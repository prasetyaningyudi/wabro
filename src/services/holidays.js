import { db, now } from '../db/index.js';

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_SKIP_ITER = 366;
const DEFAULT_WEEKEND = '6,0'; // Sabtu, Minggu (getDay: 0=Minggu..6=Sabtu)

export const WEEKDAYS = [
  { value: 1, label: 'Senin' },
  { value: 2, label: 'Selasa' },
  { value: 3, label: 'Rabu' },
  { value: 4, label: 'Kamis' },
  { value: 5, label: 'Jumat' },
  { value: 6, label: 'Sabtu' },
  { value: 0, label: 'Minggu' }
];

export function getWeekendDays() {
  const row = db.prepare("SELECT value FROM settings WHERE key = 'weekend_days'").get();
  const raw = row ? row.value : DEFAULT_WEEKEND;
  return String(raw)
    .split(',')
    .map((n) => Number.parseInt(n, 10))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
}

export function setWeekendDays(days) {
  const norm = [...new Set((Array.isArray(days) ? days : []).map((d) => Number(d)))]
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
    .sort((a, b) => a - b);
  if (norm.length === 7) throw new Error('Semua hari tidak boleh libur — paling tidak satu hari kerja');
  db.prepare(
    `INSERT INTO settings (key, value) VALUES ('weekend_days', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(norm.join(','));
  return norm;
}

export function listHolidays() {
  return db.prepare('SELECT * FROM holidays ORDER BY date').all();
}

function validDate(d) {
  const m = DATE_RE.exec(d);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const day = Number(m[3]);
  const probe = new Date(y, mo - 1, day);
  return probe.getFullYear() === y && probe.getMonth() === mo - 1 && probe.getDate() === day;
}

export function addHoliday(date, name) {
  const d = String(date || '').trim();
  if (!validDate(d)) throw new Error('Format tanggal harus YYYY-MM-DD (mis. 2026-12-25)');
  try {
    db.prepare('INSERT INTO holidays (date, name, created_at) VALUES (?, ?, ?)').run(
      d,
      String(name || '').trim(),
      now()
    );
  } catch (err) {
    if (/UNIQUE/i.test(String(err.message))) throw new Error('Tanggal itu sudah ada di daftar libur');
    throw err;
  }
  return d;
}

export function removeHoliday(id) {
  return db.prepare('DELETE FROM holidays WHERE id = ?').run(Number(id)).changes;
}

function dateKey(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// true bila tanggal (waktu lokal server) termasuk hari libur:
// hari mingguan aktif ATAU terdaftar di tabel holidays.
export function isHolidayDate(ts) {
  if (!Number.isFinite(ts)) return false;
  if (getWeekendDays().includes(new Date(ts).getDay())) return true;
  return Boolean(db.prepare('SELECT 1 FROM holidays WHERE date = ?').get(dateKey(ts)));
}

// Majukan ts sebanyak step ms sampai jatuh di hari kerja.
// Guard: bila melebihi MAX_SKIP_ITER (semua hari libur), kembalikan hasil terakhir.
export function skipHoliday(ts, stepMs) {
  let t = ts;
  const step = Number(stepMs) > 0 ? Number(stepMs) : 24 * 3600 * 1000;
  let guard = 0;
  while (isHolidayDate(t) && guard < MAX_SKIP_ITER) {
    t += step;
    guard += 1;
  }
  return t;
}
