import { Router } from 'express';
import {
  listContacts,
  getContact,
  createContact,
  updateContact,
  deleteContact,
  allTags
} from '../services/contacts.js';
import { parse } from 'csv-parse/sync';

const router = Router();

router.get('/', (req, res) => {
  const { q = '', tag = '', page = '1' } = req.query;
  const limit = 50;
  const offset = (Math.max(1, parseInt(page, 10) || 1) - 1) * limit;
  const { rows, total } = listContacts({ q, tag, limit, offset });

  const importResult = req.session.importResult || null;
  delete req.session.importResult;

  res.render('contacts', {
    contacts: rows,
    total,
    q,
    tag,
    page: parseInt(page, 10) || 1,
    pages: Math.ceil(total / limit),
    tags: allTags(),
    edit: req.query.edit ? getContact(req.query.edit) : null,
    error: req.query.error || null,
    importResult
  });
});

router.post('/', (req, res) => {
  try {
    createContact(req.body);
    res.redirect('/contacts');
  } catch (err) {
    res.redirect(`/contacts?error=${encodeURIComponent(err.message)}`);
  }
});

router.post('/import', (req, res) => {
  try {
    const { csv } = req.body;
    if (!csv?.trim()) throw new Error('CSV kosong');
    const rows = parse(csv, {
      columns: false,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true
    });
    if (rows.length < 2) throw new Error('CSV harus punya header dan minimal 1 baris data');

    const header = rows[0].map((h) => String(h).toLowerCase().trim());
    const idx = {
      name: header.findIndex((h) => ['name', 'nama'].includes(h)),
      phone: header.findIndex((h) => ['phone', 'nomor', 'number', 'no'].includes(h)),
      tags: header.findIndex((h) => ['tags', 'tag'].includes(h))
    };
    if (idx.phone < 0) throw new Error('Header CSV harus mengandung kolom phone/nomor (format: name,phone,tags)');

    let added = 0;
    const errors = [];
    const dataRows = rows.slice(1);
    dataRows.forEach((row, i) => {
      const name = idx.name >= 0 ? row[idx.name] || '' : '';
      const phone = row[idx.phone] || '';
      const tagsStart = idx.tags >= 0 ? idx.tags : row.length;
      const tags = row.slice(tagsStart).filter(Boolean).join(',');
      try {
        createContact({ name, phone, tags });
        added++;
      } catch (err) {
        errors.push(`Baris ${i + 2}: ${err.message}`);
      }
    });
    req.session.importResult = { added, errors: errors.slice(0, 20), total: dataRows.length };
    res.redirect('/contacts');
  } catch (err) {
    res.redirect(`/contacts?error=${encodeURIComponent(err.message)}`);
  }
});

router.post('/:id/delete', (req, res) => {
  deleteContact(req.params.id);
  res.redirect('/contacts');
});

router.post('/:id', (req, res) => {
  try {
    updateContact(req.params.id, req.body);
    res.redirect('/contacts');
  } catch (err) {
    res.redirect(`/contacts?edit=${encodeURIComponent(req.params.id)}&error=${encodeURIComponent(err.message)}`);
  }
});

export default router;
