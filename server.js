const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// ─── Page Routes ─────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});
app.get('/play', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Logging ─────────────────────────────────────────────
function log(room, msg) {
  const code = room ? room.code : '------';
  console.log(`[${new Date().toLocaleTimeString()}] [${code}] ${msg}`);
}
function logError(msg) {
  console.error(`[${new Date().toLocaleTimeString()}] [ERROR] ${msg}`);
}

// ─── Load data with validation ───────────────────────────
let questions, cardsData;
try {
  questions = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'questions.json'), 'utf8'));
  cardsData = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'cards.json'), 'utf8'));
  if (!Array.isArray(questions) || questions.length === 0) throw new Error('questions.json debe ser un array no vacío');
  if (!cardsData.strategy || !Array.isArray(cardsData.strategy)) throw new Error('cards.json debe tener un array "strategy"');
  for (const q of questions) {
    if (!q.scenario || !Array.isArray(q.options) || q.options.length < 2) {
      throw new Error(`Pregunta inválida: ${JSON.stringify(q).substring(0, 80)}`);
    }
  }
  console.log(`✓ Datos cargados: ${questions.length} preguntas, ${cardsData.strategy.length} tipos de cartas`);
} catch (e) {
  console.error(`\n  ❌ Error cargando datos: ${e.message}\n`);
  process.exit(1);
}

// ─── Sanitization ────────────────────────────────────────
function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ─── State ───────────────────────────────────────────────
const rooms = {};
const socketToRoom = new Map();

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function createRoom(teacherSocketId) {
  let code;
  do { code = generateCode(); } while (rooms[code]);
  rooms[code] = {
    code,
    teacherId: teacherSocketId,
    players: {},
    state: 'lobby',
    candidates: [],
    currentCandidateIdx: 0,
    questionsAsked: {},
    questionPool: shuffle([...Array(questions.length).keys()]),
    questionPoolIdx: 0,
    currentQuestion: null,
    phase: null,
    phaseTimer: null,
    phaseTimeLeft: 0,
    paused: false,
    votes: {},
    strategyPlays: {},
    agendaClaimed: false,
    agendaClaimerId: null,
    candidateAnswer: null,
    advisors: {},
    advisorMessages: {},
    scores: {},
    turnHistory: [],
    gameStats: { totalVotesUp: 0, totalVotesDown: 0, totalAbstentions: 0, cardsPlayed: {}, turnResults: [] },
    scandalActive: false,
    debateActive: false,
    debateCandidates: [],
    debateAnswers: {},
    debateVotes: {},
    debateQuestion: null,
    questionsPerCandidate: 5,
    citizenTurnOrder: [],
    citizenTurnIdx: 0,
    agendaChoices: [],
    agendaChooserId: null,
    currentTurnType: 'normal',
    generation: 0,
    pendingTimeouts: [],
    createdAt: Date.now()
  };
  log(rooms[code], 'Sala creada');
  return rooms[code];
}

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

function distributeCards(room) {
  const citizenIds = Object.keys(room.players).filter(id => room.players[id].role === 'citizen');
  if (citizenIds.length === 0) return;

  // Build weighted pool excluding fake_news
  const strategyTypes = cardsData.strategy.filter(c => c.type !== 'fake_news');
  const weightedPool = [];
  for (const card of strategyTypes) {
    for (let i = 0; i < (card.weight || 1); i++) weightedPool.push(card.type);
  }

  // Each citizen gets 75% of total turns (rounded up) as strategy cards
  const totalTurns = (room.questionsPerCandidate || 3) * room.candidates.length;
  const cardsPerCitizen = Math.ceil(totalTurns * 0.75);
  for (const cid of citizenIds) {
    room.players[cid].cards = [];
    for (let i = 0; i < cardsPerCitizen; i++) {
      const cardType = weightedPool[Math.floor(Math.random() * weightedPool.length)];
      room.players[cid].cards.push({ type: cardType });
    }
  }

  // Set up citizen turn order for agenda selection
  room.citizenTurnOrder = shuffle([...citizenIds]);
  room.citizenTurnIdx = 0;
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
    }, 20000);
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
    const totalCitizens = Object.entries(room.players)
      .filter(([, p]) => p.role !== 'candidate' && p.connected).length;
    const votedCount = Object.keys(room.votes).length;
    if (totalCitizens > 0 && votedCount >= totalCitizens) {
      clearTimer(room);
      emitActivity(room, '✅', `Todos los conectados votaron (${votedCount}/${totalCitizens})`);
      delayedTransition(room, () => {
        if (room.state !== 'ended' && room.phase === 'voting') revealVotes(room);
      }, 1200);
    }
  }

  if (room.phase === 'strategy') {
    checkStrategyComplete(room);
  }

  if (room.phase === 'debate_vote') {
    const totalCitizens = Object.entries(room.players)
      .filter(([, p]) => p.role !== 'candidate' && p.connected).length;
    const debateVoteCount = Object.keys(room.debateVotes).length;
    if (totalCitizens > 0 && debateVoteCount >= totalCitizens) {
      clearTimer(room);
      delayedTransition(room, () => {
        if (room.state !== 'ended' && room.phase === 'debate_vote') resolveDebate(room);
      }, 1200);
    }
  }
}

