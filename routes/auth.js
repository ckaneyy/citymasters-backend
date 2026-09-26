const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const db = require('../db');

const router = express.Router();

function issueToken(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

router.post('/signup', async (req, res) => {
  try {
    const { email, password, username } = req.body || {};
    if (!email || !password || password.length < 8) {
      return res.status(400).json({ error: 'invalid_input', message: 'Email requis et mot de passe de 8 caractères minimum.' });
    }
    if (!username || !/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
      return res.status(400).json({ error: 'invalid_username', message: 'Pseudo de 3 à 20 caractères (lettres, chiffres, underscore).' });
    }
    const { rows: emailRows } = await db.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (emailRows.length) return res.status(409).json({ error: 'email_taken' });
    const { rows: usernameRows } = await db.query('SELECT id FROM users WHERE username = $1', [username]);
    if (usernameRows.length) return res.status(409).json({ error: 'username_taken' });

    const userId = uuid();
    const passwordHash = bcrypt.hashSync(password, 10);
    const now = Date.now();

    await db.query(
      'INSERT INTO users (id, email, username, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)',
      [userId, email.toLowerCase(), username, passwordHash, now]
    );
    await db.query(
      'INSERT INTO players (user_id, citycoin, charges, last_update, premium) VALUES ($1, 500, 10, $2, false)',
      [userId, now]
    );

    res.json({ token: issueToken(userId) });
  } catch (err) {
    console.error('signup error', err);
    res.status(500).json({ error: 'server_error' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body || {};
    const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [(email || '').toLowerCase()]);
    const user = rows[0];
    if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
      return res.status(401).json({ error: 'invalid_credentials' });
    }
    res.json({ token: issueToken(user.id) });
  } catch (err) {
    console.error('login error', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// --- Demande de réinitialisation : génère un code à 6 chiffres valable 30 minutes ---
// NOTE : pour que l'email parte réellement, il faut configurer un service d'envoi
// (ex: Resend, gratuit jusqu'à un certain volume) et renseigner RESEND_API_KEY.
// Sans ça, le code est simplement affiché dans les logs Railway (utile pour tester).
router.post('/request-reset', async (req, res) => {
  try {
    const { email } = req.body || {};
    const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [(email || '').toLowerCase()]);
    const user = rows[0];
    // Réponse identique que le compte existe ou non, pour ne pas révéler les emails inscrits.
    if (!user) return res.json({ ok: true });

    const resetCode = String(Math.floor(100000 + Math.random() * 900000));
    const expires = Date.now() + 30 * 60 * 1000;
    await db.query('UPDATE users SET reset_token = $1, reset_expires = $2 WHERE id = $3', [resetCode, expires, user.id]);

    if (process.env.RESEND_API_KEY) {
      try {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + process.env.RESEND_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            from: process.env.RESEND_FROM || 'CityMasters <onboarding@resend.dev>',
            to: user.email,
            subject: 'Réinitialise ton mot de passe CityMasters',
            html: `<p>Ton code de réinitialisation : <b>${resetCode}</b></p><p>Valable 30 minutes.</p>`,
          }),
        });
      } catch (mailErr) {
        console.error('Échec envoi email reset', mailErr);
      }
    } else {
      console.log(`[RESET] Code pour ${user.email} : ${resetCode} (RESEND_API_KEY non configurée, email non envoyé)`);
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('request-reset error', err);
    res.status(500).json({ error: 'server_error' });
  }
});

// --- Confirmation : code + nouveau mot de passe ---
router.post('/reset-password', async (req, res) => {
  try {
    const { email, token, newPassword } = req.body || {};
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'invalid_input', message: 'Mot de passe de 8 caractères minimum.' });
    }
    const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [(email || '').toLowerCase()]);
    const user = rows[0];
    if (!user || user.reset_token !== token || !user.reset_expires || Number(user.reset_expires) < Date.now()) {
      return res.status(400).json({ error: 'invalid_token', message: 'Code invalide ou expiré.' });
    }
    const passwordHash = bcrypt.hashSync(newPassword, 10);
    await db.query('UPDATE users SET password_hash = $1, reset_token = NULL, reset_expires = NULL WHERE id = $2', [passwordHash, user.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('reset-password error', err);
    res.status(500).json({ error: 'server_error' });
  }
});

module.exports = router;
