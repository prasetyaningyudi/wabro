import { EventEmitter } from 'node:events';
import path from 'node:path';
import { waSession } from './session.js';
import { config } from '../config.js';
import { db, now } from '../db/index.js';
import {
  getCampaign,
  nextPending,
  markRecipient,
  campaignStats,
  startCampaign,
  pauseCampaign,
  finishCycle
} from '../services/campaigns.js';
import { jidFor } from '../services/contacts.js';

export const senderEvents = new EventEmitter();
senderEvents.setMaxListeners(100);

const active = new Map();
const controls = new Map();

const TRANSIENT = /timeout|timed out|connection|stream|overloaded|rate[- ]?limit|too many|503|502|econnreset|socket hang up/i;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function randDelay(min, max) {
  return Math.floor(min + Math.random() * (max - min));
}

function buildContent(recipient) {
  const campaign = getCampaign(recipient.campaign_id);
  const content = {};
  if (campaign.media_path) {
    const absPath = path.join(config.uploadsDir, path.basename(campaign.media_path));
    const file = { url: absPath };
    const type = campaign.media_type;
    if (type === 'image') content.image = file;
    else if (type === 'video') content.video = file;
    else if (type === 'audio') content.audio = file;
    else
      content.document = {
        ...file,
        fileName: campaign.media_name || path.basename(absPath),
        mimetype: campaign.media_mime || 'application/octet-stream'
      };
  }
  if (recipient.body) {
    if (content.image || content.video || content.audio || content.document)
      content.caption = recipient.body;
    else content.text = recipient.body;
  }
  return content;
}

export function isRunning(campaignId) {
  return active.has(campaignId);
}

export function activeCampaignId() {
  for (const id of active.keys()) return id;
  return null;
}

export function control(campaignId, action) {
  const c = controls.get(campaignId) || {};
  if (action === 'pause') c.paused = true;
  if (action === 'resume') c.paused = false;
  if (action === 'cancel') c.cancelled = true;
  controls.set(campaignId, c);
}

export async function runCampaign(campaignId) {
  if (active.size > 0) return;

  let campaign = getCampaign(campaignId);
  if (!campaign) return;
  if (['draft', 'paused', 'scheduled'].includes(campaign.status)) {
    campaign = startCampaign(campaignId);
  }
  if (campaign.status !== 'running') return;

  active.set(campaignId, true);
  controls.set(campaignId, { paused: false, cancelled: false });
  emitProgress(campaignId);

  let consecutiveFailures = 0;

  try {
    while (true) {
      const c = controls.get(campaignId);
      if (c.cancelled) break;

      if (c.paused) {
        const fresh = getCampaign(campaignId);
        if (fresh.status === 'running') pauseCampaign(campaignId);
        break;
      }

      const current = getCampaign(campaignId);
      if (current.status !== 'running') break;

      const recipient = nextPending(campaignId);
      if (!recipient) break;

      markRecipient(recipient.id, { status: 'sending' });
      emitProgress(campaignId);

      const jid = jidFor(recipient.phone);
      let ok = false;
      let lastErr = null;

      for (let attempt = 1; attempt <= config.defaults.maxAttempts && !ok; attempt++) {
        try {
          if (attempt > 1) await sleep(3000 * attempt);
          const res = await waSession.send(jid, buildContent(recipient));
          markRecipient(recipient.id, {
            status: 'sent',
            wa_message_id: res?.key?.id || null,
            sent_at: Date.now(),
            error: null,
            attempts: attempt
          });
          ok = true;
          consecutiveFailures = 0;
        } catch (err) {
          lastErr = err;
          const msg = String(err?.message || err);
          if (!TRANSIENT.test(msg)) break;
        }
      }

      if (!ok) {
        consecutiveFailures += 1;
        markRecipient(recipient.id, {
          status: 'failed',
          error: String(lastErr?.message || lastErr || 'Gagal mengirim').slice(0, 300)
        });
        if (consecutiveFailures >= config.defaults.consecutiveFailureLimit) {
          try {
            pauseCampaign(campaignId);
          } catch {
            // abaikan
          }
          break;
        }
      }

      emitProgress(campaignId);

      await sleep(randDelay(current.delay_min_ms, current.delay_max_ms));
    }
  } finally {
    const c = controls.get(campaignId);
    const final = getCampaign(campaignId);
    if (final && final.status === 'running' && c && !c.cancelled && !c.paused) {
      const stats = campaignStats(campaignId);
      if (stats.pending === 0) {
        if (final.repeat_rule === 'interval') {
          try {
            const res = finishCycle(campaignId);
            if (!res.done) console.log(`campaign ${campaignId} siklus berikutnya: ${new Date(res.nextAt).toLocaleString('id-ID')}`);
          } catch (err) {
            console.error('finishCycle:', err);
            db.prepare("UPDATE campaigns SET status = 'failed', finished_at = ? WHERE id = ?").run(now(), campaignId);
          }
        } else {
          db.prepare("UPDATE campaigns SET status = 'completed', finished_at = ? WHERE id = ?").run(now(), campaignId);
        }
      }
    }
    active.delete(campaignId);
    controls.delete(campaignId);
    emitProgress(campaignId, true);
  }
}

export function emitProgress(campaignId, finished = false) {
  const stats = campaignStats(campaignId);
  const campaign = getCampaign(campaignId);
  senderEvents.emit('progress', {
    campaignId,
    stats,
    status: campaign?.status,
    finished
  });
}
