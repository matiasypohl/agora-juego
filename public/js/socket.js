// Socket.io client setup + reconnection handling
const socket = io({
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000
});

// Get room code from URL
const urlParams = new URLSearchParams(window.location.search);
const roomCode = urlParams.get('code');

if (!roomCode) {
  window.location.href = '/play';
}

// Game state
let gameState = null;

// ─── Connection Feedback ─────────────────────────────────
function showConnectionOverlay(show, msg) {
  let overlay = document.getElementById('connection-overlay');
  if (show) {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'connection-overlay';
      overlay.className = 'connection-overlay';
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = `
      <div class="connection-overlay-content">
        <div class="connection-spinner"></div>
        <p>${msg || 'Reconectando...'}</p>
      </div>
    `;
    overlay.classList.remove('hidden');
  } else if (overlay) {
    overlay.classList.add('hidden');
  }
}

socket.on('connect', () => {
  showConnectionOverlay(false);
  // Try to reconnect to game
  const playerName = sessionStorage.getItem('agora_name');
  const reconnectToken = sessionStorage.getItem('agora_token');
  // First-load flag: set by index.html right before redirecting to /game
  // so the server knows this isn't a true reconnection (no toast broadcast)
  const silent = sessionStorage.getItem('agora_first_load') === '1';
  sessionStorage.removeItem('agora_first_load');
  if (playerName && roomCode) {
    socket.emit('reconnect:attempt', { code: roomCode, name: playerName, token: reconnectToken, silent });
  }
});

socket.on('disconnect', () => {
  showConnectionOverlay(true, 'Conexión perdida. Reconectando...');
});

socket.on('reconnect_attempt', () => {
  showConnectionOverlay(true, 'Reconectando...');
});

socket.on('reconnect_failed', () => {
  showConnectionOverlay(true, 'No se pudo reconectar. <a href="/play" style="color:var(--color-accent)">Volver al lobby</a>');
});

// ─── Game Events ─────────────────────────────────────────
socket.on('game:state', (state) => {
  gameState = state;
  if (typeof renderGameState === 'function') {
    renderGameState(state);
  }
});

socket.on('game:timer', (data) => {
  if (typeof updateTimer === 'function') {
    updateTimer(data.timeLeft);
  }
});

socket.on('vote:reveal', (data) => {
  if (typeof showVoteReveal === 'function') {
    showVoteReveal(data);
  }
});

socket.on('strategy:reveal', (data) => {
  if (typeof showStrategyReveal === 'function') {
    showStrategyReveal(data);
  }
});

socket.on('strategy:confirmed', (data) => {
  if (typeof onStrategyConfirmed === 'function') {
    onStrategyConfirmed(data);
  }
});

socket.on('message:private', (data) => {
  if (typeof showAdvisorMessage === 'function') {
    showAdvisorMessage(data);
  }
});

socket.on('game:end', (results) => {
  if (typeof showGameEnd === 'function') {
    showGameEnd(results);
  }
});

// ─── Vote Confirmed (two-step voting) ────────────────────
socket.on('vote:confirmed', () => {
  if (typeof hasVoted !== 'undefined') {
    hasVoted = true;
    voteSelection = null;
  }
  const selDisplay = document.getElementById('vote-selection-display');
  const confirmed = document.getElementById('vote-confirmed');
  if (selDisplay) selDisplay.classList.add('hidden');
  if (confirmed) confirmed.classList.remove('hidden');
  if (typeof showToast === 'function') showToast('✅ Voto confirmado', 'success');
});

// ─── Escándalo & Debate Events ───────────────────────────
socket.on('game:scandal', (data) => {
  if (typeof showScandalAlert === 'function') {
    showScandalAlert(data);
  }
});

socket.on('debate:result', (data) => {
  if (typeof showDebateResult === 'function') {
    showDebateResult(data);
  }
});

// ─── Error Feedback ─────────────────────────────────────
socket.on('error', (data) => {
  if (data?.message && typeof showToast === 'function') {
    showToast(data.message, 'error');
  }
});

// ─── Player Connect/Disconnect Notifications ────────────
socket.on('player:disconnected', (data) => {
  if (data?.name && typeof showToast === 'function') {
    showToast(`⚠️ ${data.name} se desconectó`, 'warning');
  }
});

socket.on('player:reconnected', (data) => {
  if (data?.name && typeof showToast === 'function') {
    showToast(`✅ ${data.name} se reconectó`, 'success');
  }
});

socket.on('player:waiting', (data) => {
  if (data?.name && typeof showToast === 'function') {
    showToast(`⏳ Esperando a ${data.name} (${data.seconds}s)...`, 'warning');
  }
});
