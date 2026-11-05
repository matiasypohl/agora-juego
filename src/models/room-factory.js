const GAME_LIMITS = require('../config/game-limits');

function createRoom({ code, teacherId, questionPool }) {
  return {
    code,
    teacherId,
    players: {},
    state: 'lobby',
    candidates: [],
    currentCandidateIdx: 0,
    questionsAsked: {},
    questionPool,
    questionPoolIdx: 0,
    currentQuestion: null,
    phase: null,
    phaseTimer: null,
    phaseTimeLeft: 0,
    phaseDuration: 0,
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
    gameStats: createGameStats(),
    scandalActive: false,
    debateActive: false,
    debateCandidates: [],
    debateAnswers: {},
    debateVotes: {},
    debateQuestion: null,
    questionsPerCandidate: GAME_LIMITS.DEFAULT_ROUNDS,
    citizenTurnOrder: [],
    citizenTurnIdx: 0,
    agendaChoices: [],
    agendaChooserId: null,
    currentTurnType: 'normal',
    generation: 0,
    pendingTimeouts: [],
    createdAt: Date.now()
  };
}

function createGameStats() {
  return {
    totalVotesUp: 0,
    totalVotesDown: 0,
    totalAbstentions: 0,
    cardsPlayed: {},
    turnResults: []
  };
}

module.exports = { createGameStats, createRoom };
