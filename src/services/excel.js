import * as XLSX from 'xlsx';
import { parse } from 'csv-parse/sync';
import { db, now } from '../db/index.js';
import { normalizePhone } from './contacts.js';
import { renderBody, getCampaign } from './campaigns.js';
import { parseSheetUrl, fetchSheet } from './sheet-source.js';

const HEADER_ALIASES = {
  phone: ['phone', 'nomor', 'no', 'number', 'no hp', 'no. hp', 'no hp.', 'wa', 'whatsapp', 'telepon', 'telp'],
  name: ['name', 'nama'],
  body: ['pesan', 'message', 'body', 'isi', 'isi pesan'],
  schedule: ['jadwal', 'schedule', 'tanggal', 'waktu', 'jam', 'date', 'time', 'tanggal jam', 'tanggal & jam']
};

const normHeader = (h) => String(h || '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/\.$/, '');

export function mapHeaders(headerRow) {
  const map = { phone: -1, name: -1, body: -1, schedule: -1 };
  headerRow.forEach((h, i) => {
    const n = normHeader(h);
    for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
      if (map[key] < 0 && aliases.includes(n)) map[key] = i;
    }
  });
  return map;
}

export function parseScheduleValue(value) {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = Math.round((value - 25569) * 86400 * 1000);
    if (!Number.isFinite(ms)) return undefined;
    const u = new Date(ms);
    if (value >= 0 && value < 1) {
      // sel murni jam (tanpa tanggal) -> hari ini, konsisten dengan cabang string "hh:mm"
      const base = new Date();
      return new Date(base.getFullYear(), base.getMonth(), base.getDate(), u.getUTCHours(), u.getUTCMinutes(), u.getUTCSeconds());
    }
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), u.getUTCHours(), u.getUTCMinutes(), u.getUTCSeconds());
  }
  const s = String(value).trim();
  if (!s) return null;

  let m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*(?:wib|wita|wit)?$/i);
  if (m) {
    let day = +m[1];
    let month = +m[2];
    const yRaw = m[3];
    const year = yRaw.length <= 2 ? (+yRaw >= 70 ? 1900 + +yRaw : 2000 + +yRaw) : +yRaw;
    const hh = m[4], mm = m[5], ss = m[6];
    if (month > 12 && day <= 12) {
      // format AS m/d/y (mis. 9/30/2026); jika keduanya <= 12 tetap d/m (prioritas dokumentasi)
      month = +m[1];
      day = +m[2];
    }
    const date = new Date(year, month - 1, day, +(hh || 0), +(mm || 0), +(ss || 0));
    if (date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day) return date;
    return undefined;
  }

  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*(?:wib|wita|wit)?$/i);
  if (m) {
    const [, y, mo, d, hh, mm, ss] = m;
    const date = new Date(+y, +mo - 1, +d, +(hh || 0), +(mm || 0), +(ss || 0));
    if (date.getFullYear() === +y && date.getMonth() === +mo - 1 && date.getDate() === +d) return date;
    return undefined;
  }

  m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (m) {
    const base = new Date();
    return new Date(base.getFullYear(), base.getMonth(), base.getDate(), +m[1], +m[2], +(m[3] || 0));
  }

  return undefined;
}

export function readExcelRows(buffer, opts = {}) {
  let wb;
  try {
    wb = XLSX.read(buffer, { type: 'buffer' });
  } catch {
    throw new Error('File tidak bisa dibaca. Pastikan format .xlsx yang valid.');
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  if (!ws) throw new Error('File Excel kosong');

  const grid = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, blankrows: false, defval: '' });
  return rowsFromGrid(grid, opts);
}

export function readCsvRows(text, opts = {}) {
  let grid;
  try {
    grid = parse(String(text ?? ''), {
      bom: true,
      columns: false,
      skip_empty_lines: true,
      relax_column_count: true
    });
  } catch (err) {
    throw new Error(`CSV tidak bisa dibaca: ${String(err?.message || err).split('\n')[0]}`);
  }
  return rowsFromGrid(grid, opts);
}

