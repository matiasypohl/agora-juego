const crypto = require('crypto');
const GAME_LIMITS = require('../config/game-limits');
const { createStoredRoom } = require('../models/room-creator');
const { remapPlayerReferences } = require('../models/player-reference-map');

function registerRoomController(socket, dependencies) {
  const {
    broadcaster, handleGameDisconnect, log, questions, rateLimiter,
    roomStore, sanitize, shuffle
  } = dependencies;

  socket.on('teacher:create', callback => {
    const questionPool = shuffle([...Array(questions.length).keys()]);
    const room = createStoredRoom(roomStore, socket.id, questionPool);
    roomStore.bindSocket(socket.id, room.code);
    log(room, 'Sala creada');
    callback({ code: room.code });
  });

  socket.on('player:join', ({ code, name }, callback) => {
    if (!isValidCode(code)) return callback({ error: 'Código de sala inválido' });
    const cleanName = sanitize((name || '').trim().substring(0, GAME_LIMITS.PLAYER_NAME_LENGTH));
    if (!cleanName) return callback({ error: 'Nombre requerido' });

    const room = roomStore.get(code);
    if (!room) return callback({ error: 'Sala no encontrada' });

    if (room.state !== 'lobby') {
      const existing = Object.entries(room.players)
        .find(([, player]) => player.name === cleanName && !player.connected);
      if (!existing) return callback({ error: 'La partida ya comenzó' });

      const [oldId, player] = existing;
      const reconnectToken = createReconnectToken();
      replacePlayer(room, roomStore, oldId, socket.id, player, reconnectToken);
      log(room, `Rejoin mid-game: ${cleanName}`);
      broadcaster.emitToRoom(room, 'player:reconnected', { name: cleanName });
      callback({ ok: true, reconnectToken, rejoin: true });
      broadcaster.emitState(room);
      return;
    }

    if (Object.values(room.players).some(player => player.name === cleanName)) {
      return callback({ error: 'Ese nombre ya está en uso' });
    }

    const reconnectToken = createReconnectToken();
    room.players[socket.id] = {
      id: socket.id,
      name: cleanName,
      role: 'citizen',
      connected: true,
      cards: [],
      reconnectToken
    };
    roomStore.bindSocket(socket.id, room.code);
    log(room, `Jugador unido: ${cleanName}`);
    callback({ ok: true, reconnectToken });
    broadcaster.emitState(room);
  });

  socket.on('teacher:join', ({ code }, callback) => {
    const room = roomStore.get(code);
    if (!room) return callback({ error: 'Sala no encontrada' });
    if (room.teacherId) roomStore.unbindSocket(room.teacherId);
    room.teacherId = socket.id;
    roomStore.bindSocket(socket.id, room.code);
    callback({ ok: true });
    broadcaster.emitState(room);
  });

  socket.on('reconnect:attempt', ({ code, name, token, silent }) => {
    const room = roomStore.get(code);
    if (!room) return;

    for (const [oldId, player] of Object.entries(room.players)) {
      if (player.name !== name || player.connected) continue;
      if (player.reconnectToken && player.reconnectToken !== token) {
        socket.emit('error', { message: 'Token de reconexión inválido' });
        log(room, `Reconexión rechazada (token inválido): ${player.name}`);
        return;
      }

      replacePlayer(room, roomStore, oldId, socket.id, player, player.reconnectToken);
      log(room, silent ? `Primer ingreso al juego: ${player.name}` : `Reconexión: ${player.name}`);
      if (!silent) broadcaster.emitToRoom(room, 'player:reconnected', { name: player.name });
      broadcaster.emitState(room);
      return;
    }
  });

  socket.on('disconnect', () => {
    rateLimiter.clear(socket.id);
    const room = roomStore.getForSocket(socket.id);
    if (!room) return;

    const player = room.players[socket.id];
    if (player) {
      log(room, `Desconectado: ${player.name}`);
      player.connected = false;
      broadcaster.emitToRoom(room, 'player:disconnected', { name: player.name });
      broadcaster.emitState(room);
      if (room.state === 'playing') handleGameDisconnect(room, socket.id, player);
    }
    if (room.teacherId === socket.id) log(room, 'Profesor desconectado');
  });
}

function replacePlayer(room, roomStore, oldId, newId, player, reconnectToken) {
  room.players[newId] = {
    ...player,
    id: newId,
    connected: true,
    cards: player.cards.map(card => ({ ...card })),
    reconnectToken
  };
  delete room.players[oldId];
  roomStore.unbindSocket(oldId);
  roomStore.bindSocket(newId, room.code);
  remapPlayerReferences(room, oldId, newId);
}

function isValidCode(code) {
  return !!code && code.length === GAME_LIMITS.ROOM_CODE_LENGTH && /^[A-Z0-9]+$/.test(code);
}

function createReconnectToken() {
  return crypto.randomBytes(16).toString('hex');
}

module.exports = { registerRoomController };
