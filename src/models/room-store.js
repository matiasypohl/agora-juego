function createRoomStore() {
  const rooms = new Map();
  const socketRooms = new Map();

  return {
    add(room) {
      rooms.set(room.code, room);
      return room;
    },

    bindSocket(socketId, code) {
      socketRooms.set(socketId, code);
    },

    delete(code) {
      const room = rooms.get(code);
      if (!room) return null;

      for (const playerId of Object.keys(room.players)) socketRooms.delete(playerId);
      if (room.teacherId) socketRooms.delete(room.teacherId);
      rooms.delete(code);
      return room;
    },

    get(code) {
      return rooms.get(code) || null;
    },

    getForSocket(socketId) {
      const code = socketRooms.get(socketId);
      return code ? rooms.get(code) || null : null;
    },

    has(code) {
      return rooms.has(code);
    },

    unbindSocket(socketId) {
      socketRooms.delete(socketId);
    },

    values() {
      return rooms.values();
    }
  };
}

module.exports = { createRoomStore };
