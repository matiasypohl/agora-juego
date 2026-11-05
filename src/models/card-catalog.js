const fs = require('fs');
const path = require('path');

function loadCards() {
  const filePath = path.join(__dirname, '..', '..', 'data', 'cards.json');
  const cards = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  if (!Array.isArray(cards.strategy) || cards.strategy.length === 0) {
    throw new Error('cards.json debe tener un array "strategy" no vacío');
  }

  for (const card of cards.strategy) {
    if (!card.type || !card.name || !card.effect || typeof card.weight !== 'number') {
      throw new Error(`Carta inválida: ${JSON.stringify(card).substring(0, 80)}`);
    }
  }

  return cards;
}

const cards = loadCards();
const strategyCardsByType = new Map(cards.strategy.map(card => [card.type, card]));

function getStrategyCards() {
  return cards.strategy;
}

function getStrategyCard(type) {
  return strategyCardsByType.get(type) || null;
}

module.exports = { getStrategyCard, getStrategyCards };
