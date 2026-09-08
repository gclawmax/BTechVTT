// Career-1c Company HQ: persistent condition and server-authoritative service.

function careerEscape(value) {
  return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
}

function careerCredits(value) { return `${Number(value || 0).toLocaleString()} credits`; }

function careerUnitLabel(mech) {
  const unit = typeof getSupportedUnit === 'function' ? getSupportedUnit(mech?.unit_id) : null;
  return unit ? `${unit.chassis} ${unit.variant}` : String(mech?.unit_id || 'Unknown BattleMech');
}

function careerContractTerms(contract) {
  const terms = contract?.terms || {}, reward = Number(terms.base_pay || 0) + Number(terms.success_bonus || 0);
  return `${String(terms.map_id || 'training-grounds').replaceAll('-', ' ')} · up to ${careerCredits(reward)} · +${Number(terms.reputation || 0)} reputation`;
}

function careerServiceSummary(mech, activeMatch) {
  const quote = mech?.service_quote;
  if (!quote) return '<small>Repair Bay is unavailable until Career-1c is installed.</small>';
  if (!quote.serviceable) return '<small class="career-hq-wreck">Recoverable wreck — replacement or salvage arrives in Career-2.</small>';
  const repair = quote.repair || {}, reload = quote.reload || {};
  const repairCost = Number(repair.total || 0), reloadCost = Number(reload.total || 0);
  const repairDetail = `${Number(repair.armor_points || 0)} armour · ${Number(repair.structure_points || 0)} structure · ${Number(repair.critical_slots || 0)} critical`;
  const reloadDetail = `${Number(reload.rounds || 0)} rounds across ${Number(reload.bins || 0)} bin${Number(reload.bins || 0) === 1 ? '' : 's'}`;
  const unavailable = activeMatch ? '<small>Service is unavailable during an active contract.</small>' : '';
  return `<div class="career-hq-service"><small><b>Repair:</b> ${repairDetail} · ${careerCredits(repairCost)}</small>${repairCost > 0 && !activeMatch ? `<button class="secondary" data-career-service onclick="confirmCareerService('${careerEscape(mech.id)}','repair',${repairCost})">Repair BattleMech</button>` : ''}<small><b>Reload:</b> ${reloadDetail} · ${careerCredits(reloadCost)}</small>${reloadCost > 0 && !activeMatch ? `<button class="secondary" data-career-service onclick="confirmCareerService('${careerEscape(mech.id)}','reload',${reloadCost})">Reload Ammunition</button>` : ''}${!repairCost && !reloadCost ? '<small class="career-hq-ready">Fully serviced.</small>' : ''}${unavailable}</div>`;
}

async function confirmCareerService(mechId, service, quotedCost) {
  const title = service === 'repair' ? 'repair this BattleMech' : 'reload its ammunition';
  if (!window.confirm(`Spend up to ${careerCredits(quotedCost)} to ${title}? The Repair Bay will calculate the final authoritative cost.`)) return;
  const root = document.getElementById('career-hq-box');
  root?.querySelectorAll('[data-career-service]').forEach(button => { button.disabled = true; });
  const { data, error } = await db.rpc('confirm_btech_career_service', { p_mech_id:mechId, p_service:service });
  if (error) {
    showGameToast(`Repair Bay could not complete service: ${error.message || 'please try again.'}`, 'error');
    root?.querySelectorAll('[data-career-service]').forEach(button => { button.disabled = false; });
    return;
  }
  showGameToast(`${service === 'repair' ? 'Repairs' : 'Reload'} complete: ${careerCredits(data?.charged || 0)} spent.`, 'success');
  await openCareerHQ();
}

async function getActiveCareerMatch() {
  const { data, error } = await db
    .from('btech_players')
    .select('seat_number,btech_games!btech_players_game_id_fkey(id,game_code,status,current_round,current_phase,match_type,state)')
    .eq('user_id', currentUser.id);
  if (error) {
    console.warn('Unable to find an active Career contract:', error);
    return null;
  }
  const active = (data || [])
    .map(entry => ({ ...(entry.btech_games || {}), seat_number: Number(entry.seat_number) }))
    .find(game => game.match_type === 'career' && game.status === 'in-progress');
  if (!active) return null;
  let state = {};
  try { state = typeof active.state === 'string' ? JSON.parse(active.state) : (active.state || {}); } catch (_) { /* malformed legacy snapshot */ }
  return {
    gameId: active.id,
    gameCode: active.game_code,
    round: Number(active.current_round || 1),
    phase: active.current_phase || 'initiative',
    contractId: state.career_context?.contract_id || null
  };
}

function resumeCareerContract(gameCode) {
  if (!gameCode) return;
  handleRejoinGame(gameCode);
}

async function launchCareerContract(contractId) {
  const root = document.getElementById('career-hq-box');
  root?.querySelectorAll('[data-career-contract]').forEach(button => { button.disabled = true; });
  const { data, error } = await db.rpc('launch_btech_career_contract', { p_contract_id:contractId });
  if (error || !data?.game_id) {
    root?.querySelectorAll('[data-career-contract]').forEach(button => { button.disabled = false; });
    showGameToast(`Career contract could not launch: ${error?.message || 'please try again.'}`, 'error');
    return;
  }
  currentGameId = data.game_id; currentGameCode = data.game_code;
  isHost = true; isReady = true; vsAiMode = true; mySeatNumber = 1;
  showGameToast('Career contract launched. Persistent BattleMechs are committed to this battle.', 'success');
  await startGameScreen();
}

