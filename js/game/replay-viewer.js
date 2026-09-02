// Offline reader for the sealed btvtt-replay-1 export. It never writes to the
// server or re-resolves combat: the exported authoritative timeline is the source.
let replayViewerData = null;
let replayViewerIndex = 0;
let replayViewerTimer = null;

const replayEscape = value => typeof escapeHtml === 'function' ? escapeHtml(value) : String(value ?? '');
const replayNumber = value => Number.isFinite(Number(value)) ? Number(value) : 0;

function openReplayViewer() {
  stopReplayPlayback(); replayViewerData = null; replayViewerIndex = 0;
  showScreen('replay-viewer-screen'); renderReplayViewer();
}
function closeReplayViewer() { stopReplayPlayback(); showScreen('menu-screen'); }
function replayFormatDate(value) { const date = new Date(value); return Number.isNaN(date.getTime()) ? 'Unknown date' : date.toLocaleString(); }
function replayUnitName(unit = {}) { return unit.unitId || unit.unit_id || unit.instanceId || unit.instance_id || 'Unknown BattleMech'; }
function replayEventTitle(event = {}) {
  const type = String(event.event_type || 'event').replaceAll('_', ' ');
  const actor = event.actor_instance_id ? ` · ${event.actor_instance_id}` : '';
  return `${type}${actor}`;
}
function replayEventDetail(event = {}) {
  const payload = event.payload || {};
  if (event.event_type === 'phase_transition') return `Phase: ${payload.from?.phase || '?'} → ${payload.to?.phase || event.phase || '?'}.`;
  if (event.event_type === 'initiative_updated') return (payload.rolls || []).map(roll => `Player ${roll.seat_number || '?'} rolled ${roll.die_a} + ${roll.die_b} = ${roll.roll ?? (replayNumber(roll.die_a) + replayNumber(roll.die_b))}`).join('\n') || 'Initiative updated.';
  if (event.event_type === 'unit_state_changed') return `State update: ${(payload.change_kinds || []).map(value => String(value).replaceAll('_', ' ')).join(', ') || 'unit state'}.`;
  if (/resolved|amended/.test(event.event_type || '')) {
    const results = payload.resolution?.results || [];
    if (results.length) return results.map(result => `${result.weapon || result.physical_weapon || result.attack_type || 'Attack'}: ${result.hit ? 'hit' : 'miss'}${result.damage != null ? ` · ${result.damage} damage` : ''}${result.target_instance_id ? ` → ${result.target_instance_id}` : ''}`).join('\n');
    return 'Combat resolution recorded.';
  }
  if (event.event_type === 'match_completed') return `Match complete. ${payload.result?.reason || ''}`.trim();
  return payload.reason || payload.note || 'Authoritative event recorded.';
}
function replayDiceDetail(event = {}) {
  const dice = event.payload?.rolls || event.payload?.dice || [];
  const lines = dice.filter(roll => Array.isArray(roll.dice) && roll.dice.length === 2).map(roll => `${roll.dice[0]} + ${roll.dice[1]} = ${roll.total ?? (replayNumber(roll.dice[0]) + replayNumber(roll.dice[1]))}${roll.target_number != null ? ` (need ${roll.target_number})` : ''}`);
  return lines.join(' · ');
}
function replayStateAt(index) {
  const replay = replayViewerData || {};
  let state;
  try { state = JSON.parse(JSON.stringify(replay.initial_state || {})); } catch (_) { state = {}; }
  state.mech_instances = Array.isArray(state.mech_instances) ? state.mech_instances : [];
  const find = id => state.mech_instances.find(unit => unit.instanceId === id || unit.instance_id === id);
  (replay.events || []).slice(0, index + 1).forEach(event => {
    const payload = event.payload || {};
    if (payload.snapshot?.mech_instances) state = JSON.parse(JSON.stringify(payload.snapshot));
    if (event.event_type === 'unit_state_changed' && event.actor_instance_id && payload.after) {
      const unit = find(event.actor_instance_id);
      if (unit) Object.assign(unit, payload.after); else state.mech_instances.push(payload.after);
    }
  });
  return state;
}
function renderReplayUnits(state) {
  const units = state.mech_instances || [];
  if (!units.length) return '<p class="victory-empty">No unit snapshot is available for this event.</p>';
  return units.map(unit => `<article class="replay-unit-card${unit.destroyed ? ' destroyed' : ''}"><b>${replayEscape(replayUnitName(unit))}${unit.owner ? ` · P${replayEscape(unit.owner)}` : ''}</b><span>Hex ${String(unit.col ?? '?').padStart(2, '0')}${String(unit.row ?? '?').padStart(2, '0')} · facing ${replayEscape(unit.facing || '?')} · Heat ${replayNumber(unit.heat)}${unit.destroyed ? ' · destroyed' : ''}</span></article>`).join('');
}
function renderReplayViewer() {
  const root = document.getElementById('replay-viewer-root'); if (!root) return;
  const replay = replayViewerData;
  if (!replay) {
    root.innerHTML = `<main class="replay-viewer-shell"><header class="replay-viewer-header"><div><h2>Battle Replay Viewer</h2><p>Import a downloaded replay to review its sealed, authoritative event timeline. Replays stay in this browser and never modify the original match.</p></div><button class="secondary" onclick="closeReplayViewer()">Back to Dropship</button></header><section class="replay-import-card"><h3>Import Battle Replay</h3><p>Choose a <code>.btvtt-replay.json</code> file downloaded from a completed battle’s report. The viewer supports the current <code>btvtt-replay-1</code> format.</p><label class="replay-import-label">Choose Replay File<input type="file" accept="application/json,.json,.btvtt-replay" onchange="importBattleReplay(this.files[0])"></label><div id="replay-import-error" class="replay-import-error" role="status"></div></section></main>`;
    return;
  }
  const events = replay.events || [], event = events[replayViewerIndex] || null, state = replayStateAt(replayViewerIndex), stats = replay.report?.statistics || {};
  const result = replay.report?.result || replay.final_state?.match_result || {};
  const outcome = typeof reportOutcome === 'function' ? reportOutcome(result).title : (result.winner_seat ? `Player ${result.winner_seat} Victory` : 'Battle Complete');
  const rounds = stats.rounds || replay.final_state?.round || '—';
  root.innerHTML = `<main class="replay-viewer-shell"><header class="replay-viewer-header"><div><h2>Battle Replay Viewer</h2><p>${replayEscape(outcome)} · exported ${replayEscape(replayFormatDate(replay.exported_at))} · catalogue ${replayEscape(replay.catalogue_version || 'not recorded')}</p></div><button class="secondary" onclick="closeReplayViewer()">Back to Dropship</button></header><section class="replay-overview"><article><span>Outcome</span><b>${replayEscape(outcome)}</b><small>${replayEscape(result.reason || 'Sealed result')}</small></article><article><span>Battle length</span><b>${replayEscape(rounds)} rounds</b><small>${events.length} recorded events</small></article><article><span>Current event</span><b>${event ? `${replayViewerIndex + 1} / ${events.length}` : 'No events'}</b><small>${event ? `Round ${event.round} · ${event.phase}` : ''}</small></article><article><span>Playback</span><b id="replay-playback-state">${replayViewerTimer ? 'Playing' : 'Paused'}</b><small>Local viewing only</small></article></section><section class="replay-layout"><aside class="replay-panel"><h3>Event timeline</h3><div class="replay-event-list">${events.map((entry, index) => `<button class="replay-event${index === replayViewerIndex ? ' active' : ''}" onclick="selectReplayEvent(${index})"><span>#${replayEscape(entry.event_index ?? index + 1)} · R${replayEscape(entry.round ?? '?')} / ${replayEscape(entry.phase || '?')}</span><b>${replayEscape(replayEventTitle(entry))}</b></button>`).join('') || '<p class="victory-empty">This replay has no events.</p>'}</div></aside><section class="replay-panel"><h3>Event inspector</h3><div class="replay-controls"><button onclick="selectReplayEvent(0)">First</button><button onclick="stepReplay(-1)">Previous</button><button class="primary" onclick="toggleReplayPlayback()">${replayViewerTimer ? 'Pause' : 'Play'}</button><button onclick="stepReplay(1)">Next</button><button onclick="selectReplayEvent(${Math.max(0, events.length - 1)})">Last</button><select id="replay-speed" onchange="restartReplayPlayback()" aria-label="Replay speed"><option value="1600">Slow</option><option value="850" selected>Standard</option><option value="350">Fast</option></select></div>${event ? `<div class="replay-current"><div class="replay-kicker">Event #${replayEscape(event.event_index ?? replayViewerIndex + 1)} · Round ${replayEscape(event.round)} · ${replayEscape(event.phase)}</div><h4>${replayEscape(replayEventTitle(event))}</h4><p>${replayEscape(replayEventDetail(event))}</p>${replayDiceDetail(event) ? `<p class="replay-dice">Dice: ${replayEscape(replayDiceDetail(event))}</p>` : ''}</div>` : '<div class="replay-current"><p>No event selected.</p></div>'}<div class="replay-unit-state">${renderReplayUnits(state)}</div></section></section><details class="replay-report-summary"><summary>After-action report summary</summary><div>${stats.players && typeof reportPlayerCard === 'function' ? `<div class="victory-player-grid">${reportPlayerCard(1, stats.players['1'])}${reportPlayerCard(2, stats.players['2'])}</div><section class="victory-section"><h3>Battle standouts</h3>${reportStandouts(stats.standouts)}</section>` : '<p class="victory-empty">This replay does not include the newer statistics summary.</p>'}</div></details></main>`;
  root.querySelector('.replay-event.active')?.scrollIntoView({ block: 'nearest' });
}
async function importBattleReplay(file) {
  if (!file) return;
  const error = document.getElementById('replay-import-error');
  try {
    const parsed = JSON.parse(await file.text());
    if (parsed?.format !== 'btvtt-replay-1' || !Array.isArray(parsed.events) || !parsed.initial_state || !parsed.final_state) throw new Error('This is not a supported BT-VTT battle replay export.');
    stopReplayPlayback(); replayViewerData = parsed; replayViewerIndex = 0; renderReplayViewer();
  } catch (reason) { if (error) error.textContent = `Import failed: ${reason.message || 'invalid replay file'}`; }
}
function selectReplayEvent(index) { const events = replayViewerData?.events || []; replayViewerIndex = Math.max(0, Math.min(events.length - 1, Number(index) || 0)); renderReplayViewer(); }
function stepReplay(delta) { if (!replayViewerData) return; const events = replayViewerData.events || []; const next = replayViewerIndex + Number(delta || 0); if (next < 0 || next >= events.length) { stopReplayPlayback(); renderReplayViewer(); return; } selectReplayEvent(next); }
function stopReplayPlayback() { if (replayViewerTimer) clearInterval(replayViewerTimer); replayViewerTimer = null; }
function toggleReplayPlayback() { if (replayViewerTimer) { stopReplayPlayback(); renderReplayViewer(); return; } const speed = Number(document.getElementById('replay-speed')?.value || 850); replayViewerTimer = setInterval(() => stepReplay(1), speed); renderReplayViewer(); }
function restartReplayPlayback() { if (!replayViewerTimer) return; stopReplayPlayback(); toggleReplayPlayback(); }
