# wabro — Broadcast WhatsApp

Panel web untuk broadcast WhatsApp massal memakai **Baileys** (unofficial, WhatsApp Web protocol).

> **Peringatan:** Memakai API unofficial melanggar ToS WhatsApp dan berisiko nomor dibanned. Gunakan delay yang wajar, jangan spam, dan tanggung jawab penuh ada di Anda.

## Fitur

- **Koneksi QR** — pindai QR dari HP, sesi tersimpan di `data/wa-auth/`, auto-reconnect
- **Kontak** — tambah/edit/hapus, tag, pencarian, **impor CSV** (`name,phone,tags`)
- **Template** — pesan tersimpan + lampiran media (gambar/video/audio/dokumen)
- **Campaign** — pilih penerima (semua / per tag), personalisasi `{nama}` `{nomor}`,
  delay acak antar pesan, kirim sekarang / **jadwal**, **pengulangan interval** (mis. tiap 1 jam dengan batas waktu)
- **Anti-ban** — kirim sekuensial 1-per-1, delay acak (default 3–8 dtk), retry untuk error transient, auto-pause setelah 5 gagal beruntun, hanya 1 campaign aktif
- **Laporan live** — status per penerima: pending → sent → delivered → read / failed,
  progress bar realtime via WebSocket, **export CSV** (BOM UTF-8, Excel-ready)

## Instalasi

```bash
npm install
cp .env.example .env      # lalu isi ADMIN_PASSWORD & SESSION_SECRET
npm start                 # atau: npm run dev (auto-reload)
```

Buka `http://localhost:3000`, login, lalu tab **Koneksi** → pindai QR.

> Catatan: dependency `libsignal` di-override ke paket npm (bukan git) agar instalasi tidak butuh git.

## Konfigurasi (`.env`)

| Variabel | Default | Keterangan |
|---|---|---|
| `PORT` | `3000` | Port web |
| `ADMIN_PASSWORD` | `admin123` | Password login — **ganti!** |
| `SESSION_SECRET` | — | Secret cookie — **ganti!** |

## Struktur

```
src/
├── server.js          Express + Socket.IO + wiring
├── config.js          env + path
├── db/                SQLite (better-sqlite3) + schema + migrasi kolom
├── middleware/auth.js login session
├── wa/
│   ├── session.js     socket Baileys (QR, reconnect, send, receipt event)
│   ├── sender.js      mesin broadcast: delay, retry, pause, siklus ulang
│   └── receipts.js    update delivered/read dari message-status
├── services/          contacts, templates, campaigns, scheduler (node-cron)
└── routes/            auth, contacts, templates, campaigns, wa
views/                 EJS (dashboard, connect/QR, contacts, templates, campaigns)
public/                css + js (progress realtime via socket.io)
data/                  runtime: wabro.sqlite, wa-auth/, uploads/ (jangan di-commit)
```

## Alur campaign

1. `draft` → **Jalankan** → `running` (kirim berdasarkan `delay_min_ms`–`delay_max_ms`)
2. Selesai semua penerima → `completed`, atau bila pakai pengulangan → reset penerima ke `pending`, status `scheduled` untuk siklus berikutnya
3. Receipt WhatsApp memperbarui status sent/delivered/read otomatis
4. Gagal ≥5 beruntun → otomatis `paused` (cek laporan, perbaiki, lanjutkan)

## Troubleshooting

- **QR tidak muncul / sesi putus** → tab Koneksi → "Muat ulang QR"; jika logout dari HP, sesi dihapus otomatis dan perlu scan ulang
- **Pesan gagal semua** → pastikan nomor format `628xx` / `08xx`, dan koneksi internet stabil
- **Server pindah mesin** → salin seluruh folder `data/` agar sesi WhatsApp & database ikut pindah
