// Extracted from index_3_1.html — state

// ── STATE ────────────────────────────────────────────────
let currentUser = null;
let currentGameId = null;
let isHost = false;
let isReady = false;
let mySeatNumber = null; // 1 or 2 — which side this browser controls on the map
let gameSubscription = null;
let playersSubscription = null;
let gameStateSubscription = null;

// ── AI OPPONENT STATE ────────────────────────────────────
let vsAiMode = false;
let aiDifficulty = 'beginner'; // beginner, intermediate, advanced, expert
const AI_UUID = '__ai_opponent__';
