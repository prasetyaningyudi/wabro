# wabro — Broadcast WhatsApp

Panel web untuk broadcast WhatsApp massal memakai **Baileys** (unofficial, WhatsApp Web protocol).

> **Peringatan:** Memakai API unofficial melanggar ToS WhatsApp dan berisiko nomor dibanned. Gunakan delay yang wajar, jangan spam, dan tanggung jawab penuh ada di Anda.

## Fitur

- **Koneksi QR** — pindai QR dari HP, sesi tersimpan di `data/wa-auth/`, auto-reconnect
- **Kontak** — tambah/edit/hapus, tag, pencarian, **impor CSV** (`name,phone,tags`)
- **Template** — pesan tersimpan + lampiran media (gambar/video/audio/dokumen)
- **Campaign** — pilih penerima (semua / per tag), personalisasi `{nama}` `{nomor}`,
  delay acak antar pesan, kirim sekarang / **jadwal**, **pengulangan interval** dengan
  **jam tetap** (siklus berikutnya tepat di jam jadwal pertama, drift otomatis dikoreksi)
- **Impor Excel & sinkron sheet online** — kirim terjadwal per baris (kolom
  `nomor,nama,tag,pesan,jadwal`); baris tanpa nomor → semua kontak ber-tag; baris
  **nomor + tag** → kirim ke nomor itu dan ke semua kontak ber-tag (nomor sama = kirim
  sekali); `{template:id}`; jadwal lampau otomatis terlewat; **Sinkronkan ulang** dari
  Google Sheets / OneDrive / Excel Online; **sinkron otomatis** per interval/jam/harian/mingguan
- **Jalankan ulang** — reset campaign non-Excel ke `pending` dan jadwalkan ulang
- **Hari Libur** — atur akhir pekan + tanggal libur; campaign perulangan dilewati saat
  libur, jadwal digeser ke interval berikutnya
- **Aksi per baris penerima** — Lewati (tidak dikirim, bertahan saat repeat/sinkron),
  Aktifkan, Kirim ulang
- **Anti-ban** — kirim sekuensial 1-per-1, delay acak (default 3–8 dtk), retry untuk error transient, auto-pause setelah 5 gagal beruntun, hanya 1 campaign aktif
- **Laporan live** — status per penerima: pending → sent → delivered → read / failed / skipped,
  progress bar realtime via WebSocket, **export CSV** (BOM UTF-8, Excel-ready)

## Instalasi

```bash
npm install
cp .env.example .env      # lalu isi ADMIN_PASSWORD & SESSION_SECRET
npm start                 # atau: npm run dev (auto-reload)
```

Buka `http://localhost:3200`, login, lalu tab **Koneksi** → pindai QR.

> Catatan: dependency `libsignal` di-override ke paket npm (bukan git) agar instalasi tidak butuh git.

## Docker

```bash
cp .env.example .env      # lalu isi ADMIN_PASSWORD & SESSION_SECRET
docker compose up -d --build
```

Buka `http://localhost:3200`. Data (SQLite, sesi WA, upload) persisten di volume `wabro-data`.

Perintah berguna:

```bash
docker compose logs -f     # lihat log
docker compose down        # stop (data tetap di volume)
docker compose up -d --build   # rebuild setelah git pull
```

Di ZimaOS: buka port container `3200` di pengaturan App, atau taruh di belakang reverse proxy HTTPS lalu isi `TRUST_PROXY=1` di `.env`.

## Konfigurasi (`.env`)

| Variabel | Default | Keterangan |
|---|---|---|
| `PORT` | `3200` | Port web |
| `ADMIN_PASSWORD` | `admin123` | Password login — **ganti!** |
| `SESSION_SECRET` | — | Secret cookie — **ganti!** |
| `TRUST_PROXY` | — | Isi `1` kalau di belakang reverse proxy HTTPS |

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
├── services/          contacts, templates, campaigns, excel (impor/sinkron sheet),
│                      holidays (libur), sheet-source (fetch sheet), scheduler (node-cron)
└── routes/            auth, contacts, templates, campaigns, holidays, wa
views/                 EJS (dashboard, connect/QR, contacts, templates, campaigns,
                        campaign-detail, holidays, login)
public/                css + js (progress realtime via socket.io)
data/                  runtime: wabro.sqlite, wa-auth/, uploads/ (jangan di-commit)
```

## Alur campaign

1. `draft` → **Jalankan** → `running` (kirim berdasarkan `delay_min_ms`–`delay_max_ms`)
2. Selesai semua penerima → `completed`, atau bila pakai pengulangan → reset penerima ke `pending`, status `scheduled` untuk siklus berikutnya
3. Receipt WhatsApp memperbarui status sent/delivered/read otomatis
4. Gagal ≥5 beruntun → otomatis `paused` (cek laporan, perbaiki, lanjutkan)
5. **Excel**: tiap baris punya jadwal sendiri — baris jatuh tempo dikirim berurutan
   (`scheduled_at`), habis itu campaign menunggu ke jadwal baris terawal berikutnya

## Troubleshooting

- **QR tidak muncul / sesi putus** → tab Koneksi → "Muat ulang QR"; jika logout dari HP, sesi dihapus otomatis dan perlu scan ulang
- **Pesan gagal semua** → pastikan nomor format `628xx` / `08xx`, dan koneksi internet stabil
- **Server pindah mesin** → salin seluruh folder `data/` agar sesi WhatsApp & database ikut pindah
