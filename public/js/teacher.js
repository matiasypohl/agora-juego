const socket = io();
const $ = id => document.getElementById(id);
let currentState = null;

function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
let maxTime = 60;
let configRounds = 5;

// ─── Create Room ─────────────────────────────────────────
$('btn-create').addEventListener('click', () => {
  socket.emit('teacher:create', (res) => {
    $('room-code-display').textContent = res.code;
    $('room-badge').classList.remove('hidden');
    $('create-section').classList.add('hidden');
    $('lobby-section').classList.remove('hidden');
  });
});

// ─── Rejoin Existing Room ────────────────────────────────
$('btn-rejoin').addEventListener('click', () => {
  const code = $('rejoin-code').value.trim().toUpperCase();
  if (!code || code.length !== 6) {
    $('rejoin-error').textContent = 'Ingresa un código de sala de 6 caracteres';
    return;
  }
  $('btn-rejoin').disabled = true;
  $('btn-rejoin').textContent = 'Conectando...';
  $('rejoin-error').textContent = '';

  socket.emit('teacher:join', { code }, (res) => {
    if (res.error) {
      $('rejoin-error').textContent = res.error;
      $('btn-rejoin').disabled = false;
      $('btn-rejoin').textContent = 'Reconectar';
      return;
    }
    $('room-code-display').textContent = code;
    $('room-badge').classList.remove('hidden');
    $('create-section').classList.add('hidden');
    // The server will emit game:state which triggers the correct render
  });
});

$('rejoin-code').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase();
});

$('rejoin-code').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('btn-rejoin').click();
});

// ─── Start Game ──────────────────────────────────────────
$('btn-start').addEventListener('click', () => {
  socket.emit('teacher:control', { action: 'start' });
});

// ─── Controls ────────────────────────────────────────────
$('btn-pause').addEventListener('click', () => {
  socket.emit('teacher:control', { action: 'pause' });
});

$('btn-skip').addEventListener('click', () => {
  socket.emit('teacher:control', { action: 'skip' });
});

$('btn-end').addEventListener('click', () => {
  if (confirm('¿Seguro que quieres terminar la partida?')) {
    socket.emit('teacher:control', { action: 'end' });
  }
});

// ─── Restart ─────────────────────────────────────────────
$('btn-restart').addEventListener('click', () => {
  socket.emit('teacher:control', { action: 'restart' });
});

// ─── Config: Rounds ──────────────────────────────────────
function updateRoundsDisplay() {
  $('config-rounds').textContent = configRounds;
  const candidateCount = currentState ? currentState.candidates.length : 2;
  $('config-total-turns').textContent = configRounds * Math.max(candidateCount, 2);
}

$('btn-rounds-minus').addEventListener('click', () => {
  if (configRounds > 1) {
    configRounds--;
    updateRoundsDisplay();
    socket.emit('teacher:control', { action: 'config', data: { rounds: configRounds } });
  }
});

$('btn-rounds-plus').addEventListener('click', () => {
  if (configRounds < 15) {
    configRounds++;
    updateRoundsDisplay();
    socket.emit('teacher:control', { action: 'config', data: { rounds: configRounds } });
  }
});

// ─── State Updates ───────────────────────────────────────
socket.on('game:state', (state) => {
  currentState = state;

  if (state.state === 'lobby') renderLobby(state);
  if (state.state === 'playing') renderGame(state);
  if (state.state === 'ended') renderEnd(state);
});

socket.on('error', (data) => {
  $('start-error').textContent = data.message;
});

// ─── Timer ───────────────────────────────────────────────
socket.on('game:timer', ({ timeLeft }) => {
  $('timer-text').textContent = timeLeft + 's';
  const pct = maxTime > 0 ? (timeLeft / maxTime) * 100 : 0;
  $('timer-bar').style.width = pct + '%';
});

// ─── Vote Count ──────────────────────────────────────────
socket.on('vote:count', ({ voted, total }) => {
  $('vote-count-text').textContent = `${voted} de ${total} han confirmado su voto`;
});

