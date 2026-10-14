import { timingSafeEqual } from 'node:crypto';
import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { config } from '../config.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: 'Terlalu banyak percobaan login. Coba lagi dalam 15 menit.'
});

function safeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

router.get('/login', (req, res) => {
  if (req.session.authed) return res.redirect('/');
  res.render('login', { layout: false, error: null });
});

router.post('/login', loginLimiter, (req, res) => {
  const { password } = req.body;
  if (password && safeEqual(password, config.adminPassword)) {
    req.session.authed = true;
    return res.redirect('/');
  }
  res.status(401).render('login', { layout: false, error: 'Password salah' });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

export default router;
