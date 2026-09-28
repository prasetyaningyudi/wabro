import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

const dataDir = path.join(rootDir, 'data');
const uploadsDir = path.join(dataDir, 'uploads');
const waAuthDir = path.join(dataDir, 'wa-auth');

for (const dir of [dataDir, uploadsDir, waAuthDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

export const config = {
  rootDir,
  port: Number(process.env.PORT) || 3000,
  adminPassword: process.env.ADMIN_PASSWORD || 'admin123',
  sessionSecret: process.env.SESSION_SECRET || 'wabro-dev-secret',
  defaultCc: (process.env.DEFAULT_CC || '62').replace(/\D/g, '') || '62',
  dataDir,
  uploadsDir,
  waAuthDir,
  dbPath: path.join(dataDir, 'wabro.sqlite'),
  defaults: {
    delayMinMs: 3000,
    delayMaxMs: 8000,
    maxAttempts: 3,
    consecutiveFailureLimit: 5
  },
  upload: {
    maxFileSize: 50 * 1024 * 1024
  }
};
