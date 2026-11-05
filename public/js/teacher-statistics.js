const TeacherStatistics = (() => {
  const candidateColors = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899'];
  const turnTypes = {
    normal: { icon: '📋', label: 'Normal' },
    escandalo: { icon: '💥', label: 'Escándalo ×2' },
    debate: { icon: '⚔️', label: 'Debate' }
  };
  const cardTypes = {
    respaldo: { icon: '👍', label: 'Respaldo' },
    censura: { icon: '👎', label: 'Censura' },
    coalicion: { icon: '🤝', label: 'Coalición' }
  };

  function render(results) {
    TeacherView.showSection('end');
    $('final-results').innerHTML = results.candidates.sort((a, b) => b.score - a.score).map((candidate, index) => `
      <div class="result-row ${candidate.winner ? 'winner' : ''}"><span class="result-rank">${index === 0 ? '🏆' : index === 1 ? '🥈' : '🥉'}</span><span class="result-name">${escapeHtml(candidate.name)}</span><span class="result-score">${candidate.score} votos</span></div>`).join('');
    const stats = results.stats || {};
    const totalVotes = (stats.totalVotesUp || 0) + (stats.totalVotesDown || 0) + (stats.totalAbstentions || 0);
    const overview = [
      [stats.totalPlayers || '?', 'Jugadores', ''], [stats.totalRounds || '?', 'Rondas/candidato', ''],
      [(stats.turnResults || []).length, 'Turnos jugados', ''], [totalVotes, 'Votos totales', ''],
      [`👍 ${stats.totalVotesUp || 0}`, `A favor (${totalVotes ? Math.round(stats.totalVotesUp / totalVotes * 100) : 0}%)`, 'positive-text'],
      [`👎 ${stats.totalVotesDown || 0}`, `En contra (${totalVotes ? Math.round(stats.totalVotesDown / totalVotes * 100) : 0}%)`, 'negative-text'],
      [`😶 ${stats.totalAbstentions || 0}`, 'Abstenciones', ''], [`🃏 ${stats.totalCardsPlayed || 0}`, 'Cartas jugadas', '']
    ];
    $('stats-overview').innerHTML = overview.map(([value, label, className]) => `<div class="stat-card ${className}"><div class="stat-value">${value}</div><div class="stat-label">${label}</div></div>`).join('');
    const cardMeta = { respaldo: ['👍', 'Respaldo', '#22c55e'], censura: ['👎', 'Censura', '#ef4444'], coalicion: ['🤝', 'Coalición', '#8b5cf6'] };
    const cards = stats.cardsPlayed || {};
    const maxCards = Math.max(1, ...Object.values(cards));
    $('stats-cards').innerHTML = Object.entries(cardMeta).map(([type, meta]) => `<div class="stats-card-row"><span class="stats-card-label">${meta[0]} ${meta[1]}</span><div class="stats-card-bar-track"><div class="stats-card-bar" style="width:${(cards[type] || 0) / maxCards * 100}%; background:${meta[2]};"></div></div><span class="stats-card-count">${cards[type] || 0}</span></div>`).join('');
    const turns = stats.turnResults || [];
    $('stats-turns').innerHTML = turns.length ? renderScoreChart(turns) : '<p class="hint">Sin datos de turnos</p>';
    if (turns.length) attachChartTooltips(turns);
  }

  function renderScoreChart(turnResults) {
    const candidateIds = [];
    const candidateNames = {};
    turnResults.forEach(turn => {
      if (!candidateIds.includes(turn.candidateId)) {
        candidateIds.push(turn.candidateId);
        candidateNames[turn.candidateId] = turn.candidateName;
      }
      Object.keys(turn.allScoresAfter || {}).forEach(id => {
        if (!candidateIds.includes(id)) {
          candidateIds.push(id);
          candidateNames[id] = id;
        }
      });
    });

    const series = {};
    const runningScores = {};
    candidateIds.forEach(id => {
      series[id] = [{ x: 0, y: 0 }];
      runningScores[id] = 0;
    });
    turnResults.forEach((turn, index) => {
      if (turn.allScoresAfter) {
        candidateIds.forEach(id => { runningScores[id] = turn.allScoresAfter[id] ?? runningScores[id]; });
      } else {
        runningScores[turn.candidateId] = (runningScores[turn.candidateId] || 0) + (turn.netVotes || 0);
      }
      candidateIds.forEach(id => series[id].push({ x: index + 1, y: runningScores[id] }));
    });

    const width = 720;
    const height = 320;
    const padding = { top: 24, right: 24, bottom: 48, left: 48 };
    const innerWidth = width - padding.left - padding.right;
    const innerHeight = height - padding.top - padding.bottom;
    const scores = candidateIds.flatMap(id => series[id].map(point => point.y));
    let minScore = Math.min(0, ...scores);
    let maxScore = Math.max(0, ...scores);
    if (minScore === maxScore) maxScore = minScore + 1;
    const scoreSpan = maxScore - minScore;
    const scorePadding = Math.max(1, Math.ceil(scoreSpan * 0.1));
    minScore -= scorePadding;
    maxScore += scorePadding;
    const xPosition = value => padding.left + value / turnResults.length * innerWidth;
    const yPosition = value => padding.top + innerHeight - (value - minScore) / (maxScore - minScore) * innerHeight;

    const gridValues = new Set([minScore, maxScore, 0]);
    const step = Math.max(1, Math.round(scoreSpan / 4));
    for (let value = Math.ceil(minScore); value <= Math.floor(maxScore); value += step) gridValues.add(value);
    const grid = [...gridValues].filter(value => value >= minScore && value <= maxScore).sort((a, b) => a - b).map(value => {
      const y = yPosition(value);
      return `<line class="chart-grid ${value === 0 ? 'chart-grid-zero' : ''}" x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}"/><text class="chart-axis-label" x="${padding.left - 8}" y="${y + 4}" text-anchor="end">${value}</text>`;
    }).join('');
    const xAxis = turnResults.map((turn, index) => {
      const x = xPosition(index + 1);
      return `<line class="chart-axis" x1="${x}" y1="${padding.top + innerHeight}" x2="${x}" y2="${padding.top + innerHeight + 4}"/><text class="chart-axis-label" x="${x}" y="${padding.top + innerHeight + 18}" text-anchor="middle">#${index + 1}</text>`;
    }).join('');
    const lines = candidateIds.map((id, colorIndex) => {
      const color = candidateColors[colorIndex % candidateColors.length];
      const points = series[id];
      const path = points.map((point, index) => `${index ? 'L' : 'M'} ${xPosition(point.x).toFixed(1)} ${yPosition(point.y).toFixed(1)}`).join(' ');
      const dots = turnResults.map((turn, index) => turn.candidateId === id
        ? `<circle class="chart-dot" data-turn="${index}" cx="${xPosition(index + 1).toFixed(1)}" cy="${yPosition(points[index + 1].y).toFixed(1)}" r="6" fill="${color}" stroke="#0b1220" stroke-width="2"/>`
        : '').join('');
      return `<path class="chart-line" d="${path}" stroke="${color}" fill="none" stroke-width="2.5"/>${dots}`;
    }).join('');
    const legend = candidateIds.map((id, index) => `<span class="chart-legend-item"><span class="chart-legend-dot" style="background:${candidateColors[index % candidateColors.length]}"></span>${escapeHtml(candidateNames[id])}</span>`).join('');

    return `<div class="score-chart-wrap"><div class="chart-legend">${legend}</div><svg class="score-chart" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Evolución de puntaje por turno">${grid}${xAxis}<line class="chart-axis" x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + innerHeight}"/><line class="chart-axis" x1="${padding.left}" y1="${padding.top + innerHeight}" x2="${width - padding.right}" y2="${padding.top + innerHeight}"/>${lines}</svg><div id="chart-tooltip" class="chart-tooltip hidden" role="tooltip"></div></div>`;
  }

  function attachChartTooltips(turnResults) {
    const tooltip = $('chart-tooltip');
    const wrapper = document.querySelector('.score-chart-wrap');
    if (!tooltip || !wrapper) return;
    const hide = () => tooltip.classList.add('hidden');
    const show = (event, index) => {
      const turn = turnResults[index];
      if (!turn) return;
      const type = turnTypes[turn.turnType] || turnTypes.normal;
      const cards = Object.entries(turn.cards || {}).map(([cardType, count]) => {
        const card = cardTypes[cardType] || { icon: '🃏', label: cardType };
        return `<span class="tt-card">${card.icon} ${card.label}${count > 1 ? ' ×' + count : ''}</span>`;
      }).join('') || '<span class="tt-muted">—</span>';
      const sign = turn.netVotes >= 0 ? '+' : '';
      const debate = turn.debate ? `<div class="tt-row"><span class="tt-label">Rival:</span> ${escapeHtml(turn.debateRivalName || '?')} (${turn.debateVotes?.self ?? '?'} vs ${turn.debateVotes?.rival ?? '?'})</div>` : '';
      tooltip.innerHTML = `<div class="tt-header"><span class="tt-turn">Turno #${index + 1}</span><span class="tt-type">${type.icon} ${type.label}</span></div><div class="tt-candidate">${escapeHtml(turn.candidateName)}</div><div class="tt-question">${escapeHtml(turn.question)}${turn.question?.length >= 80 ? '…' : ''}</div><div class="tt-row"><span class="tt-label">Votos turno:</span> <span class="${turn.netVotes >= 0 ? 'positive-text' : 'negative-text'}">${sign}${turn.netVotes}</span></div><div class="tt-row"><span class="tt-label">Puntaje tras turno:</span> ${turn.scoreAfter ?? 0}</div><div class="tt-row"><span class="tt-label">Estrategia:</span> <span class="tt-cards">${cards}</span></div>${debate}`;
      tooltip.classList.remove('hidden');
      const wrapperRect = wrapper.getBoundingClientRect();
      const dotRect = event.target.getBoundingClientRect();
      tooltip.style.left = dotRect.left - wrapperRect.left + dotRect.width / 2 + 'px';
      tooltip.style.top = dotRect.top - wrapperRect.top + 'px';
    };
    wrapper.querySelectorAll('.chart-dot').forEach(dot => {
      dot.setAttribute('tabindex', '0');
      dot.addEventListener('mouseenter', event => show(event, Number(event.target.dataset.turn)));
      dot.addEventListener('mouseleave', hide);
      dot.addEventListener('focus', event => show(event, Number(event.target.dataset.turn)));
      dot.addEventListener('blur', hide);
    });
  }

  return { render };
})();
