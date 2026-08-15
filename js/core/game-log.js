// ── GAME LOG ──────────────────────────────────────────────
// A running history of what happened this game (initiative rolls, phase
// changes, moves, attacks, sync errors). Kept locally for instant feedback
// and persisted into btech_games.state.log so it also travels between
// browsers via the existing realtime state sync, and survives rejoin/reload.
let gameLog = [];
const GAME_LOG_MAX = 200;
// Unique per browser tab so ids never collide with another player's client.
const LOG_CLIENT_ID = Math.random().toString(36).slice(2, 8);
let _logSeq = 0;

// Game state is a single JSON document. Serialize read-modify-write updates so
// a confirmed move, reaction, or log entry cannot overwrite another update
// that was still in flight from the same browser.
let gameStateWriteQueue = Promise.resolve();

function queueGameStateWrite(write) {
  const queued = gameStateWriteQueue.then(write, write);
  // Keep the queue usable after a failed network request while returning the
  // original promise to the caller for its own error handling.
  gameStateWriteQueue = queued.catch(() => {});
  return queued;
}

function _logTimeLabel() {
  const d = new Date();
  return d.toTimeString().slice(0, 8);
}

// Push an entry into the on-screen log immediately, then (fire-and-forget)
// persist it into the shared game state so other players/browsers see it too.
// category: 'system' | 'phase' | 'roll' | 'move' | 'attack' | 'error' | 'info'
function logEvent(message, category) {
  category = category || 'info';
  const entry = {
    id: `${LOG_CLIENT_ID}-${++_logSeq}`,
    ts: Date.now(),
    time: _logTimeLabel(),
    round: currentGameState ? currentGameState.round : null,
    phase: currentGameState ? currentGameState.phase : null,
    cat: category,
    msg: message
  };
  gameLog.push(entry);
  if (gameLog.length > GAME_LOG_MAX) gameLog = gameLog.slice(-GAME_LOG_MAX);
  renderGameLog();

  // Debug console mirror — same info, easier to grep/copy when troubleshooting.
  const tag = `[BT-LOG][R${entry.round ?? '?'}/${entry.phase ?? '?'}][${category}]`;
  if (category === 'error') console.error(tag, message);
  else console.log(tag, message);

  // A human-versus-human game has authoritative, seat-scoped state writes.
  // Writing an entire JSON snapshot merely to append a log line can otherwise
  // overwrite a newer initiative/action update from the other browser.
  if (currentGameId && vsAiMode) persistLogEntry(entry);
}

// Read-modify-write the game's shared state to append this one entry.
// Non-blocking by design (callers never await this) so gameplay never stalls
// on it; last-write-wins is an acceptable tradeoff for a log, same pattern
// already used elsewhere in this file (syncMechInstances, rollInitiative).
async function persistLogEntry(entry) {
  try {
    await queueGameStateWrite(async () => {
      const { data: game, error: readError } = await db.from('btech_games').select('state').eq('id', currentGameId).single();
      if (readError) throw readError;
      const gameState = game?.state ? (typeof game.state === 'string' ? JSON.parse(game.state) : game.state) : {};
      const log = Array.isArray(gameState.log) ? gameState.log : [];
      log.push(entry);
      gameState.log = log.length > GAME_LOG_MAX ? log.slice(-GAME_LOG_MAX) : log;
      const { error: writeError } = await db.from('btech_games').update({ state: JSON.stringify(gameState) }).eq('id', currentGameId);
      if (writeError) throw writeError;
    });
  } catch (err) {
    // Don't recurse into logEvent here — would loop on persistent failures.
    console.warn('[BT-LOG] failed to persist log entry:', err);
  }
}

function renderGameLog() {
  const el = document.getElementById('game-log');
  if (!el) return;
  const wasNearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 12;
  el.innerHTML = gameLog.map(e =>
    `<div class="log-entry cat-${e.cat}"><span class="log-tag">[${e.time}] R${e.round ?? '?'}/${(e.phase || '?').slice(0,4)}</span>${escapeLogHtml(e.msg)}</div>`
  ).join('');
  // Autoscroll to the newest entry unless the user has scrolled up to read history.
  if (wasNearBottom || gameLog.length <= 1) el.scrollTop = el.scrollHeight;
}

function escapeLogHtml(str) {
  return String(str).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function clearGameLog() {
  gameLog = [];
  renderGameLog();
}

// Merge a log array received from realtime sync / loadGameState into the
// local view without dropping anything only known locally (e.g. an entry
// this browser just added that hasn't round-tripped through the DB yet).
function mergeRemoteLog(remoteLog) {
  if (!Array.isArray(remoteLog) || remoteLog.length === 0) return;
  const seen = new Set(gameLog.map(e => e.id));
  let changed = false;
  for (const e of remoteLog) {
    if (!seen.has(e.id)) { gameLog.push(e); seen.add(e.id); changed = true; }
  }
  if (changed) {
    gameLog.sort((a, b) => a.ts - b.ts);
    if (gameLog.length > GAME_LOG_MAX) gameLog = gameLog.slice(-GAME_LOG_MAX);
    renderGameLog();
  }
}
