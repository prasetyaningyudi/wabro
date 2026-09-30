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
    ['schedule_mode', "TEXT NOT NULL DEFAULT 'delay'"]
  ],
  campaign_recipients: [['scheduled_at', 'INTEGER']]
};

for (const [table, columns] of Object.entries(MIGRATIONS)) {
  const existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name));
  for (const [name, def] of columns) {
    if (!existing.has(name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
  }
}

export function now() {
  return Date.now();
}
