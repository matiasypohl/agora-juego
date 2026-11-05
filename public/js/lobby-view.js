const LobbyView = (() => {
  const get = id => document.getElementById(id);
  const escapeHtml = value => (typeof value === 'string' ? value : '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function showError(message, input) {
    get('error-msg').textContent = message;
    if (!input) return;
    input.classList.remove('shake');
    void input.offsetHeight;
    input.classList.add('shake');
  }

  function setJoining(joining) {
    get('btn-join').disabled = joining;
    get('btn-join').textContent = joining ? 'Conectando...' : 'Unirse a la partida';
    if (joining) get('error-msg').textContent = '';
  }

  function showWaiting(code) {
    get('join-form').classList.add('hidden');
    get('waiting-room').classList.remove('hidden');
    get('display-code').textContent = code;
  }

  function renderPlayers(players) {
    get('player-list-lobby').innerHTML = players.map(player =>
      `<div class="player-chip ${player.role === 'candidate' ? 'candidate' : ''}">${escapeHtml(player.name)}${player.role === 'candidate' ? ' ⭐' : ''}</div>`
    ).join('');
    get('player-count-num').textContent = players.length;
  }

  return { get, renderPlayers, setJoining, showError, showWaiting };
})();