// ─── Activity Log ────────────────────────────────────────
socket.on('game:activity', ({ icon, text, time }) => {
  const log = $('activity-log');
  if (!log) return;
  const entry = document.createElement('div');
  entry.className = 'activity-entry activity-entry-new';
  const t = new Date(time);
  const timeStr = t.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  entry.innerHTML = `<span class="activity-time">${escapeHtml(timeStr)}</span> <span class="activity-icon">${escapeHtml(icon)}</span> <span class="activity-text">${escapeHtml(text)}</span>`;
  log.prepend(entry);
  // Keep max 50 entries
  while (log.children.length > 50) log.removeChild(log.lastChild);
  // Remove animation class after it plays
  setTimeout(() => entry.classList.remove('activity-entry-new'), 600);
});

// ─── Vote Reveal ─────────────────────────────────────────
socket.on('vote:reveal', (data) => {
  $('vote-count-text').textContent = `👍 ${data.ups}  |  👎 ${data.downs}  |  Abstenciones: ${data.abstentions}${data.multiplier > 1 ? '  (×2)' : ''}`;
});

// ─── Strategy Reveal ─────────────────────────────────────
socket.on('strategy:reveal', (data) => {
  renderScoreboard(data.scores, currentState);
});

// ─── Game End ────────────────────────────────────────────
socket.on('game:end', (results) => {
  $('lobby-section').classList.add('hidden');
  $('game-section').classList.add('hidden');
  $('end-section').classList.remove('hidden');

  // Podium
  $('final-results').innerHTML = results.candidates
    .sort((a, b) => b.score - a.score)
    .map((c, i) => `
      <div class="result-row ${c.winner ? 'winner' : ''}">
        <span class="result-rank">${i === 0 ? '🏆' : i === 1 ? '🥈' : '🥉'}</span>
        <span class="result-name">${escapeHtml(c.name)}</span>
        <span class="result-score">${c.score} votos</span>
      </div>
    `).join('');

  // Stats overview
  const s = results.stats || {};
  const totalVotes = (s.totalVotesUp || 0) + (s.totalVotesDown || 0) + (s.totalAbstentions || 0);

  $('stats-overview').innerHTML = `
    <div class="stat-card">
      <div class="stat-value">${s.totalPlayers || '?'}</div>
      <div class="stat-label">Jugadores</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${s.totalRounds || '?'}</div>
      <div class="stat-label">Rondas/candidato</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${(s.turnResults || []).length}</div>
      <div class="stat-label">Turnos jugados</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${totalVotes}</div>
      <div class="stat-label">Votos totales</div>
    </div>
    <div class="stat-card positive-text">
      <div class="stat-value">👍 ${s.totalVotesUp || 0}</div>
      <div class="stat-label">A favor (${totalVotes > 0 ? Math.round(s.totalVotesUp / totalVotes * 100) : 0}%)</div>
    </div>
    <div class="stat-card negative-text">
      <div class="stat-value">👎 ${s.totalVotesDown || 0}</div>
      <div class="stat-label">En contra (${totalVotes > 0 ? Math.round(s.totalVotesDown / totalVotes * 100) : 0}%)</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">😶 ${s.totalAbstentions || 0}</div>
      <div class="stat-label">Abstenciones</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">🃏 ${s.totalCardsPlayed || 0}</div>
      <div class="stat-label">Cartas jugadas</div>
    </div>
  `;

  // Cards breakdown
  const cardMeta = {
    respaldo: { icon: '👍', name: 'Respaldo', color: '#22c55e' },
    censura: { icon: '👎', name: 'Censura', color: '#ef4444' },
    coalicion: { icon: '🤝', name: 'Coalición', color: '#8b5cf6' }
  };

  const cardsPlayed = s.cardsPlayed || {};
  const maxCards = Math.max(1, ...Object.values(cardsPlayed));

  $('stats-cards').innerHTML = Object.entries(cardMeta).map(([type, meta]) => {
    const count = cardsPlayed[type] || 0;
    const pct = (count / maxCards) * 100;
    return `
      <div class="stats-card-row">
        <span class="stats-card-label">${meta.icon} ${meta.name}</span>
        <div class="stats-card-bar-track">
          <div class="stats-card-bar" style="width:${pct}%; background:${meta.color};"></div>
        </div>
        <span class="stats-card-count">${count}</span>
      </div>
    `;
  }).join('');

  // Turn-by-turn results — gráfico de líneas SVG
  const turnResults = s.turnResults || [];
  $('stats-turns').innerHTML = turnResults.length > 0
    ? renderScoreChart(turnResults)
    : '<p class="hint">Sin datos de turnos</p>';
  if (turnResults.length > 0) attachChartTooltips(turnResults);
});