function remapPlayerReferences(room, oldId, newId) {
  const candIdx = room.candidates.indexOf(oldId);
  if (candIdx !== -1) room.candidates[candIdx] = newId;
  for (const cid in room.advisors) {
    if (room.advisors[cid] === oldId) room.advisors[cid] = newId;
  }
  if (room.agendaChooserId === oldId) room.agendaChooserId = newId;
  if (room.agendaClaimerId === oldId) room.agendaClaimerId = newId;
  const turnIdx = (room.citizenTurnOrder || []).indexOf(oldId);
  if (turnIdx !== -1) room.citizenTurnOrder[turnIdx] = newId;
  if (room.votes[oldId]) { room.votes[newId] = room.votes[oldId]; delete room.votes[oldId]; }
  if (room.voteSelections?.[oldId]) { room.voteSelections[newId] = room.voteSelections[oldId]; delete room.voteSelections[oldId]; }
  if (room.strategyPlays[oldId]) { room.strategyPlays[newId] = room.strategyPlays[oldId]; delete room.strategyPlays[oldId]; }
  if (room.debateVotes[oldId]) { room.debateVotes[newId] = room.debateVotes[oldId]; delete room.debateVotes[oldId]; }
  if (room.debateAnswers[oldId]) { room.debateAnswers[newId] = room.debateAnswers[oldId]; delete room.debateAnswers[oldId]; }
  // Update debateCandidates array
  const debateIdx = (room.debateCandidates || []).indexOf(oldId);
  if (debateIdx !== -1) room.debateCandidates[debateIdx] = newId;
}

function getRoomForSocket(socketId) {
  const code = socketToRoom.get(socketId);
  if (code && rooms[code]) return rooms[code];
  return null;
}

function getPublicPlayerList(room) {
  return Object.entries(room.players).map(([id, p]) => ({
    id, name: p.name, role: p.role, connected: p.connected
  }));
}

function getPublicState(room, socketId) {
  const player = room.players[socketId];
  const isTeacher = room.teacherId === socketId;
  let myAdvisorTarget = null;
  for (const [cid, advisorId] of Object.entries(room.advisors || {})) {
    if (advisorId === socketId) { myAdvisorTarget = cid; break; }
  }
  return {
    code: room.code,
    state: room.state,
    phase: room.phase,
    timeLeft: room.phaseTimeLeft,
    paused: room.paused,
    players: getPublicPlayerList(room),
    candidates: room.candidates,
    currentCandidateId: room.candidates[room.currentCandidateIdx] || null,
    currentQuestion: room.currentQuestion,
    candidateAnswer: room.candidateAnswer,
    scores: isTeacher ? room.scores : null,
    questionsAsked: room.questionsAsked,
    questionsPerCandidate: room.questionsPerCandidate,
    myCards: player ? player.cards : [],
    myRole: player ? player.role : (isTeacher ? 'teacher' : null),
    agendaClaimed: room.agendaClaimed,
    agendaChoices: room.phase === 'agenda_window' ? (room.agendaChoices || []).map(q => ({
      headline: q.headline || q.scenario.substring(0, 50) + '...',
      id: q.id,
      turnType: q.turnType
    })) : [],
    agendaChooserId: room.agendaChooserId,
    currentTurnType: room.currentTurnType || 'normal',
    scandalActive: room.scandalActive,
    debateActive: room.debateActive,
    debateCandidates: room.debateCandidates,
    debateAnswers: room.debateActive ? room.debateAnswers : {},
    debateQuestion: room.debateQuestion,
    isTeacher,
    hasVoted: !!room.votes[socketId],
    hasPlayedStrategy: !!room.strategyPlays[socketId],
    voteSelection: room.voteSelections?.[socketId] || null,
    myAdvisorTarget
  };
}

// ─── Room Cleanup ────────────────────────────────────────
function cleanupRoom(code) {
  const room = rooms[code];
  if (!room) return;
  clearTimer(room);
  // Clean up socketToRoom entries
  for (const sid of Object.keys(room.players)) socketToRoom.delete(sid);
  if (room.teacherId) socketToRoom.delete(room.teacherId);
  delete rooms[code];
  log({ code }, 'Sala eliminada');
}

// Periodic cleanup: remove ended rooms after 5 min, empty rooms after 30 min
setInterval(() => {
  const now = Date.now();
  for (const code in rooms) {
    const room = rooms[code];
    if (room.state === 'ended' && now - (room.endedAt || room.createdAt) > 5 * 60 * 1000) {
      cleanupRoom(code);
    }
    const anyConnected = Object.values(room.players).some(p => p.connected);
    if (!anyConnected && now - room.createdAt > 30 * 60 * 1000) {
      cleanupRoom(code);
    }
  }
}, 60 * 1000);

// ─── Phase management ────────────────────────────────────
function clearTimer(room) {
  if (room.phaseTimer) {
    clearInterval(room.phaseTimer);
    room.phaseTimer = null;
  }
  clearPendingTimeouts(room);
}

function clearPendingTimeouts(room) {
  room.generation++;
  if (room.pendingTimeouts) {
    for (const id of room.pendingTimeouts) clearTimeout(id);
    room.pendingTimeouts = [];
  }
}

function delayedTransition(room, fn, ms) {
  const gen = room.generation;
  const id = setTimeout(() => {
    if (room.generation !== gen) return;
    fn();
  }, ms);
  room.pendingTimeouts.push(id);
}

function startPhaseTimer(room, seconds, onEnd) {
  clearTimer(room);
  room.phaseTimeLeft = seconds;
  emitToRoom(room, 'game:timer', { timeLeft: seconds });

  room.phaseTimer = setInterval(() => {
    if (room.paused || room.state === 'ended') return;
    room.phaseTimeLeft--;
    emitToRoom(room, 'game:timer', { timeLeft: room.phaseTimeLeft });
    if (room.phaseTimeLeft <= 0) {
      clearTimer(room);
      onEnd();
    }
  }, 1000);
}

function emitToRoom(room, event, data) {
  for (const sid of Object.keys(room.players)) {
    io.to(sid).emit(event, data);
  }
  if (room.teacherId) {
    io.to(room.teacherId).emit(event, data);
  }
}

function emitActivity(room, icon, text) {
  if (room.teacherId) {
    io.to(room.teacherId).emit('game:activity', { icon, text, time: Date.now() });
  }
}

