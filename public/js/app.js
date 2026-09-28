/* global io */
const socket = io();

const WA_LABELS = {
  connected: 'Tersambung',
  qr: 'Pindai QR',
  connecting: 'Menyambung',
  disconnected: 'Terputus'
};

socket.on('wa:status', (snap) => {
  const pill = document.getElementById('wa-pill');
  const label = document.getElementById('wa-pill-label');
  if (pill) {
    pill.dataset.status = snap.status;
    if (label) label.textContent = WA_LABELS[snap.status] || snap.status;
  }
  document.dispatchEvent(new CustomEvent('wa:status', { detail: snap }));
});
