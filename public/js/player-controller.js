window.addEventListener('agora:game-state', event => renderGameState({ ...event.detail, clientId: socket.id }));
window.addEventListener('agora:game-timer', event => updateTimer(event.detail.timeLeft, event.detail.duration));
window.addEventListener('agora:vote-reveal', event => showVoteReveal(event.detail));
window.addEventListener('agora:strategy-reveal', event => showStrategyReveal(event.detail));
window.addEventListener('agora:strategy-confirmed', event => onStrategyConfirmed(event.detail));
window.addEventListener('agora:private-message', event => showAdvisorMessage(event.detail));
window.addEventListener('agora:game-end', event => showGameEnd(event.detail));
window.addEventListener('agora:scandal', () => showScandalAlert());
window.addEventListener('agora:debate-result', event => showDebateResult(event.detail));
window.addEventListener('agora:vote-confirmed', () => {
  hasVoted = true;
  voteSelection = null;
  $('vote-selection-display').classList.add('hidden');
  $('vote-confirmed').classList.remove('hidden');
  showToast('✅ Voto confirmado', 'success');
});

document.addEventListener('click', () => ensureAudio(), { once: true });
$('game-content')?.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button) return;
  if (button.dataset.action === 'answer') {
    sfxCardPlay();
    socket.emit('event:answer', { answer: button.dataset.label });
  }
  if (button.dataset.action === 'choose-agenda') {
    sfxCardPlay();
    socket.emit('agenda:choose', { choiceIndex: parseInt(button.dataset.index, 10) });
  }
  if (button.dataset.action === 'play-strategy' && !hasPlayedStrategy) {
    sfxCardPlay();
    socket.emit('strategy:play', { cardType: button.dataset.cardType });
  }
  if (button.dataset.action === 'debate-vote' && !hasDebateVoted) {
    hasDebateVoted = true;
    sfxVote();
    socket.emit('debate:vote', { candidateId: button.dataset.candidateId });
    $('debate-vote-buttons').classList.add('hidden');
    $('debate-vote-confirmed').classList.remove('hidden');
  }
  if (button.dataset.action === 'return-lobby') window.location.href = '/play';
});

$('btn-send-advice')?.addEventListener('click', () => {
  const message = $('advisor-msg').value.trim();
  if (!message) return;
  socket.emit('message:private', { text: message });
  $('advisor-msg').value = '';
  $('advisor-msg').disabled = true;
  $('btn-send-advice').disabled = true;
  showToast('💬 Consejo enviado', 'success');
});

document.querySelectorAll('.btn-vote').forEach(button => button.addEventListener('click', () => {
  if (hasVoted) return;
  voteSelection = button.dataset.vote;
  sfxVote();
  socket.emit('vote:select', { vote: voteSelection });
  $('vote-buttons').classList.add('hidden');
  $('vote-selection-display').classList.remove('hidden');
  $('vote-selection-emoji').textContent = voteSelection === 'up' ? '👍' : '👎';
  $('vote-selection-label').textContent = voteSelection === 'up' ? 'A favor' : 'En contra';
}));

$('btn-vote-confirm')?.addEventListener('click', () => {
  if (!hasVoted && voteSelection) socket.emit('vote:confirm');
});
$('btn-vote-change')?.addEventListener('click', () => {
  if (hasVoted) return;
  voteSelection = null;
  $('vote-selection-display').classList.add('hidden');
  $('vote-buttons').classList.remove('hidden');
});
$('btn-send-debate-answer')?.addEventListener('click', () => {
  const text = $('debate-answer-input').value.trim();
  if (!text) return;
  socket.emit('debate:answer', { text });
  $('debate-answer-input').disabled = true;
  $('btn-send-debate-answer').disabled = true;
  showToast('✅ Respuesta enviada', 'success');
});
$('btn-pass')?.addEventListener('click', () => {
  hasPlayedStrategy = true;
  socket.emit('strategy:pass');
  $('strategy-hand').innerHTML = '';
  $('btn-pass').classList.add('hidden');
  $('strategy-confirmed').classList.remove('hidden');
  $('strategy-confirmed').textContent = '✅ Pasaste este turno';
});
