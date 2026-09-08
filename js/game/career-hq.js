// Career-4a Company HQ: origins, arcs, growth and regional operations.

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
  const band = Number(terms.bv_min) > 0 && Number(terms.bv_max) > 0 ? ` · BV ${Number(terms.bv_min).toLocaleString()}–${Number(terms.bv_max).toLocaleString()}` : '';
  const employer = terms.employer_faction ? ` · ${terms.employer_faction}` : '';
  return `${String(terms.map_id || 'training-grounds').replaceAll('-', ' ')}${employer}${band} · up to ${careerCredits(reward)} · +${Number(terms.reputation || 0)} reputation`;
}

function careerPilotDisplay(pilot) {
  return pilot?.callsign ? `${pilot.name} “${pilot.callsign}”` : String(pilot?.name || 'MechWarrior');
}

let careerHqPilotDirectory = new Map();

async function renameCareerPilot(pilotId) {
  const pilot = careerHqPilotDirectory.get(pilotId) || {};
  const name = window.prompt('Pilot name (1–48 characters)', pilot.name || '');
  if (name === null) return;
  const callsign = window.prompt('Callsign (optional, 1–32 characters)', pilot.callsign || '');
  if (callsign === null) return;
  const { data, error } = await db.rpc('rename_btech_career_pilot', { p_pilot_id:pilotId, p_name:name, p_callsign:callsign });
  if (error) { showGameToast(`Pilot could not be renamed: ${error.message || 'please try again.'}`, 'error'); return; }
  showGameToast(`${careerPilotDisplay(data)} saved.`, 'success');
  await openCareerHQ();
}

async function runCareerGrowthAction(rpc, args, confirmation, success) {
  if (confirmation && !window.confirm(confirmation)) return;
  const root = document.getElementById('career-hq-box');
  root?.querySelectorAll('[data-career-growth]').forEach(button => { button.disabled = true; });
  const { data, error } = await db.rpc(rpc, args || {});
  if (error) {
    showGameToast(`Company action failed: ${error.message || 'please try again.'}`, 'error');
    root?.querySelectorAll('[data-career-growth]').forEach(button => { button.disabled = false; });
    return;
  }
  showGameToast(typeof success === 'function' ? success(data) : success, 'success');
  await openCareerHQ();
}

let careerHqMarketDirectory = new Map(), careerHqSalvageDirectory = new Map();
function claimCareerSalvage(offerId, optionId) {
  const option = careerHqSalvageDirectory.get(`${offerId}:${optionId}`) || {}, label = `${option.chassis || option.unit_id || 'this wreck'} ${option.variant || ''}`.trim();
  return runCareerGrowthAction('claim_btech_career_salvage', { p_offer_id:offerId, p_option_id:optionId }, `Claim ${label} as a damaged recoverable BattleMech? It will consume company capacity and still require repairs and a pilot.`, `${label} transferred to your hangar.`);
}
function declineCareerSalvage(offerId) { return runCareerGrowthAction('decline_btech_career_salvage', { p_offer_id:offerId }, 'Decline all salvage from this battle? This cannot be undone.', 'Salvage declined.'); }
function purchaseCareerOffer(offerId) { const offer = careerHqMarketDirectory.get(offerId) || {}, payload = offer.payload || {}, label = offer.kind === 'mech' ? `${payload.chassis || payload.unit_id || 'BattleMech'} ${payload.variant || ''}`.trim() : careerPilotDisplay(payload); return runCareerGrowthAction('purchase_btech_career_market_offer', { p_offer_id:offerId }, `Purchase ${label} for ${careerCredits(offer.price)}?`, `${label} added to the company.`); }
function advanceCareerPilot(pilotId, skill, cost) { return runCareerGrowthAction('advance_btech_career_pilot', { p_pilot_id:pilotId, p_skill:skill }, `Spend ${cost} XP to improve ${skill}? Lower ratings are better.`, `${skill[0].toUpperCase()}${skill.slice(1)} improved.`); }
function upgradeCareerCapacity(price) { return runCareerGrowthAction('upgrade_btech_career_capacity', {}, `Spend ${careerCredits(price)} on the next company-capacity upgrade?`, 'Company capacity upgraded.'); }
function travelCareerCompany(worldId, worldName, days, cost) { return runCareerGrowthAction('travel_btech_career_company', { p_destination:worldId }, `Travel to ${worldName}? The journey takes ${days} days and costs ${careerCredits(cost)}. Current unsigned contract offers will be replaced locally.`, `Arrived at ${worldName}.`); }
function assignCareerPilot(mechId) {
  const select = document.getElementById(`career-pilot-for-${mechId}`);
  if (!select?.value) { showGameToast('Choose a pilot first.', 'error'); return; }
  return runCareerGrowthAction('assign_btech_career_pilot', { p_mech_id:mechId, p_pilot_id:select.value }, 'Assign this pilot to the BattleMech? Existing assignments will be changed.', 'Pilot assignment saved.');
}

