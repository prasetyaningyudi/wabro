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
    total: document.getElementById('st-total'),
    bar: document.getElementById('prog-bar'),
    text: document.getElementById('prog-text'),
    badge: document.getElementById('camp-badge')
  };

  function updateProgress(stats, status) {
    if (!stats) return;
    for (const key of ['pending', 'sent', 'delivered', 'read', 'failed', 'total']) {
      if (els[key]) els[key].textContent = stats[key] ?? 0;
    }
    const done = stats.total - (stats.pending || 0);
    const pct = stats.total ? Math.round((done / stats.total) * 100) : 0;
    if (els.bar) els.bar.style.width = pct + '%';
    if (els.text) {
      els.text.textContent = `${done}/${stats.total} diproses (${pct}%) · gagal: ${stats.failed || 0}`;
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
      failed: Number(els.failed?.textContent || 0)
    });
  }
})();
