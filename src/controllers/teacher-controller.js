const GAME_LIMITS = require('../config/game-limits');
const { resetRoom } = require('../models/room-reset');
const { distributeCards } = require('../services/strategy-service');

function registerTeacherController(socket, dependencies) {
  const {
    broadcaster, clearTimer, endGame, getStrategyCards, log, questions,
    resolveDebate, resolveStrategy, revealVotes, roomStore, shuffle,
    startDebateVoting, startTurn, startVotingPhase
  } = dependencies;

  socket.on('teacher:control', ({ action, data }) => {
    const room = roomStore.getForSocket(socket.id);
    if (!room || room.teacherId !== socket.id) return;

    if (action === 'assign-role' && room.state === 'lobby') {
      const { playerId, role } = data;
      if (room.players[playerId]) {
        room.players[playerId].role = role;
        if (role === 'candidate' && !room.candidates.includes(playerId)) room.candidates.push(playerId);
        if (role !== 'candidate') room.candidates = room.candidates.filter(id => id !== playerId);
        broadcaster.emitState(room);
      }
    }

    if (action === 'start' && room.state === 'lobby') {
      if (room.candidates.length < GAME_LIMITS.MIN_CANDIDATES) {
        socket.emit('error', { message: `Se necesitan al menos ${GAME_LIMITS.MIN_CANDIDATES} candidatos` });
        return;
      }
      room.state = 'playing';
      room.currentCandidateIdx = 0;
      for (const candidateId of room.candidates) {
        room.scores[candidateId] = 0;
        room.questionsAsked[candidateId] = 0;
      }
      distributeCards(room, getStrategyCards(), shuffle);
      log(room, `Partida iniciada con ${room.candidates.length} candidatos y ${Object.keys(room.players).length} jugadores`);
      broadcaster.emitState(room);
      startTurn(room);
    }

    if (action === 'pause') {
      room.paused = !room.paused;
      log(room, room.paused ? 'Partida pausada' : 'Partida reanudada');
      broadcaster.emitState(room);
    }

    if (action === 'skip') {
      clearTimer(room);
      if (room.phase === 'agenda_window' || room.phase === 'agenda') startVotingPhase(room);
      else if (room.phase === 'voting') revealVotes(room);
      else if (room.phase === 'strategy') resolveStrategy(room);
      else if (room.phase === 'debate_question') startDebateVoting(room);
      else if (room.phase === 'debate_vote') resolveDebate(room);
    }

    if (action === 'end') endGame(room);

    if (action === 'restart' && room.state === 'ended') {
      clearTimer(room);
      resetRoom(room, shuffle([...Array(questions.length).keys()]));
      log(room, 'Partida reiniciada — volviendo al lobby');
      broadcaster.emitActivity(room, '🔄', 'Partida reiniciada — nueva ronda con el mismo grupo');
      broadcaster.emitState(room);
    }

    if (action === 'config' && room.state === 'lobby') {
      const rounds = parseInt(data?.rounds, 10);
      if (rounds >= GAME_LIMITS.MIN_ROUNDS && rounds <= GAME_LIMITS.MAX_ROUNDS) {
        room.questionsPerCandidate = rounds;
        log(room, `Configuración: ${rounds} rondas por candidato`);
        broadcaster.emitActivity(room, '⚙️', `Rondas configuradas: ${rounds} por candidato`);
        broadcaster.emitState(room);
      }
    }
  });
}

module.exports = { registerTeacherController };
