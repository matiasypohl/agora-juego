function createTimerService(onTick) {
  function clear(room) {
    if (room.phaseTimer) {
      clearInterval(room.phaseTimer);
      room.phaseTimer = null;
    }
    clearPending(room);
  }

  function clearPending(room) {
    room.generation++;
    for (const timeoutId of room.pendingTimeouts || []) clearTimeout(timeoutId);
    room.pendingTimeouts = [];
  }

  function delay(room, callback, milliseconds) {
    const generation = room.generation;
    const timeoutId = setTimeout(() => {
      if (room.generation === generation) callback();
    }, milliseconds);
    room.pendingTimeouts.push(timeoutId);
  }

  function start(room, seconds, onEnd) {
    clear(room);
    room.phaseTimeLeft = seconds;
    room.phaseDuration = seconds;
    onTick(room);

    room.phaseTimer = setInterval(() => {
      if (room.paused || room.state === 'ended') return;
      room.phaseTimeLeft--;
      onTick(room);
      if (room.phaseTimeLeft <= 0) {
        clear(room);
        onEnd();
      }
    }, 1000);
  }

  return { clear, clearPending, delay, start };
}

module.exports = { createTimerService };
