// server/db.js
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
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settlement_branches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  municipal_branch_id INTEGER NOT NULL REFERENCES municipal_branches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  notes TEXT,
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
  mac_address TEXT,
  os TEXT,
  software TEXT,
  security TEXT,
  domain_joined TEXT,
  notes TEXT,
  status TEXT NOT NULL CHECK(status IN ('working','repair','decommissioned')) DEFAULT 'working',
  is_online INTEGER DEFAULT 0,
  last_seen TEXT,
  deleted_at TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(settlement_branch_id, inventory_number)
);

CREATE INDEX IF NOT EXISTS idx_settlements_branch ON settlement_branches(municipal_branch_id);
CREATE INDEX IF NOT EXISTS idx_devices_settlement ON devices(settlement_branch_id);
CREATE INDEX IF NOT EXISTS idx_devices_status ON devices(status);

CREATE TABLE IF NOT EXISTS device_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_device_history_device ON device_history(device_id);
`);

// Авто-миграция колонок для существующей рабочей БД
const devCols = db.prepare("PRAGMA table_info(devices)").all().map(c => c.name);
if (!devCols.includes('is_online')) db.exec("ALTER TABLE devices ADD COLUMN is_online INTEGER DEFAULT 0");
if (!devCols.includes('last_seen')) db.exec("ALTER TABLE devices ADD COLUMN last_seen TEXT");
if (!devCols.includes('mac_address')) db.exec("ALTER TABLE devices ADD COLUMN mac_address TEXT");
if (!devCols.includes('deleted_at')) db.exec("ALTER TABLE devices ADD COLUMN deleted_at TEXT DEFAULT NULL");

const branchCols = db.prepare("PRAGMA table_info(municipal_branches)").all().map(c => c.name);
if (!branchCols.includes('notes')) db.exec("ALTER TABLE municipal_branches ADD COLUMN notes TEXT");

const settlementCols = db.prepare("PRAGMA table_info(settlement_branches)").all().map(c => c.name);
if (!settlementCols.includes('notes')) db.exec("ALTER TABLE settlement_branches ADD COLUMN notes TEXT");

db.exec("CREATE INDEX IF NOT EXISTS idx_devices_deleted ON devices(deleted_at)");

// Авто-миграция: убираем ON DELETE CASCADE из истории, если он остался со старой версии
const historySchema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='device_history'").get();
if (historySchema && historySchema.sql && historySchema.sql.toUpperCase().includes('CASCADE')) {
  db.pragma('foreign_keys = OFF');
  db.transaction(() => {
    db.exec(`
      CREATE TABLE device_history_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id INTEGER REFERENCES devices(id) ON DELETE SET NULL,
        action TEXT NOT NULL,
        description TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      INSERT INTO device_history_new (id, device_id, action, description, created_at)
      SELECT id, device_id, action, description, created_at FROM device_history;
      DROP TABLE device_history;
      ALTER TABLE device_history_new RENAME TO device_history;
      CREATE INDEX IF NOT EXISTS idx_device_history_device ON device_history(device_id);
    `);
  })();
  db.pragma('foreign_keys = ON');
}

module.exports = db;