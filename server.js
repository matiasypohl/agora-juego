const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { registerGameController } = require('./src/controllers/game-controller');
const { registerPageRoutes } = require('./src/controllers/page-controller');
const { registerRoomController } = require('./src/controllers/room-controller');
const { registerTeacherController } = require('./src/controllers/teacher-controller');
const { PHASE_DURATIONS, TRANSITION_DELAYS } = require('./src/config/phase-durations');
const GAME_LIMITS = require('./src/config/game-limits');
const SCORING = require('./src/config/scoring');
const { createRoomStore } = require('./src/models/room-store');
const { createGameBroadcaster } = require('./src/infrastructure/game-broadcaster');
const { createRateLimiter } = require('./src/infrastructure/rate-limiter');
const { presentGameState } = require('./src/presenters/game-state-presenter');
const { initializeDebate, resolveDebate: resolveDebateRules } = require('./src/services/debate-service');
const { advanceCandidate, findPlayableCandidate, finishGame, resetTurn } = require('./src/services/game-engine');
const {
  getStrategyProgress,
  resolveStrategy: resolveStrategyRules
} = require('./src/services/strategy-service');
const { createTimerService } = require('./src/services/timer-service');
const { countConnectedCitizens, recordVoteStats, summarizeVotes } = require('./src/services/voting-service');

const app = express();
const server = http.createServer(app);
const io = new Server(server);
const broadcaster = createGameBroadcaster(io, presentGameState);
const emitToRoom = broadcaster.emitToRoom;
const emitActivity = broadcaster.emitActivity;
const emitStateToAll = broadcaster.emitState;
const rateLimiter = createRateLimiter(GAME_LIMITS.RATE_LIMIT_PER_SECOND);
const timerService = createTimerService(room => {
  emitToRoom(room, 'game:timer', {
    timeLeft: room.phaseTimeLeft,
    duration: room.phaseDuration
  });
});
const clearTimer = timerService.clear;
const delayedTransition = timerService.delay;
const startPhaseTimer = timerService.start;

const publicDirectory = path.join(__dirname, 'public');
app.use(express.static(publicDirectory, { index: false }));
registerPageRoutes(app, publicDirectory);

// ─── Logging ─────────────────────────────────────────────
function log(room, msg) {
  const code = room ? room.code : '------';
  console.log(`[${new Date().toLocaleTimeString()}] [${code}] ${msg}`);
}

// ─── Load data with validation ───────────────────────────
let questions, getStrategyCard, getStrategyCards;
try {
  ({ questions } = require('./src/models/question-catalog'));
  ({ getStrategyCard, getStrategyCards } = require('./src/models/card-catalog'));
  console.log(`✓ Datos cargados: ${questions.length} preguntas, ${getStrategyCards().length} tipos de cartas`);
} catch (e) {
  console.error(`\n  ❌ Error cargando datos: ${e.message}\n`);
  process.exit(1);
}

// ─── Sanitization ────────────────────────────────────────
function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const roomStore = createRoomStore();

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function getNextQuestion(room) {
  if (room.questionPoolIdx >= room.questionPool.length) {
    room.questionPool = shuffle([...Array(questions.length).keys()]);
    room.questionPoolIdx = 0;
  }
  const q = questions[room.questionPool[room.questionPoolIdx]];
  room.questionPoolIdx++;
  return q || questions[0];
}

