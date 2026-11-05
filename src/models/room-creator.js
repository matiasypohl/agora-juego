const { generateRoomCode } = require('./room-code');
const { createRoom } = require('./room-factory');

function createStoredRoom(roomStore, teacherId, questionPool) {
  let code;
  do {
    code = generateRoomCode();
  } while (roomStore.has(code));

  return roomStore.add(createRoom({ code, teacherId, questionPool }));
}

module.exports = { createStoredRoom };
