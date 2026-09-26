require('dotenv').config();
const express = require('express');
const cors = require('cors');

const authRoutes = require('./routes/auth');
const gameRoutes = require('./routes/game');
const { router: marketRoutes, settleAllExpired } = require('./routes/market');
const billingRoutes = require('./routes/billing');

const app = express();

app.use(cors());

// Le webhook Stripe a besoin du corps de requête BRUT pour vérifier la
// signature — il doit donc être monté AVANT express.json() global.
app.use('/billing/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());

app.get('/health', (req, res) => res.json({ ok: true }));

app.use('/auth', authRoutes);
app.use('/game', gameRoutes);
app.use('/market', marketRoutes);
app.use('/billing', billingRoutes);

// Règle les enchères expirées toutes les 30 secondes même si personne
// ne consulte le marché à ce moment précis.
setInterval(settleAllExpired, 30000);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CityMasters backend démarré sur le port ${PORT}`));
