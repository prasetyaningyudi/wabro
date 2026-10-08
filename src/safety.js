// Penangkap proses global — dipasang saat module pertama kali di-import,
// sebelum modul Baileys/scheduler mengeksekusi kode apa pun.
//
// Tanpa ini, unhandled rejection (mis. crash internal retry Baileys
// "Failed to decrypt message..." -> 428 Connection Closed) membunuh seluruh
// proses Node di versi >= 15. Kebijakan: server broadcast lebih baik tetap
// jalan daripada mati; state DB aman karena better-sqlite3 sinkron + transaksi.

process.on('unhandledRejection', (reason) => {
  console.error(
    `[guard ${new Date().toISOString()}] unhandledRejection — server tetap jalan:`,
    (reason && (reason.stack || reason.message)) || reason
  );
});

process.on('uncaughtException', (err) => {
  console.error(
    `[guard ${new Date().toISOString()}] uncaughtException — server tetap jalan:`,
    (err && (err.stack || err.message)) || err
  );
});
