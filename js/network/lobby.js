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
let lobbyMinefieldMode = null;
let lobbyMinefieldDensity = 20;
let lobbyVibrabombSensitivity = 50;
let lobbyMinefieldView = [];

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
  const minefieldView = await db.rpc('get_match_minefield_view', { p_game_id:currentGameId });
  lobbyMinefieldView = minefieldView.error ? [] : (minefieldView.data || []);
  gameState.minefields = lobbyMinefieldView;
  if (gameState.custom_scenario) registerCustomMapDefinition(gameState.custom_scenario);
  if (gameState.map_id) setActiveMap(gameState.map_id);
  setActiveTerrainState(gameState);
  const rosterUnitIds = Object.values(gameState.rosters || {}).flat();
  if (game.catalogue_version && rosterUnitIds.some(unitId => !databaseSupportedUnitIds.has(unitId))) {
    try { await loadUnitCatalogue(game.catalogue_version, true); }
    catch (error) { console.warn('Unable to refresh newly published custom BattleMech:', error); }
  }
  if (typeof gameState.vs_ai_mode === 'boolean') vsAiMode = gameState.vs_ai_mode;
  if (gameState.ai_difficulty) aiDifficulty = AI_DIFFICULTY_KEYS.includes(gameState.ai_difficulty) ? gameState.ai_difficulty : 'beginner';
  if (gameState.ai_personality) aiPersonality = AI_PERSONALITY_KEYS.includes(gameState.ai_personality) ? gameState.ai_personality : 'balanced';

  // Every human player receives a temporary Avatar when opening a skirmish
  // lobby. It belongs to this match only; campaign persistence comes later.
  if (mySeatNumber && !skirmishAvatarForSeat(gameState, mySeatNumber) && !skirmishAvatarEnsureInFlight) {
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
          ? `AI ${titleCase(aiDifficulty)} · ${AI_PERSONALITY_LABELS[aiPersonality]}`
          : escapeHtml(skirmishAvatarForSeat(gameState, player.seat_number)?.callsign || `Commander ${player.seat_number}`);
        const isCurrentPlayer = !isAI && player.user_id === currentUser?.id;
        if (isCurrentPlayer) isReady = player.ready === true;
        const isReadyClass = player.ready ? 'ready' : '';
        const readyText = player.ready ? 'READY' : 'NOT READY';
        const currentTag = isCurrentPlayer ? ' (you)' : '';
        const aiTag = isAI ? ' 🤖' : '';
        const rosterSummary = gameState.map_id
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
  renderLobbyC3Networks(gameState);
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
    const rostersReady = playerSeats.every(player => isRosterLegal(gameState.rosters?.[String(player.seat_number)], gameState.dropship_tonnage, matchRuleset(gameState), gameState, player.seat_number));
    const deploymentsReady = playerSeats.every(player => (gameState.deployment_positions?.[String(player.seat_number)] || []).length === (gameState.rosters?.[String(player.seat_number)] || []).length);
    const canStart = vsAiMode
      ? playerSeats.length === 2 && playerSeats.some(player => !player.is_ai && player.ready) && rostersReady && deploymentsReady
      : playerSeats.length === 2 && playerSeats.every(player => player.ready) && rostersReady && deploymentsReady;
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
  currentGameCode = null;
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

// BV-2 uses the same published, versioned G/P factors as the server. This is
// display/preflight only; update_skirmish_hangar remains the authority.
// Combined Gunnery/Piloting table: TechManual p.315, verified against MegaMek BVCalculator.
const BV2_SKILL_MULTIPLIERS = Object.freeze([[2.42, 2.31, 2.21, 2.1, 1.93, 1.75, 1.68, 1.59, 1.5], [2.21, 2.11, 2.02, 1.92, 1.76, 1.6, 1.54, 1.46, 1.38], [1.93, 1.85, 1.76, 1.68, 1.54, 1.4, 1.35, 1.28, 1.21], [1.66, 1.58, 1.51, 1.44, 1.32, 1.2, 1.16, 1.1, 1.04], [1.38, 1.32, 1.26, 1.2, 1.1, 1.0, 0.95, 0.9, 0.85], [1.31, 1.19, 1.13, 1.08, 0.99, 0.9, 0.86, 0.81, 0.77], [1.24, 1.12, 1.07, 1.02, 0.94, 0.85, 0.81, 0.77, 0.72], [1.17, 1.06, 1.01, 0.96, 0.88, 0.8, 0.76, 0.72, 0.68], [1.1, 0.99, 0.95, 0.9, 0.83, 0.75, 0.71, 0.68, 0.64]].map(row => Object.freeze(row)));

function bv2ForceLimit(state) {
  const forceLimit = state?.force_limit;
  if (!forceLimit || forceLimit.mode !== 'bv2') return null;
  const limit = Number(forceLimit.limit);
  return Number.isInteger(limit) && limit > 0 && (forceLimit.bv_version || 'BV2.1') === 'BV2.1' ? limit : null;
}

function bv2EntryValue(unit, pilot = {}) {
  const stock = Number(unit?.battleValue?.stock);
  const gunnery = Number(pilot?.gunnery ?? 4);
  const piloting = Number(pilot?.piloting ?? 5);
  if (!Number.isInteger(stock) || stock <= 0 || !Number.isInteger(gunnery) || !Number.isInteger(piloting) || !BV2_SKILL_MULTIPLIERS[gunnery]?.[piloting]) return null;
  return { stock, gunnery, piloting, adjusted:Math.round(stock * BV2_SKILL_MULTIPLIERS[gunnery][piloting]) };
}

function bv2RosterValue(roster, gameState = null, seatNumber = mySeatNumber) {
  const avatar = skirmishAvatarForSeat(gameState, seatNumber);
  const entriesById = new Map((avatar?.hangar || []).map(entry => [entry.id, entry]));
  const deployed = avatar?.deployed || [];
  const selected = deployed.length ? deployed.map(id => entriesById.get(id)).filter(Boolean) : (roster || []).map(unitId => ({ unit_id:unitId, pilot:{ gunnery:4, piloting:5 } }));
  const values = selected.map(entry => bv2EntryValue(getSupportedUnit(entry.unit_id), skirmishPilotForEntry(entry))).filter(Boolean);
  return values.length === selected.length ? values.reduce((total, value) => ({ stock:total.stock + value.stock, adjusted:total.adjusted + value.adjusted }), { stock:0, adjusted:0 }) : null;
}

function isRosterLegal(roster, tonnageLimit, ruleset = 'advanced_3060', gameState = null, seatNumber = mySeatNumber) {
  const units = roster || [];
  const baseLegal = units.length > 0 && units.every(unitId => {
    const unit = getSupportedUnit(unitId);
    return isSupportedUnit(unitId) && unitRulesetStatus(unitId, unit, ruleset).allowed;
  });
  if (!baseLegal) return false;
  const bvLimit = bv2ForceLimit(gameState);
  if (bvLimit != null) {
    const value = bv2RosterValue(units, gameState, seatNumber);
    return Boolean(value && value.adjusted <= bvLimit);
  }
  return rosterTonnage(units) <= Number(tonnageLimit || 0);
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
  if (!currentGameId || !currentUser || !isSupportedUnit(unitId)) return;
  const { data: game, error } = await db.from('btech_games').select('state').eq('id', currentGameId).single();
  if (error || !game) return;
  const state = typeof game.state === 'string' ? JSON.parse(game.state) : (game.state || {});
  const avatar = skirmishAvatarForSeat(state, mySeatNumber);
  const hangar = [...(avatar?.hangar || [])];
  if (hangar.length >= 12) { document.getElementById('lobby-status').textContent = 'A Skirmish Hangar can hold up to 12 BattleMechs.'; return; }
  const entryId = skirmishHangarId();
  const clanPilot = techBaseForUnit(getSupportedUnit(unitId)) === 'clan';
  hangar.push({ id: entryId, unit_id: unitId, pilot: { id: `pilot-${entryId}`, name: 'MechWarrior', gunnery: clanPilot ? 3 : 4, piloting: clanPilot ? 4 : 5 } });
  await saveSkirmishHangar(hangar, [...(avatar?.deployed || [])]);
}

const skirmishPilotDrafts = new Map();
function pilotDraftKey(entryId) { return `${currentGameId}:${entryId}`; }
function markSkirmishPilotDirty(entryId) {
 if (isReady && currentGameId && currentUser) {
  isReady = false;
  db.from('btech_players').update({ready:false}).eq('game_id',currentGameId).eq('user_id',currentUser.id).then(({error}) => {
   if (error) document.getElementById('lobby-status').textContent = `Could not clear Ready after editing the pilot: ${error.message}`;
  });
 }
 const read = field => document.getElementById(`hangar-pilot-${field}-${entryId}`)?.value;
 skirmishPilotDrafts.set(pilotDraftKey(entryId), {name:read('name'),gunnery:Number(read('gunnery')),piloting:Number(read('piloting'))});
 const status = document.getElementById(`pilot-save-status-${entryId}`);
 if (status) status.textContent = 'Unsaved name / skills — click Save Pilot before Ready.';
}
function hasUnsavedSkirmishPilots() {
 return [...skirmishPilotDrafts.keys()].some(key => key.startsWith(`${currentGameId}:`));
}
async function saveSkirmishPilot(entryId) {
  if (!currentGameId || !currentUser) return;
  const nameInput = document.getElementById(`hangar-pilot-name-${entryId}`);
  const gunneryInput = document.getElementById(`hangar-pilot-gunnery-${entryId}`);
  const pilotingInput = document.getElementById(`hangar-pilot-piloting-${entryId}`);
  const name = String(nameInput?.value || '').trim();
  const gunnery = Number(gunneryInput?.value ?? 4);
  const piloting = Number(pilotingInput?.value ?? 5);
  const draft = skirmishPilotDrafts.get(pilotDraftKey(entryId));
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
      gunnery,
      piloting
    }
  } : entry);
  if (await saveSkirmishHangar(hangar, [...(avatar?.deployed || [])])) {
    if (skirmishPilotDrafts.get(pilotDraftKey(entryId)) === draft) {
      skirmishPilotDrafts.delete(pilotDraftKey(entryId));
      const status = document.getElementById(`pilot-save-status-${entryId}`);
      if (status) status.textContent = 'Pilot name and skills saved.';
    }
  }
}

