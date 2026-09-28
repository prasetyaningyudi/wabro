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

const REPEAT_COLUMNS = [
  ['repeat_rule', "TEXT NOT NULL DEFAULT 'none'"],
  ['repeat_every', 'INTEGER NOT NULL DEFAULT 0'],
  ['repeat_unit', "TEXT NOT NULL DEFAULT 'hours'"],
  ['repeat_until', 'INTEGER'],
  ['cycle_count', 'INTEGER NOT NULL DEFAULT 0'],
  ['last_run_at', 'INTEGER']
];

const existingColumns = new Set(db.prepare('PRAGMA table_info(campaigns)').all().map((c) => c.name));
for (const [name, def] of REPEAT_COLUMNS) {
  if (!existingColumns.has(name)) {
    db.exec(`ALTER TABLE campaigns ADD COLUMN ${name} ${def}`);
  }
}

export function now() {
  return Date.now();
}
