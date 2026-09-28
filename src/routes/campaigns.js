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
  repeatLabel
} from '../services/campaigns.js';
import { runCampaign, control, activeCampaignId, isRunning } from '../wa/sender.js';
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
  res.render('campaigns', {
    campaigns: listCampaigns(),
    repeatLabel,
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

router.get('/:id', (req, res) => {
  const campaign = getCampaign(req.params.id);
  if (!campaign) return res.status(404).render('404');
  const { rows, total } = listRecipients(req.params.id, {
    status: req.query.status || '',
    q: req.query.q || ''
  });
  res.render('campaign-detail', {
    campaign,
    recipients: rows,
    total,
    stats: campaignStats(campaign.id),
    statusFilter: req.query.status || '',
    q: req.query.q || '',
    error: req.query.error || null,
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

router.get('/:id/export', (req, res) => {
  const campaign = getCampaign(req.params.id);
  if (!campaign) return res.status(404).send('Not found');
  const { rows } = listRecipients(campaign.id, { limit: 100000 });
  const esc = (v) => `"${String(v ?? '').replaceAll('"', '""')}"`;
  const header = 'phone,name,status,error,sent_at,delivered_at,read_at\n';
  const body = rows
    .map((r) =>
      [r.phone, r.name, r.status, r.error, r.sent_at, r.delivered_at, r.read_at].map(esc).join(',')
    )
    .join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="campaign-${campaign.id}-report.csv"`);
  res.send('﻿' + header + body);
});

export default router;