async function removeSkirmishHangarMech(entryId) {
  if (!currentGameId || !currentUser) return;
  const { data: game, error } = await db.from('btech_games').select('state').eq('id', currentGameId).single();
  if (error || !game) return;
  const state = typeof game.state === 'string' ? JSON.parse(game.state) : (game.state || {});
  const avatar = skirmishAvatarForSeat(state, mySeatNumber);
  const hangar = (avatar?.hangar || []).filter(entry => entry.id !== entryId);
  const deployed = (avatar?.deployed || []).filter(id => id !== entryId);
  if (await saveSkirmishHangar(hangar, deployed)) skirmishPilotDrafts.delete(pilotDraftKey(entryId));
}

async function toggleSkirmishDeployment(entryId) {
  if (!currentGameId || !currentUser) return;
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

  if (!gameState.map_id) {
    settingsEl.innerHTML = '<div class="match-setting-summary">Match setup is incomplete.</div>';
    rosterSection.hidden = true;
    return;
  }

  const map = getMapDefinition(gameState.map_id);
  const ruleset = matchRuleset(gameState);
  const limit = Number(gameState.dropship_tonnage || 0);
  const bvLimit = bv2ForceLimit(gameState);
  const beginnerScenario = gameState.beginner_scenario;
  const customScenario = gameState.custom_scenario;
  const victoryLabel = ({ annihilation: 'Annihilation', control: 'Objective Control (first to 5)', breakthrough: 'Breakthrough (2 BattleMechs)' })[gameState.victory_mode] || 'Annihilation';
  const aiRoster = (gameState.rosters?.['2'] || []).map(unitId => {
    const unit = getSupportedUnit(unitId); return unit ? `${unit.chassis} ${unit.variant}` : unitId;
  }).join(', ') || 'not generated';
  const aiDetails = vsAiMode ? `<br>Opponent: <strong>${escapeHtml(titleCase(aiDifficulty))} · ${escapeHtml(AI_PERSONALITY_LABELS[aiPersonality])}</strong><br>AI force: <strong>${escapeHtml(aiRoster)}</strong><br><small>Build and deploy your force below. The AI is already deployed for this battlefield and mission.</small>` : '';
  settingsEl.innerHTML = `<div class="match-setting-summary"><strong>${escapeHtml(beginnerScenario?.title || customScenario?.name || map.name)}</strong><br>${escapeHtml(beginnerScenario?.instructions || customScenario?.instructions || map.description)}<br>Battlefield: <strong>${escapeHtml(map.name)}</strong><br>Force limit: <strong>${bvLimit != null ? `${bvLimit.toLocaleString()} BV2` : `${limit} tons per player`}</strong><br>Victory: <strong>${victoryLabel}</strong><br>Ruleset: <strong>${escapeHtml(rulesetLabel(gameState))}</strong>${aiDetails}</div>`;
  if (bvLimit != null) {
    const sides = [1, 2].map(seat => ({
      label: skirmishAvatarForSeat(gameState, seat)?.callsign || `Commander ${seat}`,
      count: (gameState.rosters?.[String(seat)] || []).length,
      value: bv2RosterValue(gameState.rosters?.[String(seat)] || [], gameState, seat)
    }));
    const difference = sides.every(side => side.value && side.count) ? Math.abs(sides[0].value.adjusted - sides[1].value.adjusted) : null;
    settingsEl.innerHTML += `<div class="bv-force-comparison">${sides.map(side => `<div><strong>${escapeHtml(side.label)}</strong><br>${side.count} BattleMech${side.count === 1 ? '' : 's'} · ${side.value ? `${side.value.adjusted.toLocaleString()} BV · ${(bvLimit - side.value.adjusted).toLocaleString()} remaining` : 'BV pending'}</div>`).join('')}<p>${difference == null ? 'Select both forces to compare their BV.' : `Force difference: ${difference.toLocaleString()} BV.`} Values include saved pilot skills.</p></div>`;
  }
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
  const filtered = supportedUnitEntries().filter(([id, unit]) => {
    const tech = techBaseForUnit(unit);
    return (lobbyRosterFilters.tech === 'both' || lobbyRosterFilters.tech === tech) &&
      lobbyRosterFilters.weights.has(weightClassForUnit(unit)) && unitRulesetStatus(id, unit, ruleset).allowed;
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
    const rules = unitRulesetStatus(id, unit, ruleset);
    const disabled = hangar.length >= 12 || !rules.allowed;
    const techLabel = unit.customDesign ? 'Custom IS' : techBaseForUnit(unit) === 'clan' ? 'Clan' : 'Inner Sphere';
    const searchKey = lobbyRosterSearchKey(`${unit.chassis} ${unit.variant} ${id} ${unit.tonnage} ${techLabel}`);
    const favourite = favouriteUnitIds.has(id);
    const favouriteTitle = favourite ? 'Remove this exact variant from favourites' : 'Add this exact variant to favourites';
    const variantName = unit.variant || id;
    const bv = bv2EntryValue(unit);
    return `<div class="roster-option-wrap ${favourite ? 'favourite' : ''}" data-unit-id="${id}" data-search="${searchKey}" data-favourite="${favourite}"><button class="roster-favourite-star ${favourite ? 'active' : ''}" type="button" aria-label="${favouriteTitle}" aria-pressed="${favourite}" title="${favouriteTitle}" onclick="toggleLobbyUnitFavourite(event,'${id}')">${favourite ? '★' : '☆'}</button><button class="roster-option" onclick="addMechToSkirmishHangar('${id}')" ${disabled ? 'disabled' : ''} title="${rules.allowed ? 'Add to your match-only Hangar' : `Unavailable in ${BT_RULESETS[ruleset].name}: ${rules.reason}`}" ><span class="roster-option-name">${escapeHtml(variantName)}</span><span class="roster-option-tonnage">${unit.tonnage} tons · ${techLabel}${bv ? ` · ${bv.stock.toLocaleString()} BV2` : ' · BV pending'}${inHangar ? ` · ${inHangar} in Hangar` : ''}</span><span class="roster-option-speed">${movementSummary(unit)}</span><span class="roster-option-weapons" title="${escapeHtml(weaponSummary(unit))}">${escapeHtml(weaponSummary(unit))}</span></button></div>`;
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
    return `<section class="roster-chassis-group ${expanded ? 'expanded' : ''}" data-chassis-key="${group.chassisKey}"><button class="roster-chassis-toggle" type="button" aria-expanded="${expanded}" onclick="toggleLobbyChassis('${group.chassisKey}')"><span class="roster-chassis-chevron" aria-hidden="true">›</span><strong>${escapeHtml(group.chassisName)} · ${[...new Set(group.entries.map(([, unit]) => unit.tonnage))].sort((a,b) => a-b).join(" / ")} t</strong><span class="roster-chassis-count">${variantLabel}</span></button><div class="roster-chassis-variants roster-options" ${expanded ? '' : 'hidden'}>${group.entries.map(card).join('')}</div></section>`;
  };
  const hangarCards = hangar.map(entry => {
    const unit = getSupportedUnit(entry.unit_id);
    const isDeployed = deployed.includes(entry.id);
    const pilot = skirmishPilotDrafts.get(pilotDraftKey(entry.id)) || skirmishPilotForEntry(entry);
    const bv = bv2EntryValue(unit, pilot);
    return `<div class="hangar-entry ${isDeployed ? 'deployed' : ''}">
      <div class="hangar-mech">${unitArtworkThumbnail(entry.unit_id)}<strong>${unit ? `${unit.chassis} ${unit.variant}` : escapeHtml(entry.unit_id)}</strong><span>${unit?.tonnage || '?'} tons${bv ? ` · ${bv.stock.toLocaleString()} BV2 stock · ${bv.adjusted.toLocaleString()} adjusted` : ' · BV pending'}${isDeployed ? ' · DROPSHIP' : ''}</span></div>
      <div class="hangar-pilot-fields">
        <label>Pilot<input id="hangar-pilot-name-${entry.id}" oninput="markSkirmishPilotDirty('${entry.id}')" maxlength="48" value="${escapeHtml(pilot.name)}"></label>
        <label>Gunnery<select id="hangar-pilot-gunnery-${entry.id}" oninput="markSkirmishPilotDirty('${entry.id}')">${skirmishSkillOptions(pilot.gunnery)}</select></label>
        <label>Piloting<select id="hangar-pilot-piloting-${entry.id}" oninput="markSkirmishPilotDirty('${entry.id}')">${skirmishSkillOptions(pilot.piloting)}</select></label>
        <button onclick="saveSkirmishPilot('${entry.id}')">Save Pilot</button>
        <span class="pilot-save-status" id="pilot-save-status-${entry.id}" role="status">${skirmishPilotDrafts.has(pilotDraftKey(entry.id)) ? 'Unsaved name / skills — click Save Pilot before Ready.' : 'Name and both skills are saved together with Save Pilot.'}</span>
      </div>
      <div class="hangar-actions"><button onclick="toggleSkirmishDeployment('${entry.id}')">${isDeployed ? 'Remove from Dropship' : 'Add to Dropship'}</button><button onclick="removeSkirmishHangarMech('${entry.id}')">Remove</button></div>
    </div>`;
  }).join('') || '<div class="roster-empty">Add BattleMechs below to build your Hangar.</div>';
  const bvDeployment = bv2RosterValue(roster, gameState, mySeatNumber);
  const deploymentSummary = bvLimit != null ? `Dropship: ${bvDeployment ? bvDeployment.adjusted.toLocaleString() : 'BV pending'} / ${bvLimit.toLocaleString()} BV2 · ${roster.length || 'no'} 'Mech${roster.length === 1 ? '' : 's'} selected` : `Dropship: ${total} / ${limit} tons · ${roster.length || 'no'} 'Mech${roster.length === 1 ? '' : 's'} selected`;
  rosterEl.innerHTML = `<div class="skirmish-avatar"><strong>${avatar?.callsign || `Skirmish Commander P${mySeatNumber}`}</strong><span>Match-only Avatar · each BattleMech has its own pilot</span><button onclick="openMechDesigner()">Open MechLab</button></div><div class="roster-summary">Ruleset: <strong>${BT_RULESETS[ruleset].name}</strong> · ${escapeHtml(BT_RULESETS[ruleset].description)}</div><p class="setup-guidance">Add BattleMechs to your match-only hangar, assign pilots (Clan defaults to Gunnery 3 / Piloting 4; Inner Sphere to 4 / 5), then select your Dropship force. Place those units on the deployment map below.</p><div class="panel-eyebrow" style="margin-top:12px;">Skirmish Hangar · ${rosterTonnage(hangar.map(entry => entry.unit_id))} tons total</div><div class="hangar-list">${hangarCards}</div><div class="roster-summary">${deploymentSummary}</div>
    <div class="roster-search"><label for="lobby-roster-search">Find a BattleMech</label><div><input id="lobby-roster-search" type="search" autocomplete="off" placeholder="Chassis, variant, tonnage or tech base" value="${lobbyRosterFilters.search.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')}" oninput="filterLobbyRosterSearch(this.value)"><button id="lobby-roster-search-clear" type="button" onclick="clearLobbyRosterSearch()">Clear</button></div></div>
    <div class="roster-filter-bar"><span>Quick find</span><button class="roster-filter ${lobbyRosterFilters.favouritesOnly ? 'active' : ''}" onclick="toggleLobbyFavouritesFilter()">★ Favourites</button></div>
    <div class="roster-filter-bar"><span>Tech base</span>${techButton('is', 'Inner Sphere')}${techButton('clan', 'Clan')}${techButton('both', 'Both')}</div>
    <div class="roster-filter-bar"><span>Weight</span>${weightButton('light', 'Light')}${weightButton('medium', 'Medium')}${weightButton('heavy', 'Heavy')}${weightButton('assault', 'Assault')}</div>
    <div class="roster-scroll">${visibleByWeight.map(([weight, entries]) => entries.length ? `<section class="roster-weight-group"><div class="roster-weight-heading">${weight} ${weight === 'assault' ? '— 80–100 tons' : weight === 'heavy' ? '— 60–75 tons' : weight === 'medium' ? '— 40–55 tons' : '— 20–35 tons'}</div><div class="roster-chassis-list">${chassisGroups(entries).map(chassisGroup).join('')}</div></section>` : '').join('')}<div id="lobby-roster-search-empty" class="roster-empty" hidden>No supported BattleMechs match the search and filters.</div></div>`;
  filterLobbyRosterSearch(lobbyRosterFilters.search);
}

function lobbyC3Role(unitId) {
  const labels = Object.values(BT_CRITICAL_LAYOUTS[unitId] || {}).flat().map(label => String(label || '').toLowerCase().replace(/(?:\s*\([^)]*\))+$/, '').replace(/^(is|clan|cl)/, '').replace(/[^a-z0-9]/g, ''));
  if (labels.some(label => ['c3icomputer','improvedc3computer'].includes(label))) return 'c3i';
  if (labels.some(label => ['c3mastercomputer','c3master'].includes(label))) return 'master';
  if (labels.some(label => ['c3slavecomputer','c3slave'].includes(label))) return 'slave';
  return null;
}

