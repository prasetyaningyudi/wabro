import { Router } from 'express';
import { waSession } from '../wa/session.js';

const router = Router();

router.get('/', (req, res) => {
  res.render('connect', { wa: waSession.snapshot() });
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
