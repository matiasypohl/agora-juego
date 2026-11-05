function remapPlayerReferences(room, oldId, newId) {
  replaceInArray(room.candidates, oldId, newId);
  replaceInArray(room.citizenTurnOrder, oldId, newId);
  replaceInArray(room.debateCandidates, oldId, newId);

  for (const candidateId in room.advisors) {
    if (room.advisors[candidateId] === oldId) room.advisors[candidateId] = newId;
  }

  if (room.agendaChooserId === oldId) room.agendaChooserId = newId;
  if (room.agendaClaimerId === oldId) room.agendaClaimerId = newId;

  moveEntry(room.votes, oldId, newId);
  moveEntry(room.voteSelections, oldId, newId);
  moveEntry(room.strategyPlays, oldId, newId);
  moveEntry(room.debateVotes, oldId, newId);
  moveEntry(room.debateAnswers, oldId, newId);
  moveEntry(room.scores, oldId, newId);
  moveEntry(room.questionsAsked, oldId, newId);
  moveEntry(room.advisors, oldId, newId);

  if (room.strategyPasses?.has(oldId)) {
    room.strategyPasses.delete(oldId);
    room.strategyPasses.add(newId);
  }
}

function replaceInArray(items = [], oldId, newId) {
  const index = items.indexOf(oldId);
  if (index !== -1) items[index] = newId;
}

function moveEntry(collection, oldId, newId) {
  if (!collection || !Object.hasOwn(collection, oldId)) return;
  collection[newId] = collection[oldId];
  delete collection[oldId];
}

module.exports = { remapPlayerReferences };
