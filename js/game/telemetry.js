// Shared server-sealed report. SQL 101 calculates; this code only presents.
let currentSealedMatchReport = null;
let sealedReportLoadGameId = null;
let victoryReportAutoOpenedGameId = null;

async function loadSealedMatchReport(force = false) {
  if (!currentGameId || !currentGameState?.match_result) { currentSealedMatchReport = null; sealedReportLoadGameId = null; return null; }
  if (!force && sealedReportLoadGameId === currentGameId && currentSealedMatchReport) return currentSealedMatchReport;
  const { data, error } = await db.rpc('get_btech_match_report', { p_game_id: currentGameId });
  if (error) { console.warn('Unable to load the sealed match telemetry report:', error); return null; }
  currentSealedMatchReport = data || null;
  sealedReportLoadGameId = currentGameId;
  if (currentSealedMatchReport?.report?.statistics && victoryReportAutoOpenedGameId !== currentGameId) {
    victoryReportAutoOpenedGameId = currentGameId;
    setTimeout(openVictoryReport, 0);
  }
  return currentSealedMatchReport;
}

function sealedTelemetryStatusText() {
  if (!currentGameState?.match_result) return '';
  if (!currentSealedMatchReport) return 'Final battle telemetry is being sealed…';
  const count = Number(currentSealedMatchReport.event_count || currentSealedMatchReport.report?.event_count || 0);
  return `Battle telemetry sealed · ${count} structured event${count === 1 ? '' : 's'} · ${currentSealedMatchReport.report?.statistics ? 'statistics ready' : currentSealedMatchReport.report_version}`;
}