function renderLobbyC3Networks(gameState) {
  const section = document.getElementById('lobby-c3-section');
  const target = document.getElementById('lobby-c3-builder');
  if (!section || !target) return;
  const roster = gameState.rosters?.[String(mySeatNumber)] || [];
  const equipped = roster.map((unitId,index) => ({ unitId,index,role:lobbyC3Role(unitId),unit:getSupportedUnit(unitId) })).filter(item => item.role);
  if (vsAiMode || !equipped.length) { section.hidden=true;target.innerHTML='';return; }
  section.hidden=false;
  const assignments = gameState.c3_assignments?.[String(mySeatNumber)] || {};
  const networkOptions = selected => ['', 'A','B','C','D'].map(value => `<option value="${value}" ${value===selected?'selected':''}>${value || 'Offline / unassigned'}</option>`).join('');
  const rows = equipped.map(item => {
    const savedAssignment = assignments[String(item.index)] || {};
    const assignment = savedAssignment.unitId === item.unitId ? savedAssignment : {};
    const masterOptions = [{index:'',label:'Root / no parent'},...equipped.filter(candidate => candidate.role==='master' && candidate.index!==item.index).map(candidate => ({index:String(candidate.index),label:`${candidate.unit?.chassis || candidate.unitId} ${candidate.unit?.variant || ''}`}))];
    const parent = assignment.parent == null ? '' : String(assignment.parent);
    const parentSelect = item.role === 'c3i' ? '<span class="c3-peer-note">Peer network — no master</span>' : `<label>Parent master<select id="c3-parent-${item.index}">${customOptions(masterOptions.map(option=>[option.index,option.label]),parent)}</select></label>`;
    return `<div class="c3-assignment-row" data-c3-index="${item.index}" data-unit-id="${escapeHtml(item.unitId)}"><div><strong>${escapeHtml(item.unit ? `${item.unit.chassis} ${item.unit.variant}` : item.unitId)}</strong><span>${item.role==='c3i'?'C3i peer':item.role==='master'?'C3 Master':'C3 Slave'}</span></div><label>Network<select id="c3-network-${item.index}">${networkOptions(assignment.network || '')}</select></label>${parentSelect}</div>`;
  }).join('');
  target.innerHTML = `<p class="deployment-help">Declare networks before play. Standard C3 uses one root Master with up to three Master or Slave children per controller; C3i uses peer networks of up to six units. Leave equipment offline if it should not be linked.</p><div class="c3-assignment-list">${rows}</div><div class="deployment-unit-row"><button onclick="saveLobbyC3Assignments()">Save Network Assignment</button></div><div id="lobby-c3-status" class="deployment-help"></div>`;
}

