import { Router } from 'express';
import { waSession } from '../wa/session.js';

const router = Router();

const scriptJson = (value) =>
  JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');

router.get('/', (req, res) => {
  const snap = waSession.snapshot();
  res.render('connect', { wa: snap, waInit: scriptJson(snap) });
});

router.get('/status', (req, res) => {
  res.json(waSession.snapshot());
});

router.post('/start', async (req, res) => {
  try {
    await waSession.start();
    res.json(waSession.snapshot());
  } catch (err) {
    console.error('connect/start:', err);
    res.status(500).json({ error: String(err?.message || err), ...waSession.snapshot() });
  }
});

router.post('/logout', async (req, res) => {
  try {
    await waSession.logout();
    res.json(waSession.snapshot());
  } catch (err) {
    console.error('connect/logout:', err);
    res.status(500).json({ error: String(err?.message || err), ...waSession.snapshot() });
  }
});

export default router;
