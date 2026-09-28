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
  await waSession.start();
  res.json(waSession.snapshot());
});

router.post('/logout', async (req, res) => {
  await waSession.logout();
  res.json(waSession.snapshot());
});

export default router;
