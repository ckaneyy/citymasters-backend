const express = require('express');
const { v4: uuid } = require('uuid');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const {
  MAX_LISTINGS_FREE, MAX_LISTINGS_PREMIUM, AUCTION_DURATION_MS, MAYOR_COMMISSION, computeMayor,
} = require('../lib/game');

const router = express.Router();
router.use(requireAuth);

// Transfère une carte vendue : débite/crédite les CityCoin, verse la commission
// au maire de la ville, enregistre la transaction. Réutilisé par les enchères
// classiques (à l'expiration) et par l'achat rapide (immédiat).
async function transferCard(card, buyerId, finalPrice) {
  const { rows: buyerRows } = await db.query('SELECT * FROM players WHERE user_id = $1', [buyerId]);
  const buyer = buyerRows[0];
  const { rows: sellerRows } = await db.query('SELECT * FROM players WHERE user_id = $1', [card.owner_id]);
  const seller = sellerRows[0];
  const mayor = await computeMayor(db, card.city_id);
  let commission = 0;
  if (mayor.ownerId && mayor.ownerId !== card.owner_id) {
    commission = Math.round(finalPrice * MAYOR_COMMISSION);
  }

  await db.query('UPDATE players SET citycoin = citycoin - $1 WHERE user_id = $2', [finalPrice, buyer.user_id]);
  await db.query('UPDATE players SET citycoin = citycoin + $1 WHERE user_id = $2', [finalPrice - commission, seller.user_id]);
  if (commission > 0) {
    await db.query('UPDATE players SET citycoin = citycoin + $1 WHERE user_id = $2', [commission, mayor.ownerId]);
  }
  await db.query(
    'UPDATE cards SET owner_id = $1, listed = false, price = NULL, buy_now_price = NULL, current_bidder = NULL, ends_at = NULL WHERE id = $2',
    [buyer.user_id, card.id]
  );
  await db.query(
    'INSERT INTO transactions (id, city_id, shiny, price, buyer_id, seller_id, ts) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [uuid(), card.city_id, card.shiny, finalPrice, buyer.user_id, seller.user_id, Date.now()]
  );
}

// Règle son affaire à une enchère expirée : transfère la carte au plus offrant.
// Idempotente : si déjà réglée, ne fait rien.
async function settleAuction(cardId) {
  const { rows } = await db.query('SELECT * FROM cards WHERE id = $1', [cardId]);
  const card = rows[0];
  if (!card || !card.listed) return;

  if (!card.current_bidder) {
    await db.query('UPDATE cards SET listed = false, price = NULL, buy_now_price = NULL, ends_at = NULL WHERE id = $1', [cardId]);
    return;
  }

  const { rows: buyerRows } = await db.query('SELECT * FROM players WHERE user_id = $1', [card.current_bidder]);
  const buyer = buyerRows[0];
  if (!buyer || buyer.citycoin < card.price) {
    await db.query('UPDATE cards SET listed = false, price = NULL, buy_now_price = NULL, current_bidder = NULL, ends_at = NULL WHERE id = $1', [cardId]);
    return;
  }

  await transferCard(card, card.current_bidder, card.price);
}

async function settleAllExpired() {
  const { rows } = await db.query('SELECT id FROM cards WHERE listed = true AND ends_at <= $1', [Date.now()]);
  for (const row of rows) await settleAuction(row.id);
}

// --- Mettre une carte aux enchères (avec option d'achat rapide) ---
router.post('/list', async (req, res) => {
  try {
    const { cardId, price, buyNowPrice } = req.body || {};
    const { rows } = await db.query('SELECT * FROM cards WHERE id = $1', [cardId]);
    const card = rows[0];
    if (!card || card.owner_id !== req.userId) return res.status(404).json({ error: 'card_not_found' });
    if (card.listed) return res.status(400).json({ error: 'already_listed' });
    if (!Number.isInteger(price) || price <= 0) return res.status(400).json({ error: 'invalid_price' });
    let buyNow = null;
    if (buyNowPrice !== undefined && buyNowPrice !== null && buyNowPrice !== '') {
      if (!Number.isInteger(buyNowPrice) || buyNowPrice <= price) {
        return res.status(400).json({ error: 'invalid_buy_now_price', message: "Le prix d'achat rapide doit être supérieur à la mise à prix." });
      }
      buyNow = buyNowPrice;
    }

    const { rows: playerRows } = await db.query('SELECT * FROM players WHERE user_id = $1', [req.userId]);
    const player = playerRows[0];
    const maxListings = player.premium ? MAX_LISTINGS_PREMIUM : MAX_LISTINGS_FREE;
    const { rows: activeRows } = await db.query(
      'SELECT COUNT(*) as n FROM cards WHERE owner_id = $1 AND listed = true', [req.userId]
    );
    if (Number(activeRows[0].n) >= maxListings) {
      return res.status(400).json({ error: 'listing_cap_reached', maxListings });
    }

    await db.query(
      'UPDATE cards SET listed = true, price = $1, buy_now_price = $2, current_bidder = NULL, ends_at = $3 WHERE id = $4',
      [price, buyNow, Date.now() + AUCTION_DURATION_MS, cardId]
    );
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

// --- Voir les enchères en cours (règle d'abord celles qui sont expirées) ---
router.get('/', async (req, res) => {
  try {
    await settleAllExpired();
    const { rows } = await db.query('SELECT * FROM cards WHERE listed = true ORDER BY ends_at ASC');
    res.json({ listings: rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

// --- Enchérir sur une carte ---
router.post('/bid', async (req, res) => {
  try {
    const { cardId, amount } = req.body || {};
    await settleAllExpired();
    const { rows } = await db.query('SELECT * FROM cards WHERE id = $1', [cardId]);
    const card = rows[0];
    if (!card || !card.listed) return res.status(404).json({ error: 'listing_not_found' });
    if (card.owner_id === req.userId) return res.status(400).json({ error: 'cannot_bid_own_card' });
    if (!Number.isInteger(amount) || amount <= card.price) {
      return res.status(400).json({ error: 'bid_too_low', minBid: card.price + 1 });
    }
    const { rows: playerRows } = await db.query('SELECT * FROM players WHERE user_id = $1', [req.userId]);
    const player = playerRows[0];
    if (player.citycoin < amount) return res.status(400).json({ error: 'insufficient_funds' });

    await db.query('UPDATE cards SET price = $1, current_bidder = $2 WHERE id = $3', [amount, req.userId, cardId]);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

// --- Achat rapide : achète immédiatement au prix fixé, sans attendre l'enchère ---
router.post('/buy-now', async (req, res) => {
  try {
    const { cardId } = req.body || {};
    await settleAllExpired();
    const { rows } = await db.query('SELECT * FROM cards WHERE id = $1', [cardId]);
    const card = rows[0];
    if (!card || !card.listed || !card.buy_now_price) return res.status(404).json({ error: 'buy_now_unavailable' });
    if (card.owner_id === req.userId) return res.status(400).json({ error: 'cannot_buy_own_card' });

    const { rows: playerRows } = await db.query('SELECT * FROM players WHERE user_id = $1', [req.userId]);
    const player = playerRows[0];
    if (player.citycoin < card.buy_now_price) return res.status(400).json({ error: 'insufficient_funds' });

    await transferCard(card, req.userId, card.buy_now_price);
    res.json({ ok: true });
  } catch (err) { console.error(err); res.status(500).json({ error: 'server_error' }); }
});

module.exports = { router, settleAllExpired };