// ─── Disconnect Handling During Game ─────────────────────
function handleDisconnectDuringGame(room, playerId, player) {
  const isCurrent = room.candidates[room.currentCandidateIdx] === playerId;
  const isCandidate = room.candidates.includes(playerId);

  // Candidate disconnects during their own turn — grace period then skip
  if (isCandidate && isCurrent && ['agenda_window', 'agenda', 'debate_question'].includes(room.phase)) {
    log(room, `Candidato ${player.name} desconectado durante su turno — gracia 20s`);
    emitToRoom(room, 'player:waiting', { name: player.name, seconds: 20 });
    delayedTransition(room, () => {
      // If still disconnected after grace period, skip turn
      if (!room.players[playerId]?.connected) {
        // Check if a reconnected socket took over (different ID, same name)
        const reconnected = Object.values(room.players).find(p => p.name === player.name && p.connected);
        if (reconnected) return; // They came back under a new ID
        log(room, `Candidato ${player.name} no volvió — saltando turno`);
        emitActivity(room, '⏭️', `${player.name} no volvió — turno saltado`);
        clearTimer(room);
        advanceToNextTurn(room);
      }
    }, TRANSITION_DELAYS.DISCONNECTED_CANDIDATE);
    return;
  }

  // Citizen disconnects as agenda chooser — reassign
  if (room.agendaChooserId === playerId && room.phase === 'agenda_window' && !room.agendaClaimed) {
    const citizenIds = Object.keys(room.players).filter(
      id => room.players[id].role === 'citizen' && room.players[id].connected && id !== playerId
    );
    if (citizenIds.length > 0) {
      // Pick next in rotation
      let found = false;
      for (let i = 0; i < room.citizenTurnOrder.length; i++) {
        const nextIdx = (room.citizenTurnIdx + i) % room.citizenTurnOrder.length;
        const cid = room.citizenTurnOrder[nextIdx];
        if (room.players[cid]?.connected && room.players[cid]?.role !== 'candidate' && cid !== playerId) {
          room.agendaChooserId = cid;
          found = true;
          break;
        }
      }
      if (!found) room.agendaChooserId = citizenIds[0];
      emitActivity(room, '🔄', `${room.players[room.agendaChooserId]?.name} ahora elige el tema`);
      emitStateToAll(room);
    }
    return;
  }

  // Citizen disconnects during voting/strategy — check if we should auto-advance
  if (room.phase === 'voting') {
    const totalCitizens = countConnectedCitizens(room);
    const votedCount = Object.keys(room.votes).length;
    if (totalCitizens > 0 && votedCount >= totalCitizens) {
      clearTimer(room);
      emitActivity(room, '✅', `Todos los conectados votaron (${votedCount}/${totalCitizens})`);
      delayedTransition(room, () => {
        if (room.state !== 'ended' && room.phase === 'voting') revealVotes(room);
      }, TRANSITION_DELAYS.ALL_PLAYERS_READY);
    }
  }

  if (room.phase === 'strategy') {
    checkStrategyComplete(room);
  }

  if (room.phase === 'debate_vote') {
    const totalCitizens = countConnectedCitizens(room);
    const debateVoteCount = Object.keys(room.debateVotes).length;
    if (totalCitizens > 0 && debateVoteCount >= totalCitizens) {
      clearTimer(room);
      delayedTransition(room, () => {
        if (room.state !== 'ended' && room.phase === 'debate_vote') resolveDebate(room);
      }, TRANSITION_DELAYS.ALL_PLAYERS_READY);
    }
  }
}

// ─── Room Cleanup ────────────────────────────────────────
function cleanupRoom(code) {
  const room = roomStore.get(code);
  if (!room) return;
  clearTimer(room);
  roomStore.delete(code);
  log({ code }, 'Sala eliminada');
}

// Periodic cleanup: remove ended rooms after 5 min, empty rooms after 30 min
setInterval(() => {
  const now = Date.now();
  for (const room of roomStore.values()) {
    if (room.state === 'ended' && now - (room.endedAt || room.createdAt) > 5 * 60 * 1000) {
      cleanupRoom(room.code);
    }
    const anyConnected = Object.values(room.players).some(p => p.connected);
    if (!anyConnected && now - room.createdAt > 30 * 60 * 1000) {
      cleanupRoom(room.code);
    }
  }
}, 60 * 1000);

// ─── Game Flow ───────────────────────────────────────────
function startTurn(room) {
  if (room.state === 'ended') return;

  const candidateId = findPlayableCandidate(room);
  if (!candidateId) return endGame(room);
  resetTurn(room);

  log(room, `Turno: candidato ${room.players[candidateId]?.name || candidateId}`);
  emitActivity(room, '🎙️', `Turno de ${room.players[candidateId]?.name || '?'}`);
  startAgendaWindow(room);
}