function careerServiceSummary(mech, activeMatch) {
  const quote = mech?.service_quote;
  if (!quote) return '<small>Repair Bay is unavailable until Career-1c is installed.</small>';
  if (!quote.serviceable) return '<small class="career-hq-wreck">Recoverable wreck — replacement or salvage arrives in Career-2.</small>';
  const repair = quote.repair || {}, reload = quote.reload || {};
  const repairCost = Number(repair.total || 0), reloadCost = Number(reload.total || 0);
  const repairDetail = `${Number(repair.armor_points || 0)} armour · ${Number(repair.structure_points || 0)} structure · ${Number(repair.critical_slots || 0)} critical`;
  const reloadDetail = `${Number(reload.rounds || 0)} rounds across ${Number(reload.bins || 0)} bin${Number(reload.bins || 0) === 1 ? '' : 's'}`;
  const supply = quote.supply_world ? `<small><b>Local supply:</b> ${careerEscape(quote.supply_world)} · ×${Number(quote.supply_multiplier || 1).toFixed(2)}</small>` : '';
  const unavailable = activeMatch ? '<small>Service is unavailable during an active contract.</small>' : '';
  return `<div class="career-hq-service">${supply}<small><b>Repair:</b> ${repairDetail} · ${careerCredits(repairCost)}</small>${repairCost > 0 && !activeMatch ? `<button class="secondary" data-career-service onclick="confirmCareerService('${careerEscape(mech.id)}','repair',${repairCost})">Repair BattleMech</button>` : ''}<small><b>Reload:</b> ${reloadDetail} · ${careerCredits(reloadCost)}</small>${reloadCost > 0 && !activeMatch ? `<button class="secondary" data-career-service onclick="confirmCareerService('${careerEscape(mech.id)}','reload',${reloadCost})">Reload Ammunition</button>` : ''}${!repairCost && !reloadCost ? '<small class="career-hq-ready">Fully serviced.</small>' : ''}${unavailable}</div>`;
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
  careerHqPilotDirectory = pilotsById;
  const activeMatch = hq.activeMatch || null;
  const forceValue = hq.force_value || null, forceEntries = new Map((forceValue?.entries || []).map(entry => [entry.mech_id, entry]));
  careerHqMarketDirectory = new Map((hq.market || []).map(offer => [offer.id, offer]));
  careerHqSalvageDirectory = new Map((hq.salvage || []).flatMap(offer => (offer.options || []).map(option => [`${offer.id}:${option.option_id}`, option])));
  const mechs = (hq.mechs || []).map(mech => {
    const pilot = pilotsById.get(mech.pilot_id);
    const bv = forceEntries.get(mech.id);
    const damage = mech.status === 'operational' ? 'Operational' : careerEscape(mech.status.replaceAll('_',' '));
    const assignable = pilots.filter(candidate => ['available','assigned'].includes(candidate.status));
    const assignment = !activeMatch && mech.status !== 'destroyed' ? `<div class="career-hq-assignment"><select id="career-pilot-for-${careerEscape(mech.id)}" aria-label="Pilot for ${careerEscape(careerUnitLabel(mech))}"><option value="">Choose pilot…</option>${assignable.map(candidate => `<option value="${careerEscape(candidate.id)}" ${candidate.id === pilot?.id ? 'selected' : ''}>${careerEscape(careerPilotDisplay(candidate))} · G${candidate.gunnery}/P${candidate.piloting}</option>`).join('')}</select><button class="secondary" data-career-growth onclick="assignCareerPilot('${careerEscape(mech.id)}')">Assign Pilot</button></div>` : '';
    return `<article class="career-hq-card"><strong>${careerEscape(careerUnitLabel(mech))}</strong><span>${careerEscape(mech.callsign)} · ${damage}</span><small>${pilot ? `${careerEscape(careerPilotDisplay(pilot))} · G${pilot.gunnery}/P${pilot.piloting}` : 'No pilot assigned'}${bv ? ` · ${Number(bv.adjusted).toLocaleString()} BV` : ''} · ${mech.catalogue_version}</small>${assignment}${careerServiceSummary(mech, activeMatch)}</article>`;
  }).join('') || '<p>No persistent BattleMechs yet.</p>';
  const pilotRows = pilots.map(pilot => {
    const gunCost = (9 - Number(pilot.gunnery)) * 100, pilotCost = (9 - Number(pilot.piloting)) * 100;
    const advances = activeMatch ? '' : `<div class="career-pilot-actions">${pilot.gunnery > 0 ? `<button data-career-growth ${pilot.experience < gunCost ? 'disabled' : ''} onclick="advanceCareerPilot('${careerEscape(pilot.id)}','gunnery',${gunCost})">Gunnery · ${gunCost} XP</button>` : ''}${pilot.piloting > 0 ? `<button data-career-growth ${pilot.experience < pilotCost ? 'disabled' : ''} onclick="advanceCareerPilot('${careerEscape(pilot.id)}','piloting',${pilotCost})">Piloting · ${pilotCost} XP</button>` : ''}</div>`;
    return `<tr><td>${careerEscape(careerPilotDisplay(pilot))}</td><td>G${pilot.gunnery} / P${pilot.piloting}</td><td>${Number(pilot.experience || 0).toLocaleString()} XP</td><td>${careerEscape(pilot.specialty)}</td><td>${careerEscape(pilot.status)}</td><td><button class="secondary career-pilot-rename" onclick="renameCareerPilot('${careerEscape(pilot.id)}')" title="Change this persistent pilot's name and callsign.">Rename</button>${advances}</td></tr>`;
  }).join('') || '<tr><td colspan="6">No pilots yet.</td></tr>';
  const ledger = (hq.ledger || []).map(entry => `<li><b class="${Number(entry.amount) >= 0 ? 'credit' : 'debit'}">${Number(entry.amount) >= 0 ? '+' : ''}${careerCredits(entry.amount)}</b> · ${careerEscape(entry.note || entry.kind)}</li>`).join('') || '<li>No transactions yet.</li>';
  const activeContract = activeMatch ? `<section class="career-hq-active-contract"><div><p class="career-kicker">Active deployment</p><h3>Contract in progress</h3><p>Game ${careerEscape(activeMatch.gameCode)} · Round ${activeMatch.round} · ${careerEscape(String(activeMatch.phase).replaceAll('_', ' '))}</p></div><button class="primary" onclick="resumeCareerContract('${careerEscape(activeMatch.gameCode)}')" title="Return to this active Career contract.">Resume Contract</button></section>` : '';
  const forceTotal = Number(forceValue?.adjusted || 0);
  const contracts = (hq.contracts || []).map(contract => {
    const minimum = Number(contract.terms?.bv_min || 0), maximum = Number(contract.terms?.bv_max || 0);
    const eligible = !minimum || !maximum || (forceTotal >= minimum && forceTotal <= maximum);
    const action = contract.status === 'available'
      ? eligible ? `<button class="primary" data-career-contract onclick="launchCareerContract('${careerEscape(contract.id)}')">Launch Contract</button>` : `<button class="primary" disabled title="The assigned operational lance is outside this contract's BV band.">Lance Outside BV Band</button><small>Assign an operational lance worth BV ${minimum.toLocaleString()}–${maximum.toLocaleString()}.</small>`
      : contract.status === 'accepted' && activeMatch?.contractId === contract.id ? `<button class="secondary" onclick="resumeCareerContract('${careerEscape(activeMatch.gameCode)}')">Resume Contract</button>` : contract.status === 'accepted' ? '<small>Contract is active. Return to the active deployment above.</small>' : '';
    const briefing = contract.terms?.arc_featured ? `<small class="career-arc-contract"><b>Campaign operation:</b> ${careerEscape(contract.terms.arc_briefing || '')}</small>` : '';
    return `<article class="career-hq-card"><strong>${careerEscape(contract.title)}</strong><span>${careerEscape(contract.tier)} risk · ${careerEscape(contract.status)}</span><small>${careerEscape(careerContractTerms(contract))}</small>${briefing}${action}</article>`;
  }).join('') || '<p>No contracts are available.</p>';
  const salvage = (hq.salvage || []).map(offer => `<article class="career-growth-panel"><div><strong>Battle salvage</strong><small>Choose one recoverable wreck, or decline the lot.</small></div><div class="career-salvage-options">${(offer.options || []).map(option => { const label = `${option.chassis || option.unit_id} ${option.variant || ''}`.trim(); return `<button data-career-growth ${activeMatch ? 'disabled' : ''} onclick="claimCareerSalvage('${careerEscape(offer.id)}','${careerEscape(option.option_id)}')"><b>${careerEscape(label)}</b><span>${Number(option.mass || 0)} tons · damaged</span></button>`; }).join('')}<button class="career-decline" data-career-growth ${activeMatch ? 'disabled' : ''} onclick="declineCareerSalvage('${careerEscape(offer.id)}')">Decline salvage</button></div></article>`).join('') || '<p class="career-empty">No salvage decisions are waiting.</p>';
  const market = (hq.market || []).map(offer => { const payload = offer.payload || {}; const label = offer.kind === 'mech' ? `${payload.chassis || payload.unit_id} ${payload.variant || ''}`.trim() : careerPilotDisplay(payload); const detail = offer.kind === 'mech' ? `${payload.mass} tons · ${Number(payload.bv || 0).toLocaleString()} stock BV` : `G${payload.gunnery}/P${payload.piloting} · ${payload.specialty}`; return `<article class="career-hq-card"><strong>${careerEscape(label)}</strong><span>${careerEscape(offer.kind)} offer · ${detail}</span><small>${careerCredits(offer.price)}</small><button class="primary" data-career-growth ${activeMatch || Number(company.credits) < Number(offer.price) ? 'disabled' : ''} onclick="purchaseCareerOffer('${careerEscape(offer.id)}')">${offer.kind === 'pilot' ? 'Hire Pilot' : 'Purchase BattleMech'}</button></article>`; }).join('') || '<p>No market offers are available.</p>';
  const capacity = hq.capacity_upgrade || {}, capacityAction = capacity.available ? `<button class="secondary" data-career-growth ${!capacity.eligible || activeMatch ? 'disabled' : ''} onclick="upgradeCareerCapacity(${Number(capacity.price || 0)})">Upgrade to ${capacity.next} tons · ${careerCredits(capacity.price)}</button><small>Requires ${capacity.required_reputation} reputation.</small>` : '<small>Career-2 company capacity is fully upgraded.</small>';
  const currentWorld = hq.current_world || {}, campaignDay = Number(company.campaign_day || 0);
  const worlds = (hq.worlds || []).map(world => { const travel = world.travel || {}, here = world.id === currentWorld.id; return `<article class="career-hq-card ${here ? 'career-world-current' : ''}"><strong>${careerEscape(world.name)}</strong><span>${careerEscape(world.region)}${here ? ' · current location' : ''}</span><small>${careerEscape(world.description)}</small><small>Supply ×${Number(world.supply_multiplier || 1).toFixed(2)} · Market ×${Number(world.market_multiplier || 1).toFixed(2)}</small>${!here && travel.reachable ? `<button class="secondary" data-career-growth ${activeMatch || Number(company.credits) < Number(travel.cost) ? 'disabled' : ''} onclick="travelCareerCompany('${careerEscape(world.id)}','${careerEscape(world.name)}',${Number(travel.days)},${Number(travel.cost)})">Travel · ${travel.days} days · ${careerCredits(travel.cost)}</button>` : !here ? '<small>Travel through a connected world.</small>' : ''}</article>`; }).join('');
  const factions = (hq.factions || []).map(entry => `<li><span>${careerEscape(entry.faction)}</span><b class="${Number(entry.standing) >= 0 ? 'credit' : 'debit'}">${Number(entry.standing) >= 0 ? '+' : ''}${Number(entry.standing)}</b></li>`).join('') || '<li>No faction history yet.</li>';
  const arc = hq.campaign_arc || {}, arcStep = arc.step || {};
  const campaignArc = arc.id ? `<section class="career-arc-panel"><div><p class="career-kicker">${careerEscape(company.origin || company.affiliation)} origin · ${arc.status === 'completed' ? 'Arc complete' : `Operation ${arc.current_step} of 3`}</p><h3>${careerEscape(arc.title)}</h3><p>${careerEscape(arc.summary)}</p></div><aside><b>${careerEscape(arcStep.title || 'Campaign complete')}</b><span>${careerEscape(arcStep.briefing || 'This company has completed its founding campaign arc.')}</span></aside></section>` : '';
  root.innerHTML = `<header class="career-hq-heading"><div><p class="career-kicker">Persistent Mercenary Company</p><h2>${careerEscape(company.name)}</h2><p>${careerEscape(company.commander_callsign)} · ${careerEscape(company.affiliation)}</p></div><button class="secondary" onclick="showScreen('menu-screen')">Back to Dropship</button></header>
    <section class="career-hq-summary"><div><small>Credits</small><b>${careerCredits(company.credits)}</b></div><div><small>Reputation</small><b>${company.reputation} / 100</b></div><div><small>Company capacity</small><b>${Number(hq.hangar_tonnage || 0)} / ${company.dropship_tonnage} tons</b>${capacityAction}</div><div><small>Assigned lance</small><b>${forceValue ? `${forceTotal.toLocaleString()} BV` : 'BV unavailable'}</b></div></section>
    ${activeContract}<p class="career-hq-notice">Career contracts launch from this persistent hangar and settle only from their sealed battle report. Local supply affects service and market prices; skirmishes remain completely isolated.</p>${campaignArc}
    <section><h3>Regional Operations</h3><div class="career-region-heading"><div><strong>${careerEscape(currentWorld.name || 'Unknown location')}</strong><span>${careerEscape(currentWorld.region || '')} · Campaign day ${campaignDay}</span></div><small>${careerEscape(currentWorld.description || '')}</small></div><div class="career-hq-cards">${worlds}</div><h4>Faction standing</h4><ul class="career-faction-list">${factions}</ul></section>
    <section><h3>Hangar</h3><div class="career-hq-cards">${mechs}</div></section>
    <section><h3>Pilots</h3><div class="career-hq-table-wrap"><table><thead><tr><th>Pilot</th><th>Skills</th><th>Experience</th><th>Specialty</th><th>Status</th><th>Command</th></tr></thead><tbody>${pilotRows}</tbody></table></div></section>
    <section><h3>Salvage</h3>${salvage}</section>
    <section><h3>Market</h3><div class="career-hq-cards">${market}</div></section>
    <section><h3>Contract Board</h3><div class="career-hq-cards">${contracts}</div></section>
    <section><h3>Ledger</h3><ul class="career-hq-ledger">${ledger}</ul></section>`;
}
