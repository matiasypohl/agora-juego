function countConnectedCitizens(room) {
  return Object.values(room.players)
    .filter(player => player.role !== 'candidate' && player.connected)
    .length;
}

function summarizeVotes(room, multiplier = 1) {
  const ups = Object.values(room.votes).filter(vote => vote === 'up').length;
  const downs = Object.values(room.votes).filter(vote => vote === 'down').length;
  const total = countConnectedCitizens(room);

  return {
    ups,
    downs,
    abstentions: total - ups - downs,
    total,
    multiplier,
    netVotes: (ups - downs) * multiplier
  };
}

function recordVoteStats(room, summary) {
  room.gameStats.totalVotesUp += summary.ups;
  room.gameStats.totalVotesDown += summary.downs;
  room.gameStats.totalAbstentions += summary.abstentions;
}

module.exports = { countConnectedCitizens, recordVoteStats, summarizeVotes };
