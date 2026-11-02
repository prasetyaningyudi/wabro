import * as XLSX from 'xlsx';
import { parse } from 'csv-parse/sync';
import { db, now } from '../db/index.js';
import { normalizePhone, contactsBySelector } from './contacts.js';
import { renderBody, getCampaign } from './campaigns.js';
import { getTemplate } from './templates.js';
import { parseSheetUrl, fetchSheet } from './sheet-source.js';

const TEMPLATE_TOKEN_RE = /\{template:\s*(\d+)\s*\}/g;

// Offset zona waktu Indonesia (suffix jadwal: wib/wita/wit).
// Bila suffix ditulis, jam diterapkan di zona tsb apa pun zona server.
const ZONE_OFFSETS = { wib: 7, wita: 8, wit: 9 };

// Bangun Date dari komponen dinding jam; zone → interpretasi di zona tsb,
// tanpa zone → waktu lokal server (ikut TZ env).
function makeDate(y, mo, d, hh, mm, ss, zone) {
  const wall = new Date(Date.UTC(y, mo - 1, d, hh, mm, ss));
  if (wall.getUTCFullYear() !== y || wall.getUTCMonth() !== mo - 1 || wall.getUTCDate() !== d) {
    return undefined; // tanggal tidak valid (mis. 32/10/2026)
  }
  if (zone) {
    const off = ZONE_OFFSETS[String(zone).toLowerCase()];
    if (off != null) return new Date(wall.getTime() - off * 3600000);
  }
  return new Date(y, mo - 1, d, hh, mm, ss);
}

// Ganti {template:id} dengan body template. Resolusi satu tingkat
// (body template tidak di-resolve ulang). Id tak dikenal -> missing.
export function resolveTemplateToken(text) {
  const s = String(text ?? '');
  if (!s.includes('{template:')) return { text: s, missing: [] };
  const missing = [];
  const out = s.replace(TEMPLATE_TOKEN_RE, (m, id) => {
    const tpl = getTemplate(Number(id));
    if (!tpl) {
      if (!missing.includes(id)) missing.push(id);
      return m;
    }
    return tpl.body;
  });
  return { text: out, missing };
}

const HEADER_ALIASES = {
  phone: ['phone', 'nomor', 'no', 'number', 'no hp', 'no. hp', 'no hp.', 'wa', 'whatsapp', 'telepon', 'telp'],
  name: ['name', 'nama'],
  body: ['pesan', 'message', 'body', 'isi', 'isi pesan'],
  schedule: ['jadwal', 'schedule', 'tanggal', 'waktu', 'jam', 'date', 'time', 'tanggal jam', 'tanggal & jam'],
  tag: ['tag', 'tags', 'label']
};

