import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { config } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

const MIGRATIONS = {
  campaigns: [
    ['repeat_rule', "TEXT NOT NULL DEFAULT 'none'"],
    ['repeat_every', 'INTEGER NOT NULL DEFAULT 0'],
    ['repeat_unit', "TEXT NOT NULL DEFAULT 'hours'"],
    ['repeat_until', 'INTEGER'],
    ['cycle_count', 'INTEGER NOT NULL DEFAULT 0'],
    ['last_run_at', 'INTEGER'],
    ['schedule_mode', "TEXT NOT NULL DEFAULT 'delay'"],
    ['source_url', 'TEXT'],
    ['last_sync_at', 'INTEGER'],
    ['last_sync_result', 'TEXT']
  ],
  campaign_recipients: [['scheduled_at', 'INTEGER']]
};

for (const [table, columns] of Object.entries(MIGRATIONS)) {
  const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  for (const [name, def] of columns) {
    if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
  }
}

// Migrasi lama: UNIQUE(campaign_id, phone) -> UNIQUE(campaign_id, phone, scheduled_at)
// (satu nomor boleh banyak baris dalam campaign Excel asal jadwalnya berbeda).
// SQLite tidak bisa mengubah constraint -> table rebuild.
{
  const tbl = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'campaign_recipients'")
    .get();
  if (tbl?.sql && /UNIQUE\s*\(\s*campaign_id\s*,\s*phone\s*\)/i.test(tbl.sql)) {
    const cols = db.prepare('PRAGMA table_info(campaign_recipients)').all().map((c) => c.name);
    const colList = cols.map((c) => `"${c}"`).join(', ');
    db.pragma('foreign_keys = OFF');
    try {
      db.exec(`
        CREATE TABLE campaign_recipients_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          campaign_id INTEGER NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
          contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
          phone TEXT NOT NULL,
          name TEXT NOT NULL DEFAULT '',
          body TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          error TEXT,
          wa_message_id TEXT,
          attempts INTEGER NOT NULL DEFAULT 0,
          scheduled_at INTEGER,
          sent_at INTEGER,
          delivered_at INTEGER,
          read_at INTEGER,
          UNIQUE(campaign_id, phone, scheduled_at)
        );
        INSERT INTO campaign_recipients_new (${colList}) SELECT ${colList} FROM campaign_recipients;
        DROP TABLE campaign_recipients;
        ALTER TABLE campaign_recipients_new RENAME TO campaign_recipients;
        CREATE INDEX IF NOT EXISTS idx_recipients_campaign_status
          ON campaign_recipients(campaign_id, status);
      `);
    } finally {
      db.pragma('foreign_keys = ON');
    }
  }
}

export function now() {
  return Date.now();
}
