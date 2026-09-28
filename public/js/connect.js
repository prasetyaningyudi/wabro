/* global socket */
(function () {
  const qrImg = document.getElementById('qr-img');
  const msg = document.getElementById('conn-msg');
  const badge = document.getElementById('conn-badge');
  const initial = window.WA_INITIAL || null;
  let prev = initial ? initial.status : null;

  function render(snap) {
    if (badge) badge.textContent = snap.status;
    if (snap.status === 'connected') {
      const wasConnected = prev === 'connected';
      prev = 'connected';
      if (!wasConnected && initial) window.location.reload();
      return;
    }
    prev = snap.status;
    if (snap.status === 'qr' && snap.qr) {
      if (qrImg) {
        qrImg.src = snap.qr;
        qrImg.hidden = false;
      }
      if (msg) msg.textContent = 'Pindai QR ini dengan WhatsApp HP kamu.';
    } else if (snap.status === 'connecting') {
      if (msg) msg.textContent = 'Menyambung…';
    } else {
      if (msg) msg.textContent = 'Terputus. Klik tombol untuk memuat QR baru.';
    }
  }

  document.addEventListener('wa:status', (e) => render(e.detail));
  if (window.WA_INITIAL) render(window.WA_INITIAL);

  const btn = document.getElementById('btn-restart');
  if (btn) {
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = 'Memuat…';
      try {
        await fetch('/connect/start', { method: 'POST' });
      } finally {
        btn.disabled = false;
        btn.textContent = 'Muat ulang QR';
      }
    });
  }

  const btnLogout = document.getElementById('btn-logout');
  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      if (!confirm('Putuskan sesi WhatsApp dan hapus login?')) return;
      await fetch('/connect/logout', { method: 'POST' });
      window.location.reload();
    });
  }
})();
