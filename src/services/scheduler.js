import cron from 'node-cron';
import { db } from '../db/index.js';
import { runCampaign } from '../wa/sender.js';
import { waSession } from '../wa/session.js';
import { getCampaign, hasMoreCycles, REPEAT_UNITS } from './campaigns.js';
import { isHolidayDate, skipHoliday } from './holidays.js';
import {
  syncExcelCampaign,
  saveLastResult,
  parseAutoSyncRule,
  isAutoSyncDue
} from './excel.js';

// Sync otomatis (sheet online) — anti-tumpuk bila fetch masih jalan.
const autoSyncing = new Set();

function tickAutoSync(nowTs) {
  const candidates = db
    .prepare(
      `SELECT id, auto_sync_rule, last_sync_at FROM campaigns
        WHERE source_url IS NOT NULL AND auto_sync_rule <> '' AND status <> 'cancelled'`
    )
    .all();
  for (const row of candidates) {
    const rule = parseAutoSyncRule(row.auto_sync_rule);
    if (!rule) continue;
    if (!isAutoSyncDue(rule, row.last_sync_at, nowTs)) continue;
    if (autoSyncing.has(row.id)) continue;
    autoSyncing.add(row.id);
    syncExcelCampaign(row.id)
      .then((r) => console.log(`auto-sync campaign ${row.id}: +${r.added} baru, ${r.updated} diperbarui`))
      .catch((err) => {
        console.error(`auto-sync campaign ${row.id}:`, err);
        try {
          saveLastResult(row.id, 'sync', {
            added: 0,
            updated: 0,
            duplicates: 0,
            resumed: false,
            errors: [`Gagal sinkron otomatis: ${String(err?.message || err)}`],
            skipped: [],
            skippedTotal: 0
          });
        } catch {
          // abaikan
        }
      })
      .finally(() => autoSyncing.delete(row.id));
  }
}

export function schedulerTick() {
  // Sinkron otomatis sheet online (tanpa klik user) — tidak butuh WA tersambung.
  try {
    tickAutoSync(Date.now());
  } catch (err) {
    console.error('auto-sync:', err);
  }

  if (waSession.status !== 'connected') return;
  const due = db
    .prepare(
      "SELECT id FROM campaigns WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ?"
    )
    .all(Date.now());
  for (const row of due) {
    const c = getCampaign(row.id);
    if (!c) continue;

    // Campaign perulangan yang jatuh tempo di hari libur: lewati total,
    // geser ke interval berikutnya (harian: libur -> lusa).
    if (c.repeat_rule === 'interval' && isHolidayDate(c.scheduled_at)) {
      const unit = REPEAT_UNITS[c.repeat_unit] || REPEAT_UNITS.hours;
      const next = skipHoliday(c.scheduled_at, Math.max(1, c.repeat_every) * unit.ms);
      if (!isHolidayDate(next)) {
        if (!hasMoreCycles(c, next)) {
          db.prepare("UPDATE campaigns SET status = 'completed', finished_at = ? WHERE id = ?").run(
            Date.now(),
            c.id
          );
        } else {
          db.prepare('UPDATE campaigns SET scheduled_at = ? WHERE id = ?').run(next, c.id);
        }
        continue;
      }
      // Semua hari libur (kasus ekstrem) — jalankan agar campaign tidak macet.
    }

    runCampaign(row.id).catch((err) => console.error('scheduler:', err));
  }
}

export function startScheduler() {
  cron.schedule('* * * * *', () => {
    try {
      schedulerTick();
    } catch (err) {
      console.error('scheduler:', err);
    }
  });
}
