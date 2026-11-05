function createRateLimiter(maxPerSecond) {
  const attempts = new Map();

  return {
    clear(clientId) {
      attempts.delete(clientId);
    },

    middleware(clientId) {
      return (packet, next) => {
        const now = Date.now();
        const times = attempts.get(clientId) || [];
        while (times.length > 0 && now - times[0] > 1000) times.shift();
        if (times.length >= maxPerSecond) return next(new Error('rate limited'));
        times.push(now);
        attempts.set(clientId, times);
        next();
      };
    }
  };
}

module.exports = { createRateLimiter };
