import cron from 'node-cron';
import { db } from '../db/index.js';
import { runCampaign } from '../wa/sender.js';

export function startScheduler() {
  cron.schedule('* * * * *', () => {
    const due = db
      .prepare(
        "SELECT id FROM campaigns WHERE status = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ?"
      )
      .all(Date.now());
    for (const row of due) {
      runCampaign(row.id).catch((err) => console.error('scheduler:', err));
    }
  });
}
