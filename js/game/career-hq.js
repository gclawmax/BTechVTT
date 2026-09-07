// Career-1a Company HQ: a read-only view of server-owned persistent records.
// Contracts, settlement, repairs and reloads arrive in later Career-1 slices.

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
  renderCareerHQ(data);
}

function renderCareerHQ(hq) {
  const root = document.getElementById('career-hq-box');
  if (!root) return;
  const company = hq.company, pilots = hq.pilots || [], pilotsById = new Map(pilots.map(pilot => [pilot.id, pilot]));
  const mechs = (hq.mechs || []).map(mech => {
    const pilot = pilotsById.get(mech.pilot_id);
    const damage = mech.status === 'operational' ? 'Operational' : careerEscape(mech.status.replaceAll('_',' '));
    return `<article class="career-hq-card"><strong>${careerEscape(careerUnitLabel(mech))}</strong><span>${careerEscape(mech.callsign)} · ${damage}</span><small>${pilot ? `${careerEscape(pilot.name)} · G${pilot.gunnery}/P${pilot.piloting}` : 'No pilot assigned'} · ${mech.catalogue_version}</small></article>`;
  }).join('') || '<p>No persistent BattleMechs yet.</p>';
  const pilotRows = pilots.map(pilot => `<tr><td>${careerEscape(pilot.name)}</td><td>G${pilot.gunnery} / P${pilot.piloting}</td><td>${careerEscape(pilot.specialty)}</td><td>${careerEscape(pilot.status)}</td></tr>`).join('') || '<tr><td colspan="4">No pilots yet.</td></tr>';
  const ledger = (hq.ledger || []).map(entry => `<li><b class="${Number(entry.amount) >= 0 ? 'credit' : 'debit'}">${Number(entry.amount) >= 0 ? '+' : ''}${careerCredits(entry.amount)}</b> · ${careerEscape(entry.note || entry.kind)}</li>`).join('') || '<li>No transactions yet.</li>';
  const contracts = (hq.contracts || []).map(contract => `<article class="career-hq-card"><strong>${careerEscape(contract.title)}</strong><span>${careerEscape(contract.tier)} risk · ${careerEscape(contract.status)}</span><small>${careerEscape(careerContractTerms(contract))}</small>${contract.status === 'available' ? `<button class="primary" data-career-contract onclick="launchCareerContract('${careerEscape(contract.id)}')">Launch Contract</button>` : contract.status === 'accepted' ? '<small>Contract is active. Rejoin it from the Dropship if needed.</small>' : ''}</article>`).join('') || '<p>No contracts are available.</p>';
  root.innerHTML = `<header class="career-hq-heading"><div><p class="career-kicker">Persistent Mercenary Company</p><h2>${careerEscape(company.name)}</h2><p>${careerEscape(company.commander_callsign)} · ${careerEscape(company.affiliation)}</p></div><button class="secondary" onclick="showScreen('menu-screen')">Back to Dropship</button></header>
    <section class="career-hq-summary"><div><small>Credits</small><b>${careerCredits(company.credits)}</b></div><div><small>Reputation</small><b>${company.reputation} / 100</b></div><div><small>Dropship capacity</small><b>${company.dropship_tonnage} tons</b></div></section>
    <p class="career-hq-notice">Career contracts launch from this persistent hangar and settle only from their sealed battle report. Skirmishes remain completely isolated. Repairs and reloads arrive in Career-1c.</p>
    <section><h3>Hangar</h3><div class="career-hq-cards">${mechs}</div></section>
    <section><h3>Pilots</h3><div class="career-hq-table-wrap"><table><thead><tr><th>Pilot</th><th>Skills</th><th>Specialty</th><th>Status</th></tr></thead><tbody>${pilotRows}</tbody></table></div></section>
    <section><h3>Contract Board</h3><div class="career-hq-cards">${contracts}</div></section>
    <section><h3>Ledger</h3><ul class="career-hq-ledger">${ledger}</ul></section>`;
}
