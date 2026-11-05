function resetTurn(room) {
  Object.assign(room, {
    votes: {},
    strategyPlays: {},
    agendaClaimed: false,
    agendaClaimerId: null,
    agendaChoices: [],
    agendaChooserId: null,
    candidateAnswer: null,
    currentQuestion: null,
    currentTurnType: 'normal',
    scandalActive: false,
    debateActive: false,
    debateCandidates: [],
    debateAnswers: {},
    debateVotes: {},
    debateQuestion: null,
    advisorMessages: {}
  });
}

function advanceCandidate(room) {
  room.currentCandidateIdx = (room.currentCandidateIdx + 1) % room.candidates.length;
  return isGameComplete(room);
}

function isGameComplete(room) {
  return room.candidates.every(candidateId =>
    (room.questionsAsked[candidateId] || 0) >= room.questionsPerCandidate
  );
}

function findPlayableCandidate(room) {
  for (let attempts = 0; attempts < room.candidates.length; attempts++) {
    const candidateId = room.candidates[room.currentCandidateIdx];
    if ((room.questionsAsked[candidateId] || 0) < room.questionsPerCandidate) return candidateId;
    room.currentCandidateIdx = (room.currentCandidateIdx + 1) % room.candidates.length;
  }
  return null;
}

function finishGame(room) {
  room.state = 'ended';
  room.phase = null;
  room.endedAt = Date.now();

  let winnerId = null;
  let maxScore = -Infinity;
  for (const candidateId of room.candidates) {
    const score = room.scores[candidateId] || 0;
    if (score > maxScore) [maxScore, winnerId] = [score, candidateId];
  }

  const stats = room.gameStats;
  return {
    scores: { ...room.scores },
    candidates: room.candidates.map(candidateId => ({
      id: candidateId,
      name: room.players[candidateId]?.name || '?',
      score: room.scores[candidateId] || 0,
      winner: candidateId === winnerId
    })),
    winnerId,
    winnerName: room.players[winnerId]?.name || '?',
    maxScore,
    stats: {
      totalPlayers: Object.keys(room.players).length,
      totalRounds: room.questionsPerCandidate,
      totalVotesUp: stats.totalVotesUp,
      totalVotesDown: stats.totalVotesDown,
      totalAbstentions: stats.totalAbstentions,
      cardsPlayed: stats.cardsPlayed,
      turnResults: stats.turnResults,
      totalCardsPlayed: Object.values(stats.cardsPlayed).reduce((sum, count) => sum + count, 0)
    }
  };
}

module.exports = { advanceCandidate, findPlayableCandidate, finishGame, isGameComplete, resetTurn };
