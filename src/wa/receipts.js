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

export function startReceiptTracker() {
  waEvents.on('message-status', ({ id, status }) => {
    const mapped = STATUS_MAP[status];
    if (!mapped || !id) return;
    try {
      const fields = { status: mapped };
      if (mapped === 'delivered') fields.delivered_at = Date.now();
      if (mapped === 'read') fields.read_at = Date.now();

      const recipient = db
        .prepare('SELECT campaign_id FROM campaign_recipients WHERE wa_message_id = ?')
        .get(id);
      if (!recipient) return;

      markRecipientByMessageId(id, fields);
      emitProgress(recipient.campaign_id);
    } catch (err) {
      console.error('receipt:', err);
    }
  });
}
