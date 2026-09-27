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
      created_at BIGINT NOT NULL,
      reset_token TEXT,
      reset_expires BIGINT
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
      buy_now_price INTEGER,
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

    CREATE TABLE IF NOT EXISTS friendships (
      id TEXT PRIMARY KEY,
      requester_id TEXT NOT NULL,
      addressee_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_friend_requester ON friendships(requester_id);
    CREATE INDEX IF NOT EXISTS idx_friend_addressee ON friendships(addressee_id);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      from_id TEXT NOT NULL,
      to_id TEXT NOT NULL,
      body TEXT NOT NULL,
      ts BIGINT NOT NULL,
      read BOOLEAN NOT NULL DEFAULT false
    );
    CREATE INDEX IF NOT EXISTS idx_msg_from ON messages(from_id);
    CREATE INDEX IF NOT EXISTS idx_msg_to ON messages(to_id);

    CREATE TABLE IF NOT EXISTS country_chat_messages (
      id TEXT PRIMARY KEY,
      country_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      body TEXT NOT NULL,
      ts BIGINT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ccm_country ON country_chat_messages(country_id);

    CREATE TABLE IF NOT EXISTS president_chat_messages (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      body TEXT NOT NULL,
      ts BIGINT NOT NULL
    );

    ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_expires BIGINT;
    ALTER TABLE cards ADD COLUMN IF NOT EXISTS buy_now_price INTEGER;
    ALTER TABLE players ADD COLUMN IF NOT EXISTS avatar_url TEXT;
    ALTER TABLE players ADD COLUMN IF NOT EXISTS bio TEXT;
    ALTER TABLE players ADD COLUMN IF NOT EXISTS notifications_enabled BOOLEAN NOT NULL DEFAULT true;
  `);
}

module.exports = { pool, init, query: (text, params) => pool.query(text, params) };
