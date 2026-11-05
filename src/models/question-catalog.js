const fs = require('fs');
const path = require('path');

function loadQuestions() {
  const filePath = path.join(__dirname, '..', '..', 'data', 'questions.json');
  const questions = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  if (!Array.isArray(questions) || questions.length === 0) {
    throw new Error('questions.json debe ser un array no vacío');
  }

  for (const question of questions) {
    if (!question.scenario || !Array.isArray(question.options) || question.options.length < 2) {
      throw new Error(`Pregunta inválida: ${JSON.stringify(question).substring(0, 80)}`);
    }
  }

  return questions;
}

const questions = loadQuestions();

module.exports = { questions };
