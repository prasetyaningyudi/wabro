import { waEvents } from './session.js';
import { db } from '../db/index.js';
import { markRecipientByMessageId } from '../services/campaigns.js';
import { emitProgress } from './sender.js';

// Baileys WAMessageStatus: 0=ERROR 1=PENDING 2=SERVER_ACK 3=DELIVERY_ACK 4=READ 5=PLAYED
const STATUS_MAP = {
  2: 'sent',
  3: 'delivered',
  4: 'read',
  5: 'read'
};

const RANK = { pending: 0, sending: 0, failed: 0, sent: 1, delivered: 2, read: 3 };

export function startReceiptTracker() {
  waEvents.on('message-status', ({ id, status }) => {
    const mapped = STATUS_MAP[status];
    if (!mapped || !id) return;
    try {
      const current = db
        .prepare(
          'SELECT campaign_id, status, delivered_at, read_at FROM campaign_recipients WHERE wa_message_id = ?'
        )
        .get(id);
      if (!current) return;

      // event bisa datang tidak berurutan — hanya boleh maju, tidak boleh mundur
      if ((RANK[mapped] || 0) < (RANK[current.status] || 0)) return;

      const fields = { status: mapped };
      if (mapped === 'delivered' && !current.delivered_at) fields.delivered_at = Date.now();
      if (mapped === 'read') {
        if (!current.read_at) fields.read_at = Date.now();
        if (!current.delivered_at) fields.delivered_at = Date.now();
      }

      markRecipientByMessageId(id, fields);
      emitProgress(current.campaign_id);
    } catch (err) {
      console.error('receipt:', err);
    }
  });
}
