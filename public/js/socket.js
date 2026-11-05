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

function publishSocketEvent(name, detail) {
  window.dispatchEvent(new CustomEvent('agora:' + name, { detail }));
}

socket.on('connect', () => {
  publishSocketEvent('connection', { connected: true });
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
  publishSocketEvent('connection', { connected: false, message: 'Conexión perdida. Reconectando...' });
});

socket.on('reconnect_attempt', () => {
  publishSocketEvent('connection', { connected: false, message: 'Reconectando...' });
});

socket.on('reconnect_failed', () => {
  publishSocketEvent('connection', { connected: false, failed: true });
});

// ─── Game Events ─────────────────────────────────────────
socket.on('game:state', (state) => {
  gameState = state;
  publishSocketEvent('game-state', state);
});

socket.on('game:timer', (data) => {
  publishSocketEvent('game-timer', data);
});

socket.on('vote:reveal', (data) => {
  publishSocketEvent('vote-reveal', data);
});

socket.on('strategy:reveal', (data) => {
  publishSocketEvent('strategy-reveal', data);
});

socket.on('strategy:confirmed', (data) => {
  publishSocketEvent('strategy-confirmed', data);
});

socket.on('message:private', (data) => {
  publishSocketEvent('private-message', data);
});

socket.on('game:end', (results) => {
  publishSocketEvent('game-end', results);
});

// ─── Vote Confirmed (two-step voting) ────────────────────
socket.on('vote:confirmed', () => {
  publishSocketEvent('vote-confirmed');
});

// ─── Escándalo & Debate Events ───────────────────────────
socket.on('game:scandal', (data) => {
  publishSocketEvent('scandal', data);
});

socket.on('debate:result', (data) => {
  publishSocketEvent('debate-result', data);
});

// ─── Error Feedback ─────────────────────────────────────
socket.on('error', (data) => {
  publishSocketEvent('error', data);
});

// ─── Player Connect/Disconnect Notifications ────────────
socket.on('player:disconnected', (data) => {
  publishSocketEvent('player-disconnected', data);
});

socket.on('player:reconnected', (data) => {
  publishSocketEvent('player-reconnected', data);
});

socket.on('player:waiting', (data) => {
  publishSocketEvent('player-waiting', data);
});
