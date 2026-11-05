function createGameBroadcaster(io, presenter) {
  function emitToRoom(room, event, data) {
    for (const playerId of Object.keys(room.players)) io.to(playerId).emit(event, data);
    if (room.teacherId) io.to(room.teacherId).emit(event, data);
  }

  function emitActivity(room, icon, text) {
    if (room.teacherId) {
      io.to(room.teacherId).emit('game:activity', { icon, text, time: Date.now() });
    }
  }

  function emitState(room) {
    for (const playerId of Object.keys(room.players)) {
      io.to(playerId).emit('game:state', presenter(room, playerId));
    }
    if (room.teacherId) {
      io.to(room.teacherId).emit('game:state', presenter(room, room.teacherId));
    }
  }

  function emitToSocket(socketId, event, data) {
    io.to(socketId).emit(event, data);
  }

  return { emitActivity, emitState, emitToRoom, emitToSocket };
}

module.exports = { createGameBroadcaster };
