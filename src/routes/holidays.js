import { Router } from 'express';
import {
  listHolidays,
  addHoliday,
  removeHoliday,
  getWeekendDays,
  setWeekendDays,
  WEEKDAYS
} from '../services/holidays.js';

const router = Router();

router.get('/', (req, res) => {
  res.render('holidays', {
    holidays: listHolidays(),
    weekendDays: getWeekendDays(),
    weekdays: WEEKDAYS,
    error: req.query.error || null,
    notice: req.query.notice || null
  });
});

router.post('/add', (req, res) => {
  try {
    const { date, name } = req.body;
    addHoliday(date, name);
    res.redirect('/holidays?notice=' + encodeURIComponent('Tanggal libur ditambahkan'));
  } catch (err) {
    res.redirect('/holidays?error=' + encodeURIComponent(err.message));
  }
});

router.post('/weekend', (req, res) => {
  try {
    const raw = req.body.days;
    const days = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
    setWeekendDays(days);
    res.redirect('/holidays?notice=' + encodeURIComponent('Aturan mingguan disimpan'));
  } catch (err) {
    res.redirect('/holidays?error=' + encodeURIComponent(err.message));
  }
});

router.post('/:id/delete', (req, res) => {
  try {
    const removed = removeHoliday(req.params.id);
    if (!removed) throw new Error('Tanggal libur tidak ditemukan');
    res.redirect('/holidays?notice=' + encodeURIComponent('Tanggal libur dihapus'));
  } catch (err) {
    res.redirect('/holidays?error=' + encodeURIComponent(err.message));
  }
});

export default router;
