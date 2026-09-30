PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL UNIQUE,
  tags TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  body TEXT NOT NULL,
  media_path TEXT,
  media_type TEXT,
  media_mime TEXT,
  media_name TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  template_id INTEGER REFERENCES templates(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  media_path TEXT,
  media_type TEXT,
  media_mime TEXT,
  media_name TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  scheduled_at INTEGER,
  delay_min_ms INTEGER NOT NULL DEFAULT 3000,
  delay_max_ms INTEGER NOT NULL DEFAULT 8000,
  selector TEXT NOT NULL DEFAULT 'all',
  selector_value TEXT NOT NULL DEFAULT '',
  total INTEGER NOT NULL DEFAULT 0,
  repeat_rule TEXT NOT NULL DEFAULT 'none',
  repeat_every INTEGER NOT NULL DEFAULT 0,
  repeat_unit TEXT NOT NULL DEFAULT 'hours',
  repeat_until INTEGER,
  cycle_count INTEGER NOT NULL DEFAULT 0,
  last_run_at INTEGER,
  schedule_mode TEXT NOT NULL DEFAULT 'delay',
  source_url TEXT,
  last_sync_at INTEGER,
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER
);

CREATE TABLE IF NOT EXISTS campaign_recipients (
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
  UNIQUE(campaign_id, phone)
);

CREATE INDEX IF NOT EXISTS idx_recipients_campaign_status
  ON campaign_recipients(campaign_id, status);
CREATE INDEX IF NOT EXISTS idx_contacts_tags ON contacts(tags);