function startAgendaWindow(room) {
  room.phase = 'agenda_window';

  // Pick 3 questions — each tagged with a turn type (Normal / Escándalo / Debate)
  const types = shuffle(['normal', 'escandalo', 'debate']);
  room.agendaChoices = types.map(turnType => {
    const q = getNextQuestion(room);
    return { ...q, turnType };
  });

  // Assign the next citizen in rotation as the chooser
  const citizenIds = Object.keys(room.players).filter(id => room.players[id].role === 'citizen' && room.players[id].connected);
  if (citizenIds.length > 0) {
    if (!room.citizenTurnOrder || room.citizenTurnOrder.length === 0) {
      room.citizenTurnOrder = shuffle([...citizenIds]);
      room.citizenTurnIdx = 0;
    }
    // Ensure current chooser is still connected
    let attempts = 0;
    while (attempts < room.citizenTurnOrder.length) {
      const chooserId = room.citizenTurnOrder[room.citizenTurnIdx % room.citizenTurnOrder.length];
      if (room.players[chooserId]?.connected && room.players[chooserId]?.role !== 'candidate') {
        room.agendaChooserId = chooserId;
        break;
      }
      room.citizenTurnIdx++;
      attempts++;
    }
    if (attempts >= room.citizenTurnOrder.length) {
      room.agendaChooserId = citizenIds[0]; // fallback
    }
    emitActivity(room, '📋', `${room.players[room.agendaChooserId]?.name} elige el tema`);
  } else {
    room.agendaChooserId = null;
  }

  emitStateToAll(room);
  startPhaseTimer(room, PHASE_DURATIONS.AGENDA_WINDOW, () => {
    if (!room.agendaClaimed) {
      // Auto-pick first choice if no one chose
      const chosen = room.agendaChoices[0];
      room.currentQuestion = chosen;
      room.currentTurnType = chosen?.turnType || 'normal';
      room.scandalActive = room.currentTurnType === 'escandalo';
      if (room.currentTurnType === 'escandalo') {
        emitToRoom(room, 'game:scandal', { active: true });
      }
    }
    // Debate salta directo a la fase de debate (sin respuesta normal)
    if (room.currentTurnType === 'debate' && room.candidates.length >= 2) {
      startDebatePhase(room);
    } else {
      startAgendaPhase(room);
    }
  });
}

function startAgendaPhase(room) {
  room.phase = 'agenda';
  if (!room.currentQuestion) {
    room.currentQuestion = getNextQuestion(room);
  }
  emitStateToAll(room);
  startPhaseTimer(room, PHASE_DURATIONS.AGENDA, () => {
    startVotingPhase(room);
  });
}

function startVotingPhase(room) {
  room.phase = 'voting';
  room.votes = {};
  room.voteSelections = {};
  emitActivity(room, '🗳️', 'Fase de votación secreta');
  emitStateToAll(room);
  startPhaseTimer(room, PHASE_DURATIONS.VOTING, () => {
    revealVotes(room);
  });
}

function revealVotes(room) {
  const summary = summarizeVotes(room, room.scandalActive ? SCORING.SCANDAL_MULTIPLIER : 1);

  emitToRoom(room, 'vote:reveal', {
    ups: summary.ups,
    downs: summary.downs,
    abstentions: summary.abstentions,
    total: summary.total,
    multiplier: summary.multiplier
  });
  emitActivity(room, '📊', `Resultado: 👍${summary.ups} vs 👎${summary.downs} (${summary.abstentions} abstenciones)`);
  recordVoteStats(room, summary);

  delayedTransition(room, () => {
    if (room.state !== 'ended') startStrategyPhase(room);
  }, TRANSITION_DELAYS.VOTE_REVEAL);
}

function startStrategyPhase(room) {
  room.phase = 'strategy';
  room.strategyPlays = {};
  room.strategyPasses = new Set();
  emitStateToAll(room);
  startPhaseTimer(room, PHASE_DURATIONS.STRATEGY, () => {
    resolveStrategy(room);
  });
}

function checkStrategyComplete(room) {
  const progress = getStrategyProgress(room);
  if (progress.complete) {
    clearTimer(room);
    emitActivity(room, '✅', `Todos jugaron/pasaron (${progress.acted}/${progress.total})`);
    delayedTransition(room, () => {
      if (room.state !== 'ended' && room.phase === 'strategy') {
        resolveStrategy(room);
      }
    }, TRANSITION_DELAYS.ALL_PLAYERS_READY);
  }
}

function resolveStrategy(room) {
  if (room.state === 'ended') return;

  const advisorIdsBefore = new Set(Object.values(room.advisors));
  const revealData = resolveStrategyRules(room, getStrategyCard);
  for (const advisorId of Object.values(room.advisors)) {
    if (!advisorIdsBefore.has(advisorId)) log(room, `${room.players[advisorId]?.name} es ahora Asesor`);
  }

  room.phase = 'turn_result';
  emitToRoom(room, 'strategy:reveal', revealData);
  emitStateToAll(room);

  const sign = revealData.netVotes >= 0 ? '+' : '';
  log(room, `Resultado: ${revealData.candidateName} ${sign}${revealData.netVotes} votos (total: ${room.scores[revealData.candidateId]})`);
  emitActivity(room, '📈', `${revealData.candidateName}: ${sign}${revealData.netVotes} votos → total: ${room.scores[revealData.candidateId]}`);

  // Más tiempo para leer los resultados (cartas reveladas + cambio de puntaje)
  delayedTransition(room, () => {
    if (room.state === 'ended') return;
    advanceToNextTurn(room);
  }, TRANSITION_DELAYS.TURN_RESULT);
}

