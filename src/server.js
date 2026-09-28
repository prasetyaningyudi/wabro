import http from 'node:http';
import path from 'node:path';
import express from 'express';
import session from 'express-session';
import { Server as SocketServer } from 'socket.io';
import { config } from './config.js';
import { waSession, waEvents } from './wa/session.js';
import { senderEvents } from './wa/sender.js';
import { startReceiptTracker } from './wa/receipts.js';
import { startScheduler } from './services/scheduler.js';
import { requireAuth } from './middleware/auth.js';
import authRoutes from './routes/auth.js';
import contactRoutes from './routes/contacts.js';
import templateRoutes from './routes/templates.js';
import campaignRoutes from './routes/campaigns.js';
import waRoutes from './routes/wa.js';
import { db } from './db/index.js';

const app = express();
const server = http.createServer(app);
const io = new SocketServer(server);

app.set('view engine', 'ejs');
app.set('views', path.join(config.rootDir, 'views'));

const sessionMiddleware = session({
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 3600 * 1000 }
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json({ limit: '2mb' }));
app.use(sessionMiddleware);
app.use(express.static(path.join(config.rootDir, 'public')));
app.use('/uploads', express.static(config.uploadsDir));

app.use((req, res, next) => {
  const snap = waSession.snapshot();
  res.locals.waStatus = snap.status;
  res.locals.waLabel =
    snap.status === 'connected'
      ? 'Tersambung'
      : snap.status === 'qr'
        ? 'Pindai QR'
        : snap.status === 'connecting'
          ? 'Menyambung'
          : 'Terputus';
  res.locals.wa = snap;
  next();
});

app.use(authRoutes);

app.use(requireAuth);
app.use('/contacts', contactRoutes);
app.use('/templates', templateRoutes);
app.use('/campaigns', campaignRoutes);
app.use('/connect', waRoutes);

app.get('/', (req, res) => {
  const stats = {
    contacts: db.prepare('SELECT COUNT(*) AS c FROM contacts').get().c,
    templates: db.prepare('SELECT COUNT(*) AS c FROM templates').get().c,
    campaigns: db.prepare('SELECT COUNT(*) AS c FROM campaigns').get().c
  };
  const recent = db.prepare('SELECT * FROM campaigns ORDER BY id DESC LIMIT 5').all();
  const perStatus = db
    .prepare('SELECT status, COUNT(*) AS c FROM campaigns GROUP BY status')
    .all();
  res.render('dashboard', { stats, recent, perStatus, wa: waSession.snapshot() });
});

app.use((req, res) => res.status(404).render('404'));

const wrap = (middleware) => (socket, next) => middleware(socket.request, {}, next);

io.use(wrap(sessionMiddleware));

io.use((socket, next) => {
  const req = socket.request;
  if (req.session?.authed) return next();
  next(new Error('unauthorized'));
});

io.on('connection', (socket) => {
  socket.emit('wa:status', waSession.snapshot());
});

waEvents.on('status', (snap) => io.emit('wa:status', snap));
senderEvents.on('progress', (data) => io.emit('campaign:progress', data));

startReceiptTracker();
startScheduler();

db.transaction(() => {
  db.prepare("UPDATE campaigns SET status = 'paused' WHERE status = 'running'").run();
  db.prepare("UPDATE campaign_recipients SET status = 'pending' WHERE status = 'sending'").run();
})();

server.listen(config.port, () => {
  console.log(`wabro berjalan di http://localhost:${config.port}`);
  console.log(`password login: ${process.env.ADMIN_PASSWORD ? '(dari .env)' : 'admin123 (default)'}`);
  waSession.start().catch((err) => console.error('wa start:', err));
});
