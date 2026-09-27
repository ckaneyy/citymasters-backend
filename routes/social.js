const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { CITIES, COUNTRIES } = require('../data/cities');
const { requireAuth } = require('../middleware/auth');
const { computeMayor } = require('../lib/game');

const router = express.Router();
router.use(requireAuth);

// --- Recherche d'utilisateurs par pseudo (pour ajouter un ami) ---
router.get('/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (q.length < 2) return res.json({ users: [] });
    const { rows } = await db.query(
      'SELECT id, username FROM users WHERE username ILIKE $1 AND id != $2 LIMIT 20',
      ['%' + q + '%', req.userId]
    );
    res.json({ users: rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

// --- Liste d'amis : acceptés + demandes reçues + demandes envoyées ---
router.get('/friends', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT f.*, ru.username as requester_name, au.username as addressee_name
       FROM friendships f
       JOIN users ru ON ru.id = f.requester_id
       JOIN users au ON au.id = f.addressee_id
       WHERE f.requester_id = $1 OR f.addressee_id = $1`,
      [req.userId]
    );
    const accepted = [];
    const incoming = [];
    const outgoing = [];
    for (const r of rows) {
      const otherId = r.requester_id === req.userId ? r.addressee_id : r.requester_id;
      const otherName = r.requester_id === req.userId ? r.addressee_name : r.requester_name;
      if (r.status === 'accepted') {
        accepted.push({ userId: otherId, username: otherName });
      } else if (r.status === 'pending') {
        if (r.addressee_id === req.userId) incoming.push({ requestId: r.id, userId: otherId, username: otherName });
        else outgoing.push({ requestId: r.id, userId: otherId, username: otherName });
      }
    }
    res.json({ accepted, incoming, outgoing });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

// --- Envoyer une demande d'ami ---
router.post('/friends/request', async (req, res) => {
  try {
    const { userId } = req.body || {};
    if (!userId || userId === req.userId) return res.status(400).json({ error: 'invalid_user' });
    const { rows: existing } = await db.query(
      `SELECT * FROM friendships WHERE (requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1)`,
      [req.userId, userId]
    );
    if (existing.length) return res.status(409).json({ error: 'already_exists' });
    await db.query(
      'INSERT INTO friendships (id, requester_id, addressee_id, status, created_at) VALUES ($1, $2, $3, $4, $5)',
      [uuid(), req.userId, userId, 'pending', Date.now()]
    );
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

// --- Accepter / refuser une demande ---
router.post('/friends/accept', async (req, res) => {
  try {
    const { requestId } = req.body || {};
    const { rows } = await db.query('SELECT * FROM friendships WHERE id = $1', [requestId]);
    const fr = rows[0];
    if (!fr || fr.addressee_id !== req.userId) return res.status(404).json({ error: 'not_found' });
    await db.query('UPDATE friendships SET status = $1 WHERE id = $2', ['accepted', requestId]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

router.post('/friends/decline', async (req, res) => {
  try {
    const { requestId } = req.body || {};
    const { rows } = await db.query('SELECT * FROM friendships WHERE id = $1', [requestId]);
    const fr = rows[0];
    if (!fr || (fr.addressee_id !== req.userId && fr.requester_id !== req.userId)) return res.status(404).json({ error: 'not_found' });
    await db.query('DELETE FROM friendships WHERE id = $1', [requestId]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

// --- Retirer un ami ---
router.delete('/friends/:userId', async (req, res) => {
  try {
    await db.query(
      `DELETE FROM friendships WHERE status = 'accepted' AND
       ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))`,
      [req.userId, req.params.userId]
    );
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

async function areFriends(userA, userB) {
  const { rows } = await db.query(
    `SELECT 1 FROM friendships WHERE status = 'accepted' AND
     ((requester_id = $1 AND addressee_id = $2) OR (requester_id = $2 AND addressee_id = $1))`,
    [userA, userB]
  );
  return rows.length > 0;
}

// --- Messages privés (entre amis uniquement) ---
router.get('/messages/:friendId', async (req, res) => {
  try {
    if (!(await areFriends(req.userId, req.params.friendId))) return res.status(403).json({ error: 'not_friends' });
    const { rows } = await db.query(
      `SELECT * FROM messages WHERE (from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1) ORDER BY ts ASC LIMIT 200`,
      [req.userId, req.params.friendId]
    );
    await db.query('UPDATE messages SET read = true WHERE to_id = $1 AND from_id = $2 AND read = false', [req.userId, req.params.friendId]);
    res.json({ messages: rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

router.post('/messages/:friendId', async (req, res) => {
  try {
    const { body } = req.body || {};
    if (!body || !body.trim()) return res.status(400).json({ error: 'empty_message' });
    if (!(await areFriends(req.userId, req.params.friendId))) return res.status(403).json({ error: 'not_friends' });
    await db.query(
      'INSERT INTO messages (id, from_id, to_id, body, ts, read) VALUES ($1, $2, $3, $4, $5, false)',
      [uuid(), req.userId, req.params.friendId, body.trim().slice(0, 1000), Date.now()]
    );
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

// --- Notifications : demandes d'ami en attente + messages non lus ---
router.get('/notifications', async (req, res) => {
  try {
    const { rows: pendingRows } = await db.query(
      "SELECT COUNT(*) as n FROM friendships WHERE addressee_id = $1 AND status = 'pending'", [req.userId]
    );
    const { rows: unreadRows } = await db.query(
      'SELECT COUNT(*) as n FROM messages WHERE to_id = $1 AND read = false', [req.userId]
    );
    res.json({
      pendingFriendRequests: Number(pendingRows[0].n),
      unreadMessages: Number(unreadRows[0].n),
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

// --- Chat des maires d'un pays (lecture libre, écriture réservée aux maires actuels) ---
router.get('/country-chat/:countryId', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT c.*, u.username FROM country_chat_messages c JOIN users u ON u.id = c.user_id
       WHERE c.country_id = $1 ORDER BY c.ts DESC LIMIT 100`,
      [req.params.countryId]
    );
    res.json({ messages: rows.reverse() });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

router.post('/country-chat/:countryId', async (req, res) => {
  try {
    const { body } = req.body || {};
    if (!body || !body.trim()) return res.status(400).json({ error: 'empty_message' });
    const citiesInCountry = CITIES.filter(c => c.country === req.params.countryId);
    let isMayor = false;
    for (const c of citiesInCountry) {
      const mayor = await computeMayor(db, c.id);
      if (mayor.ownerId === req.userId) { isMayor = true; break; }
    }
    if (!isMayor) return res.status(403).json({ error: 'not_a_mayor', message: 'Réservé aux maires actuels de ce pays.' });
    await db.query(
      'INSERT INTO country_chat_messages (id, country_id, user_id, body, ts) VALUES ($1, $2, $3, $4, $5)',
      [uuid(), req.params.countryId, req.userId, body.trim().slice(0, 500), Date.now()]
    );
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

// --- Chat des présidents (tous pays confondus) ---
async function getMyPresidencies(userId) {
  const countriesHeld = [];
  for (const country of COUNTRIES) {
    const citiesInCountry = CITIES.filter(c => c.country === country.id);
    const popByMayor = {};
    for (const c of citiesInCountry) {
      const mayor = await computeMayor(db, c.id);
      if (mayor.ownerId) popByMayor[mayor.ownerId] = (popByMayor[mayor.ownerId] || 0) + c.pop;
    }
    let presidentId = null, best = 0;
    for (const [uid, pop] of Object.entries(popByMayor)) if (pop > best) { best = pop; presidentId = uid; }
    if (presidentId === userId) countriesHeld.push(country.id);
  }
  return countriesHeld;
}

router.get('/presidents-chat', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT p.*, u.username FROM president_chat_messages p JOIN users u ON u.id = p.user_id
       ORDER BY p.ts DESC LIMIT 100`
    );
    res.json({ messages: rows.reverse() });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

router.post('/presidents-chat', async (req, res) => {
  try {
    const { body } = req.body || {};
    if (!body || !body.trim()) return res.status(400).json({ error: 'empty_message' });
    const held = await getMyPresidencies(req.userId);
    if (!held.length) return res.status(403).json({ error: 'not_a_president', message: "Réservé aux présidents d'un pays." });
    await db.query(
      'INSERT INTO president_chat_messages (id, user_id, body, ts) VALUES ($1, $2, $3, $4)',
      [uuid(), req.userId, body.trim().slice(0, 500), Date.now()]
    );
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

// --- Profil public d'un joueur (visible depuis Amis / Classement) ---
router.get('/profile/:userId', async (req, res) => {
  try {
    const { rows: userRows } = await db.query('SELECT username FROM users WHERE id = $1', [req.params.userId]);
    if (!userRows[0]) return res.status(404).json({ error: 'user_not_found' });
    const { rows: playerRows } = await db.query('SELECT avatar_url, bio, premium FROM players WHERE user_id = $1', [req.params.userId]);
    const player = playerRows[0] || {};

    const { rows: cardRows } = await db.query(
      'SELECT city_id, shiny, COUNT(*) as n FROM cards WHERE owner_id = $1 GROUP BY city_id, shiny',
      [req.params.userId]
    );
    const collection = {};
    for (const r of cardRows) {
      collection[r.city_id] = collection[r.city_id] || { normal: 0, shiny: 0 };
      collection[r.city_id][r.shiny ? 'shiny' : 'normal'] = Number(r.n);
    }
    const ownedCityIds = Object.keys(collection);
    const ownedCities = CITIES.filter(c => ownedCityIds.includes(c.id));
    const TIER_RANK = { 'Légendaire': 0, 'Épique': 1, 'Rare': 2, 'Commun': 3 };
    const showcase = [...ownedCities].sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier]).slice(0, 6)
      .map(c => ({ ...c, ...collection[c.id] }));

    const mayorCities = [];
    for (const c of CITIES) {
      const mayor = await computeMayor(db, c.id);
      if (mayor.ownerId === req.params.userId) mayorCities.push(c);
    }

    res.json({
      username: userRows[0].username,
      avatarUrl: player.avatar_url || null,
      bio: player.bio || '',
      premium: !!player.premium,
      totalCards: cardRows.reduce((s, r) => s + Number(r.n), 0),
      citiesDiscovered: ownedCityIds.length,
      showcase,
      mayorCities: mayorCities.map(c => ({ id: c.id, name: c.name, tier: c.tier, country: c.country })),
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

// --- Mettre à jour sa photo de profil (image encodée en base64, taille limitée) ---
router.post('/profile/avatar', async (req, res) => {
  try {
    const { dataUrl } = req.body || {};
    if (!dataUrl || !dataUrl.startsWith('data:image/')) return res.status(400).json({ error: 'invalid_image' });
    if (dataUrl.length > 700000) return res.status(400).json({ error: 'image_too_large', message: 'Image trop lourde (max ~500 Ko).' });
    await db.query('UPDATE players SET avatar_url = $1 WHERE user_id = $2', [dataUrl, req.userId]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

router.post('/profile/bio', async (req, res) => {
  try {
    const { bio } = req.body || {};
    await db.query('UPDATE players SET bio = $1 WHERE user_id = $2', [(bio || '').slice(0, 280), req.userId]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

// --- Préférence de notifications ---
router.post('/settings/notifications', async (req, res) => {
  try {
    const { enabled } = req.body || {};
    await db.query('UPDATE players SET notifications_enabled = $1 WHERE user_id = $2', [!!enabled, req.userId]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

module.exports = router;
