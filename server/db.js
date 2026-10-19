const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'tracker.db');
const db = new Database(DB_PATH);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS municipal_branches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settlement_branches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  municipal_branch_id INTEGER NOT NULL REFERENCES municipal_branches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(municipal_branch_id, name)
);

CREATE TABLE IF NOT EXISTS devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  settlement_branch_id INTEGER NOT NULL REFERENCES settlement_branches(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('pc','printer','mfu','network','spm','sempl')),
  inventory_number TEXT NOT NULL,
  name TEXT NOT NULL,
  ip_address TEXT,
  os TEXT,
  software TEXT,
  security TEXT,
  domain_joined TEXT,
  notes TEXT,
  status TEXT NOT NULL CHECK(status IN ('working','repair','decommissioned')) DEFAULT 'working',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(settlement_branch_id, inventory_number)
);

CREATE INDEX IF NOT EXISTS idx_settlements_branch ON settlement_branches(municipal_branch_id);
CREATE INDEX IF NOT EXISTS idx_devices_settlement ON devices(settlement_branch_id);
CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);

CREATE TABLE IF NOT EXISTS device_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  action TEXT NOT NULL,          -- Тип действия: 'CREATED', 'UPDATED', 'STATUS_CHANGE', 'DELETED'
  description TEXT NOT NULL,     -- Человекочитаемое описание (например: "Статус изменен с 'Работает' на 'На ремонте'")
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_device_history_device ON device_history(device_id);
`);

module.exports = db;
