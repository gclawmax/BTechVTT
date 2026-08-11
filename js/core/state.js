// ── STATE ────────────────────────────────────────────────
let currentUser = null;
let currentGameId = null;
let isHost = false;
let isReady = false;
let mySeatNumber = null; // 1 or 2 — which side this browser controls on the map
let gameSubscription = null;
let playersSubscription = null;
let gameStateSubscription = null;