async function saveLobbyC3Assignments() {
  const assignments = {};
  for (const row of document.querySelectorAll('.c3-assignment-row[data-c3-index]')) {
    const index = Number(row.dataset.c3Index), network = document.getElementById(`c3-network-${index}`)?.value || '';
    const parentValue = document.getElementById(`c3-parent-${index}`)?.value;
    assignments[String(index)] = { unitId:row.dataset.unitId,network,parent:network && parentValue !== undefined && parentValue !== '' ? Number(parentValue) : null };
  }
  const status = document.getElementById('lobby-c3-status');
  if (status) status.textContent='Saving network…';
  const { error } = await db.rpc('set_match_c3_assignments',{p_game_id:currentGameId,p_assignments:assignments});
  if (error) { if(status) status.textContent=`Network rejected: ${error.message}`;return; }
  isReady=false;
  await loadLobbyUI();
}

function deploymentZoneContains(seat, col, row, gameState = null) {
  return scenarioDeploymentZoneContains(seat, col, row, gameState);
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
  if (!mySeatNumber || !gameState.map_id) { section.hidden = true; return; }
  section.hidden = false;
  prepareDeploymentMapView(gameState);
  const roster = gameState.rosters?.[String(mySeatNumber)] || [];
  const positions = gameState.deployment_positions?.[String(mySeatNumber)] || [];
  const minefields = gameState.minefields || [];
  const myMinefields = minefields.filter(field => Number(field.owner) === Number(mySeatNumber));
  const minefieldRules = gameState.minefield_rules || { budget:40, permitted_types:['conventional','vibrabomb'], permitted_densities:[10,20,30], vibrabomb_sensitivities:[20,30,40,50,60,70,80,90,100] };
  const minefieldBudget = Number(minefieldRules.budget ?? 40);
  const minefieldSpent = myMinefields.reduce((total, field) => total + Number(field.density || 0), 0);
  if (lobbyDeploymentIndex >= roster.length) lobbyDeploymentIndex = 0;
  const units = roster.map((id, index) => {
    const unit = getSupportedUnit(id);
    const placed = positions[index];
    return `<button class="${index === lobbyDeploymentIndex ? 'selected' : ''}" onclick="selectLobbyDeploymentUnit(${index})">${unit?.chassis || id}${placed ? ` · ${hexCode(placed.col, placed.row)}` : ' · choose hex'}</button>`;
  }).join('');
  const occupied = new Map(Object.entries(gameState.deployment_positions || {}).flatMap(([seat, list]) => (list || []).map(p => [`${p.col},${p.row}`, Number(seat)])));
  const cells = [];
  const mapLabels = [];
  for (let row = 0; row < GRID_ROWS; row++) for (let col = 0; col < GRID_COLS; col++) {
    const owner = occupied.get(`${col},${row}`);
    const mine = deploymentZoneContains(mySeatNumber, col, row, gameState);
    const enemy = deploymentZoneContains(mySeatNumber === 1 ? 2 : 1, col, row, gameState);
    const terrain = terrainAt(col, row);
    const level = elevationAt(col, row);
    const description = `${terrainDescription(col,row)}${owner ? ` · Player ${owner}` : mine ? ' · your deployment zone' : enemy ? ' · opponent deployment zone' : ' · neutral ground'}`;
    const canPlaceMech = mine && !owner && !terrainMovementBlocked(col, row);
    const field = myMinefields.find(candidate => Number(candidate.col) === col && Number(candidate.row) === row);
    const fieldIndex = field ? myMinefields.indexOf(field) : -1;
    const canPlaceMine = lobbyMinefieldMode && minefieldSpent + lobbyMinefieldDensity <= minefieldBudget && mine && !owner && !field && !['deep_water','shallow_water','building','impassable','magma_liquid'].includes(terrain);
    const handler = field ? `removeLobbyMinefield(${fieldIndex})` : lobbyMinefieldMode ? `placeLobbyMinefield(${col},${row})` : `placeLobbyDeployment(${col},${row})`;
    const canInteract = Boolean(field || (lobbyMinefieldMode ? canPlaceMine : canPlaceMech));
    const action = canInteract ? `onclick="${handler}" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();${handler}}"` : '';
    cells.push(`<polygon class="deployment-hex ${mine ? 'zone' : enemy ? 'enemy-zone' : 'neutral-zone'} ${owner ? 'occupied' : ''} ${field ? 'minefield removable' : ''} ${terrain}" points="${deploymentHexPoints(col,row)}" role="button" tabindex="${canInteract ? '0' : '-1'}" aria-label="${description}${field ? ` · your ${field.type} minefield · activate to remove` : ''}" ${action}><title>${description}${field ? ` · your ${field.type} minefield · click to remove` : ''}</title></polygon>`);
    const centre = deploymentMapCentre(col, row);
    mapLabels.push(`<text class="deployment-hex-code" x="${centre.x}" y="${centre.y + .58}" transform="rotate(${-deploymentMapView.rotation} ${centre.x} ${centre.y + .58})">${hexCode(col,row)}</text>`);
  }
  const selected = positions[lobbyDeploymentIndex];
  const facingButtons = selected ? HEX_DIR_LABELS.map((label, facing) => `<button class="${selected.facing === facing ? 'selected' : ''}" onclick="setLobbyDeploymentFacing(${facing})">${label}</button>`).join('') : '';
  const mapWidth = Math.sqrt(3) * (GRID_COLS + 0.5);
  const mapHeight = (GRID_ROWS - 1) * 1.5 + 2;
  const hiddenTerrain = selected && !['clear','pavement','bridge','shallow_water','deep_water'].includes(terrainAt(selected.col,selected.row));
  const hiddenControl = selected ? `<button ${hiddenTerrain ? '' : 'disabled'} onclick="toggleLobbyHiddenDeployment()" title="Hidden BattleMechs must begin in legal non-clear, non-paved terrain.">${selected.hidden ? '✓ Hidden' : 'Hide Unit'}</button>` : '';
  const minePlan = myMinefields.length ? `<div class="minefield-plan">${myMinefields.map((field,index)=>`<div class="minefield-plan-row"><span><strong>${hexCode(field.col,field.row)}</strong> · ${escapeHtml(field.type==='vibrabomb'?`Vibrabomb ${field.sensitivity}t`:'Conventional')} · density ${Number(field.density)}</span><button onclick="removeLobbyMinefield(${index})" title="Remove this minefield from your deployment plan.">Remove</button></div>`).join('')}</div>` : '<span class="deployment-help">No minefields planned. Minefields are optional.</span>';
  const mineControls = minefieldBudget ? `<div class="deployment-unit-row"><span class="deployment-help">Minefield budget ${minefieldSpent}/${minefieldBudget}:</span>${(minefieldRules.permitted_types || []).map(type => `<button class="${lobbyMinefieldMode===type?'selected':''}" onclick="setLobbyMinefieldMode('${type}')" title="Keep this tool selected while placing ${type} minefields.">${type === 'vibrabomb' ? 'Vibrabomb' : 'Conventional'}</button>`).join('')}<label class="deployment-help">Density <select onchange="lobbyMinefieldDensity=Number(this.value);loadLobbyUI()">${(minefieldRules.permitted_densities || [10,20,30]).map(value=>`<option ${lobbyMinefieldDensity===Number(value)?'selected':''}>${value}</option>`).join('')}</select></label>${lobbyMinefieldMode==='vibrabomb'?`<label class="deployment-help">Trigger weight <select onchange="lobbyVibrabombSensitivity=Number(this.value)">${(minefieldRules.vibrabomb_sensitivities || [50]).map(value=>`<option ${lobbyVibrabombSensitivity===Number(value)?'selected':''}>${value}</option>`).join('')}</select> t</label>`:''}<button ${myMinefields.length?'':'disabled'} onclick="resetLobbyMinefields()">Clear Plan</button></div>${minePlan}` : '<span class="deployment-help">This scenario does not permit minefields.</span>';
  target.innerHTML = `<div class="deployment-help">${positions.length}/${roster.length} placed. Choose each BattleMech, then click an empty green hex on your side. Hidden units require concealing terrain. ${minefieldBudget ? 'Minefields: choose an empty hex in your deployment zone; water, buildings, impassable terrain and liquid magma are excluded. Enemy fields remain concealed.' : 'Minefields are disabled for this match.'}</div><div class="deployment-unit-row">${units || 'Choose a roster first.'}</div>${selected ? `<div class="deployment-unit-row"><span class="deployment-help">Starting facing:</span>${facingButtons}${hiddenControl}</div>` : ''}${mineControls}${deploymentMapMarkup(gameState, cells.join(''), mapLabels.join(''), mapWidth, mapHeight)}<div class="deployment-unit-row"><button onclick="resetLobbyDeployment()">Reset My Deployment</button></div>`;
  attachDeploymentMapControls();
}

