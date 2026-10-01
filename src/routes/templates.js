import { Router } from 'express';
import path from 'node:path';
import multer from 'multer';
import { config } from '../config.js';
import {
  listTemplates,
  getTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  removeUpload
} from '../services/templates.js';
import { mediaFileFilter, uploadSingle } from '../middleware/upload.js';
import { TIME_VARS } from '../services/campaigns.js';

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
  fileFilter: mediaFileFilter
});

const router = Router();

router.get('/', (req, res) => {
  res.render('templates', {
    templates: listTemplates(),
    edit: req.query.edit ? getTemplate(req.query.edit) : null,
    timeVars: TIME_VARS,
    error: req.query.error || null
  });
});

router.post('/', uploadSingle(upload, 'media', '/templates'), (req, res) => {
  try {
    const media = req.file
      ? {
          path: path.basename(req.file.path),
          mimetype: req.file.mimetype,
          originalname: req.file.originalname
        }
      : null;
    createTemplate({ name: req.body.name, body: req.body.body, media });
    res.redirect('/templates');
  } catch (err) {
    if (req.file) removeUpload(path.basename(req.file.path));
    res.redirect(`/templates?error=${encodeURIComponent(err.message)}`);
  }
});

router.post(
  '/:id',
  uploadSingle(upload, 'media', (req) => `/templates?edit=${req.params.id}`),
  (req, res) => {
    try {
      const media = req.file
        ? {
            path: path.basename(req.file.path),
            mimetype: req.file.mimetype,
            originalname: req.file.originalname
          }
        : null;
      updateTemplate(req.params.id, {
        name: req.body.name,
        body: req.body.body,
        media,
        removeMedia: req.body.removeMedia === '1'
      });
      res.redirect('/templates');
    } catch (err) {
      if (req.file) removeUpload(path.basename(req.file.path));
      res.redirect(`/templates?edit=${req.params.id}&error=${encodeURIComponent(err.message)}`);
    }
  }
);

router.post('/:id/delete', (req, res) => {
  deleteTemplate(req.params.id);
  res.redirect('/templates');
});

export default router;
