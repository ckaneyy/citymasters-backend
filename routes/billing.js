const express = require('express');
const Stripe = require('stripe');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const router = express.Router();

// Packs de CityCoin — prix fixés ici (ajustables librement, aucune configuration
// Stripe préalable nécessaire puisqu'on utilise price_data à la volée).
const COIN_PACKAGES = {
  small:  { coins: 500,  cents: 299,  label: '500 CityCoin' },
  medium: { coins: 1500, cents: 699,  label: '1500 CityCoin' },
  large:  { coins: 5000, cents: 1999, label: '5000 CityCoin' },
};

// --- Démarre un abonnement Premium via Stripe Checkout ---
router.post('/create-checkout-session', requireAuth, async (req, res) => {
  try {
    const { rows: playerRows } = await db.query('SELECT * FROM players WHERE user_id = $1', [req.userId]);
    const player = playerRows[0];
    const { rows: userRows } = await db.query('SELECT * FROM users WHERE id = $1', [req.userId]);
    const user = userRows[0];

    let customerId = player.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, metadata: { userId: req.userId } });
      customerId = customer.id;
      await db.query('UPDATE players SET stripe_customer_id = $1 WHERE user_id = $2', [customerId, req.userId]);
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [{ price: process.env.STRIPE_PREMIUM_PRICE_ID, quantity: 1 }],
      success_url: `${process.env.FRONTEND_URL}/premium/success`,
      cancel_url: `${process.env.FRONTEND_URL}/premium/cancel`,
      metadata: { userId: req.userId, type: 'premium' },
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'stripe_error', message: err.message });
  }
});

// --- Achat ponctuel de CityCoin ---
router.post('/create-coin-checkout', requireAuth, async (req, res) => {
  try {
    const { pkg } = req.body || {};
    const chosen = COIN_PACKAGES[pkg];
    if (!chosen) return res.status(400).json({ error: 'invalid_package' });

    const { rows: playerRows } = await db.query('SELECT * FROM players WHERE user_id = $1', [req.userId]);
    const player = playerRows[0];
    const { rows: userRows } = await db.query('SELECT * FROM users WHERE id = $1', [req.userId]);
    const user = userRows[0];

    let customerId = player.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, metadata: { userId: req.userId } });
      customerId = customer.id;
      await db.query('UPDATE players SET stripe_customer_id = $1 WHERE user_id = $2', [customerId, req.userId]);
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customerId,
      line_items: [{
        price_data: {
          currency: 'eur',
          product_data: { name: 'CityMasters — ' + chosen.label },
          unit_amount: chosen.cents,
        },
        quantity: 1,
      }],
      success_url: `${process.env.FRONTEND_URL}/coins/success`,
      cancel_url: `${process.env.FRONTEND_URL}/coins/cancel`,
      metadata: { userId: req.userId, type: 'coins', amount: String(chosen.coins) },
    });
    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'stripe_error', message: err.message });
  }
});

// --- Webhook Stripe : IMPORTANT, cette route a besoin du corps brut (raw),
// voir server.js où express.raw() est appliqué spécifiquement sur cette route
// avant express.json() global. ---
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;
      const userId = session.metadata?.userId;
      if (userId && session.metadata?.type === 'coins') {
        const amount = parseInt(session.metadata.amount, 10) || 0;
        await db.query('UPDATE players SET citycoin = citycoin + $1 WHERE user_id = $2', [amount, userId]);
      } else if (userId) {
        await db.query(
          'UPDATE players SET premium = true, stripe_subscription_id = $1 WHERE user_id = $2',
          [session.subscription, userId]
        );
      }
    }

    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object;
      await db.query(
        'UPDATE players SET premium = false, stripe_subscription_id = NULL WHERE stripe_subscription_id = $1',
        [sub.id]
      );
    }
  } catch (err) {
    console.error('webhook handling error', err);
  }

  res.json({ received: true });
});

module.exports = router;
