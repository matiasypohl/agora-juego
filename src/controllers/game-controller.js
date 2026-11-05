const { TRANSITION_DELAYS } = require('../config/phase-durations');
const GAME_LIMITS = require('../config/game-limits');
const { countConnectedCitizens } = require('../services/voting-service');

function registerGameController(socket, dependencies) {
  const {
    broadcaster, checkStrategyComplete, clearTimer, delayedTransition,
    getStrategyCard, resolveDebate, revealVotes, roomStore, sanitize,
    startAgendaPhase, startDebatePhase, startDebateVoting
  } = dependencies;
  const getRoom = () => roomStore.getForSocket(socket.id);

  socket.on('agenda:choose', ({ choiceIndex }) => {
    const room = getRoom();
    if (!room || room.phase !== 'agenda_window' || room.agendaClaimed) return;
    if (room.agendaChooserId && room.agendaChooserId !== socket.id) {
      socket.emit('error', { message: 'No es tu turno de elegir agenda' });
      return;
    }
    const player = room.players[socket.id];
    if (!player || player.role === 'candidate') return;
    const index = parseInt(choiceIndex, 10);
    if (!Number.isInteger(index) || index < 0 || index >= room.agendaChoices.length) return;

    const chosen = room.agendaChoices[index];
    room.agendaClaimed = true;
    room.agendaClaimerId = socket.id;
    room.currentQuestion = chosen;
    room.currentTurnType = chosen.turnType || 'normal';
    room.scandalActive = room.currentTurnType === 'escandalo';
    if (room.citizenTurnOrder.length > 0) {
      room.citizenTurnIdx = (room.citizenTurnIdx + 1) % room.citizenTurnOrder.length;
    }

    const labels = { normal: '📋 Normal', escandalo: '💥 Escándalo ×2', debate: '⚔️ Debate' };
    broadcaster.emitActivity(room, '📋', `${player.name} eligió ${labels[room.currentTurnType] || 'turno'}: "${chosen.headline || ''}"`);
    if (room.scandalActive) broadcaster.emitToRoom(room, 'game:scandal', { active: true });
    clearTimer(room);
    if (room.currentTurnType === 'debate' && room.candidates.length >= 2) startDebatePhase(room);
    else startAgendaPhase(room);
  });

  socket.on('event:answer', ({ answer }) => {
    const room = getRoom();
    if (!room || room.phase !== 'agenda' || room.candidates[room.currentCandidateIdx] !== socket.id || room.candidateAnswer) return;
    const option = room.currentQuestion?.options?.find(item => item.label === answer);
    if (!option) return;
    room.candidateAnswer = answer;
    broadcaster.emitActivity(room, '✅', `${room.players[socket.id]?.name} eligió: ${answer} — ${option.text}`);
    broadcaster.emitState(room);
  });

  socket.on('vote:select', ({ vote }) => {
    const room = getRoom();
    const player = room?.players[socket.id];
    if (!room || room.phase !== 'voting' || !player || player.role === 'candidate' || room.votes[socket.id]) return;
    if (vote === 'up' || vote === 'down') {
      room.voteSelections[socket.id] = vote;
      socket.emit('vote:selected', { vote });
    }
  });

  socket.on('vote:confirm', () => {
    const room = getRoom();
    const player = room?.players[socket.id];
    if (!room || room.phase !== 'voting' || !player || player.role === 'candidate' || room.votes[socket.id]) return;
    const selection = room.voteSelections?.[socket.id];
    if (!selection) return socket.emit('error', { message: 'Primero selecciona tu voto' });

    room.votes[socket.id] = selection;
    socket.emit('vote:confirmed', { vote: selection });
    broadcaster.emitActivity(room, '🗳️', `${player.name} confirmó su voto`);
    const total = countConnectedCitizens(room);
    const voted = Object.keys(room.votes).length;
    if (room.teacherId) broadcaster.emitToSocket(room.teacherId, 'vote:count', { voted, total });
    if (voted >= total) {
      clearTimer(room);
      broadcaster.emitActivity(room, '✅', `Todos votaron (${voted}/${total})`);
      delayedTransition(room, () => {
        if (room.state !== 'ended' && room.phase === 'voting') revealVotes(room);
      }, TRANSITION_DELAYS.ALL_PLAYERS_READY);
    }
  });

  socket.on('strategy:play', ({ cardType, targetCandidateId }) => {
    const room = getRoom();
    const player = room?.players[socket.id];
    if (!room || room.phase !== 'strategy' || !player || player.role === 'candidate' || room.strategyPlays[socket.id]) return;
    if (!player.cards.some(card => card.type === cardType)) return socket.emit('error', { message: 'No tienes esa carta' });
    const currentCandidate = room.candidates[room.currentCandidateIdx];
    const target = room.candidates.includes(targetCandidateId) ? targetCandidateId : currentCandidate;
    room.strategyPlays[socket.id] = { cardType, targetCandidateId: target };
    socket.emit('strategy:confirmed', { cardType });
    const card = getStrategyCard(cardType);
    const cardName = card ? `${card.name.replace('Carta de ', '')} ${card.icon}` : cardType;
    broadcaster.emitActivity(room, '🃏', `${player.name} jugó ${cardName}`);
    checkStrategyComplete(room);
  });

  socket.on('strategy:pass', () => {
    const room = getRoom();
    const player = room?.players[socket.id];
    if (!room || room.phase !== 'strategy' || !player || player.role === 'candidate' || room.strategyPlays[socket.id]) return;
    room.strategyPasses.add(socket.id);
    socket.emit('strategy:confirmed', { cardType: null });
    checkStrategyComplete(room);
  });

  socket.on('message:private', ({ text = '' }) => {
    const room = getRoom();
    if (!room || !['agenda_window', 'agenda'].includes(room.phase)) return;
    const candidateId = room.candidates[room.currentCandidateIdx];
    if (room.advisors[candidateId] !== socket.id) return;
    const message = sanitize(text.substring(0, GAME_LIMITS.ADVISOR_MESSAGE_LENGTH));
    room.advisorMessages[candidateId] = message;
    broadcaster.emitToSocket(candidateId, 'message:private', { from: room.players[socket.id]?.name || 'Asesor', text: message });
  });

  socket.on('debate:answer', ({ text = '' }) => {
    const room = getRoom();
    if (!room || room.phase !== 'debate_question' || !room.debateCandidates.includes(socket.id)) return;
    room.debateAnswers[socket.id] = sanitize(text.substring(0, GAME_LIMITS.DEBATE_ANSWER_LENGTH));
    broadcaster.emitActivity(room, '✍️', `${room.players[socket.id]?.name} respondió en el debate`);
    broadcaster.emitState(room);
    if (room.debateCandidates.every(candidateId => room.debateAnswers[candidateId])) {
      clearTimer(room);
      broadcaster.emitActivity(room, '✅', 'Ambos candidatos respondieron');
      delayedTransition(room, () => {
        if (room.state !== 'ended' && room.phase === 'debate_question') startDebateVoting(room);
      }, TRANSITION_DELAYS.BOTH_DEBATERS_READY);
    }
  });

  socket.on('debate:vote', ({ candidateId }) => {
    const room = getRoom();
    const player = room?.players[socket.id];
    if (!room || room.phase !== 'debate_vote' || !room.debateCandidates.includes(candidateId) || !player || player.role === 'candidate' || room.debateVotes[socket.id]) return;
    room.debateVotes[socket.id] = candidateId;
    broadcaster.emitActivity(room, '🗳️', `${player.name} votó en el debate`);
    const total = countConnectedCitizens(room);
    const voted = Object.keys(room.debateVotes).length;
    if (voted >= total) {
      clearTimer(room);
      broadcaster.emitActivity(room, '✅', `Todos votaron en el debate (${voted}/${total})`);
      delayedTransition(room, () => {
        if (room.state !== 'ended' && room.phase === 'debate_vote') resolveDebate(room);
      }, TRANSITION_DELAYS.ALL_PLAYERS_READY);
    }
  });
}

module.exports = { registerGameController };
