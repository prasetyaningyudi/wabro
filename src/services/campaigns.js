import { db, now } from '../db/index.js';
import { contactsBySelector, normalizePhone, jidFor } from './contacts.js';
import { getTemplate } from './templates.js';
import { config } from '../config.js';

export const CAMPAIGN_STATUSES = ['draft', 'scheduled', 'running', 'paused', 'completed', 'cancelled', 'failed'];

export const REPEAT_UNITS = {
  minutes: { ms: 60 * 1000, label: 'menit' },
  hours: { ms: 60 * 60 * 1000, label: 'jam' },
  days: { ms: 24 * 60 * 60 * 1000, label: 'hari' },
  weeks: { ms: 7 * 24 * 60 * 60 * 1000, label: 'minggu' }
};

export function repeatLabel(campaign) {
  if (campaign.repeat_rule !== 'interval') return null;
  const unit = REPEAT_UNITS[campaign.repeat_unit]?.label || campaign.repeat_unit;
  let label = `Setiap ${campaign.repeat_every} ${unit}`;
  if (campaign.repeat_until) {
    label += ` sampai ${new Date(campaign.repeat_until).toLocaleString('id-ID')}`;
  } else {
    label += ' (tanpa batas)';
  }
  return label;
}

function parseRepeat({ repeatRule, repeatEvery, repeatUnit, repeatUntil }) {
  const enabled = repeatRule === 'interval';
  const every = Math.floor(Number(repeatEvery));
  const unit = Object.hasOwn(REPEAT_UNITS, repeatUnit) ? repeatUnit : 'hours';

  if (enabled && (!Number.isFinite(every) || every < 1)) {
    throw new Error('Interval pengulangan minimal 1');
  }

  let until = null;
  if (repeatUntil) {
    until = new Date(repeatUntil).getTime();
    if (Number.isNaN(until)) throw new Error('Waktu berhenti mengulang tidak valid');
    if (until <= Date.now()) throw new Error('Waktu berhenti mengulang sudah lewat');
  }

  return {
    repeatRule: enabled ? 'interval' : 'none',
    repeatEvery: enabled ? every : 0,
    repeatUnit: unit,
    repeatUntil: enabled ? until : null
  };
}

export function nextRunAt(campaign, from = Date.now()) {
  const unit = REPEAT_UNITS[campaign.repeat_unit] || REPEAT_UNITS.hours;
  return from + campaign.repeat_every * unit.ms;
}

export function hasMoreCycles(campaign, nextTime) {
  if (campaign.repeat_rule !== 'interval') return false;
  return !campaign.repeat_until || nextTime <= campaign.repeat_until;
}

export function renderBody(templateStr, contact) {
  return String(templateStr)
    .replaceAll('{nama}', contact.name || '-')
    .replaceAll('{nomor}', contact.phone || '-');
}

export function listCampaigns() {
  return db.prepare('SELECT * FROM campaigns ORDER BY id DESC').all();
}

export function getCampaign(id) {
  return db.prepare('SELECT * FROM campaigns WHERE id = ?').get(id);
}

export function campaignStats(id) {
  const rows = db
    .prepare('SELECT status, COUNT(*) AS c FROM campaign_recipients WHERE campaign_id = ? GROUP BY status')
    .all(id);
  const stats = { total: 0, pending: 0, sending: 0, sent: 0, delivered: 0, read: 0, failed: 0 };
  for (const r of rows) {
    stats[r.status] = r.c;
    stats.total += r.c;
  }
  return stats;
}

