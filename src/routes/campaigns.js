import { Router } from 'express';
import path from 'node:path';
import multer from 'multer';
import { config } from '../config.js';
import {
  listCampaigns,
  getCampaign,
  campaignStats,
  createCampaign,
  startCampaign,
  pauseCampaign,
  cancelCampaign,
  deleteCampaign,
  listRecipients,
  repeatLabel,
  TIME_VARS
} from '../services/campaigns.js';
import { runCampaign, control, activeCampaignId, isRunning } from '../wa/sender.js';
import { createExcelCampaign, buildTemplateWorkbook, syncExcelCampaign } from '../services/excel.js';
import { parseSheetUrl, fetchSheet } from '../services/sheet-source.js';
import multerLib from 'multer';

const excelUpload = multerLib({
  storage: multerLib.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});
import { listTemplates } from '../services/templates.js';
import { allTags } from '../services/contacts.js';
import { waSession } from '../wa/session.js';

const storage = multer.diskStorage({
  destination: config.uploadsDir,
  filename: (req, file, cb) => cb(null, `${Date.now()}_${file.originalname.replace(/[^\w.\-]/g, '_')}`)
});
const upload = multer({ storage, limits: { fileSize: config.upload.maxFileSize } });

const router = Router();

router.get('/', (req, res) => {
  const excelResult = req.session.excelResult || null;
  delete req.session.excelResult;
  res.render('campaigns', {
    campaigns: listCampaigns(),
    repeatLabel,
    timeVars: TIME_VARS,
    excelResult,
    templates: listTemplates(),
    tags: allTags(),
    waConnected: waSession.status === 'connected',
    activeId: activeCampaignId(),
    error: req.query.error || null
  });
});

router.post('/', upload.single('media'), (req, res) => {
  try {
    const { name, templateId, body, delayMinMs, delayMaxMs, selector, selectorValue, scheduledAt, action,
      repeatRule, repeatEvery, repeatUnit, repeatUntil } = req.body;

    let scheduled = null;
    if (scheduledAt) {
      scheduled = new Date(scheduledAt).getTime();
      if (Number.isNaN(scheduled) || scheduled < Date.now() - 60000) {
        throw new Error('Waktu jadwal tidak valid atau sudah lewat');
      }
    }

    const media = req.file
      ? {
          mediaPath: path.basename(req.file.path),
          mediaType: req.file.mimetype.startsWith('image/')
            ? 'image'
            : req.file.mimetype.startsWith('video/')
              ? 'video'
              : req.file.mimetype.startsWith('audio/')
                ? 'audio'
                : 'document',
          mediaMime: req.file.mimetype,
          mediaName: req.file.originalname
        }
      : {};

    const campaign = createCampaign({
      name,
      templateId: templateId ? Number(templateId) : null,
      body,
      scheduledAt: scheduled,
      delayMinMs,
      delayMaxMs,
      selector,
      selectorValue,
      repeatRule,
      repeatEvery,
      repeatUnit,
      repeatUntil,
      ...media
    });

    if (action === 'send' && !scheduled) {
      if (waSession.status !== 'connected') throw new Error('WhatsApp belum terhubung. Pindai QR dulu di halaman Koneksi.');
      runCampaign(campaign.id).catch((err) => console.error('sender:', err));
    }

    res.redirect(`/campaigns/${campaign.id}`);
  } catch (err) {
    res.redirect(`/campaigns?error=${encodeURIComponent(err.message)}`);
  }
});

router.get('/excel/template', (req, res) => {
  const buf = buildTemplateWorkbook();
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="template-kirim-terjadwal.xlsx"');
  res.send(buf);
});

