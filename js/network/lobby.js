// ── LOBBY MANAGEMENT ─────────────────────────────────────
async function copyLobbyGameCode() {
  const code = document.getElementById('lobby-code')?.textContent?.trim();
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code);
    document.getElementById('lobby-status').textContent = `Game code ${code} copied — send it to Player 2.`;
  } catch (error) {
    // Clipboard permissions can be unavailable on some local/static hosts.
    window.prompt('Copy this game code:', code);
  }
}

// These are view preferences only: they never change the shared match roster.
const lobbyRosterFilters = { tech: 'both', weights: new Set(['light', 'medium', 'heavy', 'assault']), search: '', favouritesOnly: false };
const favouriteUnitIds = new Set();
const expandedLobbyChassis = new Set();
let favouritesLoadedForUserId = null;
let skirmishAvatarEnsureInFlight = false;
let lobbyDeploymentIndex = 0;

async function loadProfileUnitFavourites() {
  if (!currentUser?.id || favouritesLoadedForUserId === currentUser.id) return;
  const { data, error } = await db.from('profiles').select('btech_favourite_units').eq('id', currentUser.id).maybeSingle();
  if (error) {
    console.warn('Unable to load BattleMech favourites:', error);
    return;
  }
  favouriteUnitIds.clear();
  for (const unitId of data?.btech_favourite_units || []) favouriteUnitIds.add(unitId);
  favouritesLoadedForUserId = currentUser.id;
}

function updateLobbyFavouriteCard(unitId, favourite) {
  for (const card of document.querySelectorAll('.roster-option-wrap[data-unit-id]')) {
    if (card.dataset.unitId !== unitId) continue;
    card.dataset.favourite = favourite ? 'true' : 'false';
    card.classList.toggle('favourite', favourite);
    const star = card.querySelector('.roster-favourite-star');
    if (star) {
      star.textContent = favourite ? '★' : '☆';
      star.classList.toggle('active', favourite);
      star.setAttribute('aria-pressed', String(favourite));
      star.title = favourite ? 'Remove this exact variant from favourites' : 'Add this exact variant to favourites';
    }
  }
  filterLobbyRosterSearch(lobbyRosterFilters.search);
}

async function toggleLobbyUnitFavourite(event, unitId) {
  event?.preventDefault();
  event?.stopPropagation();
  if (!currentUser?.id || !isSupportedUnit(unitId)) return;
  const wasFavourite = favouriteUnitIds.has(unitId);
  const favourite = !wasFavourite;
  if (favourite) favouriteUnitIds.add(unitId); else favouriteUnitIds.delete(unitId);
  updateLobbyFavouriteCard(unitId, favourite);
  const { data, error } = await db.rpc('set_btech_unit_favourite', { p_unit_id: unitId, p_favourite: favourite });
  if (error) {
    if (wasFavourite) favouriteUnitIds.add(unitId); else favouriteUnitIds.delete(unitId);
    updateLobbyFavouriteCard(unitId, wasFavourite);
    document.getElementById('lobby-status').textContent = `Favourite could not be saved: ${error.message}`;
    return;
  }
  favouriteUnitIds.clear();
  for (const savedUnitId of data || []) favouriteUnitIds.add(savedUnitId);
}

function toggleLobbyFavouritesFilter() {
  lobbyRosterFilters.favouritesOnly = !lobbyRosterFilters.favouritesOnly;
  loadLobbyUI();
}

