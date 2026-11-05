const lobbySocket = io();
let joinedRoomCode = null;

const savedName = sessionStorage.getItem('agora_name');
if (savedName) LobbyView.get('player-name').value = savedName;

function joinLobby() {
  const codeInput = LobbyView.get('room-code');
  const nameInput = LobbyView.get('player-name');
  const code = codeInput.value.trim().toUpperCase();
  const name = nameInput.value.trim();

  if (code.length !== 6) return LobbyView.showError('Ingresa un código de sala de 6 caracteres', codeInput);
  if (!name) return LobbyView.showError('Ingresa tu nombre', nameInput);

  LobbyView.setJoining(true);
  lobbySocket.emit('player:join', { code, name }, response => {
    if (response.error) {
      LobbyView.showError(response.error);
      LobbyView.setJoining(false);
      return;
    }
    joinedRoomCode = code;
    sessionStorage.setItem('agora_name', name);
    sessionStorage.setItem('agora_code', code);
    if (response.reconnectToken) sessionStorage.setItem('agora_token', response.reconnectToken);
    if (response.rejoin) return openGame();
    LobbyView.showWaiting(code);
  });
}

function openGame() {
  sessionStorage.setItem('agora_first_load', '1');
  window.location.href = '/game?code=' + joinedRoomCode;
}

LobbyView.get('btn-join').addEventListener('click', joinLobby);
LobbyView.get('room-code').addEventListener('input', event => { event.target.value = event.target.value.toUpperCase(); });
LobbyView.get('room-code').addEventListener('keydown', event => {
  if (event.key === 'Enter') LobbyView.get('player-name').focus();
});
LobbyView.get('player-name').addEventListener('keydown', event => {
  if (event.key === 'Enter') joinLobby();
});

lobbySocket.on('game:state', state => {
  if (state.state === 'lobby') LobbyView.renderPlayers(state.players || []);
  if (state.state === 'playing') openGame();
});
