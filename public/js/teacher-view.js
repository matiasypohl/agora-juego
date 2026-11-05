const TeacherView = (() => {
  const get = id => document.getElementById(id);
  const phaseNames = {
    agenda_window: '📋 Ventana de Agenda', agenda: '📋 Fase de Agenda', voting: '🗳️ Votación Secreta',
    strategy: '🃏 Fase de Estrategia', turn_result: '📊 Resultado del Turno',
    debate_question: '⚔️ Debate — Respuestas', debate_vote: '⚔️ Debate — Votación', debate_result: '⚔️ Debate — Resultado'
  };

  function showSection(name) {
    ['lobby', 'game', 'end'].forEach(section => get(section + '-section').classList.toggle('hidden', section !== name));
  }

  function renderLobby(state) {
    showSection('lobby');
    if (state.questionsPerCandidate) configRounds = state.questionsPerCandidate;
    updateRoundsDisplay();
    const players = state.players || [];
    get('player-list').innerHTML = players.map(player => `
      <div class="player-card ${player.role === 'candidate' ? 'is-candidate' : ''}" data-id="${escapeHtml(player.id)}">
        <span class="player-name">${escapeHtml(player.name)}</span>
        <span class="player-role">${player.role === 'candidate' ? '⭐ Candidato' : 'Ciudadano'}</span>
        <button class="btn btn-small btn-toggle-role" data-id="${escapeHtml(player.id)}" data-current="${escapeHtml(player.role)}">${player.role === 'candidate' ? 'Quitar' : 'Candidato'}</button>
      </div>`).join('');
    const candidates = players.filter(player => player.role === 'candidate');
    get('candidate-count').textContent = candidates.length;
    get('candidate-list').innerHTML = candidates.map(candidate => `<span class="candidate-chip">⭐ ${escapeHtml(candidate.name)}</span>`).join('');
    get('btn-start').disabled = candidates.length < 2;
    get('start-error').textContent = candidates.length < 2 ? 'Se necesitan al menos 2 candidatos' : '';
  }

  function renderGame(state) {
    showSection('game');
    get('phase-label').textContent = phaseNames[state.phase] || state.phase || '—';
    const currentCandidate = state.players.find(player => player.id === state.currentCandidateId);
    get('phase-candidate').textContent = currentCandidate ? `Turno de: ${currentCandidate.name}` : '';
    get('btn-pause').textContent = state.paused ? '▶ Reanudar' : '⏸ Pausar';
    renderPause(state.paused);
    renderScoreboard(state.scores, state);
    get('current-question').innerHTML = state.currentQuestion
      ? `<p class="scenario-text">${escapeHtml(state.currentQuestion.scenario)}</p>` + state.currentQuestion.options.map(option => `<span class="option-pill ${state.candidateAnswer === option.label ? 'selected' : ''}">${escapeHtml(option.label)}: ${escapeHtml(option.text)}</span>`).join('')
      : '—';
    get('game-player-list').innerHTML = state.players.map(player => `<div class="player-card mini ${player.connected ? '' : 'disconnected'}"><span class="status-dot ${player.connected ? 'online' : 'offline'}"></span><span>${escapeHtml(player.name)}</span><span class="player-role-tag">${player.role === 'candidate' ? '⭐' : (player.role === 'advisor' ? '🤝' : '')}</span></div>`).join('');
    if (state.questionsAsked) get('candidate-answer-display').innerHTML = state.candidates.map(id => {
      const player = state.players.find(item => item.id === id);
      return `<span class="progress-chip">${escapeHtml(player ? player.name : '?')}: ${state.questionsAsked[id] || 0}/${state.questionsPerCandidate}</span>`;
    }).join(' ');
  }

  function renderPause(paused) {
    let overlay = get('pause-overlay');
    if (paused && !overlay) {
      overlay = document.createElement('div');
      overlay.id = 'pause-overlay';
      overlay.className = 'pause-overlay';
      overlay.innerHTML = '<div class="pause-overlay-content">⏸️ PAUSADO</div>';
      get('phase-panel').appendChild(overlay);
    }
    if (overlay) overlay.classList.toggle('hidden', !paused);
  }

  function renderScoreboard(scores, state) {
    if (!scores || !state) return;
    const maxScore = Math.max(1, ...Object.values(scores).map(Math.abs));
    get('scoreboard').innerHTML = state.candidates.map(id => {
      const player = state.players.find(item => item.id === id);
      const score = scores[id] || 0;
      return `<div class="score-row"><span class="score-name">${escapeHtml(player ? player.name : '?')}</span><div class="score-bar-track"><div class="score-bar ${score >= 0 ? 'positive' : 'negative'}" style="width:${Math.abs(score) / maxScore * 100}%"></div></div><span class="score-value ${score >= 0 ? '' : 'negative-text'}">${score}</span></div>`;
    }).join('');
  }

  return { renderGame, renderLobby, renderScoreboard, showSection };
})();
