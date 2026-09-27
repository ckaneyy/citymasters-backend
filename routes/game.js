const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { CITIES, CITY_BY_ID, COUNTRIES } = require('../data/cities');
const { requireAuth } = require('../middleware/auth');
const { MAX_CHARGES, computeCharges, rollPack, computeMayor } = require('../lib/game');

const router = express.Router();
router.use(requireAuth);

async function getPlayer(userId) {
  const { rows } = await db.query('SELECT * FROM players WHERE user_id = $1', [userId]);
  return rows[0];
}

// --- Profil du joueur (solde, charges recalculées, statut premium) ---
router.get('/me', async (req, res) => {
  try {
    const p = await getPlayer(req.userId);
    if (!p) return res.status(404).json({ error: 'player_not_found' });
    const { rows: userRows } = await db.query('SELECT username FROM users WHERE id = $1', [req.userId]);
    const c = computeCharges(Number(p.charges), Number(p.last_update), Date.now(), !!p.premium);
    if (c.charges !== p.charges || c.lastUpdate !== Number(p.last_update)) {
      await db.query('UPDATE players SET charges = $1, last_update = $2 WHERE user_id = $3', [c.charges, c.lastUpdate, req.userId]);
    }
    res.json({
      username: userRows[0]?.username,
      citycoin: p.citycoin,
      premium: !!p.premium,
      charges: c.charges,
      maxCharges: MAX_CHARGES,
      nextChargeAt: c.charges < MAX_CHARGES ? c.lastUpdate + (p.premium ? 3 * 60 * 1000 : 15 * 60 * 1000) : null,
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

// --- Résout des identifiants de joueur en pseudos affichables ---
router.get('/profiles', async (req, res) => {
  try {
    const ids = (req.query.ids || '').split(',').map(s => s.trim()).filter(Boolean);
    if (!ids.length) return res.json({ profiles: {} });
    const { rows } = await db.query('SELECT id, username FROM users WHERE id = ANY($1)', [ids]);
    const map = {};
    rows.forEach(r => { map[r.id] = r.username; });
    res.json({ profiles: map });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

// --- Toutes les cartes du joueur, une par une (pour les mettre aux enchères) ---
router.get('/my-cards', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM cards WHERE owner_id = $1 ORDER BY created_at DESC', [req.userId]);
    res.json({ cards: rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

// --- Ouvrir un pack (5 cartes) — logique tirée au sort côté SERVEUR ---
router.post('/packs/open', async (req, res) => {
  try {
    const p = await getPlayer(req.userId);
    const now = Date.now();
    const c = computeCharges(Number(p.charges), Number(p.last_update), now, !!p.premium);
    if (c.charges < 1) {
      return res.status(400).json({ error: 'no_charges', message: 'Aucun pack disponible pour le moment.' });
    }

    const pulls = rollPack();
    for (const pull of pulls) {
      await db.query(
        'INSERT INTO cards (id, owner_id, city_id, shiny, created_at, listed) VALUES ($1, $2, $3, $4, $5, false)',
        [uuid(), req.userId, pull.city.id, pull.shiny, now]
      );
    }
    await db.query('UPDATE players SET charges = $1, last_update = $2 WHERE user_id = $3', [c.charges - 1, c.lastUpdate, req.userId]);

    const result = [];
    for (const pull of pulls) {
      const mayor = await computeMayor(db, pull.city.id);
      result.push({
        city: pull.city,
        shiny: pull.shiny,
        mayor: mayor.ownerId ? { userId: mayor.ownerId, isYou: mayor.ownerId === req.userId } : null,
      });
    }
    res.json({ pulls: result });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

// --- Villes : liste + maire calculé en direct ---
router.get('/cities', async (req, res) => {
  try {
    const list = [];
    for (const c of CITIES) {
      const mayor = await computeMayor(db, c.id);
      list.push({ ...c, mayorId: mayor.ownerId, mayorScore: mayor.score, normalInCirculation: mayor.normalTotal });
    }
    res.json({ cities: list, countries: COUNTRIES });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

router.get('/cities/:id', async (req, res) => {
  try {
    const city = CITY_BY_ID[req.params.id];
    if (!city) return res.status(404).json({ error: 'city_not_found' });
    const mayor = await computeMayor(db, city.id);
    const { rows: mine } = await db.query(
      'SELECT shiny, COUNT(*) as n FROM cards WHERE city_id = $1 AND owner_id = $2 GROUP BY shiny',
      [city.id, req.userId]
    );
    const mineNormal = Number(mine.find(r => r.shiny === false)?.n || 0);
    const mineShiny = Number(mine.find(r => r.shiny === true)?.n || 0);
    res.json({
      city, mayorId: mayor.ownerId, mayorScore: mayor.score,
      normalInCirculation: mayor.normalTotal, shinyValueInNormals: mayor.normalTotal / 20,
      yourCards: { normal: mineNormal, shiny: mineShiny },
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

// --- Pays : président = maire de toutes les villes du pays ---
router.get('/countries/:id/president', async (req, res) => {
  try {
    const citiesInCountry = CITIES.filter(c => c.country === req.params.id);
    if (!citiesInCountry.length) return res.status(404).json({ error: 'country_not_found' });
    const mayorIds = [];
    for (const c of citiesInCountry) mayorIds.push((await computeMayor(db, c.id)).ownerId);
    const presidentId = mayorIds.every(id => id && id === mayorIds[0]) ? mayorIds[0] : null;
    res.json({ presidentId });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

// --- Collection du joueur, groupée par ville ---
router.get('/collection', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT city_id, shiny, COUNT(*) as n FROM cards WHERE owner_id = $1 GROUP BY city_id, shiny',
      [req.userId]
    );
    const byCity = {};
    for (const r of rows) {
      byCity[r.city_id] = byCity[r.city_id] || { normal: 0, shiny: 0 };
      byCity[r.city_id][r.shiny ? 'shiny' : 'normal'] = Number(r.n);
    }
    res.json({ collection: byCity });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

// --- Classement des plus gros collectionneurs + stats serveur ---
router.get('/leaderboard', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT owner_id, COUNT(*) as n FROM cards GROUP BY owner_id ORDER BY n DESC LIMIT 10'
    );
    const { rows: totalRows } = await db.query('SELECT COUNT(*) as n FROM cards');
    const { rows: playerRows } = await db.query('SELECT COUNT(DISTINCT owner_id) as n FROM cards');
    res.json({
      top: rows.map(r => ({ userId: r.owner_id, cardCount: Number(r.n) })),
      packsOpened: Math.floor(Number(totalRows[0].n) / 5),
      activePlayers: Number(playerRows[0].n),
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

// --- Historique des transactions du joueur ---
router.get('/history', async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM transactions WHERE buyer_id = $1 OR seller_id = $1 ORDER BY ts DESC LIMIT 100',
      [req.userId]
    );
    res.json({ transactions: rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

// --- Défausser une carte contre des CityCoin (valeur selon la rareté) ---
const DISCARD_VALUE = { Commun: 1, Rare: 5, Épique: 20, Légendaire: 100 };
router.post('/cards/:id/discard', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM cards WHERE id = $1', [req.params.id]);
    const card = rows[0];
    if (!card || card.owner_id !== req.userId) return res.status(404).json({ error: 'card_not_found' });
    if (card.listed) return res.status(400).json({ error: 'card_listed', message: 'Retire la carte des enchères avant de la défausser.' });

    const city = CITY_BY_ID[card.city_id];
    const value = DISCARD_VALUE[city?.tier] || 1;

    await db.query('DELETE FROM cards WHERE id = $1', [req.params.id]);
    await db.query('UPDATE players SET citycoin = citycoin + $1 WHERE user_id = $2', [value, req.userId]);

    res.json({ ok: true, earned: value });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

module.exports = router;
