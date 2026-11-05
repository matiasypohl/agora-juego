function showConnectionOverlay(detail) {
  let overlay = document.getElementById('connection-overlay');
  if (detail.connected) {
    if (overlay) overlay.classList.add('hidden');
    return;
  }
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'connection-overlay';
    overlay.className = 'connection-overlay';
    document.body.appendChild(overlay);
  }
  overlay.innerHTML = detail.failed
    ? '<div class="connection-overlay-content"><p>No se pudo reconectar. <a class="connection-return-link" href="/play">Volver al lobby</a></p></div>'
    : `<div class="connection-overlay-content"><div class="connection-spinner"></div><p>${detail.message || 'Reconectando...'}</p></div>`;
  overlay.classList.remove('hidden');
}

window.addEventListener('agora:connection', event => showConnectionOverlay(event.detail));
window.addEventListener('agora:error', event => {
  if (event.detail?.message) showToast(event.detail.message, 'error');
});
window.addEventListener('agora:player-disconnected', event => {
  if (event.detail?.name) showToast(`⚠️ ${event.detail.name} se desconectó`, 'warning');
});
window.addEventListener('agora:player-reconnected', event => {
  if (event.detail?.name) showToast(`✅ ${event.detail.name} se reconectó`, 'success');
});
window.addEventListener('agora:player-waiting', event => {
  if (event.detail?.name) showToast(`⏳ Esperando a ${event.detail.name} (${event.detail.seconds}s)...`, 'warning');
});
