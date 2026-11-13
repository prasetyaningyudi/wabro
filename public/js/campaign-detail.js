/* global socket */
(function () {
  const card = document.getElementById('camp-card');
  if (!card) return;
  const campaignId = Number(card.dataset.id);

  const els = {
    pending: document.getElementById('st-pending'),
    sent: document.getElementById('st-sent'),
    delivered: document.getElementById('st-delivered'),
    read: document.getElementById('st-read'),
    failed: document.getElementById('st-failed'),
    skipped: document.getElementById('st-skipped'),
    total: document.getElementById('st-total'),
    bar: document.getElementById('prog-bar'),
    text: document.getElementById('prog-text'),
    badge: document.getElementById('camp-badge')
  };

  function updateProgress(stats, status) {
    if (!stats) return;
    for (const key of ['pending', 'sent', 'delivered', 'read', 'failed', 'skipped', 'total']) {
      if (els[key]) els[key].textContent = stats[key] ?? 0;
    }
    const done = (stats.total || 0) - (stats.pending || 0) - (stats.skipped || 0);
    const pct = stats.total ? Math.round((done / stats.total) * 100) : 0;
    if (els.bar) els.bar.style.width = pct + '%';
    if (els.text) {
      const skipInfo = stats.skipped ? ` · dilewati: ${stats.skipped}` : '';
      els.text.textContent = `${done}/${stats.total} diproses (${pct}%) · gagal: ${stats.failed || 0}${skipInfo}`;
    }
    if (status && els.badge) {
      els.badge.textContent = status;
      els.badge.className = `badge st-${status}`;
      card.dataset.status = status;
    }
  }

  socket.on('campaign:progress', (data) => {
    if (data.campaignId !== campaignId) return;
    updateProgress(data.stats, data.status);
    if (data.finished) {
      setTimeout(() => window.location.reload(), 1200);
    }
  });

  const total = Number(els.total?.textContent || 0);
  const pending = Number(els.pending?.textContent || 0);
  if (total) {
    updateProgress({
      total,
      pending,
      sent: Number(els.sent?.textContent || 0),
      delivered: Number(els.delivered?.textContent || 0),
      read: Number(els.read?.textContent || 0),
      failed: Number(els.failed?.textContent || 0),
      skipped: Number(els.skipped?.textContent || 0)
    });
  }
})();

// Form sinkron otomatis: tampilkan field sesuai mode yang dipilih.
(function () {
  const form = document.getElementById('auto-sync-form');
  if (!form) return;
  const mode = form.querySelector('[name=mode]');
  const mins = form.querySelector('.as-i');
  const day = form.querySelector('.as-w');
  const clock = form.querySelector('.as-dw');
  function syncVisibility() {
    const m = mode.value;
    mins.style.display = m === 'i' ? '' : 'none';
    day.style.display = m === 'w' ? '' : 'none';
    clock.style.display = m === 'd' || m === 'w' ? '' : 'none';
  }
  mode.addEventListener('change', syncVisibility);
  syncVisibility();
})();
