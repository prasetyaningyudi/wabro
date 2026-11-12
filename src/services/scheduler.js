import cron from 'node-cron';
import { db } from '../db/index.js';
import { runCampaign } from '../wa/sender.js';
import { waSession } from '../wa/session.js';
import { getCampaign, hasMoreCycles, REPEAT_UNITS } from './campaigns.js';
import { isHolidayDate, skipHoliday } from './holidays.js';

export function schedulerTick() {
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
