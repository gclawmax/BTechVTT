// ── AI OPPONENT STATE ────────────────────────────────────
let vsAiMode = false;
const AI_DIFFICULTY_KEYS = ['beginner', 'intermediate', 'advanced', 'expert'];
const AI_PERSONALITY_KEYS = ['balanced', 'aggressive', 'cautious', 'brawler', 'sniper', 'objective'];
const AI_PERSONALITY_LABELS = { balanced:'Balanced', aggressive:'Aggressive', cautious:'Cautious', brawler:'Brawler', sniper:'Sniper', objective:'Objective Focused' };
const AI_DIFFICULTY_STORAGE_KEY = 'btech-vtt-ai-difficulty';
const AI_PERSONALITY_STORAGE_KEY = 'btech-vtt-ai-personality';
let aiDifficulty = AI_DIFFICULTY_KEYS.includes(localStorage.getItem(AI_DIFFICULTY_STORAGE_KEY))
  ? localStorage.getItem(AI_DIFFICULTY_STORAGE_KEY) : 'beginner';
let aiPersonality = AI_PERSONALITY_KEYS.includes(localStorage.getItem(AI_PERSONALITY_STORAGE_KEY))
  ? localStorage.getItem(AI_PERSONALITY_STORAGE_KEY) : 'balanced';

function setAIOpponentOptions(difficulty = aiDifficulty, personality = aiPersonality) {
  aiDifficulty = AI_DIFFICULTY_KEYS.includes(difficulty) ? difficulty : 'beginner';
  aiPersonality = AI_PERSONALITY_KEYS.includes(personality) ? personality : 'balanced';
  localStorage.setItem(AI_DIFFICULTY_STORAGE_KEY, aiDifficulty);
  localStorage.setItem(AI_PERSONALITY_STORAGE_KEY, aiPersonality);
  const difficultySelect = document.getElementById('ai-difficulty-select');
  const personalitySelect = document.getElementById('ai-personality-select');
  const summary = document.getElementById('ai-opponent-summary');
  if (difficultySelect) difficultySelect.value = aiDifficulty;
  if (personalitySelect) personalitySelect.value = aiPersonality;
  if (summary) summary.textContent = `${titleCase(aiDifficulty)} · ${AI_PERSONALITY_LABELS[aiPersonality]}`;
}

function updateAIOpponentOptions() {
  setAIOpponentOptions(
    document.getElementById('ai-difficulty-select')?.value,
    document.getElementById('ai-personality-select')?.value
  );
}

// AI players are represented by btech_players.is_ai = true.
// They intentionally have no auth user_id.
