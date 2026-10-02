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

const themeBtn = document.getElementById('theme-toggle');
if (themeBtn) {
  const currentTheme = () => document.documentElement.getAttribute('data-theme') || 'light';
  const applyTheme = (t) => {
    document.documentElement.setAttribute('data-theme', t);
    themeBtn.textContent = t === 'light' ? 'Terang' : 'Gelap';
    try { localStorage.setItem('wabro-theme', t); } catch (e) { /* mode privat: abaikan */ }
  };
  applyTheme(currentTheme());
  themeBtn.addEventListener('click', () => applyTheme(currentTheme() === 'light' ? 'dark' : 'light'));
}