function advanceToNextTurn(room) {
  if (advanceCandidate(room)) {
    endGame(room);
  } else {
    startTurn(room);
  }
}

// ─── P1B: Debate Phase ──────────────────────────────────
function startDebatePhase(room) {
  initializeDebate(room, room.currentQuestion ? null : getNextQuestion(room));
  room.phase = 'debate_question';

  log(room, `Debate: ${room.players[room.debateCandidates[0]]?.name} vs ${room.players[room.debateCandidates[1]]?.name}`);
  emitActivity(room, '⚔️', `¡DEBATE! ${room.players[room.debateCandidates[0]]?.name} vs ${room.players[room.debateCandidates[1]]?.name}`);
  emitStateToAll(room);

  startPhaseTimer(room, PHASE_DURATIONS.DEBATE_QUESTION, () => {
    startDebateVoting(room);
  });
}

function startDebateVoting(room) {
  room.phase = 'debate_vote';
  room.debateVotes = {};
  emitStateToAll(room);

  startPhaseTimer(room, PHASE_DURATIONS.DEBATE_VOTE, () => {
    resolveDebate(room);
  });
}

function resolveDebate(room) {
  const debateResult = resolveDebateRules(room);

  room.phase = 'debate_result';
  emitToRoom(room, 'debate:result', debateResult);
  emitStateToAll(room);

  const votes1 = debateResult.candidate1.votes;
  const votes2 = debateResult.candidate2.votes;
  log(room, `Debate resultado: ${debateResult.winnerName ? debateResult.winnerName + ' gana' : 'Empate'} (${votes1} vs ${votes2})`);
  emitActivity(room, '🏆', debateResult.winnerName
    ? `${debateResult.winnerName} gana el debate (+2)`
    : `Debate empatado (${votes1} vs ${votes2})`);

  delayedTransition(room, () => {
    if (room.state === 'ended') return;
    room.debateActive = false;
    advanceToNextTurn(room);
  }, TRANSITION_DELAYS.DEBATE_RESULT);
}

function endGame(room) {
  clearTimer(room);
  const results = finishGame(room);

  emitToRoom(room, 'game:end', results);
  emitStateToAll(room);
  log(room, `Partida terminada. Ganador: ${results.winnerName} (${results.maxScore} votos)`);
  emitActivity(room, '🏆', `¡FIN! ${results.winnerName} es ELEGIDO/A con ${results.maxScore} votos`);
}

// ─── Socket handlers ─────────────────────────────────────
io.on('connection', (socket) => {
  socket.use(rateLimiter.middleware(socket.id));

  const sharedDependencies = {
    broadcaster,
    clearTimer,
    delayedTransition,
    log,
    questions,
    rateLimiter,
    roomStore,
    sanitize,
    shuffle
  };

  registerRoomController(socket, {
    ...sharedDependencies,
    handleGameDisconnect: handleDisconnectDuringGame
  });
  registerTeacherController(socket, {
    ...sharedDependencies,
    endGame,
    getStrategyCards,
    resolveDebate,
    resolveStrategy,
    revealVotes,
    startDebateVoting,
    startTurn,
    startVotingPhase
  });
  registerGameController(socket, {
    ...sharedDependencies,
    checkStrategyComplete,
    getStrategyCard,
    resolveDebate,
    revealVotes,
    startAgendaPhase,
    startDebatePhase,
    startDebateVoting
  });
});

// ─── Graceful shutdown ───────────────────────────────────
function shutdown() {
  console.log('\n  Cerrando servidor...');
  for (const room of roomStore.values()) {
    clearTimer(room);
    emitToRoom(room, 'error', { message: 'El servidor se ha cerrado' });
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 3000);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// ─── Start ───────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  const nets = require('os').networkInterfaces();
  let localIP = 'localhost';
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        localIP = net.address;
        break;
      }
    }
  }
  console.log(`\n  ╔══════════════════════════════════════════╗`);
  console.log(`  ║           🏛️  ÁGORA — Servidor           ║`);
  console.log(`  ╠══════════════════════════════════════════╣`);
  console.log(`  ║  Local:   http://localhost:${PORT}          ║`);
  console.log(`  ║  Red:     http://${localIP}:${PORT}    ║`);
  console.log(`  ╚══════════════════════════════════════════╝\n`);
});
