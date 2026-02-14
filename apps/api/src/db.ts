import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import Database from "better-sqlite3";

const schemaSql = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS apps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  store_id TEXT NOT NULL UNIQUE,
  bundle_id TEXT,
  platform TEXT NOT NULL DEFAULT 'ios',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS competitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  store_id TEXT UNIQUE,
  bundle_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS keywords (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  term TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS locales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  country TEXT NOT NULL,
  language TEXT NOT NULL DEFAULT 'en',
  UNIQUE(country, language)
);

INSERT OR IGNORE INTO locales (country, language) VALUES ('US', 'en');

CREATE TABLE IF NOT EXISTS tracking_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id INTEGER NOT NULL,
  keyword_id INTEGER NOT NULL,
  locale_id INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(app_id) REFERENCES apps(id) ON DELETE CASCADE,
  FOREIGN KEY(keyword_id) REFERENCES keywords(id) ON DELETE CASCADE,
  FOREIGN KEY(locale_id) REFERENCES locales(id) ON DELETE CASCADE,
  UNIQUE(app_id, keyword_id, locale_id)
);

CREATE TABLE IF NOT EXISTS runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error TEXT,
  total_targets INTEGER NOT NULL DEFAULT 0,
  successful_targets INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS asa_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  error TEXT,
  total_keywords INTEGER NOT NULL DEFAULT 0,
  successful_keywords INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS rank_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_id INTEGER NOT NULL,
  run_id INTEGER,
  rank INTEGER,
  found INTEGER NOT NULL DEFAULT 0,
  source TEXT NOT NULL DEFAULT 'manual',
  checked_at TEXT NOT NULL,
  FOREIGN KEY(target_id) REFERENCES tracking_targets(id) ON DELETE CASCADE,
  FOREIGN KEY(run_id) REFERENCES runs(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS metadata_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id INTEGER NOT NULL,
  locale_id INTEGER NOT NULL,
  title TEXT,
  subtitle TEXT,
  description TEXT,
  checked_at TEXT NOT NULL,
  FOREIGN KEY(app_id) REFERENCES apps(id) ON DELETE CASCADE,
  FOREIGN KEY(locale_id) REFERENCES locales(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS keyword_popularity_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword_id INTEGER NOT NULL,
  locale_id INTEGER NOT NULL,
  asa_run_id INTEGER,
  popularity_score INTEGER,
  source TEXT NOT NULL DEFAULT 'asa_api',
  checked_at TEXT NOT NULL,
  FOREIGN KEY(keyword_id) REFERENCES keywords(id) ON DELETE CASCADE,
  FOREIGN KEY(locale_id) REFERENCES locales(id) ON DELETE CASCADE,
  FOREIGN KEY(asa_run_id) REFERENCES asa_runs(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_rank_snapshots_target_date
ON rank_snapshots(target_id, checked_at);

CREATE INDEX IF NOT EXISTS idx_metadata_snapshots_app_locale_date
ON metadata_snapshots(app_id, locale_id, checked_at);

CREATE INDEX IF NOT EXISTS idx_keyword_popularity_keyword_locale_date
ON keyword_popularity_snapshots(keyword_id, locale_id, checked_at);
`;

const defaultDbPath = resolve(process.cwd(), "data", "aso.sqlite");

export function initDb(dbPath = defaultDbPath) {
  mkdirSync(dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);
  db.exec(schemaSql);

  return db;
}
