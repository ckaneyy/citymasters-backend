const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuid } = require('uuid');
const db = require('../db');

const router = express.Router();

function issueToken(userId) {
  return jwt.sign({ sub: userId }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

router.post('/signup', (req, res) => {
  const { email, password, username } = req.body || {};
  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: 'invalid_input', message: 'Email requis et mot de passe de 8 caractères minimum.' });
  }
  if (!username || !/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
    return res.status(400).json({ error: 'invalid_username', message: 'Pseudo de 3 à 20 caractères (lettres, chiffres, underscore).' });
  }
  const existingEmail = db.prepare('SELECT id FROM users WHERE email = ?').get(email.toLowerCase());
  if (existingEmail) return res.status(409).json({ error: 'email_taken' });
  const existingUsername = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (existingUsername) return res.status(409).json({ error: 'username_taken' });

  const userId = uuid();
  const passwordHash = bcrypt.hashSync(password, 10);
  const now = Date.now();

  db.prepare('INSERT INTO users (id, email, username, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(userId, email.toLowerCase(), username, passwordHash, now);
  db.prepare('INSERT INTO players (user_id, citycoin, charges, last_update, premium) VALUES (?, 500, 10, ?, 0)')
    .run(userId, now);

  res.json({ token: issueToken(userId) });
});

router.post('/login', (req, res) => {
  const { email, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').toLowerCase());
  if (!user || !bcrypt.compareSync(password || '', user.password_hash)) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  res.json({ token: issueToken(user.id) });
});

module.exports = router;