const reportNum = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const reportPct = value => `${reportNum(value).toFixed(1).replace(/\.0$/, '')}%`;
function reportMechLabel(stat) {
  const live = (typeof mechInstances === 'undefined' ? [] : mechInstances).find(mech => mech.instanceId === stat?.instance_id);
  const unit = typeof displayUnitFor === 'function' ? displayUnitFor(stat?.unit_id || live?.unitId) : null;
  return `${unit && !unit.catalogueUnavailable ? `${unit.chassis} ${unit.variant}` : (stat?.unit_id || stat?.instance_id || 'Unknown BattleMech')}${stat?.seat ? ` (P${stat.seat})` : ''}`;
}
function reportOutcome(result) {
  const reason = String(result?.reason || '').toLowerCase();
  const label = reason.includes('breakthrough') ? 'Breakthrough' : (reason.includes('control') || reason.includes('objective')) ? 'Objective Control' : reason.includes('annihilation') || reason.includes('destroy') ? 'Annihilation' : 'Battle complete';
  return { title: result?.winner_seat == null ? 'Draw' : `Player ${result.winner_seat} Victory`, label };
}
function reportExpectation(player) {
  const delta = reportNum(player?.expectation_delta), samples = reportNum(player?.qualified_rolls);
  if (!samples) return 'No qualifying attack rolls';
  if (Math.abs(delta) < .5) return `Close to expectation (${delta >= 0 ? '+' : ''}${delta.toFixed(2)} hits)`;
  return `${Math.abs(delta).toFixed(2)} hits ${delta > 0 ? 'above' : 'below'} expectation`;
}
function reportPlayerCard(seat, player = {}) {
  return `<article class="victory-player-card team-${seat}"><h3>Player ${seat}</h3><div class="victory-stat-grid">
    <span><b>${reportNum(player.damage)}</b> damage</span><span><b>${reportNum(player.hits)} / ${reportNum(player.shots)}</b> attacks hit</span>
    <span><b>${reportPct(player.accuracy)}</b> accuracy</span><span><b>${reportNum(player.criticals)}</b> critical hits</span>
    <span><b>${reportNum(player.kills)}</b> kills</span><span><b>${reportNum(player.survivors)}</b> survivors</span>
    <span><b>${reportNum(player.average_heat).toFixed(1)}</b> average Heat Level</span><span><b>${reportNum(player.peak_heat)}</b> peak Heat Level</span>
  </div><p class="victory-expectation">${escapeHtml(reportExpectation(player))}</p></article>`;
}
function reportDice(distribution = {}) {
  const totals = Array.from({ length: 11 }, (_, index) => index + 2), max = Math.max(1, ...totals.map(total => reportNum(distribution[total]?.total)));
  return `<div class="dice-chart" role="img" aria-label="Distribution of all recorded two-dice totals">${totals.map(total => { const p1 = reportNum(distribution[total]?.['1']), p2 = reportNum(distribution[total]?.['2']), all = reportNum(distribution[total]?.total); return `<div class="dice-column" title="${total}: Player 1 ${p1}, Player 2 ${p2}, total ${all}"><div class="dice-bars"><i class="p1" style="height:${p1 / max * 100}%"></i><i class="p2" style="height:${p2 / max * 100}%"></i></div><b>${total}</b><small>${all}</small></div>`; }).join('')}</div><div class="dice-legend"><span class="p1">Player 1</span><span class="p2">Player 2</span><span>Number = all rolls</span></div>`;
}
function reportStandouts(standouts = {}) {
  const shot = standouts.longest_successful_shot, mech = standouts.highest_damage_mech, weapon = standouts.highest_damage_weapon;
  return `<div class="victory-standouts"><article><span>Longest successful shot</span><b>${shot ? `${reportNum(shot.distance)} hexes` : '—'}</b><small>${shot ? `${escapeHtml(shot.weapon || 'Attack')} · ${escapeHtml(reportMechLabel(shot))}` : 'No successful shot'}</small></article><article><span>Highest damage BattleMech</span><b>${mech ? reportNum(mech.damage) : '—'}</b><small>${mech ? escapeHtml(reportMechLabel(mech)) : 'No damage recorded'}</small></article><article><span>Highest damage weapon</span><b>${weapon ? reportNum(weapon.damage) : '—'}</b><small>${weapon ? `${escapeHtml(weapon.weapon || 'Attack')} · Player ${reportNum(weapon.seat)}` : 'No damage recorded'}</small></article></div>`;
}
function reportMechTable(mechs = {}) {
  const rows = Object.values(mechs).sort((a, b) => reportNum(b.damage) - reportNum(a.damage));
  return rows.length ? `<div class="victory-table-wrap"><table class="victory-table"><thead><tr><th>BattleMech</th><th>Hit / fired</th><th>Damage</th><th>Criticals</th><th>Avg / peak heat</th><th>Status</th></tr></thead><tbody>${rows.map(stat => `<tr><td>${escapeHtml(reportMechLabel(stat))}</td><td>${reportNum(stat.hits)} / ${reportNum(stat.shots)}</td><td>${reportNum(stat.damage)}</td><td>${reportNum(stat.criticals)}</td><td>${reportNum(stat.average_heat).toFixed(1)} / ${reportNum(stat.peak_heat)}</td><td>${stat.destroyed ? 'Destroyed' : 'Survived'}</td></tr>`).join('')}</tbody></table></div>` : '<p class="victory-empty">No BattleMech statistics were recorded.</p>';
}
function renderBattleReportLog(entries) {
  const container = document.getElementById('victory-report-log'); if (!container) return;
  container.innerHTML = entries.length ? entries.map(entry => `<div class="report-log-entry"><span>[${escapeHtml(entry.time || '')}] R${escapeHtml(entry.round ?? '?')}/${escapeHtml(String(entry.phase || '?').slice(0, 4))}</span>${escapeHtml(entry.msg || '')}</div>`).join('') : '<p class="victory-empty">No battle-log entries were saved.</p>';
}
async function loadBattleReportLog() {
  const all = [], pageSize = 1000;
  for (let from = 0; currentGameId; from += pageSize) {
    const { data, error } = await db.from('btech_events').select('event').eq('game_id', currentGameId).order('created_at', { ascending: true }).range(from, from + pageSize - 1);
    if (error) { console.warn('Unable to load complete battle log:', error); break; }
    all.push(...(data || []).map(row => row.event).filter(Boolean)); if ((data || []).length < pageSize) break;
  }
  renderBattleReportLog(all);
}
function reportMoney(value) { return `${Math.round(reportNum(value)).toLocaleString()} C-bills`; }
function renderCareerPreview(preview) {
  const container = document.getElementById('career-preview-content'); if (!container) return;
  if (!preview) { container.innerHTML = '<p class="victory-empty">Career preview is unavailable for this report.</p>'; return; }
  const summary = preview.summary || {}, wrecks = preview.recoverable_wrecks || [], units = preview.units || [];
  container.innerHTML = `<p class="career-preview-warning">${escapeHtml(preview.notice || 'Illustrative only — nothing is saved.')}</p><div class="career-preview-totals"><span><b>${reportMoney(summary.illustrative_repairs_c_bills)}</b> estimated repairs</span><span><b>${reportMoney(summary.illustrative_salvage_value)}</b> recoverable wreck value</span><span><b>${reportNum(summary.illustrative_pilot_xp)}</b> illustrative pilot XP</span></div><div class="victory-table-wrap"><table class="victory-table"><thead><tr><th>BattleMech</th><th>Armour / structure lost</th><th>Critical slots</th><th>Repair estimate</th><th>Pilot preview</th></tr></thead><tbody>${units.map(unit => `<tr><td>${escapeHtml(reportMechLabel(unit))}${unit.destroyed ? ' · wreck' : ''}</td><td>${reportNum(unit.armor_lost)} / ${reportNum(unit.structure_lost)}</td><td>${reportNum(unit.critical_slots_damaged)}</td><td>${reportMoney(unit.illustrative_repair_c_bills)}</td><td>${reportNum(unit.illustrative_pilot_xp)} XP · ${escapeHtml(unit.pilot?.consciousness || 'conscious')}</td></tr>`).join('')}</tbody></table></div>${wrecks.length ? `<p class="career-preview-wrecks"><b>Recoverable wrecks:</b> ${wrecks.map(wreck => `${escapeHtml(wreck.unit_id)} (${reportMoney(wreck.illustrative_recovery_value)})`).join(' · ')}</p>` : '<p class="career-preview-wrecks">No destroyed BattleMechs to assess for salvage.</p>'}`;
}
async function loadCareerPreview() {
  const container = document.getElementById('career-preview-content'); if (!container || !currentGameId) return;
  const { data, error } = await db.rpc('get_btech_skirmish_career_preview', { p_game_id: currentGameId });
  if (error) { console.warn('Unable to load skirmish Career preview:', error); container.innerHTML = '<p class="victory-empty">Career preview unavailable until SQL 103 is applied.</p>'; return; }
  renderCareerPreview(data);
}
function downloadBattleJson(fileName, payload) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = fileName; document.body.appendChild(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function exportBattleArtifact(kind) {
  if (!currentGameId) return;
  const rpc = kind === 'replay' ? 'get_btech_match_replay_export' : 'get_btech_match_report_export';
  const { data, error } = await db.rpc(rpc, { p_game_id: currentGameId });
  if (error || !data) { showGameToast(`Could not export ${kind === 'replay' ? 'battle replay' : 'battle report'}.`, 'error'); return; }
  const stamp = String(data.completed_at || new Date().toISOString()).slice(0, 10);
  downloadBattleJson(`btvtt-${kind}-${stamp}.${kind === 'replay' ? 'btvtt-replay' : 'btvtt-report'}.json`, data);
  showGameToast(`${kind === 'replay' ? 'Battle replay' : 'Battle report'} downloaded.`);
}
function exportBattleReport() { return exportBattleArtifact('report'); }
function exportBattleReplay() { return exportBattleArtifact('replay'); }
function renderVictoryReport() {
  const content = document.getElementById('victory-report-content'), report = currentSealedMatchReport?.report || {}, stats = report.statistics, result = report.result || currentSealedMatchReport?.result || currentGameState?.match_result || {};
  if (!content) return;
  if (!stats) { content.innerHTML = `<div class="victory-report-loading"><b>${escapeHtml(reportOutcome(result).title)}</b><p>Statistics are not ready. Apply SQL 101, then reload the completed match.</p></div>`; return; }
  const outcome = reportOutcome(result), players = stats.players || {}, scores = stats.objective_scores || {}, score = reportNum(scores['1']) || reportNum(scores['2']) ? ` · Objectives P1 ${reportNum(scores['1'])} — P2 ${reportNum(scores['2'])}` : '';
  content.innerHTML = `<section class="victory-result-banner"><span>${escapeHtml(outcome.label)}</span><h3>${escapeHtml(outcome.title)}</h3><p>${reportNum(stats.rounds)} rounds${score}</p><div class="victory-export-actions"><button onclick="exportBattleReport()">Download Battle Report</button><button onclick="exportBattleReplay()">Download Battle Replay</button></div></section><section class="victory-section"><h3>Force summaries</h3><div class="victory-player-grid">${reportPlayerCard(1, players['1'])}${reportPlayerCard(2, players['2'])}</div></section><section class="victory-section"><h3>Battle standouts</h3>${reportStandouts(stats.standouts)}</section><section class="victory-section"><h3>2D6 distribution</h3><p class="victory-note">All recorded two-dice outcomes are shown. Expectation compares successful attack rolls with their exact target-number probabilities, not raw roll average.</p>${reportDice(stats.dice?.distribution)}</section><section class="victory-section"><h3>BattleMech performance</h3>${reportMechTable(stats.mechs)}</section><section class="victory-section career-preview"><h3>Career Preview <small>Skirmish only — not saved</small></h3><div id="career-preview-content"><p class="victory-empty">Preparing illustrative repairs, salvage and pilot advancement…</p></div></section><details class="victory-log-details"><summary>Complete battle log</summary><div id="victory-report-log" class="victory-report-log"><p class="victory-empty">Loading saved battle log…</p></div></details><p class="victory-retention-note">Completed skirmishes are retained online for 30 days. Download the report or replay if you want to keep it permanently. Skirmish outcomes do not change Career records.</p>`;
}
function openVictoryReport() { const overlay = document.getElementById('victory-report-overlay'); if (!overlay || !currentGameState?.match_result) return; renderVictoryReport(); overlay.hidden = false; document.body.classList.add('victory-report-open'); overlay.querySelector('.victory-report-close')?.focus(); loadBattleReportLog(); loadCareerPreview(); }
function closeVictoryReport() { document.getElementById('victory-report-overlay').hidden = true; document.body.classList.remove('victory-report-open'); }
document.addEventListener('keydown', event => { if (event.key === 'Escape' && !document.getElementById('victory-report-overlay')?.hidden) closeVictoryReport(); });
