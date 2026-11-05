const GAME_LIMITS = require('../config/game-limits');
const SCORING = require('../config/scoring');

function distributeCards(room, strategyCards, shuffle) {
  const citizenIds = Object.keys(room.players)
    .filter(id => room.players[id].role === 'citizen');
  if (citizenIds.length === 0) return;

  const weightedPool = [];
  for (const card of strategyCards.filter(card => card.type !== 'fake_news')) {
    for (let i = 0; i < (card.weight || 1); i++) weightedPool.push(card.type);
  }

  const totalTurns = room.questionsPerCandidate * room.candidates.length;
  const cardsPerCitizen = Math.ceil(totalTurns * GAME_LIMITS.CARDS_PER_TURN_RATIO);
  for (const citizenId of citizenIds) {
    room.players[citizenId].cards = Array.from({ length: cardsPerCitizen }, () => ({
      type: weightedPool[Math.floor(Math.random() * weightedPool.length)]
    }));
  }

  room.citizenTurnOrder = shuffle([...citizenIds]);
  room.citizenTurnIdx = 0;
}

function getStrategyProgress(room) {
  const total = Object.values(room.players)
    .filter(player => player.role !== 'candidate' && player.connected)
    .length;
  const acted = Object.keys(room.strategyPlays).length + (room.strategyPasses?.size || 0);
  return { acted, total, complete: acted >= total };
}

function resolveStrategy(room, getStrategyCard) {
  const candidateId = room.candidates[room.currentCandidateIdx];
  const multiplier = room.scandalActive ? SCORING.SCANDAL_MULTIPLIER : 1;
  const ups = Object.values(room.votes).filter(vote => vote === 'up').length;
  const downs = Object.values(room.votes).filter(vote => vote === 'down').length;
  const plays = Object.entries(room.strategyPlays);
  let netVotes = (ups - downs) * multiplier;

  for (const [playerId, play] of plays) {
    const card = getStrategyCard(play.cardType);
    if (typeof card?.effect?.votes === 'number') netVotes += card.effect.votes;
    if (card?.effect?.becomeAdvisor) {
      room.advisors[candidateId] = playerId;
      if (room.players[playerId]) room.players[playerId].role = 'advisor';
    }
  }

  room.scores[candidateId] = (room.scores[candidateId] || 0) + netVotes;
  room.questionsAsked[candidateId] = (room.questionsAsked[candidateId] || 0) + 1;

  for (const [playerId, play] of plays) {
    const cards = room.players[playerId]?.cards;
    const index = cards?.findIndex(card => card.type === play.cardType) ?? -1;
    if (index !== -1) cards.splice(index, 1);
  }

  const turnCards = {};
  for (const [, play] of plays) {
    room.gameStats.cardsPlayed[play.cardType] = (room.gameStats.cardsPlayed[play.cardType] || 0) + 1;
    turnCards[play.cardType] = (turnCards[play.cardType] || 0) + 1;
  }

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

  return {
    plays: plays.map(([playerId, play]) => ({
      playerName: room.players[playerId]?.name || '?',
      cardType: play.cardType,
      cancelled: false
    })),
    netVotes,
    candidateId,
    candidateName: room.players[candidateId]?.name || '?',
    scores: { ...room.scores },
    multiplier
  };
}

module.exports = { distributeCards, getStrategyProgress, resolveStrategy };