function emitStateToAll(room) {
  // 7B: Build shared base state once, override per-player fields
  const playerList = getPublicPlayerList(room);
  const currentCandidateId = room.candidates[room.currentCandidateIdx] || null;
  const agendaChoices = room.phase === 'agenda_window' ? (room.agendaChoices || []).map(q => ({
    headline: q.headline || q.scenario.substring(0, 50) + '...',
    id: q.id,
    turnType: q.turnType
  })) : [];

  const base = {
    code: room.code,
    state: room.state,
    phase: room.phase,
    timeLeft: room.phaseTimeLeft,
    paused: room.paused,
    players: playerList,
    candidates: room.candidates,
    currentCandidateId,
    currentQuestion: room.currentQuestion,
    candidateAnswer: room.candidateAnswer,
    questionsAsked: room.questionsAsked,
    questionsPerCandidate: room.questionsPerCandidate,
    agendaClaimed: room.agendaClaimed,
    agendaChoices,
    agendaChooserId: room.agendaChooserId,
    currentTurnType: room.currentTurnType || 'normal',
    scandalActive: room.scandalActive,
    debateActive: room.debateActive,
    debateCandidates: room.debateCandidates,
    debateAnswers: room.debateActive ? room.debateAnswers : {},
    debateQuestion: room.debateQuestion
  };

  for (const sid of Object.keys(room.players)) {
    const player = room.players[sid];
    let myAdvisorTarget = null;
    for (const [cid, advisorId] of Object.entries(room.advisors || {})) {
      if (advisorId === sid) { myAdvisorTarget = cid; break; }
    }
    io.to(sid).emit('game:state', {
      ...base,
      scores: null,
      myCards: player.cards,
      myRole: player.role,
      isTeacher: false,
      hasVoted: !!room.votes[sid],
      hasPlayedStrategy: !!room.strategyPlays[sid],
      voteSelection: room.voteSelections?.[sid] || null,
      myAdvisorTarget
    });
  }
  if (room.teacherId) {
    io.to(room.teacherId).emit('game:state', {
      ...base,
      scores: room.scores,
      myCards: [],
      myRole: 'teacher',
      isTeacher: true,
      hasVoted: false,
      hasPlayedStrategy: false,
      voteSelection: null,
      myAdvisorTarget: null
    });
  }
}