function setLobbyMinefieldMode(type) { lobbyMinefieldMode = lobbyMinefieldMode === type ? null : type; loadLobbyUI(); }

async function toggleLobbyHiddenDeployment() {
  const { data: game } = await db.from('btech_games').select('state').eq('id',currentGameId).single();
  const state=game?.state ? (typeof game.state==='string'?JSON.parse(game.state):game.state):{};
  const positions=[...(state.deployment_positions?.[String(mySeatNumber)]||[])], selected=positions[lobbyDeploymentIndex];if(!selected)return;
  positions[lobbyDeploymentIndex]={...selected,hidden:!selected.hidden};
  const {error}=await db.rpc('set_match_deployment',{p_game_id:currentGameId,p_positions:positions});if(error){document.getElementById('lobby-status').textContent=`Hidden deployment rejected: ${error.message}`;return;}await loadLobbyUI();
}

async function placeLobbyMinefield(col,row) {
  if(!lobbyMinefieldMode)return;
  const state=await currentLobbyState();
  if(!state)return;
  const plan=lobbyMinefieldView.filter(field=>Number(field.owner)===Number(mySeatNumber)).map(lobbyMinefieldDeclaration);
  plan.push({col,row,type:lobbyMinefieldMode,density:lobbyMinefieldDensity,sensitivity:lobbyVibrabombSensitivity});
  if(await saveLobbyMinefieldPlan(plan))await loadLobbyUI();
}

