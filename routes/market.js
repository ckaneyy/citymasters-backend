const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const {
  MAX_LISTINGS_FREE, MAX_LISTINGS_PREMIUM, AUCTION_DURATION_MS, MAYOR_COMMISSION, computeMayor,
} = require('../lib/game');

const router = express.Router();
router.use(requireAuth);

// Règle son affaire à une enchère expirée : transfère la carte au plus offrant,
// débite/crédite les CityCoin, verse la commission au maire de la ville.
// Appelée automatiquement à chaque lecture du marché (voir GET /market) et par
// le job périodique dans server.js — idempotente : si déjà réglée, ne fait rien.
function settleAuction(cardId) {
  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId);
  if (!card || !card.listed) return;
  if (!card.current_bidder) {
    db.prepare('UPDATE cards SET listed = 0, price = NULL, ends_at = NULL WHERE id = ?').run(cardId);
    return;
  }
  const buyer = db.prepare('SELECT * FROM players WHERE user_id = ?').get(card.current_bidder);
  if (!buyer || buyer.citycoin < card.price) {
    db.prepare('UPDATE cards SET listed = 0, price = NULL, current_bidder = NULL, ends_at = NULL WHERE id = ?').run(cardId);
    return;
  }
  const seller = db.prepare('SELECT * FROM players WHERE user_id = ?').get(card.owner_id);
  const mayor = computeMayor(db, card.city_id);
  let commission = 0;
  if (mayor.ownerId && mayor.ownerId !== card.owner_id) {
    commission = Math.round(card.price * MAYOR_COMMISSION);
  }

  const tx = db.transaction(() => {
    db.prepare('UPDATE players SET citycoin = citycoin - ? WHERE user_id = ?').run(card.price, buyer.user_id);
    db.prepare('UPDATE players SET citycoin = citycoin + ? WHERE user_id = ?').run(card.price - commission, seller.user_id);
    if (commission > 0) {
      db.prepare('UPDATE players SET citycoin = citycoin + ? WHERE user_id = ?').run(commission, mayor.ownerId);
    }
    db.prepare('UPDATE cards SET owner_id = ?, listed = 0, price = NULL, current_bidder = NULL, ends_at = NULL WHERE id = ?')
      .run(buyer.user_id, cardId);
    db.prepare('INSERT INTO transactions (id, city_id, shiny, price, buyer_id, seller_id, ts) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(uuid(), card.city_id, card.shiny, card.price, buyer.user_id, seller.user_id, Date.now());
  });
  tx();
}

function settleAllExpired() {
  const expired = db.prepare('SELECT id FROM cards WHERE listed = 1 AND ends_at <= ?').all(Date.now());
  for (const row of expired) settleAuction(row.id);
}

// --- Mettre une carte aux enchères ---
router.post('/list', (req, res) => {
  const { cardId, price } = req.body || {};
  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId);
  if (!card || card.owner_id !== req.userId) return res.status(404).json({ error: 'card_not_found' });
  if (card.listed) return res.status(400).json({ error: 'already_listed' });
  if (!Number.isInteger(price) || price <= 0) return res.status(400).json({ error: 'invalid_price' });

  const player = db.prepare('SELECT * FROM players WHERE user_id = ?').get(req.userId);
  const maxListings = player.premium ? MAX_LISTINGS_PREMIUM : MAX_LISTINGS_FREE;
  const activeListings = db.prepare('SELECT COUNT(*) as n FROM cards WHERE owner_id = ? AND listed = 1').get(req.userId).n;
  if (activeListings >= maxListings) {
    return res.status(400).json({ error: 'listing_cap_reached', maxListings });
  }

  db.prepare('UPDATE cards SET listed = 1, price = ?, current_bidder = NULL, ends_at = ? WHERE id = ?')
    .run(price, Date.now() + AUCTION_DURATION_MS, cardId);
  res.json({ ok: true });
});

// --- Voir les enchères en cours (règle d'abord celles qui sont expirées) ---
router.get('/', (req, res) => {
  settleAllExpired();
  const listings = db.prepare('SELECT * FROM cards WHERE listed = 1 ORDER BY ends_at ASC').all();
  res.json({ listings });
});

// --- Enchérir sur une carte ---
router.post('/bid', (req, res) => {
  const { cardId, amount } = req.body || {};
  settleAllExpired();
  const card = db.prepare('SELECT * FROM cards WHERE id = ?').get(cardId);
  if (!card || !card.listed) return res.status(404).json({ error: 'listing_not_found' });
  if (card.owner_id === req.userId) return res.status(400).json({ error: 'cannot_bid_own_card' });
  if (!Number.isInteger(amount) || amount <= card.price) {
    return res.status(400).json({ error: 'bid_too_low', minBid: card.price + 1 });
  }
  const player = db.prepare('SELECT * FROM players WHERE user_id = ?').get(req.userId);
  if (player.citycoin < amount) return res.status(400).json({ error: 'insufficient_funds' });

  db.prepare('UPDATE cards SET price = ?, current_bidder = ? WHERE id = ?').run(amount, req.userId, cardId);
  res.json({ ok: true });
});

module.exports = { router, settleAllExpired };
