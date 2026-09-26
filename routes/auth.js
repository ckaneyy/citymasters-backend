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

module.exports = router;