async function settleCareerMatchIfNeeded() {
  if (!currentGameId || !currentMatchConfig?.career_context?.contract_id) return null;
  const { data, error } = await db.rpc('settle_btech_career_contract', { p_game_id:currentGameId });
  if (error) { logEvent?.(`Career settlement is waiting: ${error.message}`, 'error'); return null; }
  if (data) logEvent?.(`Career contract settled: ${careerCredits(data.reward)} and +${data.reputation_delta || 0} reputation.`, 'phase');
  return data;
}

async function openCareerHQ() {
  if (!currentUser) return;
  const root = document.getElementById('career-hq-box');
  if (root) root.innerHTML = '<p class="career-hq-loading">Opening Company HQ…</p>';
  showScreen('career-hq-screen');
  const { data, error } = await db.rpc('get_btech_career_hq');
  if (error) {
    // A new account has no company yet; the commander form is the deliberate
    // one-way onboarding step rather than silently creating persistent data.
    if (/function|get_btech_career_hq|does not exist/i.test(error.message || '')) {
      root.innerHTML = '<p class="career-hq-error">Career-1a needs its database migration before Company HQ can open.</p><button class="secondary" onclick="showScreen(\'menu-screen\')">Back to Dropship</button>';
      return;
    }
    openCareerAvatarCreator();
    return;
  }
  if (!data?.company) { openCareerAvatarCreator(); return; }
  data.activeMatch = await getActiveCareerMatch();
  renderCareerHQ(data);
}

function renderCareerHQ(hq) {
  const root = document.getElementById('career-hq-box');
  if (!root) return;
  const company = hq.company, pilots = hq.pilots || [], pilotsById = new Map(pilots.map(pilot => [pilot.id, pilot]));
  const activeMatch = hq.activeMatch || null;
  const mechs = (hq.mechs || []).map(mech => {
    const pilot = pilotsById.get(mech.pilot_id);
    const damage = mech.status === 'operational' ? 'Operational' : careerEscape(mech.status.replaceAll('_',' '));
    return `<article class="career-hq-card"><strong>${careerEscape(careerUnitLabel(mech))}</strong><span>${careerEscape(mech.callsign)} · ${damage}</span><small>${pilot ? `${careerEscape(pilot.name)} · G${pilot.gunnery}/P${pilot.piloting}` : 'No pilot assigned'} · ${mech.catalogue_version}</small>${careerServiceSummary(mech, activeMatch)}</article>`;
  }).join('') || '<p>No persistent BattleMechs yet.</p>';
  const pilotRows = pilots.map(pilot => `<tr><td>${careerEscape(pilot.name)}</td><td>G${pilot.gunnery} / P${pilot.piloting}</td><td>${careerEscape(pilot.specialty)}</td><td>${careerEscape(pilot.status)}</td></tr>`).join('') || '<tr><td colspan="4">No pilots yet.</td></tr>';
  const ledger = (hq.ledger || []).map(entry => `<li><b class="${Number(entry.amount) >= 0 ? 'credit' : 'debit'}">${Number(entry.amount) >= 0 ? '+' : ''}${careerCredits(entry.amount)}</b> · ${careerEscape(entry.note || entry.kind)}</li>`).join('') || '<li>No transactions yet.</li>';
  const activeContract = activeMatch ? `<section class="career-hq-active-contract"><div><p class="career-kicker">Active deployment</p><h3>Contract in progress</h3><p>Game ${careerEscape(activeMatch.gameCode)} · Round ${activeMatch.round} · ${careerEscape(String(activeMatch.phase).replaceAll('_', ' '))}</p></div><button class="primary" onclick="resumeCareerContract('${careerEscape(activeMatch.gameCode)}')" title="Return to this active Career contract.">Resume Contract</button></section>` : '';
  const contracts = (hq.contracts || []).map(contract => `<article class="career-hq-card"><strong>${careerEscape(contract.title)}</strong><span>${careerEscape(contract.tier)} risk · ${careerEscape(contract.status)}</span><small>${careerEscape(careerContractTerms(contract))}</small>${contract.status === 'available' ? `<button class="primary" data-career-contract onclick="launchCareerContract('${careerEscape(contract.id)}')">Launch Contract</button>` : contract.status === 'accepted' && activeMatch?.contractId === contract.id ? `<button class="secondary" onclick="resumeCareerContract('${careerEscape(activeMatch.gameCode)}')">Resume Contract</button>` : contract.status === 'accepted' ? '<small>Contract is active. Return to the active deployment above.</small>' : ''}</article>`).join('') || '<p>No contracts are available.</p>';
  root.innerHTML = `<header class="career-hq-heading"><div><p class="career-kicker">Persistent Mercenary Company</p><h2>${careerEscape(company.name)}</h2><p>${careerEscape(company.commander_callsign)} · ${careerEscape(company.affiliation)}</p></div><button class="secondary" onclick="showScreen('menu-screen')">Back to Dropship</button></header>
    <section class="career-hq-summary"><div><small>Credits</small><b>${careerCredits(company.credits)}</b></div><div><small>Reputation</small><b>${company.reputation} / 100</b></div><div><small>Dropship capacity</small><b>${company.dropship_tonnage} tons</b></div></section>
    ${activeContract}<p class="career-hq-notice">Career contracts launch from this persistent hangar and settle only from their sealed battle report. The Repair Bay calculates service from the pinned BattleMech record; skirmishes remain completely isolated.</p>
    <section><h3>Hangar</h3><div class="career-hq-cards">${mechs}</div></section>
    <section><h3>Pilots</h3><div class="career-hq-table-wrap"><table><thead><tr><th>Pilot</th><th>Skills</th><th>Specialty</th><th>Status</th></tr></thead><tbody>${pilotRows}</tbody></table></div></section>
    <section><h3>Contract Board</h3><div class="career-hq-cards">${contracts}</div></section>
    <section><h3>Ledger</h3><ul class="career-hq-ledger">${ledger}</ul></section>`;
}