export function rowsFromGrid(grid, { now = Date.now() } = {}) {
  if (grid.length < 2) throw new Error('Sheet harus punya baris header dan minimal 1 baris data');

  const headerIdx = grid.findIndex((row) => row.some((c) => String(c).trim() !== ''));
  const header = grid[headerIdx] || [];
  const map = mapHeaders(header);
  if (map.phone < 0) {
    throw new Error('Header harus mengandung kolom nomor (contoh: nomor, nama, pesan, jadwal)');
  }
  if (map.schedule < 0) {
    throw new Error('Header harus mengandung kolom jadwal (format: 30/09/2026 14:30). Baris tanpa jadwal tidak dikirim.');
  }

  const rows = [];
  const errors = [];
  const skipped = [];
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const row = grid[i];
    if (!row || row.every((c) => String(c).trim() === '')) continue;
    const line = i + 1;

    const phone = normalizePhone(row[map.phone]);
    if (!phone) {
      errors.push(`Baris ${line}: nomor "${String(row[map.phone] ?? '').trim()}" tidak valid`);
      continue;
    }

    const name = map.name >= 0 ? String(row[map.name] ?? '').trim() : '';
    const body = map.body >= 0 ? String(row[map.body] ?? '').trim() : '';

    const rawSchedule = row[map.schedule];
    const parsed = parseScheduleValue(rawSchedule);
    if (parsed === undefined) {
      errors.push(`Baris ${line}: jadwal "${String(rawSchedule ?? '').trim()}" tidak dikenali (format: 30/09/2026 14:30)`);
      continue;
    }
    if (!parsed) {
      skipped.push({
        line,
        phone,
        kind: 'empty',
        scheduledAt: null,
        message: `Baris ${line}: jadwal kosong — baris tidak dikirim`
      });
      continue;
    }
    const scheduledAt = parsed.getTime();
    if (scheduledAt <= now) {
      skipped.push({
        line,
        phone,
        kind: 'past',
        scheduledAt,
        message: `Baris ${line}: jadwal sudah lewat (${new Date(scheduledAt).toLocaleString('id-ID')}) — baris tidak dikirim`
      });
      continue;
    }

    rows.push({ line, phone, name, body, scheduledAt });
  }

  return { rows, errors, skipped, headerCount: grid.length - headerIdx - 1 };
}

function skippedSummary(skipped) {
  const lampau = skipped.filter((s) => s.kind === 'past').length;
  const kosong = skipped.length - lampau;
  const parts = [];
  if (lampau) parts.push(`${lampau} jadwal lampau`);
  if (kosong) parts.push(`${kosong} jadwal kosong`);
  return parts.join(', ') || `${skipped.length} baris terlewat`;
}