// ─── Game Flow ───────────────────────────────────────────
function startTurn(room) {
  if (room.state === 'ended') return;

  const candidateId = room.candidates[room.currentCandidateIdx];
  if (!candidateId) return endGame(room);

  if ((room.questionsAsked[candidateId] || 0) >= room.questionsPerCandidate) {
    room.currentCandidateIdx++;
    if (room.currentCandidateIdx >= room.candidates.length) {
      const allDone = room.candidates.every(cid => (room.questionsAsked[cid] || 0) >= room.questionsPerCandidate);
      if (allDone) return endGame(room);
      room.currentCandidateIdx = 0;
    }
    return startTurn(room);
  }

  // Reset per-turn state
  room.votes = {};
  room.strategyPlays = {};
  room.agendaClaimed = false;
  room.agendaClaimerId = null;
  room.agendaChoices = [];
  room.agendaChooserId = null;
  room.candidateAnswer = null;
  room.currentQuestion = null;
  room.currentTurnType = 'normal';
  room.scandalActive = false;
  room.debateActive = false;
  room.debateCandidates = [];
  room.debateAnswers = {};
  room.debateVotes = {};
  room.debateQuestion = null;
  room.advisorMessages = {};

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
  startPhaseTimer(room, 15, () => {
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
  startPhaseTimer(room, 60, () => {
    startVotingPhase(room);
  });
}

function startVotingPhase(room) {
  room.phase = 'voting';
  room.votes = {};
  room.voteSelections = {};
  emitActivity(room, '🗳️', 'Fase de votación secreta');
  emitStateToAll(room);
  startPhaseTimer(room, 20, () => {
    revealVotes(room);
  });
}

function revealVotes(room) {
  const ups = Object.values(room.votes).filter(v => v === 'up').length;
  const downs = Object.values(room.votes).filter(v => v === 'down').length;
  const connectedCitizens = Object.entries(room.players)
    .filter(([, p]) => p.role !== 'candidate' && p.connected).length;
  const abstentions = connectedCitizens - ups - downs;

  emitToRoom(room, 'vote:reveal', {
    ups, downs, abstentions, total: connectedCitizens,
    multiplier: room.scandalActive ? 2 : 1
  });
  emitActivity(room, '📊', `Resultado: 👍${ups} vs 👎${downs} (${abstentions} abstenciones)`);

  // Track stats
  room.gameStats.totalVotesUp += ups;
  room.gameStats.totalVotesDown += downs;
  room.gameStats.totalAbstentions += abstentions;

  delayedTransition(room, () => {
    if (room.state !== 'ended') startStrategyPhase(room);
  }, 2000);
}

function startStrategyPhase(room) {
  room.phase = 'strategy';
  room.strategyPlays = {};
  room.strategyPasses = new Set();
  emitStateToAll(room);
  startPhaseTimer(room, 20, () => {
    resolveStrategy(room);
  });
}

function checkStrategyComplete(room) {
  const citizens = Object.entries(room.players)
    .filter(([, p]) => p.role !== 'candidate' && p.connected);
  const totalCitizens = citizens.length;
  const acted = Object.keys(room.strategyPlays).length + (room.strategyPasses ? room.strategyPasses.size : 0);
  if (acted >= totalCitizens) {
    clearTimer(room);
    emitActivity(room, '✅', `Todos jugaron/pasaron (${acted}/${totalCitizens})`);
    delayedTransition(room, () => {
      if (room.state !== 'ended' && room.phase === 'strategy') {
        resolveStrategy(room);
      }
    }, 1200);
  }
}

function resolveStrategy(room) {
  if (room.state === 'ended') return;

  const candidateId = room.candidates[room.currentCandidateIdx];
  const multiplier = room.scandalActive ? 2 : 1;

  const ups = Object.values(room.votes).filter(v => v === 'up').length;
  const downs = Object.values(room.votes).filter(v => v === 'down').length;
  let netVotes = (ups - downs) * multiplier;

  const plays = Object.entries(room.strategyPlays);

  for (const [sid, play] of plays) {
    if (play.cardType === 'respaldo') {
      netVotes += 2;
    } else if (play.cardType === 'censura') {
      netVotes -= 2;
    } else if (play.cardType === 'coalicion') {
      room.advisors[candidateId] = sid;
      if (room.players[sid]) room.players[sid].role = 'advisor';
      log(room, `${room.players[sid]?.name} es ahora Asesor`);
    }
  }

  // Update score
  if (!room.scores[candidateId]) room.scores[candidateId] = 0;
  room.scores[candidateId] += netVotes;

  // Track questions asked
  if (!room.questionsAsked[candidateId]) room.questionsAsked[candidateId] = 0;
  room.questionsAsked[candidateId]++;

  // Remove used cards
  for (const [sid, play] of plays) {
    if (room.players[sid]) {
      const idx = room.players[sid].cards.findIndex(c => c.type === play.cardType);
      if (idx !== -1) room.players[sid].cards.splice(idx, 1);
    }
  }

  const revealData = {
    plays: plays.map(([sid, play]) => ({
      playerName: room.players[sid] ? room.players[sid].name : '?',
      cardType: play.cardType,
      cancelled: false
    })),
    netVotes, candidateId,
    candidateName: room.players[candidateId] ? room.players[candidateId].name : '?',
    scores: { ...room.scores },
    multiplier
  };

  room.phase = 'turn_result';
  emitToRoom(room, 'strategy:reveal', revealData);
  emitStateToAll(room);

  log(room, `Resultado: ${room.players[candidateId]?.name} ${netVotes >= 0 ? '+' : ''}${netVotes} votos (total: ${room.scores[candidateId]})`);
  emitActivity(room, '📈', `${room.players[candidateId]?.name}: ${netVotes >= 0 ? '+' : ''}${netVotes} votos → total: ${room.scores[candidateId]}`);

  // Track stats: cards played (totales + por turno)
  const turnCards = {};
  for (const [, play] of plays) {
    room.gameStats.cardsPlayed[play.cardType] = (room.gameStats.cardsPlayed[play.cardType] || 0) + 1;
    turnCards[play.cardType] = (turnCards[play.cardType] || 0) + 1;
  }
  // Track turn result
  room.gameStats.turnResults.push({
    candidateId,
    candidateName: room.players[candidateId]?.name || '?',
    netVotes,
    question: room.currentQuestion?.scenario?.substring(0, 80) || '',
    scoreAfter: room.scores[candidateId] || 0,
    allScoresAfter: { ...room.scores },
    turnType: room.currentTurnType || 'normal',
    cards: turnCards,
    multiplier
  });

  // Más tiempo para leer los resultados (cartas reveladas + cambio de puntaje)
  delayedTransition(room, () => {
    if (room.state === 'ended') return;
    advanceToNextTurn(room);
  }, 6000);
}

function advanceToNextTurn(room) {
  room.currentCandidateIdx++;
  if (room.currentCandidateIdx >= room.candidates.length) {
    room.currentCandidateIdx = 0;
  }
  const allDone = room.candidates.every(cid => (room.questionsAsked[cid] || 0) >= room.questionsPerCandidate);
  if (allDone) {
    endGame(room);
  } else {
    startTurn(room);
  }
}

// ─── P1A: Escándalo Phase ────────────────────────────────
function startScandalPhase(room) {
  room.scandalActive = true;
  room.candidateAnswer = null;
  room.currentQuestion = getNextQuestion(room);
  room.phase = 'agenda';
  log(room, 'Escándalo activado — pregunta extra con ×2');
  emitToRoom(room, 'game:scandal', { active: true });
  emitStateToAll(room);

  startPhaseTimer(room, 30, () => {
    // Voting with ×2 multiplier
    startScandalVoting(room);
  });
}

function startScandalVoting(room) {
  room.phase = 'voting';
  room.votes = {};
  room.voteSelections = {};
  emitActivity(room, '💥', 'Votación de Escándalo (×2)');
  emitStateToAll(room);
  startPhaseTimer(room, 20, () => {
    revealScandalVotes(room);
  });
}

function revealScandalVotes(room) {
  const candidateId = room.candidates[room.currentCandidateIdx];
  const ups = Object.values(room.votes).filter(v => v === 'up').length;
  const downs = Object.values(room.votes).filter(v => v === 'down').length;
  const connectedCitizens = Object.entries(room.players)
    .filter(([, p]) => p.role !== 'candidate' && p.connected).length;

  const netVotes = (ups - downs) * 2; // ×2 multiplier
  if (!room.scores[candidateId]) room.scores[candidateId] = 0;
  room.scores[candidateId] += netVotes;

  // Track scandal stats
  room.gameStats.totalVotesUp += ups;
  room.gameStats.totalVotesDown += downs;
  room.gameStats.totalAbstentions += (connectedCitizens - ups - downs);

  emitToRoom(room, 'vote:reveal', {
    ups, downs, abstentions: connectedCitizens - ups - downs,
    total: connectedCitizens, multiplier: 2
  });

  emitToRoom(room, 'strategy:reveal', {
    plays: [], netVotes, candidateId,
    candidateName: room.players[candidateId]?.name || '?',
    scores: { ...room.scores }, multiplier: 2
  });

  log(room, `Escándalo resultado: ${netVotes >= 0 ? '+' : ''}${netVotes} votos (×2)`);

  delayedTransition(room, () => {
    if (room.state === 'ended') return;
    room.scandalActive = false;
    advanceToNextTurn(room);
  }, 3000);
}

// ─── P1B: Debate Phase ──────────────────────────────────
function startDebatePhase(room) {
  const current = room.candidates[room.currentCandidateIdx];
  const others = room.candidates.filter(cid => cid !== current);
  const rival = others[Math.floor(Math.random() * others.length)];
  room.debateActive = true;
  room.debateCandidates = [current, rival];
  room.debateAnswers = {};
  room.debateVotes = {};
  // Reuse the agenda-selected question when turnType is 'debate'; fall back if absent
  room.debateQuestion = room.currentQuestion || getNextQuestion(room);
  room.phase = 'debate_question';

  log(room, `Debate: ${room.players[room.debateCandidates[0]]?.name} vs ${room.players[room.debateCandidates[1]]?.name}`);
  emitActivity(room, '⚔️', `¡DEBATE! ${room.players[room.debateCandidates[0]]?.name} vs ${room.players[room.debateCandidates[1]]?.name}`);
  emitStateToAll(room);

  startPhaseTimer(room, 45, () => {
    startDebateVoting(room);
  });
}

function startDebateVoting(room) {
  room.phase = 'debate_vote';
  room.debateVotes = {};
  emitStateToAll(room);

  startPhaseTimer(room, 20, () => {
    resolveDebate(room);
  });
}

function resolveDebate(room) {
  const [cid1, cid2] = room.debateCandidates;
  const votes1 = Object.values(room.debateVotes).filter(v => v === cid1).length;
  const votes2 = Object.values(room.debateVotes).filter(v => v === cid2).length;

  let winnerId, loserId;
  if (votes1 > votes2) { winnerId = cid1; loserId = cid2; }
  else if (votes2 > votes1) { winnerId = cid2; loserId = cid1; }
  else { winnerId = null; loserId = null; } // Empate: nadie gana

  if (winnerId) {
    if (!room.scores[winnerId]) room.scores[winnerId] = 0;
    if (!room.scores[loserId]) room.scores[loserId] = 0;
    room.scores[winnerId] += 2;
    room.scores[loserId] -= 1;
  }

  // El turno de debate consume el turno del candidato actual (incrementar contador)
  const currentCandidateId = room.candidates[room.currentCandidateIdx];
  if (currentCandidateId) {
    if (!room.questionsAsked[currentCandidateId]) room.questionsAsked[currentCandidateId] = 0;
    room.questionsAsked[currentCandidateId]++;
  }

  // Tracking de stats del debate (como turno jugado)
  const debateNet = winnerId === currentCandidateId ? 2 : (loserId === currentCandidateId ? -1 : 0);
  room.gameStats.turnResults.push({
    candidateId: currentCandidateId,
    candidateName: room.players[currentCandidateId]?.name || '?',
    netVotes: debateNet,
    question: room.debateQuestion?.scenario?.substring(0, 80) || '',
    scoreAfter: room.scores[currentCandidateId] || 0,
    allScoresAfter: { ...room.scores },
    turnType: 'debate',
    cards: {},
    debate: true,
    debateWinnerName: winnerId ? (room.players[winnerId]?.name || '?') : null,
    debateRivalName: room.players[cid1 === currentCandidateId ? cid2 : cid1]?.name || '?',
    debateVotes: { self: currentCandidateId === cid1 ? votes1 : votes2, rival: currentCandidateId === cid1 ? votes2 : votes1 }
  });

  const debateResult = {
    candidate1: { id: cid1, name: room.players[cid1]?.name || '?', votes: votes1, answer: room.debateAnswers[cid1] || '' },
    candidate2: { id: cid2, name: room.players[cid2]?.name || '?', votes: votes2, answer: room.debateAnswers[cid2] || '' },
    winnerId,
    winnerName: winnerId ? (room.players[winnerId]?.name || '?') : null,
    scores: { ...room.scores }
  };

  room.phase = 'debate_result';
  emitToRoom(room, 'debate:result', debateResult);
  emitStateToAll(room);

  log(room, `Debate resultado: ${winnerId ? room.players[winnerId]?.name + ' gana' : 'Empate'} (${votes1} vs ${votes2})`);
  emitActivity(room, '🏆', winnerId ? `${room.players[winnerId]?.name} gana el debate (+2)` : `Debate empatado (${votes1} vs ${votes2})`);

  delayedTransition(room, () => {
    if (room.state === 'ended') return;
    room.debateActive = false;
    advanceToNextTurn(room);
  }, 6000);
}

function endGame(room) {
  clearTimer(room);
  room.state = 'ended';
  room.phase = null;
  room.endedAt = Date.now();

  let maxScore = -Infinity;
  let winnerId = null;
  for (const cid of room.candidates) {
    const s = room.scores[cid] || 0;
    if (s > maxScore) { maxScore = s; winnerId = cid; }
  }

  const totalPlayers = Object.keys(room.players).length;
  const stats = room.gameStats;

  const results = {
    scores: { ...room.scores },
    candidates: room.candidates.map(cid => ({
      id: cid,
      name: room.players[cid] ? room.players[cid].name : '?',
      score: room.scores[cid] || 0,
      winner: cid === winnerId
    })),
    winnerId,
    winnerName: room.players[winnerId] ? room.players[winnerId].name : '?',
    stats: {
      totalPlayers,
      totalRounds: room.questionsPerCandidate,
      totalVotesUp: stats.totalVotesUp,
      totalVotesDown: stats.totalVotesDown,
      totalAbstentions: stats.totalAbstentions,
      cardsPlayed: stats.cardsPlayed,
      turnResults: stats.turnResults,
      totalCardsPlayed: Object.values(stats.cardsPlayed).reduce((a, b) => a + b, 0)
    }
  };

  emitToRoom(room, 'game:end', results);
  emitStateToAll(room);
  log(room, `Partida terminada. Ganador: ${results.winnerName} (${maxScore} votos)`);
  emitActivity(room, '🏆', `¡FIN! ${results.winnerName} es ELEGIDO/A con ${maxScore} votos`);
}

// ─── Rate Limiting ──────────────────────────────────────
const rateLimitMap = new Map();
function rateLimit(socketId, maxPerSec = 10) {
  const now = Date.now();
  let times = rateLimitMap.get(socketId);
  if (!times) { times = []; rateLimitMap.set(socketId, times); }
  // Remove entries older than 1 second
  while (times.length > 0 && now - times[0] > 1000) times.shift();
  if (times.length >= maxPerSec) return false;
  times.push(now);
  return true;
}

// ─── Socket handlers ─────────────────────────────────────
io.on('connection', (socket) => {
  // Apply rate limiting to all events
  socket.use(([event], next) => {
    if (!rateLimit(socket.id)) {
      return next(new Error('rate limited'));
    }
    next();
  });

  socket.on('teacher:create', (callback) => {
    const room = createRoom(socket.id);
    socketToRoom.set(socket.id, room.code);
    callback({ code: room.code });
  });

  socket.on('player:join', ({ code, name }, callback) => {
    // P3B: Validate inputs
    if (!code || !/^[A-Z0-9]{6}$/.test(code)) return callback({ error: 'Código de sala inválido' });
    const cleanName = sanitize((name || '').trim().substring(0, 20));
    if (!cleanName) return callback({ error: 'Nombre requerido' });

    const room = rooms[code];
    if (!room) return callback({ error: 'Sala no encontrada' });

    // Mid-game rejoin: allow reconnecting by name if player is disconnected
    if (room.state !== 'lobby') {
      const existing = Object.entries(room.players).find(
        ([, p]) => p.name === cleanName && !p.connected
      );
      if (!existing) return callback({ error: 'La partida ya comenzó' });

      const [oldId, player] = existing;
      // Remap player to new socket
      const newToken = crypto.randomBytes(16).toString('hex');
      room.players[socket.id] = {
        ...player,
        id: socket.id,
        connected: true,
        cards: player.cards.map(c => ({ ...c })),
        reconnectToken: newToken
      };
      delete room.players[oldId];
      socketToRoom.delete(oldId);
      socketToRoom.set(socket.id, room.code);
      remapPlayerReferences(room, oldId, socket.id);

      log(room, `Rejoin mid-game: ${cleanName}`);
      emitToRoom(room, 'player:reconnected', { name: cleanName });
      callback({ ok: true, reconnectToken: newToken, rejoin: true });
      emitStateToAll(room);
      return;
    }

    // Check for duplicate name in lobby
    const duplicateName = Object.values(room.players).some(p => p.name === cleanName);
    if (duplicateName) return callback({ error: 'Ese nombre ya está en uso' });

    const reconnectToken = crypto.randomBytes(16).toString('hex');
    room.players[socket.id] = {
      id: socket.id,
      name: cleanName,
      role: 'citizen',
      connected: true,
      cards: [],
      reconnectToken
    };

    socketToRoom.set(socket.id, room.code);
    log(room, `Jugador unido: ${cleanName}`);
    callback({ ok: true, reconnectToken });
    emitStateToAll(room);
  });

  socket.on('teacher:join', ({ code }, callback) => {
    const room = rooms[code];
    if (!room) return callback({ error: 'Sala no encontrada' });
    room.teacherId = socket.id;
    socketToRoom.set(socket.id, room.code);
    callback({ ok: true });
    emitStateToAll(room);
  });

  socket.on('teacher:control', ({ action, data }) => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.teacherId !== socket.id) return;

    if (action === 'assign-role') {
      // P2B: Only allow in lobby
      if (room.state !== 'lobby') return;
      const { playerId, role } = data;
      if (room.players[playerId]) {
        room.players[playerId].role = role;
        if (role === 'candidate' && !room.candidates.includes(playerId)) {
          room.candidates.push(playerId);
        } else if (role !== 'candidate') {
          room.candidates = room.candidates.filter(id => id !== playerId);
        }
        emitStateToAll(room);
      }
    }

    if (action === 'start' && room.state === 'lobby') {
      if (room.candidates.length < 2) {
        io.to(socket.id).emit('error', { message: 'Se necesitan al menos 2 candidatos' });
        return;
      }
      room.state = 'playing';
      room.currentCandidateIdx = 0;
      for (const cid of room.candidates) {
        room.scores[cid] = 0;
        room.questionsAsked[cid] = 0;
      }
      distributeCards(room);
      log(room, `Partida iniciada con ${room.candidates.length} candidatos y ${Object.keys(room.players).length} jugadores`);
      emitStateToAll(room);
      startTurn(room);
    }

    if (action === 'pause') {
      room.paused = !room.paused;
      log(room, room.paused ? 'Partida pausada' : 'Partida reanudada');
      // P2E: Sync pause state to all clients
      emitStateToAll(room);
    }

    if (action === 'skip') {
      clearTimer(room);
      if (room.phase === 'agenda_window' || room.phase === 'agenda') {
        startVotingPhase(room);
      } else if (room.phase === 'voting') {
        revealVotes(room);
      } else if (room.phase === 'strategy') {
        resolveStrategy(room);
      } else if (room.phase === 'debate_question') {
        startDebateVoting(room);
      } else if (room.phase === 'debate_vote') {
        resolveDebate(room);
      }
    }

    if (action === 'end') {
      endGame(room);
    }

    if (action === 'restart' && room.state === 'ended') {
      clearTimer(room);
      // Reset game state but keep players and candidates
      room.state = 'lobby';
      room.phase = null;
      room.currentCandidateIdx = 0;
      room.questionsAsked = {};
      room.questionPool = shuffle([...Array(questions.length).keys()]);
      room.questionPoolIdx = 0;
      room.currentQuestion = null;
      room.votes = {};
      room.voteSelections = {};
      room.strategyPlays = {};
      room.agendaClaimed = false;
      room.agendaClaimerId = null;
      room.candidateAnswer = null;
      room.advisors = {};
      room.advisorMessages = {};
      room.scores = {};
      room.turnHistory = [];
      room.gameStats = { totalVotesUp: 0, totalVotesDown: 0, totalAbstentions: 0, cardsPlayed: {}, turnResults: [] };
      room.currentTurnType = 'normal';
      room.scandalActive = false;
      room.debateActive = false;
      room.debateCandidates = [];
      room.debateAnswers = {};
      room.debateVotes = {};
      room.debateQuestion = null;
      room.paused = false;
      room.phaseTimeLeft = 0;
      room.endedAt = undefined;
      room.agendaChoices = [];
      room.agendaChooserId = null;
      room.citizenTurnOrder = [];
      room.citizenTurnIdx = 0;
      // Reset player cards and roles (keep candidates)
      for (const [sid, player] of Object.entries(room.players)) {
        player.cards = [];
        if (!room.candidates.includes(sid)) {
          player.role = 'citizen';
        }
      }
      log(room, 'Partida reiniciada — volviendo al lobby');
      emitActivity(room, '🔄', 'Partida reiniciada — nueva ronda con el mismo grupo');
      emitStateToAll(room);
    }

    if (action === 'config' && room.state === 'lobby') {
      const rounds = parseInt(data?.rounds, 10);
      if (rounds && rounds >= 1 && rounds <= 15) {
        room.questionsPerCandidate = rounds;
        log(room, `Configuración: ${rounds} rondas por candidato`);
        emitActivity(room, '⚙️', `Rondas configuradas: ${rounds} por candidato`);
        emitStateToAll(room);
      }
    }
  });

  socket.on('agenda:choose', ({ choiceIndex }) => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.phase !== 'agenda_window' || room.agendaClaimed) return;

    // Only the designated chooser can pick (or any citizen if chooser disconnected)
    if (room.agendaChooserId && room.agendaChooserId !== socket.id) {
      socket.emit('error', { message: 'No es tu turno de elegir agenda' });
      return;
    }

    const player = room.players[socket.id];
    if (!player || player.role === 'candidate') return;

    const idx = parseInt(choiceIndex, 10);
    if (isNaN(idx) || idx < 0 || idx >= (room.agendaChoices || []).length) return;

    const chosen = room.agendaChoices[idx];
    room.agendaClaimed = true;
    room.agendaClaimerId = socket.id;
    room.currentQuestion = chosen;
    room.currentTurnType = chosen.turnType || 'normal';
    room.scandalActive = room.currentTurnType === 'escandalo';

    // Advance citizen turn for next round
    if (room.citizenTurnOrder.length > 0) {
      room.citizenTurnIdx = (room.citizenTurnIdx + 1) % room.citizenTurnOrder.length;
    }

    const typeLabels = { normal: '📋 Normal', escandalo: '💥 Escándalo ×2', debate: '⚔️ Debate' };
    emitActivity(room, '📋', `${player.name} eligió ${typeLabels[room.currentTurnType] || 'turno'}: "${room.currentQuestion.headline || ''}"`);
    if (room.currentTurnType === 'escandalo') {
      emitToRoom(room, 'game:scandal', { active: true });
    }
    clearTimer(room);
    // Debate salta directo a la fase de debate (sin respuesta normal ni votación)
    if (room.currentTurnType === 'debate' && room.candidates.length >= 2) {
      startDebatePhase(room);
    } else {
      startAgendaPhase(room);
    }
  });

  socket.on('event:answer', ({ answer }) => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.phase !== 'agenda') return;

    const candidateId = room.candidates[room.currentCandidateIdx];
    if (socket.id !== candidateId) return;
    if (room.candidateAnswer) return; // Already answered

    // P3B: Validate answer is one of the options
    const validLabels = (room.currentQuestion?.options || []).map(o => o.label);
    if (!validLabels.includes(answer)) return;

    room.candidateAnswer = answer;
    const chosenOpt = room.currentQuestion?.options?.find(o => o.label === answer);
    emitActivity(room, '✅', `${room.players[socket.id]?.name} eligió: ${answer}${chosenOpt ? ' — ' + chosenOpt.text : ''}`);
    emitStateToAll(room);
  });

  // Two-step voting: select → confirm
  socket.on('vote:select', ({ vote }) => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.phase !== 'voting') return;
    const player = room.players[socket.id];
    if (!player || player.role === 'candidate') return;
    if (room.votes[socket.id]) return; // Already confirmed

    // Store selection (not yet confirmed)
    if (!room.voteSelections) room.voteSelections = {};
    if (vote === 'up' || vote === 'down') {
      room.voteSelections[socket.id] = vote;
      io.to(socket.id).emit('vote:selected', { vote });
    }
  });

  socket.on('vote:confirm', () => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.phase !== 'voting') return;
    const player = room.players[socket.id];
    if (!player || player.role === 'candidate') return;
    if (room.votes[socket.id]) return; // Already confirmed

    const selection = room.voteSelections?.[socket.id];
    if (!selection) {
      socket.emit('error', { message: 'Primero selecciona tu voto' });
      return;
    }

    room.votes[socket.id] = selection;
    io.to(socket.id).emit('vote:confirmed', { vote: selection });
    emitActivity(room, '🗳️', `${player.name} confirmó su voto`);

    // Notify teacher of progress
    const totalCitizens = Object.entries(room.players)
      .filter(([, p]) => p.role !== 'candidate' && p.connected).length;
    const votedCount = Object.keys(room.votes).length;

    if (room.teacherId) {
      io.to(room.teacherId).emit('vote:count', {
        voted: votedCount,
        total: totalCitizens
      });
    }

    // Auto-advance when ALL citizens have confirmed
    if (votedCount >= totalCitizens) {
      clearTimer(room);
      emitActivity(room, '✅', `Todos votaron (${votedCount}/${totalCitizens})`);
      delayedTransition(room, () => {
        if (room.state !== 'ended' && room.phase === 'voting') {
          revealVotes(room);
        }
      }, 1200);
    }
  });

  socket.on('strategy:play', ({ cardType, targetCandidateId }) => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.phase !== 'strategy') return;

    const player = room.players[socket.id];
    if (!player || player.role === 'candidate') return;
    if (room.strategyPlays[socket.id]) return;

    const cardIdx = player.cards.findIndex(c => c.type === cardType);
    if (cardIdx === -1) {
      socket.emit('error', { message: 'No tienes esa carta' });
      return;
    }

    // P3B: Validate target candidate
    const currentCandidate = room.candidates[room.currentCandidateIdx];
    const validTarget = targetCandidateId && room.candidates.includes(targetCandidateId)
      ? targetCandidateId : currentCandidate;

    room.strategyPlays[socket.id] = { cardType, targetCandidateId: validTarget };
    io.to(socket.id).emit('strategy:confirmed', { cardType });

    const cardNames = Object.fromEntries(cardsData.strategy.map(c => [c.type, `${c.name.replace('Carta de ','')} ${c.icon}`]));
    emitActivity(room, '🃏', `${room.players[socket.id]?.name} jugó ${cardNames[cardType] || cardType}`);
    checkStrategyComplete(room);
  });

  socket.on('strategy:pass', () => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.phase !== 'strategy') return;
    const player = room.players[socket.id];
    if (!player || player.role === 'candidate') return;
    if (room.strategyPlays[socket.id]) return;
    if (!room.strategyPasses) room.strategyPasses = new Set();
    room.strategyPasses.add(socket.id);
    io.to(socket.id).emit('strategy:confirmed', { cardType: null });
    checkStrategyComplete(room);
  });

  socket.on('message:private', ({ text }) => {
    const room = getRoomForSocket(socket.id);
    if (!room || !['agenda_window', 'agenda'].includes(room.phase)) return;

    const candidateId = room.candidates[room.currentCandidateIdx];
    if (room.advisors[candidateId] !== socket.id) return;

    const msg = sanitize(text.substring(0, 150));
    room.advisorMessages[candidateId] = msg;
    io.to(candidateId).emit('message:private', {
      from: room.players[socket.id] ? room.players[socket.id].name : 'Asesor',
      text: msg
    });
  });

  // P1B: Debate answer from candidate
  socket.on('debate:answer', ({ text }) => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.phase !== 'debate_question') return;
    if (!room.debateCandidates.includes(socket.id)) return;

    room.debateAnswers[socket.id] = sanitize(text.substring(0, 300));
    emitActivity(room, '✍️', `${room.players[socket.id]?.name} respondió en el debate`);
    emitStateToAll(room);

    // Auto-advance when both candidates have answered
    const bothAnswered = room.debateCandidates.every(cid => room.debateAnswers[cid]);
    if (bothAnswered) {
      clearTimer(room);
      emitActivity(room, '✅', 'Ambos candidatos respondieron');
      delayedTransition(room, () => {
        if (room.state !== 'ended' && room.phase === 'debate_question') {
          startDebateVoting(room);
        }
      }, 1500);
    }
  });

  // P1B: Debate vote
  socket.on('debate:vote', ({ candidateId }) => {
    const room = getRoomForSocket(socket.id);
    if (!room || room.phase !== 'debate_vote') return;
    if (!room.debateCandidates.includes(candidateId)) return;

    const player = room.players[socket.id];
    if (!player || player.role === 'candidate') return;
    if (room.debateVotes[socket.id]) return; // Already voted

    room.debateVotes[socket.id] = candidateId;
    emitActivity(room, '🗳️', `${player.name} votó en el debate`);

    // Auto-advance when all citizens have voted in debate
    const totalCitizens = Object.entries(room.players)
      .filter(([, p]) => p.role !== 'candidate' && p.connected).length;
    const debateVoteCount = Object.keys(room.debateVotes).length;
    if (debateVoteCount >= totalCitizens) {
      clearTimer(room);
      emitActivity(room, '✅', `Todos votaron en el debate (${debateVoteCount}/${totalCitizens})`);
      delayedTransition(room, () => {
        if (room.state !== 'ended' && room.phase === 'debate_vote') {
          resolveDebate(room);
        }
      }, 1200);
    }
  });

  // Reconnection (socket.io auto-reconnect — sessionStorage still available)
  // `silent` flag set by index.html on the lobby→game navigation, so the first
  // connect to /game doesn't emit a spurious "X se reconectó" toast to everyone.
  socket.on('reconnect:attempt', ({ code, name, token, silent }) => {
    const room = rooms[code];
    if (!room) return;

    for (const [oldId, player] of Object.entries(room.players)) {
      if (player.name === name && !player.connected) {
        // Verify reconnection token to prevent session hijacking
        if (player.reconnectToken && player.reconnectToken !== token) {
          socket.emit('error', { message: 'Token de reconexión inválido' });
          log(room, `Reconexión rechazada (token inválido): ${player.name}`);
          return;
        }

        // Deep copy cards and remap
        room.players[socket.id] = {
          ...player,
          id: socket.id,
          connected: true,
          cards: player.cards.map(c => ({ ...c }))
        };
        delete room.players[oldId];
        socketToRoom.delete(oldId);
        socketToRoom.set(socket.id, room.code);
        remapPlayerReferences(room, oldId, socket.id);

        log(room, silent ? `Primer ingreso al juego: ${player.name}` : `Reconexión: ${player.name}`);
        if (!silent) {
          emitToRoom(room, 'player:reconnected', { name: player.name });
        }
        io.to(socket.id).emit('game:state', getPublicState(room, socket.id));
        emitStateToAll(room);
        return;
      }
    }
  });

  socket.on('disconnect', () => {
    rateLimitMap.delete(socket.id);
    const room = getRoomForSocket(socket.id);
    if (!room) return;

    const player = room.players[socket.id];
    if (player) {
      log(room, `Desconectado: ${player.name}`);
      player.connected = false;
      emitToRoom(room, 'player:disconnected', { name: player.name });
      emitStateToAll(room);

      if (room.state === 'playing') {
        handleDisconnectDuringGame(room, socket.id, player);
      }
    }

    // Teacher disconnect
    if (room.teacherId === socket.id) {
      log(room, 'Profesor desconectado');
      // Game continues, teacher can rejoin
    }
  });
});

// ─── Routes ──────────────────────────────────────────────
app.get('/teacher', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'teacher.html'));
});

app.get('/game', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'game.html'));
});

// ─── Graceful shutdown ───────────────────────────────────
function shutdown() {
  console.log('\n  Cerrando servidor...');
  for (const code in rooms) {
    clearTimer(rooms[code]);
    emitToRoom(rooms[code], 'error', { message: 'El servidor se ha cerrado' });
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
