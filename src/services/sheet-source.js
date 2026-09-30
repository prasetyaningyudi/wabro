const MAX_HOPS = 5;
const TIMEOUT_MS = 15000;
const MAX_BYTES = 10 * 1024 * 1024;

const ACCESS_MSG =
  'Sheet tidak bisa diakses. Buka aksesnya: Bagikan → "Siapa saja yang punya link" (lihat), lalu coba lagi.';

function normHost(hostname) {
  return String(hostname || '').toLowerCase().replace(/\.$/, '');
}

export function isAllowedHost(hostname) {
  const h = normHost(hostname);
  if (h === 'docs.google.com') return true;
  // Google melempar export ke CDN googleusercontent.com (mis. doc-14-70-sheets.googleusercontent.com)
  if (h === 'googleusercontent.com' || h.endsWith('.googleusercontent.com')) return true;
  if (h === '1drv.ms' || h === 'onedrive.live.com') return true;
  if (h.endsWith('.sharepoint.com') || h.endsWith('.sharepoint-df.com')) return true;
  return false;
}

const HOST_MSG =
  'Penyedia tidak didukung. Pakai link Google Sheets (docs.google.com) atau OneDrive/Excel Online (1drv.ms, onedrive.live.com, sharepoint.com).';

export function parseSheetUrl(input) {
  let raw = String(input || '').trim();
  if (!raw) throw new Error('Isi link sheet-nya dulu');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = 'https://' + raw;

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('Link sheet tidak valid. Contoh: https://docs.google.com/spreadsheets/d/xxxx/edit');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Link sheet harus http/https');

  const host = normHost(url.hostname);

  if (host === 'docs.google.com') {
    const m = url.pathname.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]{10,})/);
    if (!m) throw new Error('Bukan link Google Sheet yang valid (tidak ada /spreadsheets/d/<id>)');
    const id = m[1];
    let gid = url.searchParams.get('gid');
    if (!gid) {
      const h = url.hash.match(/gid=(\d+)/);
      if (h) gid = h[1];
    }
    let downloadUrl = `https://docs.google.com/spreadsheets/d/${id}/export?format=xlsx`;
    if (gid) downloadUrl += `&gid=${encodeURIComponent(gid)}`;
    return { provider: 'google', downloadUrl, label: 'Google Sheet' };
  }

  if (isAllowedHost(host)) {
    return { provider: 'onedrive', downloadUrl: url.toString(), label: 'OneDrive / Excel Online' };
  }

  throw new Error(HOST_MSG);
}

function mapHttpError(status) {
  if (status === 401 || status === 403) return new Error(ACCESS_MSG);
  if (status === 404) return new Error('Link sheet tidak ditemukan (404). Periksa link, file mungkin sudah dihapus.');
  if (status === 429)
    return new Error('Penyedia membatasi permintaan (429). Tunggu sebentar lalu coba lagi.');
  if (status >= 500) return new Error(`Server penyedia sedang bermasalah (HTTP ${status}). Coba lagi nanti.`);
  return new Error(`Gagal mengambil sheet (HTTP ${status}).`);
}

function looksHtml(text) {
  return /^\s*<(!doctype|html|\?xml)/i.test(text);
}

export async function fetchSheet(input, { fetchImpl = fetch } = {}) {
  let current = new URL(String(input));
  const accept = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, text/csv, */*';

  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    if (!isAllowedHost(current.hostname)) {
      const h = normHost(current.hostname);
      if (h.endsWith('.google.com') || h.endsWith('.googleusercontent.com')) throw new Error(ACCESS_MSG);
      throw new Error(HOST_MSG);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await fetchImpl(current.toString(), {
        redirect: 'manual',
        signal: controller.signal,
        headers: { accept, 'user-agent': 'Mozilla/5.0 (compatible; wabro/1.0)' }
      });
    } catch (err) {
      if (err?.name === 'AbortError' || err?.name === 'TimeoutError' || /abort/i.test(String(err?.message))) {
        throw new Error('Mengambil sheet timeout (15 detik). Coba lagi.');
      }
      throw new Error(`Gagal mengambil sheet: ${String(err?.message || err)}`);
    } finally {
      clearTimeout(timer);
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      if (!loc) throw new Error('Gagal mengambil sheet (redirect tanpa tujuan).');
      current = new URL(loc, current);
      continue;
    }
    if (!res.ok) throw mapHttpError(res.status);

    const len = Number(res.headers.get('content-length'));
    if (Number.isFinite(len) && len > MAX_BYTES) {
      throw new Error('Ukuran file sheet melebihi batas 10MB.');
    }

    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BYTES) throw new Error('Ukuran file sheet melebihi batas 10MB.');
    if (!buf.length) throw new Error('Sheet kosong (tidak ada isi).');

    if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) {
      return { kind: 'xlsx', buffer: buf };
    }

    const contentType = String(res.headers.get('content-type') || '').toLowerCase();
    const text = buf.toString('utf8');
    if (contentType.includes('html') || looksHtml(text)) throw new Error(ACCESS_MSG);
    return { kind: 'csv', text };
  }

  throw new Error('Gagal mengambil sheet: terlalu banyak redirect.');
}
