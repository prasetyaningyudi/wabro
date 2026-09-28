import { Router } from 'express';
import path from 'node:path';
import multer from 'multer';
import { config } from '../config.js';
import {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate
} from '../services/templates.js';

const storage = multer.diskStorage({
  destination: config.uploadsDir,
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^\w.\-]/g, '_');
    cb(null, `${Date.now()}_${safe}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: config.upload.maxFileSize },
  fileFilter: (req, file, cb) => {
    cb(null, true);
  }
});

const router = Router();

router.get('/', (req, res) => {
  res.render('templates', {
    templates: listTemplates(),
    edit: req.query.edit ? getTemplate(req.query.edit) : null,
    error: req.query.error || null
  });
});

router.post('/', upload.single('media'), (req, res) => {
  try {
    const media = req.file
      ? { path: path.basename(req.file.path), mimetype: req.file.mimetype }
      : null;
    createTemplate({ name: req.body.name, body: req.body.body, media });
    res.redirect('/templates');
  } catch (err) {
    res.redirect(`/templates?error=${encodeURIComponent(err.message)}`);
  }
});

router.post('/:id', upload.single('media'), (req, res) => {
  try {
    updateTemplate(req.params.id, {
      name: req.body.name,
      body: req.body.body
    });
    res.redirect('/templates');
  } catch (err) {
    res.redirect(`/templates?error=${encodeURIComponent(err.message)}`);
  }
});

router.post('/:id/delete', (req, res) => {
  deleteTemplate(req.params.id);
  res.redirect('/templates');
});

export default router;
