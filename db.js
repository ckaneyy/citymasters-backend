// Base de données SQLite locale (fichier unique, zéro configuration).
// Pour passer à l'échelle en production, migrer vers PostgreSQL (Railway/Render
// fournissent une base Postgres gratuite ou peu chère) en remplaçant ce fichier
// par un client 'pg' — les requêtes SQL ci-dessous restent presque identiques.

const Database = require('better-sqlite3');
const db = new Database(process.env.DB_PATH || 'citymasters.db');
db.pragma('journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS players (
  user_id TEXT PRIMARY KEY,
  citycoin INTEGER NOT NULL DEFAULT 500,
  charges INTEGER NOT NULL DEFAULT 10,
  last_update INTEGER NOT NULL,
  premium INTEGER NOT NULL DEFAULT 0,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  FOREIGN KEY(user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS cards (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  city_id TEXT NOT NULL,
  shiny INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  listed INTEGER NOT NULL DEFAULT 0,
  price INTEGER,
  current_bidder TEXT,
  ends_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_cards_owner ON cards(owner_id);
CREATE INDEX IF NOT EXISTS idx_cards_city ON cards(city_id);
CREATE INDEX IF NOT EXISTS idx_cards_listed ON cards(listed);

CREATE TABLE IF NOT EXISTS transactions (
  id TEXT PRIMARY KEY,
  city_id TEXT NOT NULL,
  shiny INTEGER NOT NULL,
  price INTEGER NOT NULL,
  buyer_id TEXT NOT NULL,
  seller_id TEXT NOT NULL,
  ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tx_buyer ON transactions(buyer_id);
CREATE INDEX IF NOT EXISTS idx_tx_seller ON transactions(seller_id);
`);

module.exports = db;
