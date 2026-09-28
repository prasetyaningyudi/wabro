import fs from 'node:fs';
import path from 'node:path';
import { db, now } from '../db/index.js';
import { config } from '../config.js';

export function mediaTypeFor(mime) {
  if (!mime) return null;
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  return 'document';
}

export function listTemplates() {
  return db.prepare('SELECT * FROM templates ORDER BY id DESC').all();
}

export function getTemplate(id) {
  return db.prepare('SELECT * FROM templates WHERE id = ?').get(id);
}

export function createTemplate({ name, body, media = null }) {
  if (!name?.trim()) throw new Error('Nama template wajib diisi');
  if (!body?.trim()) throw new Error('Isi pesan wajib diisi');
  const info = db
    .prepare(
      'INSERT INTO templates (name, body, media_path, media_type, media_mime, media_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(
      name.trim(),
      body,
      media?.path || null,
      media ? mediaTypeFor(media.mimetype) : null,
      media?.mimetype || null,
      media?.originalname || null,
      now()
    );
  return getTemplate(info.lastInsertRowid);
}

export function updateTemplate(id, { name, body, keepMedia = true }) {
  const current = getTemplate(id);
  if (!current) throw new Error('Template tidak ditemukan');
  if (!name?.trim()) throw new Error('Nama template wajib diisi');
  if (!body?.trim()) throw new Error('Isi pesan wajib diisi');
  db.prepare('UPDATE templates SET name = ?, body = ? WHERE id = ?').run(
    name.trim(),
    body,
    id
  );
  return getTemplate(id);
}

export function deleteTemplate(id) {
  const current = getTemplate(id);
  if (current?.media_path) removeUpload(current.media_path);
  return db.prepare('DELETE FROM templates WHERE id = ?').run(id);
}

export function removeUpload(relPath) {
  if (!relPath) return;
  const abs = path.join(config.uploadsDir, path.basename(relPath));
  fs.rmSync(abs, { force: true });
}