function lobbyRosterSearchKey(value) {
  return String(value || '').normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function setLobbyChassisExpanded(group, expanded) {
  if (!group) return;
  group.classList.toggle('expanded', expanded);
  const toggle = group.querySelector('.roster-chassis-toggle');
  const variants = group.querySelector('.roster-chassis-variants');
  if (toggle) toggle.setAttribute('aria-expanded', String(expanded));
  if (variants) variants.hidden = !expanded;
}

function toggleLobbyChassis(chassisKey) {
  const expanded = !expandedLobbyChassis.has(chassisKey);
  if (expanded) expandedLobbyChassis.add(chassisKey); else expandedLobbyChassis.delete(chassisKey);
  for (const group of document.querySelectorAll('.roster-chassis-group[data-chassis-key]')) {
    if (group.dataset.chassisKey === chassisKey) setLobbyChassisExpanded(group, expanded);
  }
}

function filterLobbyRosterSearch(value) {
  lobbyRosterFilters.search = String(value || '');
  const roster = document.getElementById('lobby-roster-builder');
  if (!roster) return;
  const needle = lobbyRosterSearchKey(lobbyRosterFilters.search);
  let visibleCount = 0;
  for (const option of roster.querySelectorAll('.roster-option-wrap[data-search]')) {
    const searchMismatch = Boolean(needle) && !option.dataset.search.includes(needle);
    const favouriteMismatch = lobbyRosterFilters.favouritesOnly && option.dataset.favourite !== 'true';
    option.hidden = searchMismatch || favouriteMismatch;
    if (!option.hidden) visibleCount += 1;
  }
  const revealMatches = Boolean(needle) || lobbyRosterFilters.favouritesOnly;
  for (const chassis of roster.querySelectorAll('.roster-chassis-group[data-chassis-key]')) {
    const hasVisibleVariant = Boolean(chassis.querySelector('.roster-option-wrap[data-search]:not([hidden])'));
    chassis.hidden = !hasVisibleVariant;
    setLobbyChassisExpanded(chassis, hasVisibleVariant && (revealMatches || expandedLobbyChassis.has(chassis.dataset.chassisKey)));
  }
  for (const group of roster.querySelectorAll('.roster-weight-group')) {
    group.hidden = !group.querySelector('.roster-chassis-group:not([hidden])');
  }
  const empty = document.getElementById('lobby-roster-search-empty');
  if (empty) empty.hidden = visibleCount > 0;
  const clear = document.getElementById('lobby-roster-search-clear');
  if (clear) clear.hidden = !lobbyRosterFilters.search;
}

function clearLobbyRosterSearch() {
  const input = document.getElementById('lobby-roster-search');
  if (input) input.value = '';
  filterLobbyRosterSearch('');
  input?.focus();
}

function skirmishAvatarForSeat(gameState, seat) {
  return gameState?.skirmish_avatars?.[String(seat)] || null;
}

function skirmishHangarId() {
  return globalThis.crypto?.randomUUID?.() || `hangar-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function skirmishPilotForEntry(entry) {
  return {
    id: entry?.pilot?.id || `pilot-${entry?.id || skirmishHangarId()}`,
    name: String(entry?.pilot?.name || 'MechWarrior').trim().slice(0, 48) || 'MechWarrior',
    gunnery: Math.max(0, Math.min(8, Number(entry?.pilot?.gunnery ?? 4))),
    piloting: Math.max(0, Math.min(8, Number(entry?.pilot?.piloting ?? 5)))
  };
}

function skirmishSkillOptions(selected) {
  return Array.from({ length: 9 }, (_, value) => `<option value="${value}" ${value === Number(selected) ? 'selected' : ''}>${value}</option>`).join('');
}

function weightClassForUnit(unit) {
  const tons = Number(unit?.tonnage || 0);
  if (tons <= 35) return 'light';
  if (tons <= 55) return 'medium';
  if (tons <= 75) return 'heavy';
  return 'assault';
}

function techBaseForUnit(unit) {
  return String(unit?.techBase || 'Inner Sphere').toLowerCase().includes('clan') ? 'clan' : 'is';
}

function setLobbyRosterTechFilter(tech) {
  lobbyRosterFilters.tech = ['is', 'clan', 'both'].includes(tech) ? tech : 'both';
  loadLobbyUI();
}

function toggleLobbyRosterWeightFilter(weight) {
  if (!['light', 'medium', 'heavy', 'assault'].includes(weight)) return;
  if (lobbyRosterFilters.weights.has(weight)) {
    // Keep one category selected, so the roster never becomes mysteriously blank.
    if (lobbyRosterFilters.weights.size > 1) lobbyRosterFilters.weights.delete(weight);
  } else {
    lobbyRosterFilters.weights.add(weight);
  }
  loadLobbyUI();
}

async function loadLobby() {
  if (!currentGameId) return;
  lobbyClosureInProgress = false;

  // Subscribe to game changes
  if (gameSubscription) gameSubscription.unsubscribe();
  gameSubscription = db
    .channel('btech_games:' + currentGameId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'btech_games', filter: `id=eq.${currentGameId}` },
      (payload) => {
        console.log('[BT-DIAG] lobby game update', payload.new?.status, payload.new?.id);
        if (payload.eventType === 'DELETE') {
          handleLobbyClosed();
          return;
        }
        if (payload.eventType === 'UPDATE' && payload.new.status === 'in-progress') {
          startGameScreen();
        } else {
          loadLobbyUI();
        }
      }
    )
    .subscribe();

  // Subscribe to player changes
  if (playersSubscription) playersSubscription.unsubscribe();
  playersSubscription = db
    .channel('btech_players:' + currentGameId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'btech_players', filter: `game_id=eq.${currentGameId}` },
      (payload) => {
        loadLobbyUI();
      }
    )
    .subscribe();

  // Also load once immediately
  await loadLobbyUI();
}

async function loadLobbyUI() {
  if (!currentGameId) return;

  // Get game info
  const { data: loadedGame, error: gameError } = await db
    .from('btech_games')
    .select('game_code,state,catalogue_version')
    .eq('id', currentGameId)
    .single();

  // A cascading player-delete event can arrive before the game DELETE event.
  // Treat a missing game row as a closed lobby in either order.
  if (!loadedGame && gameError?.code === 'PGRST116') {
    await handleLobbyClosed();
    return;
  }
  if (!loadedGame) {
    console.warn('Unable to refresh lobby:', gameError);
    return;
  }

  const game = await repairLegacyMatchCatalogue(loadedGame);

  if (game) {
    document.getElementById('lobby-code').textContent = game.game_code;
  }
  if (game.catalogue_version) {
    try {
      await loadUnitCatalogue(game.catalogue_version);
    } catch (error) {
      console.error('Unable to load match catalogue:', error);
      document.getElementById('lobby-status').textContent = 'The BattleMech catalogue for this match could not be loaded.';
      return;
    }
  }
  await loadProfileUnitFavourites();
  const gameState = game?.state ? (typeof game.state === 'string' ? JSON.parse(game.state) : game.state) : {};
  const rosterUnitIds = Object.values(gameState.rosters || {}).flat();
  if (game.catalogue_version && rosterUnitIds.some(unitId => !databaseSupportedUnitIds.has(unitId))) {
    try { await loadUnitCatalogue(game.catalogue_version, true); }
    catch (error) { console.warn('Unable to refresh newly published custom BattleMech:', error); }
  }
  if (typeof gameState.vs_ai_mode === 'boolean') vsAiMode = gameState.vs_ai_mode;

  // Every human player receives a temporary Avatar when opening a skirmish
  // lobby. It belongs to this match only; campaign persistence comes later.
  if (!vsAiMode && mySeatNumber && !skirmishAvatarForSeat(gameState, mySeatNumber) && !skirmishAvatarEnsureInFlight) {
    skirmishAvatarEnsureInFlight = true;
    const { error } = await db.rpc('ensure_skirmish_avatar', { p_game_id: currentGameId });
    skirmishAvatarEnsureInFlight = false;
    if (!error) return loadLobbyUI();
    console.warn('Unable to create Skirmish Avatar:', error);
  }

  // Get players
  const { data: players } = await db
    .from('btech_players')
    .select('*')
    .eq('game_id', currentGameId)
    .order('seat_number');

  // Get spectators
  const { data: spectators } = await db
    .from('btech_players')
    .select('*')
    .eq('game_id', currentGameId)
    .eq('role', 'spectator')
    .order('created_at');

  // Render seats
  const seatsEl = document.getElementById('lobby-seats');
  seatsEl.innerHTML = '';

  if (players) {
    for (let i = 0; i < 2; i++) {
      const player = players.find(p => p.seat_number === i + 1);
      const row = document.createElement('div');

      if (player) {
        // Check if this is the AI player
        const isAI = player.is_ai === true;
        const username = isAI 
          ? `AI ${aiDifficulty.charAt(0).toUpperCase() + aiDifficulty.slice(1)}`
          : titleCase(player.user_id?.substring(0, 8) || `Player ${player.seat_number}`);
        const isCurrentPlayer = !isAI && player.user_id === currentUser?.id;
        if (isCurrentPlayer) isReady = player.ready === true;
        const isReadyClass = player.ready ? 'ready' : '';
        const readyText = player.ready ? 'READY' : 'NOT READY';
        const currentTag = isCurrentPlayer ? ' (you)' : '';
        const aiTag = isAI ? ' 🤖' : '';
        const rosterSummary = !isAI && !vsAiMode && gameState.map_id
          ? `<div class="seat-roster">${rosterSummaryForSeat(gameState, player.seat_number)}</div>`
          : '';

        row.className = 'seat-row';
        row.innerHTML = `
          <div class="seat-number">${i + 1}</div>
          <div class="seat-name">${username}${aiTag}${currentTag}${rosterSummary}</div>
          <div class="seat-status ${isReadyClass}">${readyText}</div>
        `;
      } else {
        row.className = 'seat-row empty';
        row.innerHTML = `
          <div class="seat-number">${i + 1}</div>
          <div class="seat-name">Empty Seat</div>
          <div class="seat-status">—</div>
        `;
      }

      seatsEl.appendChild(row);
    }
  }

  renderLobbyMatchSetup(gameState, players || []);
  renderLobbyDeployment(gameState);

  // Render spectators
  const specEl = document.getElementById('lobby-spectators');
  if (spectators && spectators.length > 0) {
    specEl.innerHTML = spectators.map(s => {
      const username = titleCase(s.user_id?.substring(0, 8) || 'Spectator');
      return `<div class="spectator-item">${username}</div>`;
    }).join('');
  } else {
    specEl.innerHTML = '<div class="spectator-item" style="color:var(--phosphor-dim);font-style:italic;">No spectators</div>';
  }

  // Update button states
  const btnReady = document.getElementById('btn-ready');
  const btnStart = document.getElementById('btn-start');

  if (btnReady) {
    btnReady.textContent = isReady ? 'Unready' : 'Ready Up';
  }
  if (btnStart) {
    const playerSeats = (players || []).filter(player => player.role === 'player');
    const rostersReady = vsAiMode || playerSeats.every(player => isRosterLegal(gameState.rosters?.[String(player.seat_number)], gameState.dropship_tonnage));
    const canStart = vsAiMode
      ? playerSeats.length === 2 && playerSeats.some(player => !player.is_ai && player.ready)
      : playerSeats.length === 2 && playerSeats.every(player => player.ready) && rostersReady;
    btnStart.disabled = !isHost || !canStart;
  }

  // Update status
  const statusEl = document.getElementById('lobby-status');
  if (statusEl) {
    const playerCount = players ? players.filter(p => p.role === 'player').length : 0;
    statusEl.textContent = vsAiMode
      ? `${playerCount}/2 players in lobby`
      : `${playerCount}/2 human players in lobby${playerCount < 2 ? ' — waiting for an opponent' : ''}`;
  }
}

function stopLobbySubscriptions() {
  if (gameSubscription) { gameSubscription.unsubscribe(); gameSubscription = null; }
  if (playersSubscription) { playersSubscription.unsubscribe(); playersSubscription = null; }
  if (gameLogSubscription) { gameLogSubscription.unsubscribe(); gameLogSubscription = null; }
}

async function handleLobbyClosed() {
  if (lobbyClosureInProgress) return;
  lobbyClosureInProgress = true;
  stopLobbySubscriptions();
  currentGameId = null;
  isHost = false;
  isReady = false;
  mySeatNumber = null;
  alert('The host has closed this room. You have been returned to the Dropship.');
  await showMainMenu();
}

function supportedUnitEntries() {
  return Object.entries(BT_UNIT_CATALOGUE)
    .filter(([id, unit]) => isSupportedUnit(id) && (!unit.customDesign || (unit.customOwnerId === currentUser?.id && !unit.customArchived)))
    .sort(([, left], [, right]) => left.tonnage - right.tonnage ||
      left.chassis.localeCompare(right.chassis) || left.variant.localeCompare(right.variant));
}

function rosterTonnage(roster) {
  return (roster || []).reduce((total, unitId) => total + (getSupportedUnit(unitId)?.tonnage || 0), 0);
}

function isRosterLegal(roster, tonnageLimit) {
  const units = roster || [];
  return units.length > 0 && units.every(isSupportedUnit) && rosterTonnage(units) <= Number(tonnageLimit || 0);
}

function rosterSummaryForSeat(gameState, seatNumber) {
  const roster = gameState.rosters?.[String(seatNumber)] || [];
  const names = roster.map(unitId => {
    const unit = getSupportedUnit(unitId);
    return unit ? `${unit.chassis} ${unit.variant}` : unitId;
  });
  return names.length
    ? `Roster: ${names.join(', ')} · ${rosterTonnage(roster)} tons`
    : 'Roster: not selected';
}

async function saveSkirmishHangar(hangar, deployed) {
  const { error } = await db.rpc('update_skirmish_hangar', {
    p_game_id: currentGameId, p_hangar: hangar, p_deployed: deployed
  });
  if (error) {
    console.error('Failed to save Skirmish Hangar:', error);
    document.getElementById('lobby-status').textContent = `Skirmish Hangar could not be saved: ${error.message}`;
    return false;
  }
  isReady = false;
  await db.from('btech_players').update({ ready: false }).eq('game_id', currentGameId).eq('user_id', currentUser.id);
  await loadLobbyUI();
  return true;
}

async function addMechToSkirmishHangar(unitId) {
  if (!currentGameId || !currentUser || vsAiMode || !isSupportedUnit(unitId)) return;
  const { data: game, error } = await db.from('btech_games').select('state').eq('id', currentGameId).single();
  if (error || !game) return;
  const state = typeof game.state === 'string' ? JSON.parse(game.state) : (game.state || {});
  const avatar = skirmishAvatarForSeat(state, mySeatNumber);
  const hangar = [...(avatar?.hangar || [])];
  if (hangar.length >= 12) { document.getElementById('lobby-status').textContent = 'A Skirmish Hangar can hold up to 12 BattleMechs.'; return; }
  const entryId = skirmishHangarId();
  hangar.push({ id: entryId, unit_id: unitId, pilot: { id: `pilot-${entryId}`, name: 'MechWarrior', gunnery: 4, piloting: 5 } });
  await saveSkirmishHangar(hangar, [...(avatar?.deployed || [])]);
}

async function saveSkirmishPilot(entryId) {
  if (!currentGameId || !currentUser || vsAiMode) return;
  const nameInput = document.getElementById(`hangar-pilot-name-${entryId}`);
  const gunneryInput = document.getElementById(`hangar-pilot-gunnery-${entryId}`);
  const pilotingInput = document.getElementById(`hangar-pilot-piloting-${entryId}`);
  const name = String(nameInput?.value || '').trim();
  if (!name) {
    document.getElementById('lobby-status').textContent = 'Give this MechWarrior a name before saving.';
    nameInput?.focus();
    return;
  }
  const { data: game, error } = await db.from('btech_games').select('state').eq('id', currentGameId).single();
  if (error || !game) return;
  const state = typeof game.state === 'string' ? JSON.parse(game.state) : (game.state || {});
  const avatar = skirmishAvatarForSeat(state, mySeatNumber);
  const hangar = (avatar?.hangar || []).map(entry => entry.id === entryId ? {
    ...entry,
    pilot: {
      ...skirmishPilotForEntry(entry),
      name: name.slice(0, 48),
      gunnery: Number(gunneryInput?.value ?? 4),
      piloting: Number(pilotingInput?.value ?? 5)
    }
  } : entry);
  await saveSkirmishHangar(hangar, [...(avatar?.deployed || [])]);
}

async function removeSkirmishHangarMech(entryId) {
  if (!currentGameId || !currentUser || vsAiMode) return;
  const { data: game, error } = await db.from('btech_games').select('state').eq('id', currentGameId).single();
  if (error || !game) return;
  const state = typeof game.state === 'string' ? JSON.parse(game.state) : (game.state || {});
  const avatar = skirmishAvatarForSeat(state, mySeatNumber);
  const hangar = (avatar?.hangar || []).filter(entry => entry.id !== entryId);
  const deployed = (avatar?.deployed || []).filter(id => id !== entryId);
  await saveSkirmishHangar(hangar, deployed);
}

async function toggleSkirmishDeployment(entryId) {
  if (!currentGameId || !currentUser || vsAiMode) return;
  const { data: game, error } = await db.from('btech_games').select('state').eq('id', currentGameId).single();
  if (error || !game) return;
  const state = typeof game.state === 'string' ? JSON.parse(game.state) : (game.state || {});
  const avatar = skirmishAvatarForSeat(state, mySeatNumber);
  const hangar = [...(avatar?.hangar || [])];
  const deployed = [...(avatar?.deployed || [])];
  const index = deployed.indexOf(entryId);
  if (index >= 0) deployed.splice(index, 1);
  else if (deployed.length < 6) deployed.push(entryId);
  else { document.getElementById('lobby-status').textContent = 'A skirmish roster can deploy up to six BattleMechs.'; return; }
  await saveSkirmishHangar(hangar, deployed);
}

function renderLobbyMatchSetup(gameState, players) {
  const settingsEl = document.getElementById('lobby-match-settings');
  const rosterSection = document.getElementById('lobby-roster-section');
  const rosterEl = document.getElementById('lobby-roster-builder');
  if (!settingsEl || !rosterSection || !rosterEl) return;

  if (vsAiMode || !gameState.map_id) {
    settingsEl.innerHTML = '<div class="match-setting-summary">AI skirmish using the current demonstration map and test roster.</div>';
    rosterSection.hidden = true;
    return;
  }

  const map = getMapDefinition(gameState.map_id);
  const limit = Number(gameState.dropship_tonnage || 0);
  const beginnerScenario = gameState.beginner_scenario;
  const victoryLabel = ({ annihilation: 'Annihilation', control: 'Objective Control (first to 5)', breakthrough: 'Breakthrough (2 BattleMechs)' })[gameState.victory_mode] || 'Annihilation';
  settingsEl.innerHTML = `<div class="match-setting-summary"><strong>${beginnerScenario?.title || map.name}</strong><br>${beginnerScenario?.instructions || map.description}<br>Battlefield: <strong>${map.name}</strong><br>Force limit: <strong>${limit} tons per player</strong><br>Victory: <strong>${victoryLabel}</strong></div>`;
  if (beginnerScenario) {
    rosterSection.hidden = true;
    rosterEl.innerHTML = '';
    return;
  }
  rosterSection.hidden = false;
  const avatar = skirmishAvatarForSeat(gameState, mySeatNumber);
  const hangar = avatar?.hangar || [];
  const deployed = avatar?.deployed || [];
  const roster = gameState.rosters?.[String(mySeatNumber)] || [];
  const total = rosterTonnage(roster);
  const filtered = supportedUnitEntries().filter(([, unit]) => {
    const tech = techBaseForUnit(unit);
    return (lobbyRosterFilters.tech === 'both' || lobbyRosterFilters.tech === tech) &&
      lobbyRosterFilters.weights.has(weightClassForUnit(unit));
  });
  const weightOrder = ['light', 'medium', 'heavy', 'assault'];
  const visibleByWeight = weightOrder.map(weight => [weight, filtered.filter(([, unit]) => weightClassForUnit(unit) === weight)]);
  const techButton = (value, label) => `<button class="roster-filter ${lobbyRosterFilters.tech === value ? 'active' : ''}" onclick="setLobbyRosterTechFilter('${value}')">${label}</button>`;
  const weightButton = (weight, label) => `<button class="roster-filter ${lobbyRosterFilters.weights.has(weight) ? 'active' : ''}" onclick="toggleLobbyRosterWeightFilter('${weight}')">${label}</button>`;
  const movementSummary = unit => {
    const movement = unit.movement || {};
    const walk = Number(movement.walk ?? 0);
    const run = Number(movement.run ?? 0);
    const jump = Number(movement.jump ?? 0);
    return `Speed ${walk}/${run}${jump ? `/${jump}J` : ''}`;
  };
  const weaponSummary = unit => {
    const counts = new Map();
    for (const entry of unit.weapons || []) {
      const name = entry.weapon?.name || entry.name || BT_WEAPONS?.[entry.key]?.name || entry.key || 'Unknown weapon';
      counts.set(name, (counts.get(name) || 0) + Number(entry.count || 1));
    }
    return [...counts].map(([name, count]) => count > 1 ? `${count}× ${name}` : name).join(', ') || 'No weapons listed';
  };
  const card = ([id, unit]) => {
    const inHangar = hangar.filter(entry => entry.unit_id === id).length;
    const disabled = hangar.length >= 12;
    const techLabel = unit.customDesign ? 'Custom IS' : techBaseForUnit(unit) === 'clan' ? 'Clan' : 'Inner Sphere';
    const searchKey = lobbyRosterSearchKey(`${unit.chassis} ${unit.variant} ${id} ${unit.tonnage} ${techLabel}`);
    const favourite = favouriteUnitIds.has(id);
    const favouriteTitle = favourite ? 'Remove this exact variant from favourites' : 'Add this exact variant to favourites';
    const variantName = unit.variant || id;
    return `<div class="roster-option-wrap ${favourite ? 'favourite' : ''}" data-unit-id="${id}" data-search="${searchKey}" data-favourite="${favourite}"><button class="roster-favourite-star ${favourite ? 'active' : ''}" type="button" aria-label="${favouriteTitle}" aria-pressed="${favourite}" title="${favouriteTitle}" onclick="toggleLobbyUnitFavourite(event,'${id}')">${favourite ? '★' : '☆'}</button><button class="roster-option" onclick="addMechToSkirmishHangar('${id}')" ${disabled ? 'disabled' : ''}><span class="roster-option-name">${escapeHtml(variantName)}</span><span class="roster-option-tonnage">${unit.tonnage} tons · ${techLabel}${inHangar ? ` · ${inHangar} in Hangar` : ''}</span><span class="roster-option-speed">${movementSummary(unit)}</span><span class="roster-option-weapons" title="${escapeHtml(weaponSummary(unit))}">${escapeHtml(weaponSummary(unit))}</span></button></div>`;
  };
  const chassisGroups = entries => {
    const groups = new Map();
    for (const entry of entries) {
      const chassisName = String(entry[1].chassis || 'Unknown chassis');
      const chassisKey = lobbyRosterSearchKey(chassisName);
      if (!groups.has(chassisKey)) groups.set(chassisKey, { chassisKey, chassisName, entries: [] });
      groups.get(chassisKey).entries.push(entry);
    }
    return [...groups.values()].sort((a, b) => a.chassisName.localeCompare(b.chassisName));
  };
  const chassisGroup = group => {
    const expanded = expandedLobbyChassis.has(group.chassisKey);
    const variantLabel = `${group.entries.length} variant${group.entries.length === 1 ? '' : 's'}`;
    return `<section class="roster-chassis-group ${expanded ? 'expanded' : ''}" data-chassis-key="${group.chassisKey}"><button class="roster-chassis-toggle" type="button" aria-expanded="${expanded}" onclick="toggleLobbyChassis('${group.chassisKey}')"><span class="roster-chassis-chevron" aria-hidden="true">›</span><strong>${escapeHtml(group.chassisName)}</strong><span class="roster-chassis-count">${variantLabel}</span></button><div class="roster-chassis-variants roster-options" ${expanded ? '' : 'hidden'}>${group.entries.map(card).join('')}</div></section>`;
  };
  const hangarCards = hangar.map(entry => {
    const unit = getSupportedUnit(entry.unit_id);
    const isDeployed = deployed.includes(entry.id);
    const pilot = skirmishPilotForEntry(entry);
    return `<div class="hangar-entry ${isDeployed ? 'deployed' : ''}">
      <div class="hangar-mech"><strong>${unit ? `${unit.chassis} ${unit.variant}` : escapeHtml(entry.unit_id)}</strong><span>${unit?.tonnage || '?'} tons${isDeployed ? ' · DEPLOYED' : ''}</span></div>
      <div class="hangar-pilot-fields">
        <label>Pilot<input id="hangar-pilot-name-${entry.id}" maxlength="48" value="${escapeHtml(pilot.name)}"></label>
        <label>Gunnery<select id="hangar-pilot-gunnery-${entry.id}">${skirmishSkillOptions(pilot.gunnery)}</select></label>
        <label>Piloting<select id="hangar-pilot-piloting-${entry.id}">${skirmishSkillOptions(pilot.piloting)}</select></label>
        <button onclick="saveSkirmishPilot('${entry.id}')">Save Pilot</button>
      </div>
      <div class="hangar-actions"><button onclick="toggleSkirmishDeployment('${entry.id}')">${isDeployed ? 'Withdraw' : 'Deploy'}</button><button onclick="removeSkirmishHangarMech('${entry.id}')">Remove</button></div>
    </div>`;
  }).join('') || '<div class="roster-empty">Add BattleMechs below to build your Hangar.</div>';
  rosterEl.innerHTML = `<div class="skirmish-avatar"><strong>${avatar?.callsign || `Skirmish Commander P${mySeatNumber}`}</strong><span>Match-only Avatar · each BattleMech has its own pilot</span><button onclick="openMechDesigner()">Open MechLab</button></div><div class="panel-eyebrow" style="margin-top:12px;">Skirmish Hangar</div><div class="hangar-list">${hangarCards}</div><div class="roster-summary">Deployment: ${total} / ${limit} tons · ${roster.length || 'no'} 'Mech${roster.length === 1 ? '' : 's'} selected</div>
    <div class="roster-search"><label for="lobby-roster-search">Find a BattleMech</label><div><input id="lobby-roster-search" type="search" autocomplete="off" placeholder="Chassis, variant, tonnage or tech base" value="${lobbyRosterFilters.search.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')}" oninput="filterLobbyRosterSearch(this.value)"><button id="lobby-roster-search-clear" type="button" onclick="clearLobbyRosterSearch()">Clear</button></div></div>
    <div class="roster-filter-bar"><span>Quick find</span><button class="roster-filter ${lobbyRosterFilters.favouritesOnly ? 'active' : ''}" onclick="toggleLobbyFavouritesFilter()">★ Favourites</button></div>
    <div class="roster-filter-bar"><span>Tech base</span>${techButton('is', 'Inner Sphere')}${techButton('clan', 'Clan')}${techButton('both', 'Both')}</div>
    <div class="roster-filter-bar"><span>Weight</span>${weightButton('light', 'Light')}${weightButton('medium', 'Medium')}${weightButton('heavy', 'Heavy')}${weightButton('assault', 'Assault')}</div>
    <div class="roster-scroll">${visibleByWeight.map(([weight, entries]) => entries.length ? `<section class="roster-weight-group"><div class="roster-weight-heading">${weight} ${weight === 'assault' ? '— 80–100 tons' : weight === 'heavy' ? '— 60–75 tons' : weight === 'medium' ? '— 40–55 tons' : '— 20–35 tons'}</div><div class="roster-chassis-list">${chassisGroups(entries).map(chassisGroup).join('')}</div></section>` : '').join('')}<div id="lobby-roster-search-empty" class="roster-empty" hidden>No supported BattleMechs match the search and filters.</div></div>`;
  filterLobbyRosterSearch(lobbyRosterFilters.search);
}

function deploymentZoneContains(seat, col, row) {
  return row >= 0 && row < GRID_ROWS && (seat === 1 ? col >= 0 && col <= 4 : col >= 11 && col < GRID_COLS);
}

function deploymentHexPoints(col, row) {
  const root3 = Math.sqrt(3);
  const centerX = root3 * (col + 0.5 * (row & 1)) + root3 / 2;
  const centerY = row * 1.5 + 1;
  return Array.from({ length: 6 }, (_, index) => {
    const angle = (60 * index + 30) * Math.PI / 180;
    return `${(centerX + Math.cos(angle)).toFixed(3)},${(centerY + Math.sin(angle)).toFixed(3)}`;
  }).join(' ');
}

function renderLobbyDeployment(gameState) {
  const section = document.getElementById('lobby-deployment-section');
  const target = document.getElementById('lobby-deployment');
  if (!section || !target) return;
  if (vsAiMode || !mySeatNumber || !gameState.map_id) { section.hidden = true; return; }
  section.hidden = false;
  const roster = gameState.rosters?.[String(mySeatNumber)] || [];
  const positions = gameState.deployment_positions?.[String(mySeatNumber)] || [];
  if (lobbyDeploymentIndex >= roster.length) lobbyDeploymentIndex = 0;
  const units = roster.map((id, index) => {
    const unit = getSupportedUnit(id);
    const placed = positions[index];
    return `<button class="${index === lobbyDeploymentIndex ? 'selected' : ''}" onclick="selectLobbyDeploymentUnit(${index})">${unit?.chassis || id}${placed ? ` · ${hexCode(placed.col, placed.row)}` : ' · choose hex'}</button>`;
  }).join('');
  const occupied = new Map(Object.entries(gameState.deployment_positions || {}).flatMap(([seat, list]) => (list || []).map(p => [`${p.col},${p.row}`, Number(seat)])));
  const cells = [];
  for (let row = 0; row < GRID_ROWS; row++) for (let col = 0; col < GRID_COLS; col++) {
    const owner = occupied.get(`${col},${row}`);
    const mine = deploymentZoneContains(mySeatNumber, col, row);
    const terrain = terrainAt(col, row);
    const level = elevationAt(col, row);
    const description = `${hexCode(col,row)} · ${terrain.replace('_',' ')}${level ? ` · level ${level}` : ''}${owner ? ` · Player ${owner}` : mine ? ' · your deployment zone' : ' · opponent deployment zone'}`;
    const canPlace = mine && !owner;
    const action = canPlace ? `onclick="placeLobbyDeployment(${col},${row})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();placeLobbyDeployment(${col},${row})}"` : '';
    cells.push(`<polygon class="deployment-hex ${mine ? 'zone' : 'enemy-zone'} ${owner ? 'occupied' : ''} ${terrain}" points="${deploymentHexPoints(col,row)}" role="button" tabindex="${canPlace ? '0' : '-1'}" aria-label="${description}" ${action}><title>${description}</title></polygon>`);
  }
  const selected = positions[lobbyDeploymentIndex];
  const facingButtons = selected ? HEX_DIR_LABELS.map((label, facing) => `<button class="${selected.facing === facing ? 'selected' : ''}" onclick="setLobbyDeploymentFacing(${facing})">${label}</button>`).join('') : '';
  const mapWidth = Math.sqrt(3) * (GRID_COLS + 0.5);
  const mapHeight = (GRID_ROWS - 1) * 1.5 + 2;
  target.innerHTML = `<div class="deployment-help">${positions.length}/${roster.length} placed. Choose each BattleMech, then click an empty green hex on your side. Amber hexes are occupied; the tooltip identifies terrain and elevation.</div><div class="deployment-unit-row">${units || 'Choose a roster first.'}</div>${selected ? `<div class="deployment-unit-row"><span class="deployment-help">Starting facing:</span>${facingButtons}</div>` : ''}<svg class="deployment-map" viewBox="0 0 ${mapWidth.toFixed(3)} ${mapHeight}" aria-label="Battlefield deployment hexes">${cells.join('')}</svg><div class="deployment-unit-row"><button onclick="resetLobbyDeployment()">Reset My Deployment</button></div>`;
}

async function selectLobbyDeploymentUnit(index) {
  const { data: game } = await db.from('btech_games').select('state').eq('id', currentGameId).single();
  const state = game?.state ? (typeof game.state === 'string' ? JSON.parse(game.state) : game.state) : {};
  const placed = state.deployment_positions?.[String(mySeatNumber)] || [];
  if (index > placed.length) {
    document.getElementById('lobby-status').textContent = 'Place BattleMechs in roster order so their positions stay matched to the roster.';
    return;
  }
  lobbyDeploymentIndex = index;
  loadLobbyUI();
}

async function placeLobbyDeployment(col, row) {
  if (!deploymentZoneContains(mySeatNumber, col, row)) return;
  const { data: game } = await db.from('btech_games').select('state').eq('id', currentGameId).single();
  const state = game?.state ? (typeof game.state === 'string' ? JSON.parse(game.state) : game.state) : {};
  const positions = [...(state.deployment_positions?.[String(mySeatNumber)] || [])];
  positions[lobbyDeploymentIndex] = { col, row, facing: mySeatNumber === 1 ? 0 : 3 };
  const { error } = await db.rpc('set_match_deployment', { p_game_id: currentGameId, p_positions: positions });
  if (error) { document.getElementById('lobby-status').textContent = `Deployment rejected: ${error.message}`; return; }
  await loadLobbyUI();
}

async function setLobbyDeploymentFacing(facing) {
  const { data: game } = await db.from('btech_games').select('state').eq('id', currentGameId).single();
  const state = game?.state ? (typeof game.state === 'string' ? JSON.parse(game.state) : game.state) : {};
  const positions = [...(state.deployment_positions?.[String(mySeatNumber)] || [])];
  if (!positions[lobbyDeploymentIndex]) return;
  positions[lobbyDeploymentIndex] = { ...positions[lobbyDeploymentIndex], facing };
  const { error } = await db.rpc('set_match_deployment', { p_game_id: currentGameId, p_positions: positions });
  if (error) { document.getElementById('lobby-status').textContent = `Facing rejected: ${error.message}`; return; }
  await loadLobbyUI();
}

async function resetLobbyDeployment() {
  const { error } = await db.rpc('set_match_deployment', { p_game_id: currentGameId, p_positions: [] });
  if (error) { document.getElementById('lobby-status').textContent = `Reset rejected: ${error.message}`; return; }
  lobbyDeploymentIndex = 0;
  await loadLobbyUI();
}

async function toggleRosterUnit(unitId) {
  if (!currentGameId || !currentUser || vsAiMode || !isSupportedUnit(unitId)) return;
  const { data: game, error } = await db.from('btech_games').select('state').eq('id', currentGameId).single();
  if (error || !game) return;
  const state = game.state ? (typeof game.state === 'string' ? JSON.parse(game.state) : game.state) : {};
  const rosterKey = String(mySeatNumber);
  const roster = [...(state.rosters?.[rosterKey] || [])];
  const index = roster.indexOf(unitId);
  if (index >= 0) roster.splice(index, 1);
  else if (rosterTonnage(roster) + getSupportedUnit(unitId).tonnage <= Number(state.dropship_tonnage)) roster.push(unitId);
  else return;
  state.rosters = { ...(state.rosters || {}), [rosterKey]: roster };
  const { error: updateError } = await db.rpc('update_lobby_roster', {
    p_game_id: currentGameId,
    p_roster: roster
  });
  if (updateError) {
    console.error('Failed to save lobby roster:', updateError);
    document.getElementById('lobby-status').textContent = 'Roster could not be saved. Please refresh and try again.';
    return;
  }
  isReady = false;
  const { error: readyError } = await db.from('btech_players')
    .update({ ready: false })
    .eq('game_id', currentGameId)
    .eq('user_id', currentUser.id);
  if (readyError) console.error('Failed to clear readiness after roster change:', readyError);
  await loadLobbyUI();
}

async function handleReadyUp() {
  if (!currentGameId || !currentUser) return;

  const { data: player } = await db
    .from('btech_players')
    .select('*')
    .eq('game_id', currentGameId)
    .eq('user_id', currentUser.id)
    .single();

  if (!player) return;

  const newReady = !player.ready;
  if (newReady) {
    const { data: game } = await db.from('btech_games').select('state').eq('id', currentGameId).single();
    const state = game?.state ? (typeof game.state === 'string' ? JSON.parse(game.state) : game.state) : {};
    if (!vsAiMode && !isRosterLegal(state.rosters?.[String(player.seat_number)], state.dropship_tonnage)) {
      document.getElementById('lobby-status').textContent = 'Choose a legal roster before readying up.';
      return;
    }
    if (!vsAiMode && (state.deployment_positions?.[String(player.seat_number)] || []).length !== (state.rosters?.[String(player.seat_number)] || []).length) {
      document.getElementById('lobby-status').textContent = 'Place every BattleMech in your deployment zone before readying up.';
      return;
    }
  }
  isReady = newReady;

  await db
    .from('btech_players')
    .update({ ready: newReady })
    .eq('id', player.id);
}

async function handleStartGame() {
  if (!isHost || !currentGameId) return;

  // Get all players
  const { data: players } = await db
    .from('btech_players')
    .select('*')
    .eq('game_id', currentGameId)
    .eq('role', 'player');

  if (!players || players.length !== 2) {
    document.getElementById('lobby-status').textContent = 'Two player seats are required to start.';
    return;
  }

  // In AI mode, we only need 1 human player (AI auto-readies)
  // In multiplayer, all players must be ready
  if (!vsAiMode) {
    const allReady = players.every(p => p.ready === true);
    if (!allReady) {
      document.getElementById('lobby-status').textContent = 'All players must be ready!';
      return;
    }
  }

  // Store AI difficulty and mode in game state
  const { data: game } = await db
    .from('btech_games')
    .select('state,catalogue_version')
    .eq('id', currentGameId)
    .single();

  const gameState = game?.state ? (typeof game.state === 'string' ? JSON.parse(game.state) : game.state) : {};
  if (game?.catalogue_version) {
    await loadUnitCatalogue(game.catalogue_version);
    gameState.catalogue_version = game.catalogue_version;
  }
  if (!vsAiMode) {
    const rostersValid = players.every(player => isRosterLegal(gameState.rosters?.[String(player.seat_number)], gameState.dropship_tonnage));
    if (!rostersValid) {
      document.getElementById('lobby-status').textContent = 'Each player needs a legal roster within the dropship limit.';
      return;
    }
    gameState.mech_instances = buildRosterInstances(gameState.rosters, gameState.skirmish_avatars, gameState.deployment_positions);
  }
  gameState.vs_ai_mode = vsAiMode;
  gameState.ai_difficulty = aiDifficulty;

  // Single update call — set up game but leave phase at 'initiative' for manual roll
  await db
    .from('btech_games')
    .update({
      status: 'in-progress',
      current_round: 1,
      current_phase: 'initiative',
      state: JSON.stringify(gameState)
    })
    .eq('id', currentGameId);

  // Transition to game screen
  startGameScreen();
}

function buildRosterInstances(rosters, skirmishAvatars = {}, deploymentPositions = {}) {
  const deployment = {
    1: [
      { col: 4, row: 4, facing: 0 }, { col: 3, row: 5, facing: 0 },
      { col: 4, row: 6, facing: 0 }, { col: 3, row: 7, facing: 0 },
      { col: 4, row: 8, facing: 0 }, { col: 5, row: 6, facing: 0 }
    ],
    2: [
      { col: 11, row: 4, facing: 3 }, { col: 12, row: 5, facing: 3 },
      { col: 11, row: 6, facing: 3 }, { col: 12, row: 7, facing: 3 },
      { col: 11, row: 8, facing: 3 }, { col: 10, row: 6, facing: 3 }
    ]
  };
  return [1, 2].flatMap(seat => (rosters?.[String(seat)] || []).map((unitId, index) => {
    const position = deploymentPositions?.[String(seat)]?.[index] || deployment[seat][index];
    const unit = getSupportedUnit(unitId);
    const avatar = skirmishAvatars?.[String(seat)] || {};
    const deployedEntries = (avatar.deployed || []).map(entryId => (avatar.hangar || []).find(entry => entry.id === entryId)).filter(Boolean);
    const pilot = skirmishPilotForEntry(deployedEntries[index] || (avatar.hangar || []).find(entry => entry.unit_id === unitId));
    return {
      instanceId: `${unitId}-p${seat}-${index + 1}`,
      unitId, owner: seat, col: position.col, row: position.row,
      facing: position.facing, torsoFacing: position.facing,
      // The server is authoritative for damage and movement. Save the full
      // starting record here rather than relying on the browser-only display
      // hydrator, which would otherwise make absent legs look destroyed.
      armor: { ...(unit?.armor || {}) },
      structure: { ...(unit?.structure || {}) },
      ammoBins: (unit?.ammoBins || []).map(bin => ({ ...bin, maxShots: bin.maxShots ?? bin.shots })),
      heat: 0, roundStartingHeat: 0, weaponHeat: 0, movementHeat: 0,
      pilot: { ...pilot, hits: 0, consciousness: 'conscious' },
      pilotingSkill: pilot.piloting,
      criticalSlotDamage: {}, weaponJams: [],
      ...(activeCatalogueVersion ? { catalogueVersion: activeCatalogueVersion } : {})
    };
  }));
}

async function startGameScreen() {
  stopLobbySubscriptions();

  showScreen('game-screen');
  gameLog = [];
  renderGameLog();
  initGame();
  // Finish the initial snapshot before listening for changes. Otherwise a
  // slower initial read can overwrite a newer realtime turn hand-off.
  await loadGameState();
  subscribeGameStateSync();
  subscribePersistentGameLog();
}

// Keep unit positions/facings/movement in sync between both browsers during play.
function subscribeGameStateSync() {
  if (gameStateSubscription) { gameStateSubscription.unsubscribe(); gameStateSubscription = null; }
  if (!currentGameId) return;

  gameStateSubscription = db
    .channel('btech_games_state:' + currentGameId)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'btech_games', filter: `id=eq.${currentGameId}` },
      async (payload) => {
        const remote = payload.new;
        if (remote.status !== 'in-progress') {
          console.warn('[BT-DIAG] Game status changed while game screen is active:', remote.status);
          logEvent(`Diagnostic: database game status changed to ${remote.status}. No automatic lobby navigation is performed.`, 'error');
        }
        // Round/phase bookkeeping
        currentGameState.round = remote.current_round || currentGameState.round;
        currentGameState.phase = remote.current_phase || currentGameState.phase;
        currentGameState.initiative_winner = remote.initiative_winner;
        const gs = remote.state ? (typeof remote.state === 'string' ? JSON.parse(remote.state) : remote.state) : {};
        if (remote.catalogue_version) await loadUnitCatalogue(remote.catalogue_version);
        setActiveMap(gs.map_id);
        currentMatchConfig = {
          ...(gs.map_id ? { map_id: gs.map_id } : {}),
          ...(gs.dropship_tonnage ? { dropship_tonnage: gs.dropship_tonnage } : {}),
          ...(gs.rosters ? { rosters: gs.rosters } : {}),
          ...(typeof gs.vs_ai_mode === 'boolean' ? { vs_ai_mode: gs.vs_ai_mode } : {}),
          ...(gs.ai_difficulty ? { ai_difficulty: gs.ai_difficulty } : {}),
          ...(remote.catalogue_version ? { catalogue_version: remote.catalogue_version } : {})
        };
        // Realtime updates must update this too: a tab may previously have
        // been used for an AI match before entering a human game.
        vsAiMode = gs.vs_ai_mode === true;
        // active_player_id is the authoritative database column. The state
        // copy exists for a single JSON snapshot, but can briefly lag behind
        // during concurrent human actions and must not steal a player's turn.
        currentGameState.active_player_id = remote.active_player_id || gs.active_player_player_id || null;
        // Empty arrays/null are meaningful here: they are how an initiative
        // tie resets both players for a re-roll. Never retain stale values.
        currentGameState.initiative_order = gs.initiative_order || [];
        currentGameState.initiative_rolls = gs.initiative_rolls || [];
        currentGameState.initiative_round = gs.initiative_round ?? null;
        currentGameState.initiative_pending = gs.initiative_pending || [];
        currentGameState.phase_activation = gs.phase_activation || null;
        currentGameState.match_result = gs.match_result || null;
        mergeRemoteLog(gs.log);

        const initBtn = document.getElementById('btn-roll-initiative');
        if (initBtn) initBtn.disabled = (currentGameState.initiative_round === currentGameState.round);

        // Don't clobber a move currently in progress locally
        if (gs.mech_instances && !moveState.active) {
          mechInstances = gs.mech_instances;
          // The compact multiplayer state stores only unit placement and
          // action flags. Restore derived combat fields before any panel can
          // inspect armour or structure after a realtime update.
          mechInstances.forEach(ensureMechCombatState);
          if (selectedInstanceId && !mechInstances.some(m => m.instanceId === selectedInstanceId)) {
            selectedInstanceId = null;
          }
          draw();
          renderRoster();
          renderDetail();
        }
        await loadWeaponCombatEvents();
        await loadResolvedPhysicalEvents();

        updateGameHeader();
        renderInitiativeDisplay();
        renderMovementPanel();
        renderReactionPanel();
        renderWeaponAttackPanel();
        renderPhysicalAttackPanel();
        renderHeatPanel();
        renderEndPanel();
        updateAdvanceButtonState();
        scheduleActiveAiTurn();
      }
    )
    .subscribe();
}

async function handleLeaveLobby() {
  if (!currentGameId) return;

  // The host intentionally closes the room below. Stop listening first so
  // their own DELETE event does not display the room-closed notice.
  lobbyClosureInProgress = true;
  stopLobbySubscriptions();

  // A host deletes the game itself; its player rows are removed by the
  // btech_players.game_id ON DELETE CASCADE relationship.
  if (isHost) {
    const { error: clearError } = await db
      .from('btech_games')
      .update({ active_player_id: null, initiative_winner: null })
      .eq('id', currentGameId);
    if (clearError) {
      console.error('Failed to clear game turn references before leaving:', clearError);
      lobbyClosureInProgress = false;
      await loadLobby();
      return;
    }

    const { error: deleteError } = await db.from('btech_games').delete().eq('id', currentGameId);
    if (deleteError) {
      console.error('Failed to delete hosted game:', deleteError);
      lobbyClosureInProgress = false;
      await loadLobby();
      return;
    }
  } else if (currentUser) {
    await db
      .from('btech_players')
      .delete()
      .eq('game_id', currentGameId)
      .eq('user_id', currentUser.id);
  }

  currentGameId = null;
  isHost = false;
  isReady = false;
  mySeatNumber = null;
  lobbyClosureInProgress = false;
  showScreen('menu-screen');
}