const normHeader = (h) => String(h || '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/\.$/, '');

export function mapHeaders(headerRow) {
  const map = { phone: -1, name: -1, body: -1, schedule: -1, tag: -1 };
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

  let m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*(wib|wita|wit)?$/i);
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
    return makeDate(year, month, day, +(hh || 0), +(mm || 0), +(ss || 0), m[7]);
  }

  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?\s*(wib|wita|wit)?$/i);
  if (m) {
    const [, y, mo, d, hh, mm, ss, zone] = m;
    return makeDate(+y, +mo, +d, +(hh || 0), +(mm || 0), +(ss || 0), zone);
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
  if (map.phone < 0 && map.tag < 0) {
    throw new Error('Header harus mengandung kolom nomor atau tag (contoh: nomor, nama, tag, pesan, jadwal)');
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

    const rawPhone = map.phone >= 0 ? String(row[map.phone] ?? '').trim() : '';
    const rawTag = map.tag >= 0 ? String(row[map.tag] ?? '').trim() : '';
    const isTagRow = !rawPhone && Boolean(rawTag);

    let phone = null;
    if (!isTagRow) {
      phone = normalizePhone(map.phone >= 0 ? row[map.phone] : '');
      if (!phone) {
        if (!rawPhone && !rawTag) {
          errors.push(`Baris ${line}: kolom nomor dan tag kosong`);
        } else {
          errors.push(`Baris ${line}: nomor "${rawPhone}" tidak valid`);
        }
        continue;
      }
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

    if (!isTagRow) {
      rows.push({ line, phone, name, body, scheduledAt });
      continue;
    }

    // Baris tag: expand ke semua kontak dengan tag tsb
    const tags = [...new Set(rawTag.split(/[;,]/).map((t) => t.trim()).filter(Boolean))];
    if (!tags.length) {
      errors.push(`Baris ${line}: tag tidak boleh kosong bila kolom nomor kosong`);
      continue;
    }
    const matched = [];
    const seenPhone = new Set();
    const emptyTags = [];
    for (const t of tags) {
      const contacts = contactsBySelector('tag', t);
      if (!contacts.length) {
        emptyTags.push(t);
        continue;
      }
      for (const c of contacts) {
        const p = normalizePhone(c.phone);
        if (!p || seenPhone.has(p)) continue;
        seenPhone.add(p);
        matched.push({ phone: p, name: c.name || '' });
      }
    }
    if (emptyTags.length) {
      errors.push(`Baris ${line}: tag ${emptyTags.map((t) => `"${t}"`).join(', ')} tidak dikenal atau tanpa kontak — baris dilewati`);
      continue;
    }
    if (!matched.length) {
      errors.push(`Baris ${line}: tag ${tags.map((t) => `"${t}"`).join(', ')} tidak punya kontak — baris dilewati`);
      continue;
    }
    for (const c of matched) {
      rows.push({ line, phone: c.phone, name: c.name, body, scheduledAt });
    }
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

// Simpan hasil impor/sinkron terakhir di campaign supaya terlihat permanen
// di halaman detail (bukan cuma flash sekali lihat).
function saveLastResult(campaignId, kind, extra) {
  try {
    db.prepare('UPDATE campaigns SET last_sync_result = ? WHERE id = ?').run(
      JSON.stringify({ kind, at: now(), ...extra }),
      campaignId
    );
  } catch {
    // tidak kritis — tampilan hasil tetap lewat flash
  }
}

export function createExcelCampaign({ fileName, defaultBody, templateId, delayMinMs, delayMaxMs, buffer, csvText, sourceUrl, name: customName, now: at }) {
  const opts = at ? { now: at } : {};
  const { rows, errors, skipped } = buffer ? readExcelRows(buffer, opts) : readCsvRows(csvText, opts);
  if (!rows.length) {
    if (skipped.length) {
      throw new Error(`Semua baris terlewat (${skippedSummary(skipped)}). Tidak ada campaign dibuat.`);
    }
    throw new Error(errors.length ? `Tidak ada baris valid. ${errors[0]}` : 'Tidak ada baris data di Excel');
  }

  let formTemplate = null;
  if (templateId) {
    formTemplate = getTemplate(Number(templateId));
    if (!formTemplate) throw new Error('Template tidak ditemukan');
  }

  // Prioritas pesan default: isi form > body template pilihan form
  let defaultText = String(defaultBody || '').trim();
  if (!defaultText && formTemplate) defaultText = formTemplate.body;
  if (defaultText) {
    const r = resolveTemplateToken(defaultText);
    if (r.missing.length) {
      throw new Error(`Pesan default: template ${r.missing.join(', ')} tidak ditemukan`);
    }
    defaultText = r.text;
  }

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

  const firstResolved = rows[0].body ? resolveTemplateToken(rows[0].body) : { text: defaultText, missing: [] };
  const campaignBody = defaultText || (firstResolved.missing.length ? rows[0].body : firstResolved.text);

  const create = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO campaigns
          (name, template_id, body, media_path, media_type, media_mime, media_name,
           status, scheduled_at, delay_min_ms, delay_max_ms,
           selector, selector_value, total, created_at, schedule_mode, source_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, 'all', '', 0, ?, 'excel', ?)`
      )
      .run(
        name,
        formTemplate ? formTemplate.id : null,
        campaignBody,
        formTemplate?.media_path || null,
        formTemplate?.media_type || null,
        formTemplate?.media_mime || null,
        formTemplate?.media_name || null,
        firstAt,
        minDelay,
        maxDelay,
        now(),
        sourceUrl || null
      );
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
      const key = `${r.phone}|${r.scheduledAt}`;
      if (seen.has(key)) {
        duplicates++;
        continue;
      }
      seen.add(key);
      let text;
      if (r.body) {
        const resolved = resolveTemplateToken(r.body);
        if (resolved.missing.length) {
          errors.push(`Baris ${r.line}: template ${resolved.missing.join(', ')} tidak ditemukan — baris dilewati`);
          continue;
        }
        text = resolved.text;
      } else {
        text = defaultText;
      }
      insert.run(campaignId, r.phone, r.name, renderBody(text, { name: r.name, phone: r.phone }), r.scheduledAt);
      added++;
    }
    db.prepare('UPDATE campaigns SET total = ? WHERE id = ?').run(added, campaignId);
    if (!added) {
      throw new Error(errors.length ? `Tidak ada penerima valid. ${errors[0]}` : 'Semua nomor+jadwal duplikat, tidak ada penerima');
    }
    return { campaignId, added, duplicates };
  });

  const { campaignId, added, duplicates } = create();

  saveLastResult(campaignId, 'import', {
    added,
    duplicates,
    errors: errors.slice(0, 20),
    skipped: skipped.slice(0, 20),
    skippedTotal: skipped.length
  });

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

  const defaultRaw = String(campaign.body || '').trim();
  const defResolved = resolveTemplateToken(defaultRaw);
  if (defResolved.missing.length) {
    errors.push(`Pesan default campaign: template ${defResolved.missing.join(', ')} tidak ditemukan`);
  }
  const defaultText = defResolved.missing.length ? defaultRaw : defResolved.text;

  const result = db.transaction(() => {
    const getExisting = db.prepare(
      'SELECT id, status, name, body, scheduled_at FROM campaign_recipients WHERE campaign_id = ? AND phone = ? AND scheduled_at IS ?'
    );
    const insert = db.prepare(
      `INSERT OR IGNORE INTO campaign_recipients
        (campaign_id, contact_id, phone, name, body, status, scheduled_at)
       VALUES (?, NULL, ?, ?, ?, 'pending', ?)`
    );
    const updatePending = db.prepare(
      `UPDATE campaign_recipients
          SET name = ?, body = ?
        WHERE id = ? AND status = 'pending'`
    );
    const retryFailed = db.prepare(
      `UPDATE campaign_recipients
          SET name = ?, body = ?, status = 'pending', error = '', attempts = 0, sent_at = NULL
        WHERE id = ? AND status = 'failed'`
    );
    const seen = new Set();
    let added = 0;
    let updated = 0;
    let duplicates = 0;
    for (const r of rows) {
      const key = `${r.phone}|${r.scheduledAt}`;
      if (seen.has(key)) {
        duplicates++;
        continue;
      }
      seen.add(key);
      let text;
      if (r.body) {
        const resolved = resolveTemplateToken(r.body);
        if (resolved.missing.length) {
          errors.push(`Baris ${r.line}: template ${resolved.missing.join(', ')} tidak ditemukan — baris dilewati`);
          continue;
        }
        text = resolved.text;
      } else {
        text = defaultText;
      }
      if (!text) {
        errors.push(`Baris ${r.line}: kolom pesan kosong dan pesan default juga kosong`);
        continue;
      }
      const finalBody = renderBody(text, { name: r.name, phone: r.phone });

      const existing = getExisting.get(campaignId, r.phone, r.scheduledAt);
      if (existing) {
        if (existing.status === 'pending') {
          const changed = existing.name !== r.name || existing.body !== finalBody;
          if (changed) {
            const info = updatePending.run(r.name, finalBody, existing.id);
            if (info.changes > 0) updated++;
            else duplicates++;
          } else {
            duplicates++;
          }
        } else if (existing.status === 'failed') {
          const info = retryFailed.run(r.name, finalBody, existing.id);
          if (info.changes > 0) updated++;
          else duplicates++;
        } else {
          // sending/sent/delivered/read: baris dengan jadwal ini sudah jalan
          duplicates++;
        }
        continue;
      }
      // (nomor, jadwal) belum ada -> baris baru selalu menang
      const info = insert.run(campaignId, r.phone, r.name, finalBody, r.scheduledAt);
      if (info.changes > 0) added++;
      else duplicates++;
    }
    if (!added && !updated && !duplicates && !skipped.length) {
      throw new Error(`Tidak ada baris valid. ${errors[0] || 'cek header sheet'}`);
    }

    db.prepare(
      `UPDATE campaigns
          SET total = (SELECT COUNT(*) FROM campaign_recipients WHERE campaign_id = ?), last_sync_at = ?
        WHERE id = ?`
    ).run(campaignId, now(), campaignId);

    let resumed = false;
    const statusNow = db.prepare('SELECT status FROM campaigns WHERE id = ?').get(campaignId)?.status;
    if ((added > 0 || updated > 0) && statusNow === 'completed') {
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
    return { added, updated, duplicates, resumed };
  });

  const { added, updated, duplicates, resumed } = result();

  saveLastResult(campaignId, 'sync', {
    added,
    updated,
    duplicates,
    resumed,
    errors: errors.slice(0, 20),
    skipped: skipped.slice(0, 20),
    skippedTotal: skipped.length
  });

  return {
    added,
    updated,
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
    ['nomor', 'nama', 'tag', 'pesan', 'jadwal'],
    ['6281234567890', 'Budi Santoso', '', 'Halo {nama}, paket Anda siap. Order jam {jam}', fdate(1, 14, 30)],
    ['085770000123', 'Ani Wijaya', '', 'Halo {nama}, promo khusus untuk Anda hari ini', fdate(2, 9, 0)],
    ['', '', 'vip', 'Halo {nama}, promo khusus member VIP hari ini', fdate(2, 10, 0)],
    ['628111222333', 'Citra Lestari', '', 'Halo {nama}, kabar terbaru dari kami', fdate(3, 15, 0)]
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [{ wch: 18 }, { wch: 20 }, { wch: 14 }, { wch: 55 }, { wch: 18 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Kirim');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
