function presentGameState(room, socketId) {
  const player = room.players[socketId];
  const isTeacher = room.teacherId === socketId;
  const base = presentSharedState(room);

  return {
    ...base,
    scores: isTeacher ? room.scores : null,
    myCards: player?.cards || [],
    myRole: player?.role || (isTeacher ? 'teacher' : null),
    isTeacher,
    hasVoted: !!room.votes[socketId],
    hasPlayedStrategy: !!room.strategyPlays[socketId],
    voteSelection: room.voteSelections?.[socketId] || null,
    myAdvisorTarget: findAdvisorTarget(room, socketId)
  };
}

function presentSharedState(room) {
  return {
    code: room.code,
    state: room.state,
    phase: room.phase,
    timeLeft: room.phaseTimeLeft,
    phaseDuration: room.phaseDuration,
    paused: room.paused,
    players: Object.entries(room.players).map(([id, player]) => ({
      id,
      name: player.name,
      role: player.role,
      connected: player.connected
    })),
    candidates: room.candidates,
    currentCandidateId: room.candidates[room.currentCandidateIdx] || null,
    currentQuestion: room.currentQuestion,
    candidateAnswer: room.candidateAnswer,
    questionsAsked: room.questionsAsked,
    questionsPerCandidate: room.questionsPerCandidate,
    agendaClaimed: room.agendaClaimed,
    agendaChoices: presentAgendaChoices(room),
    agendaChooserId: room.agendaChooserId,
    currentTurnType: room.currentTurnType || 'normal',
    scandalActive: room.scandalActive,
    debateActive: room.debateActive,
    debateCandidates: room.debateCandidates,
    debateAnswers: room.debateActive ? room.debateAnswers : {},
    debateQuestion: room.debateQuestion
  };
}

function presentAgendaChoices(room) {
  if (room.phase !== 'agenda_window') return [];
  return (room.agendaChoices || []).map(question => ({
    headline: question.headline || question.scenario.substring(0, 50) + '...',
    id: question.id,
    turnType: question.turnType
  }));
}

function findAdvisorTarget(room, socketId) {
  for (const [candidateId, advisorId] of Object.entries(room.advisors || {})) {
    if (advisorId === socketId) return candidateId;
  }
  return null;
}

module.exports = { presentGameState, presentSharedState };
