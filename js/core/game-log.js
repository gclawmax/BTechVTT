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
let gameLogUnreadCount = 0;

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
function logEvent(message, category, team = null, metadata = null) {
  category = category || 'info';
  const entry = {
    id: `${LOG_CLIENT_ID}-${++_logSeq}`,
    ts: Date.now(),
    time: _logTimeLabel(),
    round: currentGameState ? currentGameState.round : null,
    phase: currentGameState ? currentGameState.phase : null,
    cat: category,
    msg: message,
    ...(team === 1 || team === 2 ? { team } : {}),
    ...(metadata?.kind ? { kind: metadata.kind } : {})
  };
  gameLog.push(entry);
  if (gameLog.length > GAME_LOG_MAX) gameLog = gameLog.slice(-GAME_LOG_MAX);
  renderGameLog({ incoming: true });

  // A brief, local acknowledgement makes successful actions feel responsive
  // without duplicating the durable, shared game log.
  if (['move', 'attack'].includes(category) && entry.kind !== 'weapon-header') showGameToast(message);

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
    .order('created_at', { ascending: false }).limit(GAME_LOG_MAX);
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

function formatVisibleLogMessage(message) {
  let text = String(message);
  const state = typeof currentGameState !== 'undefined' ? currentGameState : null;
  text = text.replace(/\b(?:P|Player )(1|2)\b/g, (label, seat) => {
    const avatar = typeof skirmishAvatarForSeat === 'function' ? skirmishAvatarForSeat(state, Number(seat)) : null;
    return avatar?.callsign || label;
  });
  return escapeLogHtml(text);
}

function logEntrySeat(entry) {
  if (entry?.team === 1 || entry?.team === 2) return Number(entry.team);
  const message = String(entry?.msg || '');
  if (/\(P1\)|\bPlayer 1\b|\bP1\s*=/.test(message)) return 1;
  if (/\(P2\)|\(AI\)|\bPlayer 2\b|\bP2\s*=/.test(message)) return 2;
  return null;
}

function logEntryMatchesFilter(entry) {
  if (gameLogFilter === 'all') return true;
  if (['move', 'attack', 'roll'].includes(gameLogFilter)) return entry.cat === gameLogFilter;
  if (gameLogFilter === 'notice') return ['error', 'phase', 'system'].includes(entry.cat);
  const seat = logEntrySeat(entry);
  if (gameLogFilter === 'mine') return seat != null && Number(seat) === Number(mySeatNumber);
  if (gameLogFilter === 'enemy') return seat != null && Number(seat) !== Number(mySeatNumber);
  return true;
}

function logPhaseLabel(entry) {
  const label = typeof PHASE_LABELS !== 'undefined' ? PHASE_LABELS?.[entry.phase] : null;
  return label || String(entry.phase || 'Unknown phase').replace(/_/g, ' ');
}

function logActionSummary(entry) {
  const message = String(entry?.msg || '').replace(/\s+/g, ' ').trim();
  if (entry.kind === 'weapon-header' || (!message.match(/\b(?:rolled|need)\b/i) && entry.cat !== 'roll')) return { summary: message, detail: null };
  const detailAt = message.search(/\s*(?:—\s*)?(?:need|rolled)\b/i);
  let summary = detailAt > 0 ? message.slice(0, detailAt).replace(/[,:;\s]+$/, '') : message;
  const outcomes = [...message.matchAll(/\b(miss|hit|success|failure|passed|failed)\b/gi)];
  const outcome = outcomes.length ? outcomes[outcomes.length - 1][1].toUpperCase() : '';
  if (outcome && !new RegExp(`\\b${outcome}\\b`, 'i').test(summary)) summary += ` — ${outcome}`;
  return { summary: summary || message, detail: message };
}

function formatLogMessageWithMechLinks(message) {
  let html = formatVisibleLogMessage(message);
  const units = (typeof mechInstances === 'undefined' ? [] : mechInstances)
    .map(mech => ({ id: mech.instanceId, label: escapeLogHtml(mechLabel(mech)) }))
    .filter(unit => unit.id && unit.label && html.includes(unit.label))
    .sort((a, b) => b.label.length - a.label.length);
  // Replace labels with temporary tokens first. A chassis name can be a
  // substring of another unit's label, so direct replacement could nest links.
  const links = [];
  for (const unit of units) {
    const token = `@@BTLOGMECH${links.length}@@`;
    const link = `<button type="button" class="log-mech-link" data-log-instance-id="${escapeLogHtml(unit.id)}">${unit.label}</button>`;
    if (!html.includes(unit.label)) continue;
    html = html.split(unit.label).join(token);
    links.push({ token, link });
  }
  for (const { token, link } of links) html = html.split(token).join(link);
  return html;
}

function renderGameLog({ incoming = false } = {}) {
  const el = document.getElementById('game-log');
  if (!el) return;
  const wasNearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 12;
  const visibleEntries = gameLog.filter(logEntryMatchesFilter);
  let lastPhaseKey = null;
  const rows = [];
  for (const entry of visibleEntries) {
    const phaseKey = `${entry.round ?? '?'}:${entry.phase || '?'}`;
    if (phaseKey !== lastPhaseKey) {
      rows.push(`<div class="log-phase-divider"><span>Round ${entry.round ?? '?'}</span><span>${escapeLogHtml(logPhaseLabel(entry))}</span></div>`);
      lastPhaseKey = phaseKey;
    }
    const action = logActionSummary(entry);
    const classes = `log-entry cat-${entry.cat} ${logTeamClass(entry)}${entry.kind === 'weapon-header' ? ' combat-mech-header' : ''}`;
    const tag = `<span class="log-tag">${entry.time}</span>`;
    const summary = formatLogMessageWithMechLinks(action.summary);
    const content = action.detail
      ? `<details class="log-action-detail"><summary><span class="log-message">${summary}</span></summary><div class="log-detail-copy">${formatLogMessageWithMechLinks(action.detail)}</div></details>`
      : `<span class="log-message">${summary}</span>`;
    rows.push(`<div class="${classes}">${tag}${content}</div>`);
  }
  el.innerHTML = rows.join('') || '<div class="log-entry cat-system">No matching log entries.</div>';
  el.querySelectorAll('[data-log-instance-id]').forEach(button => button.addEventListener('click', () => {
    if (typeof selectInstance === 'function') selectInstance(button.dataset.logInstanceId);
  }));
  // Autoscroll to the newest entry unless the user has scrolled up to read history.
  if (wasNearBottom || gameLog.length <= 1 || !incoming) {
    el.scrollTop = el.scrollHeight;
    if (wasNearBottom) gameLogUnreadCount = 0;
  } else if (incoming) gameLogUnreadCount += 1;
  updateGameLogNewEventsButton();
}

function setGameLogFilter(filter) {
  gameLogFilter = ['all', 'mine', 'enemy', 'move', 'attack', 'roll', 'notice'].includes(filter) ? filter : 'all';
  document.querySelectorAll('[data-log-filter]').forEach(button => {
    button.classList.toggle('active-filter', button.dataset.logFilter === gameLogFilter);
  });
  renderGameLog();
}

function updateGameLogNewEventsButton() {
  const button = document.getElementById('game-log-new-events');
  if (!button) return;
  button.hidden = gameLogUnreadCount === 0;
  button.textContent = gameLogUnreadCount === 1 ? '1 new event' : `${gameLogUnreadCount} new events`;
}

function jumpToLatestGameLog() {
  const el = document.getElementById('game-log');
  if (el) el.scrollTop = el.scrollHeight;
  gameLogUnreadCount = 0;
  updateGameLogNewEventsButton();
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
  if (/\(P1\)|\bPlayer 1\b|\bP1\s*=/.test(message)) return 'team-p1';
  if (/\(P2\)|\(AI\)|\bPlayer 2\b|\bP2\s*=/.test(message)) return 'team-p2';
  return 'team-neutral';
}

function escapeLogHtml(str) {
  return String(str).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
}

function clearGameLog() {
  gameLog = [];
  gameLogUnreadCount = 0;
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
    renderGameLog({ incoming: true });
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const el = document.getElementById('game-log');
  if (!el) return;
  el.addEventListener('scroll', () => {
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 12 && gameLogUnreadCount) {
      gameLogUnreadCount = 0;
      updateGameLogNewEventsButton();
    }
  });
});