router.post('/excel/url', async (req, res) => {
  try {
    const { sheetUrl, body, delayMinMs, delayMaxMs } = req.body;
    const parsed = parseSheetUrl(sheetUrl);
    const sheet = await fetchSheet(parsed.downloadUrl);
    const result = createExcelCampaign({
      defaultBody: body,
      delayMinMs,
      delayMaxMs,
      buffer: sheet.kind === 'xlsx' ? sheet.buffer : undefined,
      csvText: sheet.kind === 'csv' ? sheet.text : undefined,
      sourceUrl: String(sheetUrl).trim()
    });
    req.session.excelResult = {
      added: result.added,
      duplicates: result.duplicates,
      errors: result.errors.slice(0, 20)
    };
    res.redirect(`/campaigns/${result.campaign.id}`);
  } catch (err) {
    res.redirect(`/campaigns?error=${encodeURIComponent(err.message)}`);
  }
});

router.post('/excel', excelUpload.single('excel'), (req, res) => {
  try {
    if (!req.file) throw new Error('Pilih file Excel (.xlsx) dulu');
    if (!req.file.originalname.toLowerCase().endsWith('.xlsx')) {
      throw new Error('Hanya file .xlsx yang didukung');
    }
    const { name, body, delayMinMs, delayMaxMs } = req.body;
    const result = createExcelCampaign({
      fileName: req.file.originalname,
      defaultBody: body,
      delayMinMs,
      delayMaxMs,
      buffer: req.file.buffer
    });
    req.session.excelResult = {
      added: result.added,
      duplicates: result.duplicates,
      errors: result.errors.slice(0, 20)
    };
    res.redirect(`/campaigns/${result.campaign.id}`);
  } catch (err) {
    res.redirect(`/campaigns?error=${encodeURIComponent(err.message)}`);
  }
});

router.get('/:id', (req, res) => {
  const campaign = getCampaign(req.params.id);
  if (!campaign) return res.status(404).render('404');
  const { rows, total } = listRecipients(req.params.id, {
    status: req.query.status || '',
    q: req.query.q || ''
  });
  const syncResult = req.session.syncResult || null;
  delete req.session.syncResult;
  res.render('campaign-detail', {
    campaign,
    recipients: rows,
    total,
    stats: campaignStats(campaign.id),
    statusFilter: req.query.status || '',
    q: req.query.q || '',
    error: req.query.error || null,
    syncResult,
    repeatLabel,
    waConnected: waSession.status === 'connected'
  });
});

router.post('/:id/action', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { action } = req.body;
    if (action === 'start') {
      if (waSession.status !== 'connected') throw new Error('WhatsApp belum terhubung');
      runCampaign(id).catch((err) => console.error('sender:', err));
    } else if (action === 'pause') {
      pauseCampaign(id);
      control(id, 'pause');
    } else if (action === 'cancel') {
      cancelCampaign(id);
      control(id, 'cancel');
    } else if (action === 'delete') {
      deleteCampaign(id);
      return res.redirect('/campaigns');
    }
    res.redirect(`/campaigns/${id}`);
  } catch (err) {
    res.redirect(`/campaigns/${req.params.id}?error=${encodeURIComponent(err.message)}`);
  }
});

router.post('/:id/sync', async (req, res) => {
  try {
    const result = await syncExcelCampaign(Number(req.params.id));
    req.session.syncResult = result;
    res.redirect(`/campaigns/${req.params.id}`);
  } catch (err) {
    res.redirect(`/campaigns/${req.params.id}?error=${encodeURIComponent(err.message)}`);
  }
});

router.get('/:id/export', (req, res) => {
  const campaign = getCampaign(req.params.id);
  if (!campaign) return res.status(404).send('Not found');
  const { rows } = listRecipients(campaign.id, { limit: 100000 });
  const esc = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const fmt = (ts) => (ts ? new Date(ts).toLocaleString('id-ID') : '');
  const header = 'phone,name,status,jadwal,error,sent_at,delivered_at,read_at\n';
  const body = rows
    .map((r) =>
      [r.phone, r.name, r.status, fmt(r.scheduled_at), r.error, fmt(r.sent_at), fmt(r.delivered_at), fmt(r.read_at)].map(esc).join(',')
    )
    .join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="campaign-${campaign.id}-report.csv"`);
  res.send('﻿' + header + body);
});

export default router;
