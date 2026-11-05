const path = require('path');

function registerPageRoutes(app, publicDirectory) {
  app.get('/', sendPage('landing.html'));
  app.get('/play', sendPage('index.html'));
  app.get('/teacher', sendPage('teacher.html'));
  app.get('/game', sendPage('game.html'));

  function sendPage(fileName) {
    return (request, response) => response.sendFile(path.join(publicDirectory, fileName));
  }
}

module.exports = { registerPageRoutes };
