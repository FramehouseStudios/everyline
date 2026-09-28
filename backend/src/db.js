'use strict';
// SQLite store for the everyline control plane.
// v1 uses a local SQLite file (zero setup). The schema is relational and
// carries over unchanged if we move to Postgres later.

const Database = require('better-sqlite3');
const crypto = require('node:crypto');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS theaters (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  chain TEXT,
  city TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS auditoriums (
  id TEXT PRIMARY KEY,
  theater_id TEXT NOT NULL REFERENCES theaters(id),
  name TEXT NOT NULL,
  server_vendor TEXT,
  server_model TEXT,
  seats INTEGER,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS appliances (
  id TEXT PRIMARY KEY,
  auditorium_id TEXT NOT NULL UNIQUE REFERENCES auditoriums(id),
  label TEXT,
  api_key_hash TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'unknown',
  version TEXT,
  cue_stream_url TEXT,
  last_seen_at TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS shows (
  id TEXT PRIMARY KEY,
  auditorium_id TEXT NOT NULL REFERENCES auditoriums(id),
  title TEXT NOT NULL,
  starts_at TEXT,
  languages TEXT NOT NULL DEFAULT '["en"]',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_aud_theater ON auditoriums(theater_id);
CREATE INDEX IF NOT EXISTS idx_shows_aud ON shows(auditorium_id);
`;

function openDb(path = process.env.DATABASE_PATH || './everyline.db') {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.exec(SCHEMA);
  return db;
}

const now = () => new Date().toISOString();
const hashKey = (k) => crypto.createHash('sha256').update(String(k)).digest('hex');

module.exports = { openDb, now, hashKey };