export function createCampaign(input) {
  const { name, templateId, body, scheduledAt, delayMinMs, delayMaxMs, selector, selectorValue, mediaPath, mediaType, mediaMime, mediaName } = input;
  if (!name?.trim()) throw new Error('Nama campaign wajib diisi');

  const repeat = parseRepeat(input);

  let finalBody = body || '';
  let finalMediaPath = mediaPath || null;
  let finalMediaType = mediaType || null;
  let finalMediaMime = mediaMime || null;
  let finalMediaName = mediaName || null;

  if (templateId) {
    const tpl = getTemplate(templateId);
    if (!tpl) throw new Error('Template tidak ditemukan');
    if (!finalBody.trim()) finalBody = tpl.body;
    if (!finalMediaPath) {
      finalMediaPath = tpl.media_path;
      finalMediaType = tpl.media_type;
      finalMediaMime = tpl.media_mime;
      finalMediaName = tpl.media_name;
    }
  }
  if (!finalBody.trim()) throw new Error('Isi pesan wajib diisi');

  const minDelay = Math.max(500, Number(delayMinMs) || config.defaults.delayMinMs);
  const maxDelay = Math.max(minDelay, Number(delayMaxMs) || config.defaults.delayMaxMs);
  const sel = selector === 'tag' || selector === 'ids' ? selector : 'all';

  const contacts = contactsBySelector(sel, selectorValue || '');
  if (!contacts.length) throw new Error('Tidak ada kontak yang cocok dengan filter');

  const status = scheduledAt ? 'scheduled' : 'draft';

  const create = db.transaction(() => {
    const info = db
      .prepare(
        `INSERT INTO campaigns
          (name, template_id, body, media_path, media_type, media_mime, media_name, status, scheduled_at,
           delay_min_ms, delay_max_ms, selector, selector_value, total, created_at,
           repeat_rule, repeat_every, repeat_unit, repeat_until)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        name.trim(),
        templateId || null,
        finalBody,
        finalMediaPath,
        finalMediaType,
        finalMediaMime,
        finalMediaName,
        status,
        scheduledAt || null,
        minDelay,
        maxDelay,
        sel,
        selectorValue || '',
        contacts.length,
        now(),
        repeat.repeatRule,
        repeat.repeatEvery,
        repeat.repeatUnit,
        repeat.repeatUntil
      );
    const campaignId = info.lastInsertRowid;

    const insert = db.prepare(
      `INSERT OR IGNORE INTO campaign_recipients
        (campaign_id, contact_id, phone, name, body, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`
    );
    const seen = new Set();
    for (const c of contacts) {
      const phone = normalizePhone(c.phone);
      if (!phone || seen.has(phone)) continue;
      seen.add(phone);
      insert.run(campaignId, c.id, phone, c.name || '', renderBody(finalBody, { ...c, phone }));
    }
    return campaignId;
  });

  const id = create();
  return getCampaign(id);
}

export function startCampaign(id) {
  const c = getCampaign(id);
  if (!c) throw new Error('Campaign tidak ditemukan');
  if (!['draft', 'paused', 'scheduled'].includes(c.status)) throw new Error(`Campaign tidak bisa dijalankan dari status ${c.status}`);
  db.prepare('UPDATE campaigns SET status = ?, started_at = COALESCE(started_at, ?) WHERE id = ?').run(
    'running',
    now(),
    id
  );
  return getCampaign(id);
}

export function pauseCampaign(id) {
  const c = getCampaign(id);
  if (!c) throw new Error('Campaign tidak ditemukan');
  if (c.status !== 'running') throw new Error('Hanya campaign berjalan yang bisa dijeda');
  db.prepare("UPDATE campaigns SET status = 'paused' WHERE id = ?").run(id);
  return getCampaign(id);
}

export function cancelCampaign(id) {
  const c = getCampaign(id);
  if (!c) throw new Error('Campaign tidak ditemukan');
  db.transaction(() => {
    db.prepare("UPDATE campaigns SET status = 'cancelled', finished_at = ? WHERE id = ?").run(now(), id);
    db.prepare(
      "UPDATE campaign_recipients SET status = 'failed', error = 'Dibatalkan' WHERE campaign_id = ? AND status IN ('pending', 'sending')"
    ).run(id);
  })();
  return getCampaign(id);
}

export function deleteCampaign(id) {
  return db.prepare('DELETE FROM campaigns WHERE id = ?').run(id);
}

export function finishCycle(id) {
  const c = getCampaign(id);
  if (!c) return { done: true };

  const nextTime = nextRunAt(c, Date.now());
  if (!hasMoreCycles(c, nextTime)) {
    db.prepare("UPDATE campaigns SET status = 'completed', finished_at = ?, last_run_at = ? WHERE id = ?").run(
      now(),
      now(),
      id
    );
    return { done: true, nextAt: null };
  }

  const reset = db.transaction(() => {
    db.prepare(
      `UPDATE campaign_recipients
         SET status = 'pending', error = NULL, wa_message_id = NULL, attempts = 0,
             sent_at = NULL, delivered_at = NULL, read_at = NULL
       WHERE campaign_id = ?`
    ).run(id);
    db.prepare(
      `UPDATE campaigns
         SET status = 'scheduled', scheduled_at = ?, cycle_count = cycle_count + 1, last_run_at = ?, finished_at = NULL
       WHERE id = ?`
    ).run(nextTime, now(), id);
  });
  reset();
  return { done: false, nextAt: nextTime };
}

export function listRecipients(campaignId, { status = '', q = '', limit = 1000, offset = 0 } = {}) {
  const where = ['campaign_id = ?'];
  const params = [campaignId];
  if (status) {
    where.push('status = ?');
    params.push(status);
  }
  if (q) {
    where.push('(phone LIKE ? OR name LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  const rows = db
    .prepare(`SELECT * FROM campaign_recipients WHERE ${where.join(' AND ')} ORDER BY id LIMIT ? OFFSET ?`)
    .all(...params, limit, offset);
  const total = db
    .prepare(`SELECT COUNT(*) AS c FROM campaign_recipients WHERE ${where.join(' AND ')}`)
    .get(...params).c;
  return { rows, total };
}

export function nextPending(campaignId) {
  return db
    .prepare(
      "SELECT * FROM campaign_recipients WHERE campaign_id = ? AND status = 'pending' ORDER BY id LIMIT 1"
    )
    .get(campaignId);
}

export function markRecipient(id, fields) {
  const sets = [];
  const params = [];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    params.push(v);
  }
  params.push(id);
  db.prepare(`UPDATE campaign_recipients SET ${sets.join(', ')} WHERE id = ?`).run(...params);
}

export function markRecipientByMessageId(messageId, fields) {
  const sets = [];
  const params = [];
  for (const [k, v] of Object.entries(fields)) {
    sets.push(`${k} = ?`);
    params.push(v);
  }
  params.push(messageId);
  db.prepare(`UPDATE campaign_recipients SET ${sets.join(', ')} WHERE wa_message_id = ?`).run(...params);
}
