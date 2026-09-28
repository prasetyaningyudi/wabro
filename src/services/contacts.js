import { db, now } from '../db/index.js';
import { config } from '../config.js';

const SELECT_ALL = 'SELECT * FROM contacts';

export function normalizePhone(input) {
  let digits = String(input || '').replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00')) digits = digits.slice(2);
  const cc = config.defaultCc;
  if (digits.startsWith('0')) {
    digits = cc + digits.slice(1);
  } else if (!digits.startsWith(cc)) {
    digits = cc + digits;
  }
  if (digits.length < 9 || digits.length > 15) return null;
  return digits;
}

export function jidFor(phone) {
  return `${phone}@s.whatsapp.net`;
}

export function listContacts({ q = '', tag = '', limit = 500, offset = 0 } = {}) {
  const where = [];
  const params = [];
  if (q) {
    where.push('(phone LIKE ? OR name LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (tag) {
    where.push('(tags = ? OR tags LIKE ? OR tags LIKE ? OR tags LIKE ?)');
    params.push(tag, `${tag},%`, `%,${tag}`, `%,${tag},%`);
  }
  const sql =
    SELECT_ALL +
    (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
    ' ORDER BY id DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  const rows = db.prepare(sql).all(...params);
  const total = db
    .prepare(
      `SELECT COUNT(*) AS c FROM contacts${
        where.length ? ` WHERE ${where.join(' AND ')}` : ''
      }`
    )
    .get(...params.slice(0, params.length - 2)).c;
  return { rows, total };
}

export function getContact(id) {
  return db.prepare('SELECT * FROM contacts WHERE id = ?').get(id);
}

export function createContact({ name = '', phone, tags = '' }) {
  const normalized = normalizePhone(phone);
  if (!normalized) throw new Error('Nomor tidak valid');
  const existing = db.prepare('SELECT id FROM contacts WHERE phone = ?').get(normalized);
  if (existing) throw new Error(`Nomor ${phone} sudah ada di daftar kontak`);
  const info = db
    .prepare(
      'INSERT INTO contacts (name, phone, tags, created_at) VALUES (?, ?, ?, ?)'
    )
    .run(name.trim(), normalized, normalizeTags(tags), now());
  return getContact(info.lastInsertRowid);
}

export function updateContact(id, { name = '', phone, tags = '' }) {
  const normalized = normalizePhone(phone);
  if (!normalized) throw new Error('Nomor tidak valid');
  const existing = db
    .prepare('SELECT id FROM contacts WHERE phone = ? AND id != ?')
    .get(normalized, id);
  if (existing) throw new Error(`Nomor ${phone} sudah dipakai kontak lain`);
  db.prepare('UPDATE contacts SET name = ?, phone = ?, tags = ? WHERE id = ?').run(
    name.trim(),
    normalized,
    normalizeTags(tags),
    id
  );
  return getContact(id);
}

export function deleteContact(id) {
  return db.prepare('DELETE FROM contacts WHERE id = ?').run(id);
}

export function normalizeTags(tags) {
  if (Array.isArray(tags)) return [...new Set(tags.map((t) => t.trim()).filter(Boolean))].join(',');
  return [...new Set(String(tags || '').split(/[;,]/).map((t) => t.trim()).filter(Boolean))].join(',');
}

export function allTags() {
  const rows = db.prepare('SELECT tags FROM contacts WHERE tags != ?').all('');
  const set = new Set();
  for (const row of rows) {
    for (const t of row.tags.split(',')) if (t) set.add(t);
  }
  return [...set].sort();
}

export function contactsBySelector(selector, selectorValue) {
  if (selector === 'tag') {
    const tag = selectorValue.trim();
    if (!tag) return [];
    return db
      .prepare(
        `SELECT * FROM contacts WHERE tags = ? OR tags LIKE ? OR tags LIKE ? OR tags LIKE ? ORDER BY id`
      )
      .all(tag, `${tag},%`, `%,${tag}`, `%,${tag},%`);
  }
  if (selector === 'ids') {
    const ids = String(selectorValue)
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => Number.isInteger(n));
    if (!ids.length) return [];
    const stmt = db.prepare('SELECT * FROM contacts WHERE id = ?');
    return ids.map((id) => stmt.get(id)).filter(Boolean);
  }
  return db.prepare('SELECT * FROM contacts ORDER BY id').all();
}
