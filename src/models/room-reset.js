const { createGameStats } = require('./room-factory');

function resetRoom(room, questionPool) {
  Object.assign(room, {
    state: 'lobby',
    phase: null,
    currentCandidateIdx: 0,
    questionsAsked: {},
    questionPool,
    questionPoolIdx: 0,
    currentQuestion: null,
    votes: {},
    voteSelections: {},
    strategyPlays: {},
    strategyPasses: new Set(),
    agendaClaimed: false,
    agendaClaimerId: null,
    candidateAnswer: null,
    advisors: {},
    advisorMessages: {},
    scores: {},
    turnHistory: [],
    gameStats: createGameStats(),
    currentTurnType: 'normal',
    scandalActive: false,
    debateActive: false,
    debateCandidates: [],
    debateAnswers: {},
    debateVotes: {},
    debateQuestion: null,
    paused: false,
    phaseTimeLeft: 0,
    phaseDuration: 0,
    endedAt: undefined,
    agendaChoices: [],
    agendaChooserId: null,
    citizenTurnOrder: [],
    citizenTurnIdx: 0
  });

  for (const [playerId, player] of Object.entries(room.players)) {
    player.cards = [];
    if (!room.candidates.includes(playerId)) player.role = 'citizen';
  }

  return room;
}

module.exports = { resetRoom };
