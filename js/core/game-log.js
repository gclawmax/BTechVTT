// ── GAME LOG ──────────────────────────────────────────────
// A running history of what happened this game. It is persisted in the
// dedicated btech_events table, never inside the mutable game-state snapshot.
let gameLog = [];
const GAME_LOG_MAX = 200;
// Unique per browser tab so ids never collide with another player's client.
const LOG_CLIENT_ID = Math.random().toString(36).slice(2, 8);
let _logSeq = 0;
let gameLogFilter = 'all';
let gameToastTimer = null;

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
function logEvent(message, category, team = null) {
  category = category || 'info';
  const entry = {
    id: `${LOG_CLIENT_ID}-${++_logSeq}`,
    ts: Date.now(),
    time: _logTimeLabel(),
    round: currentGameState ? currentGameState.round : null,
    phase: currentGameState ? currentGameState.phase : null,
    cat: category,
    msg: message,
    ...(team === 1 || team === 2 ? { team } : {})
  };
  gameLog.push(entry);
  if (gameLog.length > GAME_LOG_MAX) gameLog = gameLog.slice(-GAME_LOG_MAX);
  renderGameLog();

  // A brief, local acknowledgement makes successful actions feel responsive
  // without duplicating the durable, shared game log.
  if (['move', 'attack'].includes(category)) showGameToast(message);

  // Debug console mirror — same info, easier to grep/copy when troubleshooting.
  const tag = `[BT-LOG][R${entry.round ?? '?'}/${entry.phase ?? '?'}][${category}]`;
  if (category === 'error') console.error(tag, message);
  else console.log(tag, message);

  if (currentGameId) persistLogEntry(entry);
}

// Append safely through a server function. This has no interaction with the
// game-state write queue, so a log line cannot overwrite a turn update.
async function persistLogEntry(entry) {
  try {
    const { error } = await db.rpc('append_game_log', { p_game_id: currentGameId, p_entry: entry });
    if (error) throw error;
  } catch (err) {
    // Don't recurse into logEvent here — would loop on persistent failures.
    console.warn('[BT-LOG] failed to persist log entry:', err);
  }
}

async function loadPersistentGameLog() {
  if (!currentGameId) return;
  const { data, error } = await db.from('btech_events')
    .select('event,created_at').eq('game_id', currentGameId)
    .order('created_at', { ascending: true }).limit(GAME_LOG_MAX);
  if (error) { console.warn('[BT-LOG] failed to load persistent log:', error); return; }
  mergeRemoteLog((data || []).map(row => row.event));
}

function subscribePersistentGameLog() {
  if (gameLogSubscription) { gameLogSubscription.unsubscribe(); gameLogSubscription = null; }
  if (!currentGameId) return;
  gameLogSubscription = db.channel('btech_events:' + currentGameId)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'btech_events', filter: `game_id=eq.${currentGameId}` },
      payload => mergeRemoteLog([payload.new.event]))
    .subscribe();
}

function renderGameLog() {
  const el = document.getElementById('game-log');
  if (!el) return;
  const wasNearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 12;
  const visibleEntries = gameLog.filter(e => gameLogFilter === 'all' || e.cat === gameLogFilter);
  el.innerHTML = visibleEntries.map(e =>
    `<div class="log-entry cat-${e.cat} ${logTeamClass(e)}"><span class="log-tag">[${e.time}] R${e.round ?? '?'}/${(e.phase || '?').slice(0,4)}</span><span class="log-message">${escapeLogHtml(e.msg)}</span></div>`
  ).join('') || '<div class="log-entry cat-system">No matching log entries.</div>';
  // Autoscroll to the newest entry unless the user has scrolled up to read history.
  if (wasNearBottom || gameLog.length <= 1) el.scrollTop = el.scrollHeight;
}

function setGameLogFilter(filter) {
  gameLogFilter = ['all', 'move', 'attack', 'roll'].includes(filter) ? filter : 'all';
  document.querySelectorAll('[data-log-filter]').forEach(button => {
    button.classList.toggle('active-filter', button.dataset.logFilter === gameLogFilter);
  });
  renderGameLog();
}

function showGameToast(message, type = 'success') {
  const toast = document.getElementById('game-toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.toggle('error', type === 'error');
  toast.classList.add('show');
  clearTimeout(gameToastTimer);
  gameToastTimer = setTimeout(() => toast.classList.remove('show'), 4200);
}

// Most combat and action messages carry their acting side in the standard
// P1/P2 label. Derive only presentation metadata here: the saved text stays
// unchanged and remains readable in exports or the browser console.
function logTeamClass(entry) {
  if (entry?.team === 1) return 'team-p1';
  if (entry?.team === 2) return 'team-p2';
  const message = String(entry?.msg || '');
  if (/\(P1\)|\bPlayer 1\b|\bP1=/.test(message)) return 'team-p1';
  if (/\(P2\)|\(AI\)|\bPlayer 2\b|\bP2=/.test(message)) return 'team-p2';
  return 'team-neutral';
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