async function currentLobbyState(){const {data:game,error}=await db.from('btech_games').select('state').eq('id',currentGameId).single();if(error||!game){document.getElementById('lobby-status').textContent=`Could not load the current minefield plan: ${error?.message||'match unavailable'}`;return null;}const state=game.state?(typeof game.state==='string'?JSON.parse(game.state):game.state):{};state.minefields=lobbyMinefieldView;return state;}
function lobbyMinefieldDeclaration(field){return{col:Number(field.col),row:Number(field.row),type:field.type,density:Number(field.density),sensitivity:Number(field.sensitivity||50)};}
async function saveLobbyMinefieldPlan(plan){const {error}=await db.rpc('set_match_minefield_plan',{p_game_id:currentGameId,p_minefields:plan});if(error){document.getElementById('lobby-status').textContent=`Minefield plan rejected: ${error.message}. Apply SQL 130 before using private minefield planning.`;return false;}isReady=false;return true;}
async function removeLobbyMinefield(index){const plan=lobbyMinefieldView.filter(field=>Number(field.owner)===Number(mySeatNumber)).map(lobbyMinefieldDeclaration);if(index<0||index>=plan.length)return;plan.splice(index,1);if(await saveLobbyMinefieldPlan(plan))await loadLobbyUI();}
async function resetLobbyMinefields(){const count=lobbyMinefieldView.filter(field=>Number(field.owner)===Number(mySeatNumber)).length;if(!count)return;if(!confirm(`Remove all ${count} minefield${count===1?'':'s'} from your plan?`))return;if(await saveLobbyMinefieldPlan([])){lobbyMinefieldMode=null;await loadLobbyUI();}}

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
  const { data: game } = await db.from('btech_games').select('state').eq('id', currentGameId).single();
  const state = game?.state ? (typeof game.state === 'string' ? JSON.parse(game.state) : game.state) : {};
  if (!deploymentZoneContains(mySeatNumber, col, row, state)) return;
  const positions = [...(state.deployment_positions?.[String(mySeatNumber)] || [])];
  positions[lobbyDeploymentIndex] = { col, row, facing: mySeatNumber === 1 ? 0 : 3, hidden: false };
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
  if (!currentGameId || !currentUser || !isSupportedUnit(unitId)) return;
  const { data: game, error } = await db.from('btech_games').select('state').eq('id', currentGameId).single();
  if (error || !game) return;
  const state = game.state ? (typeof game.state === 'string' ? JSON.parse(game.state) : game.state) : {};
  const rosterKey = String(mySeatNumber);
  const roster = [...(state.rosters?.[rosterKey] || [])];
  const index = roster.indexOf(unitId);
  if (index >= 0) roster.splice(index, 1);
  else {
    const candidate = [...roster, unitId];
    if (!isRosterLegal(candidate, state.dropship_tonnage, matchRuleset(state), state, mySeatNumber)) return;
    roster.push(unitId);
  }
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
  if (hasUnsavedSkirmishPilots()) { document.getElementById('lobby-status').textContent = 'Save your edited pilot names and skills before continuing.'; return; }
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
    if (!isRosterLegal(state.rosters?.[String(player.seat_number)], state.dropship_tonnage, matchRuleset(state), state, player.seat_number)) {
      document.getElementById('lobby-status').textContent = 'Choose a roster that is legal for this force limit and ruleset before readying up.';
      return;
    }
    if ((state.deployment_positions?.[String(player.seat_number)] || []).length !== (state.rosters?.[String(player.seat_number)] || []).length) {
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
  if (hasUnsavedSkirmishPilots()) { document.getElementById('lobby-status').textContent = 'Save your edited pilot names and skills before continuing.'; return; }
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
  } else if (!players.some(player => !player.is_ai && player.ready)) {
    document.getElementById('lobby-status').textContent = 'Finish your force and deployment, then Ready Up before starting the AI match.';
    return;
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
  const rostersValid = players.every(player => isRosterLegal(gameState.rosters?.[String(player.seat_number)], gameState.dropship_tonnage, matchRuleset(gameState), gameState, player.seat_number));
  const deploymentsValid = players.every(player => (gameState.deployment_positions?.[String(player.seat_number)] || []).length === (gameState.rosters?.[String(player.seat_number)] || []).length);
  if (!rostersValid || !deploymentsValid) {
    document.getElementById('lobby-status').textContent = 'Each force must be legal and fully deployed before the match can start.';
    return;
  }
  if (bv2ForceLimit(gameState) != null) {
    const { data: sealedState, error: sealError } = await db.rpc('seal_bv2_match_force_values', { p_game_id:currentGameId });
    if (sealError) {
      document.getElementById('lobby-status').textContent = `BV2 force validation rejected: ${sealError.message}`;
      return;
    }
    if (sealedState && typeof sealedState === 'object') Object.assign(gameState, sealedState);
  }
  if (vsAiMode) {
    const { error } = await db.rpc('seed_ai_minefield_plan', { p_game_id:currentGameId });
    if (error) { document.getElementById('lobby-status').textContent = `AI minefield setup rejected: ${error.message}`; return; }
  }
  // SQL 123 forbids replacing units after play starts. Persist the complete
  // configured roster before any human or AI phase action can be submitted.
  gameState.mech_instances = buildRosterInstances(gameState.rosters, gameState.skirmish_avatars, gameState.deployment_positions, gameState.c3_assignments, gameState);
  if (vsAiMode && typeof prepareAIAmmoLoadouts === 'function') prepareAIAmmoLoadouts(gameState.mech_instances);
  gameState.vs_ai_mode = vsAiMode;
  gameState.ai_difficulty = aiDifficulty;
  gameState.ai_personality = aiPersonality;

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

function defaultRosterDeployment(seat, count, mapState = {}) {
  const zone = scenarioDeploymentZoneHexes(seat, mapState).map(code => ({ col:Number(code.slice(0,2)), row:Number(code.slice(2,4)) }));
  const dimensions = mapDimensions(mapState.map_id);
  return Array.from({ length:count }, (_, index) => ({ ...(zone[index] || { col:seat === 1 ? 0 : dimensions.cols - 1, row:index }), facing:seat === 1 ? 0 : 3, hidden:false }));
}

function buildRosterInstances(rosters, skirmishAvatars = {}, deploymentPositions = {}, c3Assignments = {}, mapState = {}) {
  const deployment = { 1:defaultRosterDeployment(1, (rosters?.['1'] || []).length, mapState), 2:defaultRosterDeployment(2, (rosters?.['2'] || []).length, mapState) };
  return [1, 2].flatMap(seat => (rosters?.[String(seat)] || []).map((unitId, index) => {
    const position = deploymentPositions?.[String(seat)]?.[index] || deployment[seat][index];
    const unit = getSupportedUnit(unitId);
    const avatar = skirmishAvatars?.[String(seat)] || {};
    const deployedEntries = (avatar.deployed || []).map(entryId => (avatar.hangar || []).find(entry => entry.id === entryId)).filter(Boolean);
    const pilot = skirmishPilotForEntry(deployedEntries[index] || (avatar.hangar || []).find(entry => entry.unit_id === unitId));
    const instanceId = `${unitId}-p${seat}-${index + 1}`;
    const savedAssignment = c3Assignments?.[String(seat)]?.[String(index)] || {};
    const assignment = savedAssignment.unitId === unitId ? savedAssignment : {};
    const parentIndex = assignment.parent == null ? null : Number(assignment.parent);
    const role = lobbyC3Role(unitId);
    const c3Network = assignment.network && role ? {
      id:`p${seat}-${assignment.network}`,type:role==='c3i'?'c3i':'standard',role,
      parentInstanceId:parentIndex == null ? null : `${rosters[String(seat)][parentIndex]}-p${seat}-${parentIndex + 1}`
    } : null;
    return {
      instanceId,
      unitId, owner: seat, col: position.col, row: position.row,
      facing: position.facing, torsoFacing: position.facing, hidden: Boolean(position.hidden),
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
      ...(c3Network ? { c3Network } : {}),
      ...(activeCatalogueVersion ? { catalogueVersion: activeCatalogueVersion } : {})
    };
  }));
}

async function startGameScreen() {
  stopLobbySubscriptions();

  showScreen('game-screen');
  gameLog = [];
  resetCombatPresentation();
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
        const minefieldView = await db.rpc('get_match_minefield_view', { p_game_id:currentGameId });
        gs.minefields = minefieldView.error ? [] : (minefieldView.data || []);
        if (remote.catalogue_version) await loadUnitCatalogue(remote.catalogue_version);
        setActiveMap(gs.map_id);
        currentMatchConfig = {
          ...(gs.map_id ? { map_id: gs.map_id } : {}),
          ...(gs.dropship_tonnage ? { dropship_tonnage: gs.dropship_tonnage } : {}),
          ...(gs.rosters ? { rosters: gs.rosters } : {}),
          ...(typeof gs.vs_ai_mode === 'boolean' ? { vs_ai_mode: gs.vs_ai_mode } : {}),
          ...(gs.ai_difficulty ? { ai_difficulty: gs.ai_difficulty } : {}),
          ...(gs.ai_personality ? { ai_personality: gs.ai_personality } : {}),
          minefields: gs.minefields,
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
    .subscribe(status => {
      // A phase update can occur between the initial snapshot and the realtime
      // channel becoming active. Re-read once on subscription so that missed
      // initiative/turn hand-offs cannot leave this browser on a stale phase.
      if (status === 'SUBSCRIBED' && currentGameId) loadGameState();
    });
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
  currentGameCode = null;
  isHost = false;
  isReady = false;
  mySeatNumber = null;
  lobbyClosureInProgress = false;
  showScreen('menu-screen');
}