export function createExcelCampaign({ fileName, defaultBody, delayMinMs, delayMaxMs, buffer, csvText, sourceUrl, name: customName, now: at }) {
  const opts = at ? { now: at } : {};
  const { rows, errors, skipped } = buffer ? readExcelRows(buffer, opts) : readCsvRows(csvText, opts);
  if (!rows.length) {
    if (skipped.length) {
      throw new Error(`Semua baris terlewat (${skippedSummary(skipped)}). Tidak ada campaign dibuat.`);
    }
    throw new Error(errors.length ? `Tidak ada baris valid. ${errors[0]}` : 'Tidak ada baris data di Excel');
  }

  const defaultText = String(defaultBody || '').trim();
  const missing = rows.filter((r) => !r.body && !defaultText);
  if (missing.length) {
    throw new Error(`Baris ${missing[0].line}: kolom pesan kosong dan pesan default juga kosong`);
  }

  const minDelay = Math.max(500, Number(delayMinMs) || 3000);
  const maxDelay = Math.max(minDelay, Number(delayMaxMs) || 8000);
  const times = rows.map((r) => r.scheduledAt).filter((t) => t !== null);
  const firstAt = times.length ? Math.min(...times) : Date.now();

  const custom = String(customName || '').trim();
  const stamp = new Date().toLocaleString('id-ID', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).replace(/[.:]/g, '');
  const fallbackName = sourceUrl ? 'Sheet online' : fileName || 'Excel';
  const name = custom || (fallbackName.replace(/\.xlsx$/i, '').trim() || 'Kirim Excel') + ` (${stamp})`;

  const create = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO campaigns
          (name, template_id, body, status, scheduled_at, delay_min_ms, delay_max_ms,
           selector, selector_value, total, created_at, schedule_mode, source_url)
         VALUES (?, NULL, ?, 'scheduled', ?, ?, ?, 'all', '', 0, ?, 'excel', ?)`
      )
      .run(name, defaultText || rows[0].body, firstAt, minDelay, maxDelay, now(), sourceUrl || null);
    const campaignId = info.lastInsertRowid;

    const insert = db.prepare(
      `INSERT OR IGNORE INTO campaign_recipients
        (campaign_id, contact_id, phone, name, body, status, scheduled_at)
       VALUES (?, NULL, ?, ?, ?, 'pending', ?)`
    );
    const seen = new Set();
    let added = 0;
    let duplicates = 0;
    for (const r of rows) {
      if (seen.has(r.phone)) {
        duplicates++;
        continue;
      }
      seen.add(r.phone);
      const text = r.body || defaultText;
      insert.run(campaignId, r.phone, r.name, renderBody(text, { name: r.name, phone: r.phone }), r.scheduledAt);
      added++;
    }
    db.prepare('UPDATE campaigns SET total = ? WHERE id = ?').run(added, campaignId);
    if (!added) throw new Error('Semua nomor duplikat, tidak ada penerima');
    return { campaignId, added, duplicates };
  });

  const { campaignId, added, duplicates } = create();

  return {
    campaign: getCampaign(campaignId),
    errors,
    skipped: skipped.slice(0, 20),
    skippedTotal: skipped.length,
    duplicates,
    added
  };
}

export async function syncExcelCampaign(campaignId, { fetchImpl, now: at } = {}) {
  const campaign = getCampaign(campaignId);
  if (!campaign) throw new Error('Campaign tidak ditemukan');
  if (campaign.schedule_mode !== 'excel' || !campaign.source_url) {
    throw new Error('Campaign ini tidak punya sumber sheet online, sinkron tidak tersedia');
  }

  const { downloadUrl } = parseSheetUrl(campaign.source_url);
  const sheet = await fetchSheet(downloadUrl, { fetchImpl });
  const opts = at ? { now: at } : {};
  const { rows, errors, skipped } = sheet.kind === 'xlsx' ? readExcelRows(sheet.buffer, opts) : readCsvRows(sheet.text, opts);
  if (!rows.length && !skipped.length) {
    throw new Error(errors.length ? `Tidak ada baris valid. ${errors[0]}` : 'Sheet tidak punya baris data');
  }

  const defaultText = String(campaign.body || '').trim();

  const result = db.transaction(() => {
    const insert = db.prepare(
      `INSERT OR IGNORE INTO campaign_recipients
        (campaign_id, contact_id, phone, name, body, status, scheduled_at)
       VALUES (?, NULL, ?, ?, ?, 'pending', ?)`
    );
    const seen = new Set();
    let added = 0;
    let duplicates = 0;
    for (const r of rows) {
      if (seen.has(r.phone)) {
        duplicates++;
        continue;
      }
      seen.add(r.phone);
      const text = r.body || defaultText;
      if (!text) {
        errors.push(`Baris ${r.line}: kolom pesan kosong dan pesan default juga kosong`);
        continue;
      }
      const info = insert.run(campaignId, r.phone, r.name, renderBody(text, { name: r.name, phone: r.phone }), r.scheduledAt);
      if (info.changes > 0) added++;
      else duplicates++;
    }
    if (!added && !duplicates && !skipped.length) {
      throw new Error(`Tidak ada baris valid. ${errors[0] || 'cek header sheet'}`);
    }

    db.prepare(
      `UPDATE campaigns
          SET total = (SELECT COUNT(*) FROM campaign_recipients WHERE campaign_id = ?), last_sync_at = ?
        WHERE id = ?`
    ).run(campaignId, now(), campaignId);

    let resumed = false;
    const statusNow = db.prepare('SELECT status FROM campaigns WHERE id = ?').get(campaignId)?.status;
    if (added > 0 && statusNow === 'completed') {
      const earliest = db
        .prepare(
          `SELECT MIN(COALESCE(scheduled_at, ?)) AS m FROM campaign_recipients
            WHERE campaign_id = ? AND status = 'pending'`
        )
        .get(now(), campaignId);
      if (earliest?.m != null) {
        db.prepare("UPDATE campaigns SET status = 'scheduled', scheduled_at = ?, finished_at = NULL WHERE id = ?").run(
          earliest.m,
          campaignId
        );
        resumed = true;
      }
    }
    return { added, duplicates, resumed };
  });

  const { added, duplicates, resumed } = result();
  return {
    added,
    duplicates,
    errors: errors.slice(0, 20),
    skipped: skipped.slice(0, 20),
    skippedTotal: skipped.length,
    resumed
  };
}

export function buildTemplateWorkbook() {
  const fdate = (addDays, h, m) => {
    const t = new Date();
    t.setDate(t.getDate() + addDays);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(t.getDate())}/${pad(t.getMonth() + 1)}/${t.getFullYear()} ${pad(h)}:${pad(m)}`;
  };
  const rows = [
    ['nomor', 'nama', 'pesan', 'jadwal'],
    ['6281234567890', 'Budi Santoso', 'Halo {nama}, paket Anda siap. Order jam {jam}', fdate(1, 14, 30)],
    ['085770000123', 'Ani Wijaya', 'Halo {nama}, promo khusus untuk Anda hari ini', fdate(2, 9, 0)],
    ['628111222333', 'Citra Lestari', 'Halo {nama}, kabar terbaru dari kami', fdate(3, 15, 0)]
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 18 }, { wch: 20 }, { wch: 55 }, { wch: 18 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Kirim');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
