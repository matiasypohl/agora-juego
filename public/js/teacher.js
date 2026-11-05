const socket = io();
const $ = id => document.getElementById(id);
let currentState = null;
let maxTime = 60;
let configRounds = 5;

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function updateRoundsDisplay() {
  $('config-rounds').textContent = configRounds;
  const candidateCount = currentState ? currentState.candidates.length : 2;
  $('config-total-turns').textContent = configRounds * Math.max(candidateCount, 2);
}

$('btn-create').addEventListener('click', () => {
  socket.emit('teacher:create', response => {
    $('room-code-display').textContent = response.code;
    $('room-badge').classList.remove('hidden');
    $('create-section').classList.add('hidden');
    $('lobby-section').classList.remove('hidden');
  });
});

$('btn-rejoin').addEventListener('click', () => {
  const code = $('rejoin-code').value.trim().toUpperCase();
  if (code.length !== 6) {
    $('rejoin-error').textContent = 'Ingresa un código de sala de 6 caracteres';
    return;
  }
  $('btn-rejoin').disabled = true;
  $('btn-rejoin').textContent = 'Conectando...';
  $('rejoin-error').textContent = '';
  socket.emit('teacher:join', { code }, response => {
    if (response.error) {
      $('rejoin-error').textContent = response.error;
      $('btn-rejoin').disabled = false;
      $('btn-rejoin').textContent = 'Reconectar';
      return;
    }
    $('room-code-display').textContent = code;
    $('room-badge').classList.remove('hidden');
    $('create-section').classList.add('hidden');
  });
});

$('rejoin-code').addEventListener('input', event => { event.target.value = event.target.value.toUpperCase(); });
$('rejoin-code').addEventListener('keydown', event => {
  if (event.key === 'Enter') $('btn-rejoin').click();
});
$('btn-start').addEventListener('click', () => socket.emit('teacher:control', { action: 'start' }));
$('btn-pause').addEventListener('click', () => socket.emit('teacher:control', { action: 'pause' }));
$('btn-skip').addEventListener('click', () => socket.emit('teacher:control', { action: 'skip' }));
$('btn-end').addEventListener('click', () => {
  if (confirm('¿Seguro que quieres terminar la partida?')) socket.emit('teacher:control', { action: 'end' });
});
$('btn-restart').addEventListener('click', () => socket.emit('teacher:control', { action: 'restart' }));
$('btn-rounds-minus').addEventListener('click', () => {
  if (configRounds <= 1) return;
  configRounds--;
  updateRoundsDisplay();
  socket.emit('teacher:control', { action: 'config', data: { rounds: configRounds } });
});
$('btn-rounds-plus').addEventListener('click', () => {
  if (configRounds >= 15) return;
  configRounds++;
  updateRoundsDisplay();
  socket.emit('teacher:control', { action: 'config', data: { rounds: configRounds } });
});

socket.on('game:state', state => {
  currentState = state;
  if (state.state === 'lobby') TeacherView.renderLobby(state);
  if (state.state === 'playing') TeacherView.renderGame(state);
  if (state.state === 'ended') TeacherView.showSection('end');
});
socket.on('error', data => { $('start-error').textContent = data.message; });
socket.on('game:timer', ({ timeLeft, duration }) => {
  if (duration > 0) maxTime = duration;
  $('timer-text').textContent = timeLeft + 's';
  $('timer-bar').style.width = (maxTime > 0 ? timeLeft / maxTime * 100 : 0) + '%';
});
socket.on('vote:count', ({ voted, total }) => {
  $('vote-count-text').textContent = `${voted} de ${total} han confirmado su voto`;
});
socket.on('game:activity', ({ icon, text, time }) => {
  const log = $('activity-log');
  if (!log) return;
  const entry = document.createElement('div');
  entry.className = 'activity-entry activity-entry-new';
  const timeText = new Date(time).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  entry.innerHTML = `<span class="activity-time">${escapeHtml(timeText)}</span> <span class="activity-icon">${escapeHtml(icon)}</span> <span class="activity-text">${escapeHtml(text)}</span>`;
  log.prepend(entry);
  while (log.children.length > 50) log.removeChild(log.lastChild);
  setTimeout(() => entry.classList.remove('activity-entry-new'), 600);
});
socket.on('vote:reveal', data => {
  $('vote-count-text').textContent = `👍 ${data.ups}  |  👎 ${data.downs}  |  Abstenciones: ${data.abstentions}${data.multiplier > 1 ? '  (×2)' : ''}`;
});
socket.on('strategy:reveal', data => TeacherView.renderScoreboard(data.scores, currentState));
socket.on('game:end', results => TeacherStatistics.render(results));

$('player-list').addEventListener('click', event => {
  const button = event.target.closest('.btn-toggle-role');
  if (!button) return;
  socket.emit('teacher:control', {
    action: 'assign-role',
    data: { playerId: button.dataset.id, role: button.dataset.current === 'candidate' ? 'citizen' : 'candidate' }
  });
});
