// Base de données PostgreSQL — fournie nativement par Railway (onglet "New" >
// "Database" > "PostgreSQL" dans ton projet), sans module natif fragile
// contrairement à SQLite. Railway injecte automatiquement DATABASE_URL.

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')
    ? { rejectUnauthorized: false }
    : false,
});

async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS players (
      user_id TEXT PRIMARY KEY REFERENCES users(id),
      citycoin INTEGER NOT NULL DEFAULT 500,
      charges INTEGER NOT NULL DEFAULT 10,
      last_update BIGINT NOT NULL,
      premium BOOLEAN NOT NULL DEFAULT false,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT
    );

    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      city_id TEXT NOT NULL,
      shiny BOOLEAN NOT NULL DEFAULT false,
      created_at BIGINT NOT NULL,
      listed BOOLEAN NOT NULL DEFAULT false,
      price INTEGER,
      current_bidder TEXT,
      ends_at BIGINT
    );
    CREATE INDEX IF NOT EXISTS idx_cards_owner ON cards(owner_id);
    CREATE INDEX IF NOT EXISTS idx_cards_city ON cards(city_id);
    CREATE INDEX IF NOT EXISTS idx_cards_listed ON cards(listed);

    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      city_id TEXT NOT NULL,
      shiny BOOLEAN NOT NULL,
      price INTEGER NOT NULL,
      buyer_id TEXT NOT NULL,
      seller_id TEXT NOT NULL,
      ts BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tx_buyer ON transactions(buyer_id);
    CREATE INDEX IF NOT EXISTS idx_tx_seller ON transactions(seller_id);
  `);
}

module.exports = { pool, init, query: (text, params) => pool.query(text, params) };
