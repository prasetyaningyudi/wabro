import path from 'node:path';

const ALLOWED_MEDIA_EXT = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'heic', 'heif',
  'mp4', '3gp', '3gpp', 'mov', 'webm',
  'mp3', 'm4a', 'aac', 'ogg', 'oga', 'wav', 'opus',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'zip'
]);

export function mediaFileFilter(req, file, cb) {
  const ext = path.extname(file.originalname || '').toLowerCase().replace(/^\./, '');
  if (ALLOWED_MEDIA_EXT.has(ext)) return cb(null, true);
  const label = ext ? `.${ext}` : 'tanpa ekstensi';
  cb(new Error(`File ${label} tidak diizinkan. Pakai gambar, video, audio, atau dokumen (pdf/doc/xls).`));
}

export function uploadSingle(upload, field, errorPath) {
  return (req, res, next) => {
    upload.single(field)(req, res, (err) => {
      if (!err) return next();
      let msg = err.message || 'Upload gagal';
      if (err.code === 'LIMIT_FILE_SIZE') msg = 'Ukuran file melebihi batas';
      const base = typeof errorPath === 'function' ? errorPath(req) : errorPath;
      return res.redirect(`${base}${base.includes('?') ? '&' : '?'}error=${encodeURIComponent(msg)}`);
    });
  };
}