// ─── Score Chart (SVG line chart with hover tooltips) ─────
const CANDIDATE_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];
const TYPE_META_CHART = {
  normal:    { icon: '📋', label: 'Normal' },
  escandalo: { icon: '💥', label: 'Escándalo ×2' },
  debate:    { icon: '⚔️', label: 'Debate' }
};
const CARD_META_CHART = {
  respaldo:  { icon: '👍', label: 'Respaldo' },
  censura:   { icon: '👎', label: 'Censura' },
  coalicion: { icon: '🤝', label: 'Coalición' }
};

function renderScoreChart(turnResults) {
  // Descubrir candidatos y construir series por candidato
  const candidateIds = [];
  const candidateNames = {};
  for (const t of turnResults) {
    if (!candidateIds.includes(t.candidateId)) {
      candidateIds.push(t.candidateId);
      candidateNames[t.candidateId] = t.candidateName;
    }
    if (t.allScoresAfter) {
      for (const cid of Object.keys(t.allScoresAfter)) {
        if (!candidateIds.includes(cid)) {
          candidateIds.push(cid);
          candidateNames[cid] = cid; // fallback
        }
      }
    }
  }

  // Por cada turno, captura el puntaje acumulado de cada candidato (usa allScoresAfter si existe)
  const N = turnResults.length;
  const series = {}; // cid -> [{x, y}]
  for (const cid of candidateIds) series[cid] = [{ x: 0, y: 0 }];
  const runningScore = {};
  for (const cid of candidateIds) runningScore[cid] = 0;

  turnResults.forEach((t, i) => {
    if (t.allScoresAfter) {
      for (const cid of candidateIds) {
        runningScore[cid] = t.allScoresAfter[cid] ?? runningScore[cid];
      }
    } else {
      // fallback legacy: solo sumamos al candidato del turno
      runningScore[t.candidateId] = (runningScore[t.candidateId] || 0) + (t.netVotes || 0);
    }
    for (const cid of candidateIds) {
      series[cid].push({ x: i + 1, y: runningScore[cid] });
    }
  });

  // Dimensiones del SVG
  const W = 720, H = 320;
  const pad = { top: 24, right: 24, bottom: 48, left: 48 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;

  // Rango Y (simétrico si hay negativos)
  let yMin = 0, yMax = 0;
  for (const cid of candidateIds) {
    for (const p of series[cid]) {
      if (p.y < yMin) yMin = p.y;
      if (p.y > yMax) yMax = p.y;
    }
  }
  if (yMin === yMax) yMax = yMin + 1;
  const ySpan = yMax - yMin;
  const yPad = Math.max(1, Math.ceil(ySpan * 0.1));
  yMin -= yPad; yMax += yPad;

  const xToPx = (x) => pad.left + (N === 0 ? 0 : (x / N) * innerW);
  const yToPx = (y) => pad.top + innerH - ((y - yMin) / (yMax - yMin)) * innerH;

  // Líneas de grilla Y (0 + extremos)
  const gridLines = [];
  const gridVals = new Set([yMin, yMax, 0]);
  const step = Math.max(1, Math.round(ySpan / 4));
  for (let v = Math.ceil(yMin); v <= Math.floor(yMax); v += step) gridVals.add(v);
  const sortedGrid = [...gridVals].filter(v => v >= yMin && v <= yMax).sort((a, b) => a - b);
  for (const v of sortedGrid) {
    const y = yToPx(v);
    gridLines.push(`<line class="chart-grid ${v === 0 ? 'chart-grid-zero' : ''}" x1="${pad.left}" y1="${y}" x2="${W - pad.right}" y2="${y}"/>`);
    gridLines.push(`<text class="chart-axis-label" x="${pad.left - 8}" y="${y + 4}" text-anchor="end">${v}</text>`);
  }

  // Eje X (labels por turno)
  const xLabels = [];
  for (let i = 0; i <= N; i++) {
    const x = xToPx(i);
    xLabels.push(`<line class="chart-axis" x1="${x}" y1="${pad.top + innerH}" x2="${x}" y2="${pad.top + innerH + 4}"/>`);
    if (i > 0) xLabels.push(`<text class="chart-axis-label" x="${x}" y="${pad.top + innerH + 18}" text-anchor="middle">#${i}</text>`);
  }

  // Paths y puntos por candidato
  const pathsAndDots = candidateIds.map((cid, idx) => {
    const color = CANDIDATE_COLORS[idx % CANDIDATE_COLORS.length];
    const pts = series[cid];
    const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${xToPx(p.x).toFixed(1)} ${yToPx(p.y).toFixed(1)}`).join(' ');
    const path = `<path class="chart-line" d="${d}" stroke="${color}" fill="none" stroke-width="2.5"/>`;
    // Solo puntos interactivos en los turnos donde este candidato actuó
    const dots = turnResults.map((t, i) => {
      if (t.candidateId !== cid) return '';
      const p = pts[i + 1];
      return `<circle class="chart-dot" data-turn="${i}" data-cid="${escapeHtml(cid)}" cx="${xToPx(p.x).toFixed(1)}" cy="${yToPx(p.y).toFixed(1)}" r="6" fill="${color}" stroke="#0b1220" stroke-width="2"/>`;
    }).join('');
    return path + dots;
  }).join('');

  // Leyenda
  const legend = candidateIds.map((cid, idx) => {
    const color = CANDIDATE_COLORS[idx % CANDIDATE_COLORS.length];
    return `<span class="chart-legend-item"><span class="chart-legend-dot" style="background:${color}"></span>${escapeHtml(candidateNames[cid])}</span>`;
  }).join('');

  return `
    <div class="score-chart-wrap">
      <div class="chart-legend">${legend}</div>
      <svg class="score-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Evolución de puntaje por turno">
        ${gridLines.join('')}
        ${xLabels.join('')}
        <line class="chart-axis" x1="${pad.left}" y1="${pad.top}" x2="${pad.left}" y2="${pad.top + innerH}"/>
        <line class="chart-axis" x1="${pad.left}" y1="${pad.top + innerH}" x2="${W - pad.right}" y2="${pad.top + innerH}"/>
        ${pathsAndDots}
      </svg>
      <div id="chart-tooltip" class="chart-tooltip hidden" role="tooltip"></div>
    </div>
  `;
}

function attachChartTooltips(turnResults) {
  const tooltip = $('chart-tooltip');
  const wrap = document.querySelector('.score-chart-wrap');
  if (!tooltip || !wrap) return;

  const show = (e, turnIdx) => {
    const t = turnResults[turnIdx];
    if (!t) return;
    const typeMeta = TYPE_META_CHART[t.turnType] || TYPE_META_CHART.normal;
    const cardsEntries = Object.entries(t.cards || {});
    const cardsHtml = cardsEntries.length > 0
      ? cardsEntries.map(([type, n]) => {
          const m = CARD_META_CHART[type] || { icon: '🃏', label: type };
          return `<span class="tt-card">${m.icon} ${m.label}${n > 1 ? ' ×' + n : ''}</span>`;
        }).join('')
      : '<span class="tt-muted">—</span>';

    const debateExtra = t.debate
      ? `<div class="tt-row"><span class="tt-label">Rival:</span> ${escapeHtml(t.debateRivalName || '?')} (${t.debateVotes?.self ?? '?'} vs ${t.debateVotes?.rival ?? '?'})</div>`
      : '';

    const sign = t.netVotes >= 0 ? '+' : '';
    const voteClass = t.netVotes >= 0 ? 'positive-text' : 'negative-text';

    tooltip.innerHTML = `
      <div class="tt-header">
        <span class="tt-turn">Turno #${turnIdx + 1}</span>
        <span class="tt-type">${typeMeta.icon} ${typeMeta.label}</span>
      </div>
      <div class="tt-candidate">${escapeHtml(t.candidateName)}</div>
      <div class="tt-question">${escapeHtml(t.question)}${t.question && t.question.length >= 80 ? '…' : ''}</div>
      <div class="tt-row"><span class="tt-label">Votos turno:</span> <span class="${voteClass}">${sign}${t.netVotes}</span></div>
      <div class="tt-row"><span class="tt-label">Puntaje tras turno:</span> ${t.scoreAfter ?? 0}</div>
      <div class="tt-row"><span class="tt-label">Estrategia:</span> <span class="tt-cards">${cardsHtml}</span></div>
      ${debateExtra}
    `;
    tooltip.classList.remove('hidden');

    // Posicionamiento relativo al wrap
    const wrapRect = wrap.getBoundingClientRect();
    const dotRect = e.target.getBoundingClientRect();
    const left = dotRect.left - wrapRect.left + dotRect.width / 2;
    const top = dotRect.top - wrapRect.top;
    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
  };

  const hide = () => tooltip.classList.add('hidden');

  wrap.querySelectorAll('.chart-dot').forEach(dot => {
    dot.addEventListener('mouseenter', (e) => {
      const idx = parseInt(e.target.dataset.turn, 10);
      show(e, idx);
    });
    dot.addEventListener('mouseleave', hide);
    dot.addEventListener('focus', (e) => {
      const idx = parseInt(e.target.dataset.turn, 10);
      show(e, idx);
    });
    dot.addEventListener('blur', hide);
    dot.setAttribute('tabindex', '0');
  });
}

// ─── Render Functions ────────────────────────────────────
function renderLobby(state) {
  $('lobby-section').classList.remove('hidden');
  $('game-section').classList.add('hidden');
  $('end-section').classList.add('hidden');

  // Sync rounds config
  if (state.questionsPerCandidate) {
    configRounds = state.questionsPerCandidate;
  }
  updateRoundsDisplay();

  const players = state.players || [];
  $('player-list').innerHTML = players.map(p => `
    <div class="player-card ${p.role === 'candidate' ? 'is-candidate' : ''}" data-id="${escapeHtml(p.id)}">
      <span class="player-name">${escapeHtml(p.name)}</span>
      <span class="player-role">${p.role === 'candidate' ? '⭐ Candidato' : 'Ciudadano'}</span>
      <button class="btn btn-small btn-toggle-role" data-id="${escapeHtml(p.id)}" data-current="${escapeHtml(p.role)}">
        ${p.role === 'candidate' ? 'Quitar' : 'Candidato'}
      </button>
    </div>
  `).join('');

  const candidates = players.filter(p => p.role === 'candidate');
  $('candidate-count').textContent = candidates.length;
  $('candidate-list').innerHTML = candidates.map(c =>
    `<span class="candidate-chip">⭐ ${escapeHtml(c.name)}</span>`
  ).join('');

  $('btn-start').disabled = candidates.length < 2;
  $('start-error').textContent = candidates.length < 2 ? 'Se necesitan al menos 2 candidatos' : '';
}

function renderGame(state) {
  $('lobby-section').classList.add('hidden');
  $('game-section').classList.remove('hidden');
  $('end-section').classList.add('hidden');

  // Phase label
  const phaseNames = {
    'agenda_window': '📋 Ventana de Agenda',
    'agenda': '📋 Fase de Agenda',
    'voting': '🗳️ Votación Secreta',
    'strategy': '🃏 Fase de Estrategia',
    'turn_result': '📊 Resultado del Turno',
    'debate_question': '⚔️ Debate — Respuestas',
    'debate_vote': '⚔️ Debate — Votación',
    'debate_result': '⚔️ Debate — Resultado'
  };
  $('phase-label').textContent = phaseNames[state.phase] || state.phase || '—';

  // Max time for timer bar
  const phaseTimes = {
    'agenda_window': 10, 'agenda': 60,
    'voting': 20, 'strategy': 20, 'turn_result': 3,
    'debate_question': 45, 'debate_vote': 20, 'debate_result': 3
  };
  maxTime = phaseTimes[state.phase] || 60;

  // Current candidate
  const currentCandidate = state.players.find(p => p.id === state.currentCandidateId);
  $('phase-candidate').textContent = currentCandidate ? `Turno de: ${currentCandidate.name}` : '';

  // Pause button text and overlay
  $('btn-pause').textContent = state.paused ? '▶ Reanudar' : '⏸ Pausar';
  let pauseOverlay = document.getElementById('pause-overlay');
  if (state.paused) {
    if (!pauseOverlay) {
      pauseOverlay = document.createElement('div');
      pauseOverlay.id = 'pause-overlay';
      pauseOverlay.className = 'pause-overlay';
      pauseOverlay.innerHTML = '<div class="pause-overlay-content">⏸️ PAUSADO</div>';
      $('phase-panel').appendChild(pauseOverlay);
    }
    pauseOverlay.classList.remove('hidden');
  } else if (pauseOverlay) {
    pauseOverlay.classList.add('hidden');
  }

  // Scoreboard
  renderScoreboard(state.scores, state);

  // Current question
  if (state.currentQuestion) {
    let qHtml = `<p class="scenario-text">${escapeHtml(state.currentQuestion.scenario)}</p>`;
    qHtml += state.currentQuestion.options.map(o =>
      `<span class="option-pill ${state.candidateAnswer === o.label ? 'selected' : ''}">${escapeHtml(o.label)}: ${escapeHtml(o.text)}</span>`
    ).join('');
    $('current-question').innerHTML = qHtml;
  } else {
    $('current-question').innerHTML = '—';
  }

  // Player list with connection status
  $('game-player-list').innerHTML = state.players.map(p => `
    <div class="player-card mini ${p.connected ? '' : 'disconnected'}">
      <span class="status-dot ${p.connected ? 'online' : 'offline'}"></span>
      <span>${escapeHtml(p.name)}</span>
      <span class="player-role-tag">${p.role === 'candidate' ? '⭐' : (p.role === 'advisor' ? '🤝' : '')}</span>
    </div>
  `).join('');

  // Progress
  if (state.questionsAsked) {
    const progHtml = state.candidates.map(cid => {
      const p = state.players.find(pl => pl.id === cid);
      const asked = (state.questionsAsked[cid] || 0);
      return `<span class="progress-chip">${escapeHtml(p ? p.name : '?')}: ${asked}/${state.questionsPerCandidate}</span>`;
    }).join(' ');
    $('candidate-answer-display').innerHTML = progHtml;
  }
}

function renderScoreboard(scores, state) {
  if (!scores || !state) return;
  const maxScore = Math.max(1, ...Object.values(scores).map(Math.abs));

  $('scoreboard').innerHTML = state.candidates.map(cid => {
    const p = state.players.find(pl => pl.id === cid);
    const score = scores[cid] || 0;
    const pct = Math.abs(score) / maxScore * 100;
    const isPositive = score >= 0;
    return `
      <div class="score-row">
        <span class="score-name">${escapeHtml(p ? p.name : '?')}</span>
        <div class="score-bar-track">
          <div class="score-bar ${isPositive ? 'positive' : 'negative'}" style="width:${pct}%"></div>
        </div>
        <span class="score-value ${isPositive ? '' : 'negative-text'}">${score}</span>
      </div>
    `;
  }).join('');
}

function renderEnd(state) {
  $('game-section').classList.add('hidden');
  $('lobby-section').classList.add('hidden');
  $('end-section').classList.remove('hidden');
}

// ─── Event Delegation (lobby role toggle) ────────────────
$('player-list').addEventListener('click', (e) => {
  const btn = e.target.closest('.btn-toggle-role');
  if (!btn) return;
  const playerId = btn.dataset.id;
  const newRole = btn.dataset.current === 'candidate' ? 'citizen' : 'candidate';
  socket.emit('teacher:control', {
    action: 'assign-role',
    data: { playerId, role: newRole }
  });
});
