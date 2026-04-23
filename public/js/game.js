const $ = id => document.getElementById(id);

// ─── HTML Sanitization ──────────────────────────────────
function escapeHtml(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ─── Card metadata ───────────────────────────────────────
const CARD_META = {
  agenda:    { name: 'Agenda',    icon: '📋', color: '#3b82f6', desc: 'Elige el dilema que enfrentará el candidato' },
  respaldo:  { name: 'Respaldo',  icon: '👍', color: '#22c55e', desc: '+2 votos al candidato' },
  censura:   { name: 'Censura',   icon: '👎', color: '#ef4444', desc: '-2 votos al candidato' },
  coalicion: { name: 'Coalición', icon: '🤝', color: '#8b5cf6', desc: 'Conviértete en Asesor privado' }
};

// Agenda turn-type metadata (Normal / Escándalo / Debate)
const TYPE_META = {
  normal:    { icon: '📋', label: 'Normal',       color: '#3b82f6', desc: 'Turno estándar' },
  escandalo: { icon: '💥', label: 'Escándalo ×2', color: '#dc2626', desc: 'Votación con multiplicador ×2' },
  debate:    { icon: '⚔️', label: 'Debate',       color: '#d946ef', desc: 'Los dos candidatos responden lo mismo' }
};

const PHASE_NAMES = {
  'agenda_window':    '📋 Ventana de Agenda',
  'agenda':           '📋 Fase de Agenda',
  'voting':           '🗳️ Votación Secreta',
  'strategy':         '🃏 Fase de Estrategia',
  'turn_result':      '📊 Resultado del Turno',
  'debate_question':  '⚔️ Debate — Respuestas',
  'debate_vote':      '⚔️ Debate — Votación',
  'debate_result':    '⚔️ Debate — Resultado'
};

const PHASE_ICONS = {
  'agenda_window': '📋', 'agenda': '🎙️',
  'voting': '🗳️', 'strategy': '🃏', 'turn_result': '📊',
  'debate_question': '⚔️', 'debate_vote': '⚔️', 'debate_result': '🏆'
};

const PHASE_TIMES = {
  'agenda_window': 10, 'agenda': 60,
  'voting': 20, 'strategy': 20, 'turn_result': 3,
  'debate_question': 45, 'debate_vote': 20, 'debate_result': 3
};

// ─── Flavor Text for Strategy Cards ──────────────────────
const FLAVOR_RESPALDO = [
  'El candidato rescató un gatito de un árbol 🐱',
  'Vecinos destacan su labor comunitaria',
  'Voluntario en campañas de reciclaje',
  'Donó útiles escolares a colegio rural',
  'Organizó operativo médico gratuito',
  'Lideró reforestación en su barrio',
  'Ayudó a abuelitos durante la pandemia',
  'Promovió campaña anti-bullying exitosa',
  'Su fundación entregó 200 canastas familiares',
  'Medios lo destacan como líder juvenil del año',
  'Creó huerto comunitario en la población',
  'Impulsó WiFi gratuito para estudiantes',
];

const FLAVOR_CENSURA = [
  'Candidato grabado manejando ebrio por la ciudad 🚗',
  'Descubren que plagió su tesis universitaria',
  'Filtran audio insultando a votantes',
  'No pagó impuestos durante 3 años',
  'Usó fondos públicos para viaje personal',
  'Mintió sobre su título profesional',
  'Acusado de nepotismo en su oficina',
  'Prometió 5 veces lo mismo sin cumplir',
  'Sorprendido tirando basura en la playa',
  'Se descubre conflicto de interés con empresa',
  'Faltó al 40% de las sesiones del consejo',
  'Canceló reunión vecinal para ir de vacaciones',
];

function getRandomFlavor(type) {
  if (type === 'respaldo') return FLAVOR_RESPALDO[Math.floor(Math.random() * FLAVOR_RESPALDO.length)];
  if (type === 'censura') return FLAVOR_CENSURA[Math.floor(Math.random() * FLAVOR_CENSURA.length)];
  return null;
}

const flavorCache = {};
function getCachedFlavor(type, index) {
  const key = type + ':' + index;
  if (!(key in flavorCache)) flavorCache[key] = getRandomFlavor(type);
  return flavorCache[key];
}
function clearFlavorCache() {
  for (const k in flavorCache) delete flavorCache[k];
}

// ─── State ───────────────────────────────────────────────
let maxTime = 60;
let hasVoted = false;
let hasPlayedStrategy = false;
let hasDebateVoted = false;
let lastPhase = null;
let currentTimeLeft = 0;

// ─── Sound System (Web Audio API) ────────────────────────
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

function ensureAudio() {
  if (!audioCtx) audioCtx = new AudioCtx();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playTone(freq, duration, type = 'sine', volume = 0.12) {
  try {
    ensureAudio();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.value = volume;
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
  } catch (e) { /* Audio not available */ }
}

function sfxPhaseChange()  { playTone(523, 0.15); setTimeout(() => playTone(659, 0.15), 100); setTimeout(() => playTone(784, 0.2), 200); }
function sfxVote()         { playTone(880, 0.1, 'sine', 0.08); }
function sfxCardPlay()     { playTone(440, 0.08); playTone(554, 0.12); }
function sfxTimerWarn()    { playTone(440, 0.1, 'square', 0.05); }
function sfxVoteReveal()   { playTone(392, 0.15); setTimeout(() => playTone(523, 0.15), 150); setTimeout(() => playTone(659, 0.3), 300); }
function sfxGameEnd()      { [523,659,784,1047].forEach((f,i) => setTimeout(() => playTone(f, 0.3, 'sine', 0.1), i*150)); }

// ─── Toast System ────────────────────────────────────────
function showToast(msg, type = '', duration = 2500) {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = `toast ${type ? 'toast-' + type : ''}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// ─── Phase Transition Overlay ────────────────────────────
function showPhaseOverlay(icon, title, subtitle) {
  const existing = document.querySelector('.phase-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.className = 'phase-overlay';
  overlay.innerHTML = `
    <div class="phase-overlay-icon">${icon}</div>
    <div class="phase-overlay-title">${title}</div>
    ${subtitle ? `<div class="phase-overlay-subtitle">${subtitle}</div>` : ''}
  `;
  document.body.appendChild(overlay);

  setTimeout(() => {
    overlay.classList.add('out');
    setTimeout(() => overlay.remove(), 400);
  }, 1200);
}

// ─── Confetti ────────────────────────────────────────────
function launchConfetti() {
  const container = document.createElement('div');
  container.className = 'confetti-container';
  document.body.appendChild(container);

  const colors = ['#7c3aed', '#fcd34d', '#22c55e', '#ef4444', '#3b82f6', '#d946ef', '#f97316'];
  for (let i = 0; i < 80; i++) {
    const piece = document.createElement('div');
    piece.className = 'confetti-piece';
    piece.style.left = Math.random() * 100 + 'vw';
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDuration = (2 + Math.random() * 3) + 's';
    piece.style.animationDelay = Math.random() * 1.5 + 's';
    piece.style.borderRadius = Math.random() > 0.5 ? '50%' : '2px';
    piece.style.width = (6 + Math.random() * 8) + 'px';
    piece.style.height = (6 + Math.random() * 8) + 'px';
    container.appendChild(piece);
  }
  setTimeout(() => container.remove(), 6000);
}

// ─── Role Instructions ───────────────────────────────────
function getInstruction(phase, role, isCurrentCandidate, opts) {
  const instructions = {
    agenda_window: {
      citizen: '⏳ Espera tu turno para elegir el tema del dilema',
      chooser: '📋 ¡Es tu turno! Elige el tema del próximo dilema',
      candidate: '⏳ Espera a que los ciudadanos elijan un dilema para ti',
      currentCandidate: '⏳ Los ciudadanos deciden qué dilema enfrentarás'
    },
    agenda: {
      citizen: '👀 Observa cómo responde el candidato y prepárate para votar',
      candidate: '⏳ Otro candidato está respondiendo',
      currentCandidate: '🎙️ Lee el dilema y elige tu postura. ¡Todos te observan!',
      advisor: '🤝 Envía un consejo privado al candidato antes de que responda'
    },
    voting: {
      citizen: '🗳️ Vota en secreto: ¿te convenció la postura del candidato?',
      candidate: '🤞 Los ciudadanos deciden tu destino...'
    },
    strategy: {
      citizen: '🃏 Juega una carta de estrategia o pasa',
      candidate: '⏳ Los ciudadanos están jugando cartas que afectan tu puntuación...'
    },
    debate_question: {
      citizen: '👀 Los candidatos debaten — espera para votar al más convincente',
      candidate: '⚔️ ¡Debate! Escribe tu postura sobre el dilema',
      currentCandidate: '⚔️ ¡Debate! Escribe tu postura sobre el dilema'
    },
    debate_vote: {
      citizen: '🗳️ Vota por el candidato que te convenció más',
      candidate: '🤞 Los ciudadanos eligen al ganador del debate...'
    },
    debate_result: {
      citizen: '📊 Resultado del debate',
      candidate: '📊 Resultado del debate'
    }
  };

  const phaseInstr = instructions[phase];
  if (!phaseInstr) return null;

  if (isCurrentCandidate && phaseInstr.currentCandidate) return phaseInstr.currentCandidate;
  if (role === 'advisor' && phaseInstr.advisor) return phaseInstr.advisor;
  if (opts && opts.isChooser && phaseInstr.chooser) return phaseInstr.chooser;
  return phaseInstr[role] || phaseInstr.citizen || null;
}

// ─── Main Render ─────────────────────────────────────────
function renderGameState(state) {
  // Header
  const roleLabels = { citizen: 'Ciudadano', candidate: 'Candidato', advisor: 'Asesor' };
  $('my-role-badge').textContent = roleLabels[state.myRole] || '';
  $('my-role-badge').className = 'role-badge role-' + (state.myRole || 'citizen');

  // Phase banner
  $('phase-label').textContent = PHASE_NAMES[state.phase] || state.phase || 'Esperando...';
  const currentCandidate = state.players.find(p => p.id === state.currentCandidateId);
  $('phase-candidate-name').textContent = currentCandidate ? `— Turno de ${currentCandidate.name}` : '';

  maxTime = PHASE_TIMES[state.phase] || 60;

  // Phase transition overlay
  const phaseChanged = state.phase && state.phase !== lastPhase;
  if (phaseChanged) {
    const prevPhase = lastPhase;
    lastPhase = state.phase;

    // Timer expiration feedback
    if (prevPhase === 'voting' && !hasVoted && state.myRole !== 'candidate') {
      showToast('⏰ Se acabó el tiempo para votar', 'warning');
    }
    if (prevPhase === 'strategy' && !hasPlayedStrategy && state.myRole !== 'candidate') {
      showToast('⏰ Se acabó el tiempo de estrategia', 'warning');
    }

    // Reset per-phase state
    if (state.phase === 'voting') { hasVoted = false; voteSelection = null; }
    if (state.phase === 'strategy') { hasPlayedStrategy = false; clearFlavorCache(); }
    if (state.phase === 'debate_vote') hasDebateVoted = false;

    // Show overlay for major phase transitions
    if (state.phase !== 'turn_result') {
      const icon = PHASE_ICONS[state.phase] || '🎮';
      const name = PHASE_NAMES[state.phase] || state.phase;
      const candidateName = currentCandidate ? currentCandidate.name : '';
      const subtitle = candidateName ? `Turno de ${candidateName}` : '';
      showPhaseOverlay(icon, name, subtitle);
      sfxPhaseChange();
    }
  }

  // Hide all views
  document.querySelectorAll('.game-view').forEach(v => v.classList.add('hidden'));

  if (state.state === 'ended') {
    $('view-end').classList.remove('hidden');
    return;
  }

  if (!state.phase) {
    $('view-waiting').classList.remove('hidden');
    return;
  }

  const isCandidate = state.myRole === 'candidate';
  const isCurrentCandidate = state.currentCandidateId === socket.id;
  const isAdvisor = state.myRole === 'advisor';

  // Show instruction
  const isChooser = state.agendaChooserId === socket.id;
  const instruction = getInstruction(state.phase, state.myRole, isCurrentCandidate, { isChooser });
  $('role-instruction').innerHTML = instruction
    ? `<span class="instruction-icon">💡</span> ${instruction}`
    : '';
  $('role-instruction').classList.toggle('hidden', !instruction);

  // Scandal indicator
  const scandalEl = $('scandal-indicator');
  if (scandalEl) {
    scandalEl.classList.toggle('hidden', !state.scandalActive);
  }

  // Advisor panel: visible during agenda_window + agenda for either
  // (a) the advisor whose target is the current candidate, or
  // (b) the current candidate (to receive private messages)
  const advisorPanel = $('advisor-panel');
  if (advisorPanel) {
    const inAgendaPhase = ['agenda_window', 'agenda'].includes(state.phase);
    const isAdvisorOfCurrent =
      state.myRole === 'advisor' &&
      state.myAdvisorTarget &&
      state.myAdvisorTarget === state.currentCandidateId;
    const isCurrentCandidateWithAdvisor =
      state.currentCandidateId === socket.id &&
      state.myRole === 'candidate';
    const show = inAgendaPhase && (isAdvisorOfCurrent || isCurrentCandidateWithAdvisor);
    advisorPanel.classList.toggle('hidden', !show);

    // Input: only for the advisor
    $('advisor-input')?.classList.toggle('hidden', !isAdvisorOfCurrent);

    // On entering agenda_window (new turn), reset advisor input state
    if (phaseChanged && state.phase === 'agenda_window' && isAdvisorOfCurrent) {
      const msg = $('advisor-msg');
      const btn = $('btn-send-advice');
      if (msg) { msg.disabled = false; msg.value = ''; }
      if (btn) { btn.disabled = false; }
      $('advisor-received')?.classList.add('hidden');
    }
  }

  // Sync flags from server (important for reconnection)
  if (state.hasVoted) hasVoted = true;
  if (state.hasPlayedStrategy) hasPlayedStrategy = true;
  if (state.voteSelection) voteSelection = state.voteSelection;

  switch (state.phase) {
    case 'agenda_window': renderAgendaWindow(state); break;
    case 'agenda': renderAgenda(state, isCurrentCandidate, isAdvisor); break;
    case 'voting': renderVoting(state, isCandidate); break;
    case 'strategy': renderStrategy(state, isCandidate); break;
    case 'turn_result': $('view-strategy-reveal').classList.remove('hidden'); break;
    case 'debate_question': renderDebateQuestion(state, isCandidate); break;
    case 'debate_vote': renderDebateVote(state, isCandidate); break;
    case 'debate_result': $('view-debate-result').classList.remove('hidden'); break;
  }

  renderMiniScoreboard(state);
  renderMyCards(state);

  // 5B: Focus first interactive element on phase change
  if (phaseChanged) {
    requestAnimationFrame(() => {
      const activeView = document.querySelector('.game-view:not(.hidden)');
      if (activeView) {
        const focusable = activeView.querySelector('button:not([disabled]):not(.hidden), input:not([disabled]), textarea:not([disabled]), [tabindex="0"]');
        if (focusable) focusable.focus();
      }
    });
  }
}

// ─── Agenda Window ───────────────────────────────────────
function renderAgendaWindow(state) {
  $('view-agenda-window').classList.remove('hidden');

  const currentCandidate = state.players.find(p => p.id === state.currentCandidateId);
  $('aw-candidate-name').textContent = currentCandidate ? currentCandidate.name : '?';

  const isChooser = state.agendaChooserId === socket.id;
  const choices = state.agendaChoices || [];

  if (isChooser && choices.length > 0 && !state.agendaClaimed) {
    $('agenda-cards-hand').innerHTML = choices.map((c, i) => {
      const type = TYPE_META[c.turnType] || TYPE_META.normal;
      return `
        <button class="card-btn card-agenda-choice" data-action="choose-agenda" data-index="${i}"
                style="border-color:${escapeHtml(type.color)}; --card-color:${escapeHtml(type.color)}"
                aria-label="Elegir tema ${escapeHtml(type.label)}: ${escapeHtml(c.headline)}">
          <span class="card-type-badge" style="background:${escapeHtml(type.color)}">${type.icon} ${escapeHtml(type.label)}</span>
          <span class="card-icon">${type.icon}</span>
          <span class="card-name">${escapeHtml(c.headline)}</span>
          <span class="card-desc">${escapeHtml(type.desc)}</span>
        </button>
      `;
    }).join('');
    $('aw-waiting').classList.add('hidden');
  } else {
    $('agenda-cards-hand').innerHTML = '';
    $('aw-waiting').classList.remove('hidden');
    if (state.agendaClaimed) {
      $('aw-waiting').textContent = '¡Un ciudadano eligió el dilema!';
    } else {
      const chooser = state.players.find(p => p.id === state.agendaChooserId);
      $('aw-waiting').textContent = chooser
        ? `${chooser.name} está eligiendo el tema...`
        : 'Esperando que alguien elija el tema...';
    }
  }
}

function chooseAgenda(idx) {
  sfxCardPlay();
  socket.emit('agenda:choose', { choiceIndex: idx });
}

// ─── Agenda Phase ────────────────────────────────────────
function renderAgenda(state, isCurrentCandidate, isAdvisor) {
  $('view-agenda').classList.remove('hidden');

  const q = state.currentQuestion;
  if (!q) return;

  $('agenda-scenario').textContent = q.scenario;

  if (isCurrentCandidate) {
    $('agenda-options').innerHTML = q.options.map(o => `
      <button class="option-btn ${state.candidateAnswer === o.label ? 'selected' : ''}"
              data-action="answer" data-label="${escapeHtml(o.label)}"
              aria-label="Responder opción ${escapeHtml(o.label)}: ${escapeHtml(o.text)}"
              ${state.candidateAnswer ? 'disabled' : ''}>
        <strong>${escapeHtml(o.label)}</strong> ${escapeHtml(o.text)}
      </button>
    `).join('');
  } else {
    $('agenda-options').innerHTML = q.options.map(o => `
      <div class="option-display ${state.candidateAnswer === o.label ? 'selected' : ''}">
        <strong>${escapeHtml(o.label)}</strong> ${escapeHtml(o.text)}
      </div>
    `).join('');
  }

  if (state.candidateAnswer) {
    $('candidate-answer-show').classList.remove('hidden');
    const chosen = q.options.find(o => o.label === state.candidateAnswer);
    $('chosen-answer').textContent = `${state.candidateAnswer}: ${chosen ? chosen.text : ''}`;
  } else {
    $('candidate-answer-show').classList.add('hidden');
  }

}

function answerQuestion(label) {
  sfxCardPlay();
  socket.emit('event:answer', { answer: label });
}

// ─── Voting ──────────────────────────────────────────────
let voteSelection = null; // 'up' or 'down' — not yet confirmed

function renderVoting(state, isCandidate) {
  $('view-voting').classList.remove('hidden');

  if (isCandidate) {
    $('vote-buttons').classList.add('hidden');
    $('vote-selection-display').classList.add('hidden');
    $('vote-confirmed').classList.add('hidden');
    $('vote-candidate-wait').classList.remove('hidden');
  } else if (hasVoted) {
    $('vote-buttons').classList.add('hidden');
    $('vote-selection-display').classList.add('hidden');
    $('vote-confirmed').classList.remove('hidden');
    $('vote-candidate-wait').classList.add('hidden');
  } else if (voteSelection) {
    $('vote-buttons').classList.add('hidden');
    $('vote-selection-display').classList.remove('hidden');
    $('vote-confirmed').classList.add('hidden');
    $('vote-candidate-wait').classList.add('hidden');
  } else {
    $('vote-buttons').classList.remove('hidden');
    $('vote-selection-display').classList.add('hidden');
    $('vote-confirmed').classList.add('hidden');
    $('vote-candidate-wait').classList.add('hidden');
  }
}

// ─── Strategy ────────────────────────────────────────────
function renderStrategy(state, isCandidate) {
  $('view-strategy').classList.remove('hidden');

  if (isCandidate) {
    $('strategy-hand').innerHTML = '<p class="hint">Los ciudadanos están decidiendo...</p>';
    $('btn-pass').classList.add('hidden');
    $('strategy-confirmed').classList.add('hidden');
    $('strategy-candidate-wait').classList.remove('hidden');
    return;
  }

  $('strategy-candidate-wait').classList.add('hidden');

  if (hasPlayedStrategy) {
    $('strategy-hand').innerHTML = '';
    $('btn-pass').classList.add('hidden');
    $('strategy-confirmed').classList.remove('hidden');
    return;
  }

  const strategyCards = (state.myCards || []).filter(c => c.type !== 'agenda');
  if (strategyCards.length === 0) {
    $('strategy-hand').innerHTML = '<p class="hint">No tienes cartas de estrategia</p>';
    $('btn-pass').classList.remove('hidden');
    $('strategy-confirmed').classList.add('hidden');
    return;
  }

  $('btn-pass').classList.remove('hidden');
  $('strategy-confirmed').classList.add('hidden');
  $('strategy-hand').innerHTML = strategyCards.map((c, i) => {
    const meta = CARD_META[c.type] || { name: c.type || '?', icon: '🃏', color: '#666', desc: '' };
    const flavor = getCachedFlavor(c.type, i);
    return `
      <button class="card-btn" style="border-color:${escapeHtml(meta.color)}; --card-color:${escapeHtml(meta.color)}"
              data-action="play-strategy" data-card-type="${escapeHtml(c.type)}"
              aria-label="Jugar carta ${escapeHtml(meta.name)}: ${escapeHtml(meta.desc)}">
        <span class="card-icon">${meta.icon}</span>
        <span class="card-name">${escapeHtml(meta.name)}</span>
        ${flavor
          ? `<span class="card-flavor">"${escapeHtml(flavor)}"</span>`
          : `<span class="card-desc">${escapeHtml(meta.desc)}</span>`}
      </button>
    `;
  }).join('');
}

function playStrategy(cardType) {
  if (hasPlayedStrategy) return;
  sfxCardPlay();
  socket.emit('strategy:play', { cardType });
}

function onStrategyConfirmed(data) {
  hasPlayedStrategy = true;
  $('strategy-hand').innerHTML = '';
  $('btn-pass').classList.add('hidden');
  $('strategy-confirmed').classList.remove('hidden');
  if (!data.cardType) {
    $('strategy-confirmed').textContent = '✅ Pasaste este turno';
    return;
  }
  const meta = CARD_META[data.cardType];
  $('strategy-confirmed').textContent = `✅ Jugaste: ${meta?.name || data.cardType}`;
  showToast(`${meta?.icon || '🃏'} ${meta?.name || data.cardType} jugada`, 'success');
}

// ─── Vote Reveal ─────────────────────────────────────────
function showVoteReveal(data) {
  document.querySelectorAll('.game-view').forEach(v => v.classList.add('hidden'));
  $('view-vote-reveal').classList.remove('hidden');

  hasVoted = false;
  sfxVoteReveal();

  const total = data.ups + data.downs + data.abstentions;
  const upPct = total > 0 ? (data.ups / total * 100) : 0;
  const downPct = total > 0 ? (data.downs / total * 100) : 0;

  $('reveal-ups').textContent = data.ups;
  $('reveal-downs').textContent = data.downs;

  // Animated emoji reveal
  const emojiGrid = $('vote-emoji-grid');
  if (emojiGrid) {
    let emojis = '';
    for (let i = 0; i < data.ups; i++) {
      emojis += `<span class="vote-emoji" style="animation-delay:${i * 0.06}s">👍</span>`;
    }
    for (let i = 0; i < data.downs; i++) {
      emojis += `<span class="vote-emoji" style="animation-delay:${(data.ups + i) * 0.06}s">👎</span>`;
    }
    emojiGrid.innerHTML = emojis;
  }

  // Bars
  setTimeout(() => {
    $('reveal-bar-up').style.width = upPct + '%';
    $('reveal-bar-down').style.width = downPct + '%';
  }, 100);

  // Net result
  const net = data.ups - data.downs;
  const multiplied = net * (data.multiplier || 1);
  const netEl = $('reveal-net');
  if (netEl) {
    const sign = multiplied >= 0 ? '+' : '';
    netEl.textContent = `${sign}${multiplied} votos${data.multiplier > 1 ? ' (×2)' : ''}`;
    netEl.className = `vote-net-result ${multiplied >= 0 ? 'positive' : 'negative'}`;
  }

  $('reveal-multiplier').classList.toggle('hidden', data.multiplier <= 1);
}

// ─── Strategy Reveal ─────────────────────────────────────
function showStrategyReveal(data) {
  document.querySelectorAll('.game-view').forEach(v => v.classList.add('hidden'));
  $('view-strategy-reveal').classList.remove('hidden');

  hasPlayedStrategy = false;

  const cardsHtml = data.plays.map((p, i) => {
    const meta = CARD_META[p.cardType] || { name: p.cardType || '?', icon: '🃏', color: '#666' };
    const flavor = p.flavor || getRandomFlavor(p.cardType);
    return `
      <div class="reveal-card ${p.cancelled ? 'cancelled' : ''}"
           style="border-color:${escapeHtml(meta.color)}; animation-delay:${i * 0.15}s">
        <span class="card-icon">${meta.icon}</span>
        <span>${escapeHtml(p.playerName)}: ${escapeHtml(meta.name)}</span>
        ${flavor ? `<span class="card-flavor-reveal">"${escapeHtml(flavor)}"</span>` : ''}
        ${p.cancelled ? '<span class="cancelled-label">ANULADA</span>' : ''}
      </div>
    `;
  }).join('');

  $('strategy-reveal-cards').innerHTML = cardsHtml || '<p class="hint">Nadie jugó cartas este turno</p>';

  const sign = data.netVotes >= 0 ? '+' : '';
  $('net-votes').textContent = `${sign}${data.netVotes}${data.multiplier > 1 ? ' (×2)' : ''}`;
  $('net-votes').className = data.netVotes >= 0 ? 'positive-text' : 'negative-text';

  // Score update toast
  const candidateName = data.candidateName || '?';
  if (data.netVotes > 0) {
    showToast(`📈 ${candidateName}: +${data.netVotes} votos`, 'success');
  } else if (data.netVotes < 0) {
    showToast(`📉 ${candidateName}: ${data.netVotes} votos`, 'danger');
  }

  if (gameState) {
    gameState.scores = data.scores;
    renderMiniScoreboard(gameState);
  }
}

// ─── Advisor Message ─────────────────────────────────────
function showAdvisorMessage(data) {
  $('advisor-received').classList.remove('hidden');
  $('advisor-received-text').textContent = data.text;
  showToast('💬 Mensaje de tu Asesor', 'accent');
}

// ─── Scandal Event ───────────────────────────────────────
function showScandalAlert() {
  showPhaseOverlay('💥', 'ESCÁNDALO', 'Votación con multiplicador ×2');
  showToast('💥 ¡Escándalo! Los votos valen ×2', 'danger', 3000);
  sfxPhaseChange();
}

// ─── Debate Question ─────────────────────────────────────
function renderDebateQuestion(state, isCandidate) {
  $('view-debate-question').classList.remove('hidden');

  const q = state.debateQuestion;
  if (!q) return;

  const [cid1, cid2] = state.debateCandidates || [];
  const p1 = state.players.find(p => p.id === cid1);
  const p2 = state.players.find(p => p.id === cid2);
  $('debate-vs').textContent = `${p1?.name || '?'} vs ${p2?.name || '?'}`;
  $('debate-scenario').textContent = q.scenario;

  const isDebater = state.debateCandidates?.includes(socket.id);
  const myAnswer = state.debateAnswers?.[socket.id];

  if (isDebater && !myAnswer) {
    $('debate-candidate-input').classList.remove('hidden');
    $('debate-waiting').classList.add('hidden');
    $('debate-answers-display').classList.add('hidden');
    $('debate-answer-input').disabled = false;
    $('debate-answer-input').value = '';
  } else if (isDebater && myAnswer) {
    $('debate-candidate-input').classList.add('hidden');
    $('debate-waiting').classList.remove('hidden');
    $('debate-waiting').querySelector('.hint').textContent = '✅ Respuesta enviada. Esperando al otro candidato...';
    $('debate-answers-display').classList.add('hidden');
  } else {
    $('debate-candidate-input').classList.add('hidden');

    // Show answers as they come in
    const answers = state.debateAnswers || {};
    const hasAnyAnswer = Object.keys(answers).length > 0;
    if (hasAnyAnswer) {
      $('debate-answers-display').classList.remove('hidden');
      $('debate-waiting').classList.add('hidden');
      $('debate-answers-display').innerHTML = [cid1, cid2].map(cid => {
        const name = state.players.find(p => p.id === cid)?.name || '?';
        const ans = answers[cid];
        return `
          <div class="debate-answer-card ${ans ? '' : 'pending'}">
            <div class="debate-answer-name">${escapeHtml(name)}</div>
            <div class="debate-answer-text">${ans ? escapeHtml(ans) : '✍️ Escribiendo...'}</div>
          </div>
        `;
      }).join('');
    } else {
      $('debate-answers-display').classList.add('hidden');
      $('debate-waiting').classList.remove('hidden');
      $('debate-waiting').querySelector('.hint').textContent = 'Los candidatos están respondiendo...';
    }
  }
}

// ─── Debate Vote ─────────────────────────────────────────
function renderDebateVote(state, isCandidate) {
  $('view-debate-vote').classList.remove('hidden');

  const [cid1, cid2] = state.debateCandidates || [];
  const answers = state.debateAnswers || {};

  // Show both answers
  $('debate-vote-answers').innerHTML = [cid1, cid2].map(cid => {
    const name = state.players.find(p => p.id === cid)?.name || '?';
    return `
      <div class="debate-answer-card">
        <div class="debate-answer-name">${escapeHtml(name)}</div>
        <div class="debate-answer-text">${escapeHtml(answers[cid] || '(sin respuesta)')}</div>
      </div>
    `;
  }).join('');

  const isDebater = state.debateCandidates?.includes(socket.id);

  if (isDebater) {
    $('debate-vote-buttons').classList.add('hidden');
    $('debate-vote-confirmed').classList.add('hidden');
    $('debate-vote-candidate-wait').classList.remove('hidden');
  } else if (hasDebateVoted) {
    $('debate-vote-buttons').classList.add('hidden');
    $('debate-vote-confirmed').classList.remove('hidden');
    $('debate-vote-candidate-wait').classList.add('hidden');
  } else {
    $('debate-vote-candidate-wait').classList.add('hidden');
    $('debate-vote-confirmed').classList.add('hidden');
    $('debate-vote-buttons').classList.remove('hidden');
    $('debate-vote-buttons').innerHTML = [cid1, cid2].map(cid => {
      const name = state.players.find(p => p.id === cid)?.name || '?';
      return `<button class="btn btn-primary debate-vote-btn" data-action="debate-vote" data-candidate-id="${escapeHtml(cid)}" aria-label="Votar por ${escapeHtml(name)} en el debate">${escapeHtml(name)}</button>`;
    }).join('');
  }
}

function castDebateVote(candidateId) {
  if (hasDebateVoted) return;
  hasDebateVoted = true;
  sfxVote();
  socket.emit('debate:vote', { candidateId });
  $('debate-vote-buttons').classList.add('hidden');
  $('debate-vote-confirmed').classList.remove('hidden');
}

// ─── Debate Result ───────────────────────────────────────
function showDebateResult(data) {
  document.querySelectorAll('.game-view').forEach(v => v.classList.add('hidden'));
  $('view-debate-result').classList.remove('hidden');

  sfxVoteReveal();

  const c1 = data.candidate1;
  const c2 = data.candidate2;
  const isTie = !data.winnerId;

  $('debate-result-content').innerHTML = `
    <h3 style="margin-bottom:1.5rem;">⚔️ Resultado del Debate</h3>
    <div class="debate-answers-grid">
      <div class="debate-answer-card ${c1.id === data.winnerId ? 'winner' : isTie ? '' : 'loser'}">
        <div class="debate-answer-name">${escapeHtml(c1.name)} ${c1.id === data.winnerId ? '🏆' : ''}</div>
        <div class="debate-answer-text">${escapeHtml(c1.answer || '(sin respuesta)')}</div>
        <div class="debate-vote-count">${c1.votes} voto${c1.votes !== 1 ? 's' : ''}</div>
      </div>
      <div class="debate-answer-card ${c2.id === data.winnerId ? 'winner' : isTie ? '' : 'loser'}">
        <div class="debate-answer-name">${escapeHtml(c2.name)} ${c2.id === data.winnerId ? '🏆' : ''}</div>
        <div class="debate-answer-text">${escapeHtml(c2.answer || '(sin respuesta)')}</div>
        <div class="debate-vote-count">${c2.votes} voto${c2.votes !== 1 ? 's' : ''}</div>
      </div>
    </div>
    <div class="debate-result-summary">
      ${isTie
        ? '<span class="tie-text">🤝 ¡Empate! Ningún candidato gana puntos</span>'
        : `<span class="winner-text">🏆 ${escapeHtml(data.winnerName)} gana +2 votos</span>`}
    </div>
  `;

  if (data.winnerId) {
    showToast(`🏆 ${data.winnerName} ganó el debate (+2)`, 'success', 3000);
  } else {
    showToast('🤝 Debate empatado', '', 3000);
  }

  if (gameState) {
    gameState.scores = data.scores;
    renderMiniScoreboard(gameState);
  }
}

// ─── Game End ────────────────────────────────────────────
function showGameEnd(results) {
  document.querySelectorAll('.game-view').forEach(v => v.classList.add('hidden'));
  $('view-end').classList.remove('hidden');

  sfxGameEnd();
  launchConfetti();

  const sorted = results.candidates.sort((a, b) => b.score - a.score);

  $('game-final-results').innerHTML = `
    <div class="end-container">
      <div class="end-title">🏆 ${escapeHtml(results.winnerName)} es ELEGIDO/A</div>
      ${sorted.map((c, i) => `
        <div class="result-row ${c.winner ? 'winner' : ''}">
          <span class="result-rank">${i === 0 ? '🏆' : i === 1 ? '🥈' : '🥉'}</span>
          <span class="result-name">${escapeHtml(c.name)}</span>
          <span class="result-score">${c.score} votos</span>
        </div>
      `).join('')}
      <div class="end-stats">
        <div class="end-stat">
          <div class="end-stat-value">${results.candidates.length}</div>
          <div class="end-stat-label">Candidatos</div>
        </div>
        <div class="end-stat">
          <div class="end-stat-value">${gameState ? gameState.players.length : '?'}</div>
          <div class="end-stat-label">Jugadores</div>
        </div>
        <div class="end-stat">
          <div class="end-stat-value">${gameState ? gameState.questionsPerCandidate : 5}</div>
          <div class="end-stat-label">Rondas</div>
        </div>
      </div>
      <button class="btn btn-primary" style="margin-top:2rem; width:100%; max-width:300px;" onclick="window.location.href='/play'">
        🏛️ Volver al Lobby
      </button>
    </div>
  `;
}

// ─── Timer ───────────────────────────────────────────────
function updateTimer(timeLeft) {
  currentTimeLeft = timeLeft;
  $('timer-text').textContent = timeLeft + 's';

  // Timer big display
  const timerBig = $('timer-big');
  if (timerBig) {
    timerBig.textContent = timeLeft;
    timerBig.classList.toggle('urgent', timeLeft <= 5);
  }

  const pct = maxTime > 0 ? (timeLeft / maxTime) * 100 : 0;
  const bar = $('timer-bar');
  bar.style.width = pct + '%';

  // Progressive color
  bar.classList.remove('urgent', 'warning');
  if (timeLeft <= 5) {
    bar.classList.add('urgent');
    if (timeLeft === 1) {
      document.querySelector('.game-container')?.classList.add('screen-pulse');
      setTimeout(() => document.querySelector('.game-container')?.classList.remove('screen-pulse'), 800);
      sfxTimerWarn();
    }
  } else if (timeLeft <= 10) {
    bar.classList.add('warning');
  }
}

// ─── Mini Scoreboard ─────────────────────────────────────
function renderMiniScoreboard(state) {
  if (!state.candidates || state.candidates.length === 0) {
    $('mini-scoreboard').innerHTML = '';
    return;
  }

  $('mini-scoreboard').innerHTML = state.candidates.map(cid => {
    const p = state.players.find(pl => pl.id === cid);
    const score = state.scores ? (state.scores[cid] || 0) : '???';
    const isCurrent = cid === state.currentCandidateId;
    const asked = state.questionsAsked ? (state.questionsAsked[cid] || 0) : 0;
    return `
      <div class="mini-score ${isCurrent ? 'active' : ''}">
        <span class="mini-name">${escapeHtml(p ? p.name : '?')} <small style="opacity:0.5">${asked}/${state.questionsPerCandidate}</small></span>
        <span class="mini-value ${score >= 0 ? '' : 'negative-text'}">${score >= 0 ? '+' : ''}${score}</span>
      </div>
    `;
  }).join('');
}

// ─── My Cards Bar ────────────────────────────────────────
function renderMyCards(state) {
  const cards = state.myCards || [];
  if (cards.length === 0) {
    $('my-cards').innerHTML = '';
    return;
  }

  $('my-cards').innerHTML = cards.map(c => {
    const meta = CARD_META[c.type] || { name: c.type || '?', icon: '🃏', color: '#666', desc: '' };
    return `
      <div class="mini-card" style="border-color:${escapeHtml(meta.color)}" title="${escapeHtml(meta.desc)}">
        <span>${meta.icon}</span>
        <span class="mini-card-name">${meta.name}</span>
      </div>
    `;
  }).join('');
}

// ─── Event Listeners ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Enable audio on first interaction
  document.addEventListener('click', () => ensureAudio(), { once: true });

  // Delegated event handler for dynamically generated buttons
  $('game-content')?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'answer') answerQuestion(btn.dataset.label);
    else if (action === 'choose-agenda') chooseAgenda(parseInt(btn.dataset.index, 10));
    else if (action === 'play-strategy') playStrategy(btn.dataset.cardType);
    else if (action === 'debate-vote') castDebateVote(btn.dataset.candidateId);
  });

  $('btn-send-advice')?.addEventListener('click', () => {
    const msg = $('advisor-msg').value.trim();
    if (msg) {
      socket.emit('message:private', { text: msg });
      $('advisor-msg').value = '';
      $('advisor-msg').disabled = true;
      $('btn-send-advice').disabled = true;
      showToast('💬 Consejo enviado', 'success');
    }
  });

  // Vote buttons — Step 1: Select
  document.querySelectorAll('.btn-vote').forEach(btn => {
    btn.addEventListener('click', () => {
      if (hasVoted) return;
      const vote = btn.dataset.vote;
      sfxVote();
      voteSelection = vote;
      socket.emit('vote:select', { vote });

      // Show selection for confirmation
      $('vote-buttons').classList.add('hidden');
      $('vote-selection-display').classList.remove('hidden');
      $('vote-selection-emoji').textContent = vote === 'up' ? '👍' : '👎';
      $('vote-selection-label').textContent = vote === 'up' ? 'A favor' : 'En contra';
    });
  });

  // Vote — Step 2: Confirm
  $('btn-vote-confirm')?.addEventListener('click', () => {
    if (hasVoted || !voteSelection) return;
    socket.emit('vote:confirm');
    // Server will emit 'vote:confirmed' back
  });

  // Vote — Change selection
  $('btn-vote-change')?.addEventListener('click', () => {
    if (hasVoted) return;
    voteSelection = null;
    $('vote-selection-display').classList.add('hidden');
    $('vote-buttons').classList.remove('hidden');
  });

  // Debate answer
  $('btn-send-debate-answer')?.addEventListener('click', () => {
    const text = $('debate-answer-input').value.trim();
    if (text) {
      socket.emit('debate:answer', { text });
      $('debate-answer-input').disabled = true;
      $('btn-send-debate-answer').disabled = true;
      showToast('✅ Respuesta enviada', 'success');
    }
  });

  $('btn-pass')?.addEventListener('click', () => {
    hasPlayedStrategy = true;
    socket.emit('strategy:pass');
    $('strategy-hand').innerHTML = '';
    $('btn-pass').classList.add('hidden');
    $('strategy-confirmed').classList.remove('hidden');
    $('strategy-confirmed').textContent = '✅ Pasaste este turno';
  });
});
