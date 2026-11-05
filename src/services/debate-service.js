const SCORING = require('../config/scoring');

function initializeDebate(room, fallbackQuestion) {
  const current = room.candidates[room.currentCandidateIdx];
  const rivals = room.candidates.filter(candidateId => candidateId !== current);
  const rival = rivals[Math.floor(Math.random() * rivals.length)];

  room.debateActive = true;
  room.debateCandidates = [current, rival];
  room.debateAnswers = {};
  room.debateVotes = {};
  room.debateQuestion = room.currentQuestion || fallbackQuestion;
}

function resolveDebate(room) {
  const [candidate1Id, candidate2Id] = room.debateCandidates;
  const candidate1Votes = Object.values(room.debateVotes)
    .filter(candidateId => candidateId === candidate1Id).length;
  const candidate2Votes = Object.values(room.debateVotes)
    .filter(candidateId => candidateId === candidate2Id).length;

  let winnerId = null;
  let loserId = null;
  if (candidate1Votes > candidate2Votes) [winnerId, loserId] = [candidate1Id, candidate2Id];
  if (candidate2Votes > candidate1Votes) [winnerId, loserId] = [candidate2Id, candidate1Id];

  if (winnerId) {
    room.scores[winnerId] = (room.scores[winnerId] || 0) + SCORING.DEBATE_WINNER_POINTS;
    room.scores[loserId] = (room.scores[loserId] || 0) + SCORING.DEBATE_LOSER_POINTS;
  }

  const currentCandidateId = room.candidates[room.currentCandidateIdx];
  room.questionsAsked[currentCandidateId] = (room.questionsAsked[currentCandidateId] || 0) + 1;
  const currentNet = winnerId === currentCandidateId
    ? SCORING.DEBATE_WINNER_POINTS
    : (loserId === currentCandidateId ? SCORING.DEBATE_LOSER_POINTS : 0);

  room.gameStats.turnResults.push({
    candidateId: currentCandidateId,
    candidateName: room.players[currentCandidateId]?.name || '?',
    netVotes: currentNet,
    question: room.debateQuestion?.scenario?.substring(0, 80) || '',
    scoreAfter: room.scores[currentCandidateId] || 0,
    allScoresAfter: { ...room.scores },
    turnType: 'debate',
    cards: {},
    debate: true,
    debateWinnerName: winnerId ? room.players[winnerId]?.name || '?' : null,
    debateRivalName: room.players[candidate1Id === currentCandidateId ? candidate2Id : candidate1Id]?.name || '?',
    debateVotes: {
      self: currentCandidateId === candidate1Id ? candidate1Votes : candidate2Votes,
      rival: currentCandidateId === candidate1Id ? candidate2Votes : candidate1Votes
    }
  });

  return {
    candidate1: buildCandidateResult(room, candidate1Id, candidate1Votes),
    candidate2: buildCandidateResult(room, candidate2Id, candidate2Votes),
    winnerId,
    winnerName: winnerId ? room.players[winnerId]?.name || '?' : null,
    scores: { ...room.scores }
  };
}

function buildCandidateResult(room, candidateId, votes) {
  return {
    id: candidateId,
    name: room.players[candidateId]?.name || '?',
    votes,
    answer: room.debateAnswers[candidateId] || ''
  };
}

module.exports = { initializeDebate, resolveDebate };
