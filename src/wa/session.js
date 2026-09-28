import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import makeWASocket, {
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  DisconnectReason,
  Browsers
} from '@whiskeysockets/baileys';
import pino from 'pino';
import QRCode from 'qrcode';
import { config } from '../config.js';

const logger = pino({ level: 'silent' });

export const waEvents = new EventEmitter();
waEvents.setMaxListeners(100);

const sentMessages = new Map();
const SENT_MESSAGES_LIMIT = 5000;

function rememberMessage(id, message) {
  if (!id || !message) return;
  if (sentMessages.size >= SENT_MESSAGES_LIMIT) {
    const oldest = sentMessages.keys().next().value;
    sentMessages.delete(oldest);
  }
  sentMessages.set(id, message);
}

function wipeAuth() {
  fs.rmSync(config.waAuthDir, { recursive: true, force: true });
  fs.mkdirSync(config.waAuthDir, { recursive: true });
}

class WaSession extends EventEmitter {
  constructor() {
    super();
    this.sock = null;
    this.status = 'disconnected';
    this.qr = null;
    this.me = null;
    this.starting = false;
    this.stopped = false;
    this.restartAttempts = 0;
  }

  snapshot() {
    return { status: this.status, qr: this.qr, me: this.me };
  }

  setStatus(status, extra = {}) {
    this.status = status;
    if (!('qr' in extra)) this.qr = status === 'qr' ? this.qr : null;
    const snap = { ...this.snapshot(), ...extra };
    waEvents.emit('status', snap);
    this.emit('status', snap);
  }

  async start() {
    if (this.starting || this.status === 'connected') return;
    this.starting = true;
    this.stopped = false;

    try {
      const { state, saveCreds } = await useMultiFileAuthState(config.waAuthDir);

      const sock = makeWASocket({
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, logger)
        },
        logger,
        browser: Browsers.ubuntu('Chrome'),
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
        getMessage: async (key) => sentMessages.get(key.id) || undefined
      });
      this.sock = sock;
      this.setStatus('connecting');

      sock.ev.on('creds.update', saveCreds);

      sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          try {
            this.qr = await QRCode.toDataURL(qr, { margin: 1, width: 320 });
          } catch {
            this.qr = null;
          }
          this.setStatus('qr');
        }

        if (connection === 'open') {
          this.restartAttempts = 0;
          this.me = sock.user
            ? { id: sock.user.id?.split(':')[0] || '', name: sock.user.name || '' }
            : null;
          this.setStatus('connected');
        }

        if (connection === 'close') {
          const code = lastDisconnect?.error?.output?.statusCode;
          const loggedOut = code === DisconnectReason.loggedOut;

          if (this.stopped || loggedOut) {
            if (loggedOut) wipeAuth();
            this.sock = null;
            this.me = null;
            this.qr = null;
            this.setStatus('disconnected');
            return;
          }

          this.restartAttempts += 1;
          const delay = Math.min(30000, 1000 * 2 ** Math.min(this.restartAttempts, 5));
          this.setStatus('connecting');
          setTimeout(() => {
            if (!this.stopped) this.start().catch(() => {});
          }, delay);
        }
      });

      sock.ev.on('messages.update', (updates) => {
        for (const update of updates) {
          const status = update.update?.status;
          if (status == null || !update.key?.id) continue;
          waEvents.emit('message-status', {
            id: update.key.id,
            jid: update.key.remoteJid,
            status
          });
        }
      });
    } catch (err) {
      this.setStatus('disconnected');
      waEvents.emit('error', err);
    } finally {
      this.starting = false;
    }
  }

  async logout() {
    this.stopped = true;
    try {
      if (this.sock) await this.sock.logout();
    } catch {
      // logout gagal diabaikan, auth tetap dihapus
    }
    this.sock = null;
    this.me = null;
    this.qr = null;
    wipeAuth();
    this.setStatus('disconnected');
    this.stopped = false;
  }

  async send(jid, content) {
    if (!this.sock) throw new Error('WhatsApp belum terhubung');
    const res = await this.sock.sendMessage(jid, content);
    if (res?.key?.id) rememberMessage(res.key.id, res.message);
    return res;
  }
}

export const waSession = new WaSession();
