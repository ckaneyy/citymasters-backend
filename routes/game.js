const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { CITIES, CITY_BY_ID, COUNTRIES } = require('../data/cities');
const { requireAuth } = require('../middleware/auth');
const { MAX_CHARGES, computeCharges, rollPack, computeMayor } = require('../lib/game');

const router = express.Router();
router.use(requireAuth);

function getPlayer(userId) {
  return db.prepare('SELECT * FROM players WHERE user_id = ?').get(userId);
}

// --- Profil du joueur (solde, charges recalculées, statut premium) ---
router.get('/me', (req, res) => {
  const p = getPlayer(req.userId);
  if (!p) return res.status(404).json({ error: 'player_not_found' });
  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(req.userId);
  const c = computeCharges(p.charges, p.last_update, Date.now(), !!p.premium);
  if (c.charges !== p.charges || c.lastUpdate !== p.last_update) {
    db.prepare('UPDATE players SET charges = ?, last_update = ? WHERE user_id = ?')
      .run(c.charges, c.lastUpdate, req.userId);
  }
  res.json({
    username: user?.username,
    citycoin: p.citycoin,
    premium: !!p.premium,
    charges: c.charges,
    maxCharges: MAX_CHARGES,
    nextChargeAt: c.charges < MAX_CHARGES ? c.lastUpdate + (p.premium ? 3 * 60 * 1000 : 15 * 60 * 1000) : null,
  });
});

// --- Résout des identifiants de joueur en pseudos affichables ---
router.get('/profiles', (req, res) => {
  const ids = (req.query.ids || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!ids.length) return res.json({ profiles: {} });
  const placeholders = ids.map(() => '?').join(',');
  const rows = db.prepare(`SELECT id, username FROM users WHERE id IN (${placeholders})`).all(...ids);
  const map = {};
  rows.forEach(r => { map[r.id] = r.username; });
  res.json({ profiles: map });
});

// --- Toutes les cartes du joueur, une par une (pour les mettre aux enchères) ---
router.get('/my-cards', (req, res) => {
  const rows = db.prepare('SELECT * FROM cards WHERE owner_id = ? ORDER BY created_at DESC').all(req.userId);
  res.json({ cards: rows });
});

// --- Ouvrir un pack (5 cartes) — logique tirée au sort côté SERVEUR ---
router.post('/packs/open', (req, res) => {
  const p = getPlayer(req.userId);
  const now = Date.now();
  const c = computeCharges(p.charges, p.last_update, now, !!p.premium);
  if (c.charges < 1) {
    return res.status(400).json({ error: 'no_charges', message: 'Aucun pack disponible pour le moment.' });
  }

  const pulls = rollPack();
  const insert = db.prepare(
    'INSERT INTO cards (id, owner_id, city_id, shiny, created_at, listed) VALUES (?, ?, ?, ?, ?, 0)'
  );
  const tx = db.transaction(() => {
    for (const pull of pulls) {
      insert.run(uuid(), req.userId, pull.city.id, pull.shiny ? 1 : 0, now);
    }
    db.prepare('UPDATE players SET charges = ?, last_update = ? WHERE user_id = ?')
      .run(c.charges - 1, c.lastUpdate, req.userId);
  });
  tx();

  const result = pulls.map(pull => {
    const mayor = computeMayor(db, pull.city.id);
    return {
      city: pull.city,
      shiny: pull.shiny,
      mayor: mayor.ownerId ? { userId: mayor.ownerId, isYou: mayor.ownerId === req.userId } : null,
    };
  });
  res.json({ pulls: result });
});

// --- Villes : liste + maire calculé en direct ---
router.get('/cities', (req, res) => {
  const list = CITIES.map(c => {
    const mayor = computeMayor(db, c.id);
    return { ...c, mayorId: mayor.ownerId, mayorScore: mayor.score, normalInCirculation: mayor.normalTotal };
  });
  res.json({ cities: list, countries: COUNTRIES });
});

router.get('/cities/:id', (req, res) => {
  const city = CITY_BY_ID[req.params.id];
  if (!city) return res.status(404).json({ error: 'city_not_found' });
  const mayor = computeMayor(db, city.id);
  const mine = db.prepare('SELECT shiny, COUNT(*) as n FROM cards WHERE city_id = ? AND owner_id = ? GROUP BY shiny')
    .all(city.id, req.userId);
  const mineNormal = mine.find(r => r.shiny === 0)?.n || 0;
  const mineShiny = mine.find(r => r.shiny === 1)?.n || 0;
  res.json({
    city, mayorId: mayor.ownerId, mayorScore: mayor.score,
    normalInCirculation: mayor.normalTotal, shinyValueInNormals: mayor.normalTotal / 20,
    yourCards: { normal: mineNormal, shiny: mineShiny },
  });
});

// --- Pays : président = maire de toutes les villes du pays ---
router.get('/countries/:id/president', (req, res) => {
  const citiesInCountry = CITIES.filter(c => c.country === req.params.id);
  if (!citiesInCountry.length) return res.status(404).json({ error: 'country_not_found' });
  const mayorIds = citiesInCountry.map(c => computeMayor(db, c.id).ownerId);
  const presidentId = mayorIds.every(id => id && id === mayorIds[0]) ? mayorIds[0] : null;
  res.json({ presidentId });
});

// --- Collection du joueur, groupée par ville ---
router.get('/collection', (req, res) => {
  const rows = db.prepare('SELECT city_id, shiny, COUNT(*) as n FROM cards WHERE owner_id = ? GROUP BY city_id, shiny')
    .all(req.userId);
  const byCity = {};
  for (const r of rows) {
    byCity[r.city_id] = byCity[r.city_id] || { normal: 0, shiny: 0 };
    byCity[r.city_id][r.shiny ? 'shiny' : 'normal'] = r.n;
  }
  res.json({ collection: byCity });
});

// --- Classement des plus gros collectionneurs + stats serveur ---
router.get('/leaderboard', (req, res) => {
  const rows = db.prepare(
    'SELECT owner_id, COUNT(*) as n FROM cards GROUP BY owner_id ORDER BY n DESC LIMIT 10'
  ).all();
  const totalCards = db.prepare('SELECT COUNT(*) as n FROM cards').get().n;
  const totalPlayers = db.prepare('SELECT COUNT(DISTINCT owner_id) as n FROM cards').get().n;
  res.json({
    top: rows.map(r => ({ userId: r.owner_id, cardCount: r.n })),
    packsOpened: Math.floor(totalCards / 5),
    activePlayers: totalPlayers,
  });
});

// --- Historique des transactions du joueur ---
router.get('/history', (req, res) => {
  const rows = db.prepare(
    'SELECT * FROM transactions WHERE buyer_id = ? OR seller_id = ? ORDER BY ts DESC LIMIT 100'
  ).all(req.userId, req.userId);
  res.json({ transactions: rows });
});

module.exports = router;
