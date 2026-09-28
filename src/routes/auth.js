import { Router } from 'express';
import { config } from '../config.js';

const router = Router();

router.get('/login', (req, res) => {
  if (req.session.authed) return res.redirect('/');
  res.render('login', { layout: false, error: null });
});

router.post('/login', (req, res) => {
  const { password } = req.body;
  if (password === config.adminPassword) {
    req.session.authed = true;
    return res.redirect('/');
  }
  res.status(401).render('login', { layout: false, error: 'Password salah' });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

export default router;
