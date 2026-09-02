// Compatibility definitions keep old saves and AI tests playable. New human
// matches replace these entries with their pinned Supabase catalogue release.

const BT_UNIT_CATALOGUE = {
  'atlas-as7-d': {
    chassis: 'Atlas', variant: 'AS7-D', tonnage: 100, color: '#c4302b',
    movement: { walk: 3, run: 5, jump: 0 },
    heat_sinks: 20, heat_sink_type: 'single',
    weapons: [
      { key: 'med_laser', count: 1, location: 'Left Arm' },
      { key: 'med_laser', count: 1, location: 'Right Arm' },
      { key: 'lr20', count: 1, location: 'Left Torso' },
      { key: 'sr6', count: 1, location: 'Left Torso' },
      { key: 'ac20', count: 1, location: 'Right Torso' },
      { key: 'med_laser', count: 1, location: 'Center Torso' },
      { key: 'med_laser', count: 1, location: 'Center Torso' }
    ],
    ammoBins: [
      { id: 'atlas-lrm20-lt', type: 'lrm20', location: 'Left Torso', shots: 6 },
      { id: 'atlas-srm6-lt', type: 'srm6', location: 'Left Torso', shots: 15 },
      { id: 'atlas-ac20-rt', type: 'ac20', location: 'Right Torso', shots: 10 }
    ],
    armor: { head:9, ct:47, ct_rear:14, lt:32, lt_rear:10, rt:32, rt_rear:10, la:34, ra:34, ll:41, rl:41 },
    structure: { head:3, ct:31, lt:21, rt:21, la:17, ra:17, ll:21, rl:21 }
  },
  'hunchback-hbk-4g': {
    chassis: 'Hunchback', variant: 'HBK-4G', tonnage: 50, color: '#d4800a',
    movement: { walk: 4, run: 6, jump: 0 },
    heat_sinks: 10, heat_sink_type: 'single',
    weapons: [
      { key: 'med_laser', count: 1, location: 'Left Arm' },
      { key: 'med_laser', count: 1, location: 'Right Arm' },
      { key: 'ac20', count: 1, location: 'Right Torso' },
      { key: 'small_laser', count: 1, location: 'Head' }
    ],
    ammoBins: [{ id: 'hunchback-ac20-lt', type: 'ac20', location: 'Left Torso', shots: 5 }],
    armor: { head:9, ct:26, ct_rear:5, lt:20, lt_rear:4, rt:20, rt_rear:4, la:16, ra:16, ll:20, rl:20 },
    structure: { head:3, ct:16, lt:11, rt:11, la:8, ra:8, ll:11, rl:11 }
  },
  'locust-lct-1v': {
    chassis: 'Locust', variant: 'LCT-1V', tonnage: 20, color: '#2a8a2a',
    movement: { walk: 8, run: 12, jump: 0 },
    heat_sinks: 10, heat_sink_type: 'single',
    weapons: [
      { key: 'machine_gun', count: 1, location: 'Left Arm' },
      { key: 'machine_gun', count: 1, location: 'Right Arm' },
      { key: 'med_laser', count: 1, location: 'Center Torso' }
    ],
    ammoBins: [{ id: 'locust-mg-ct', type: 'machine_gun', location: 'Center Torso', shots: 200 }],
    armor: { head:8, ct:10, ct_rear:2, lt:8, lt_rear:2, rt:8, rt_rear:2, la:4, ra:4, ll:8, rl:8 },
    structure: { head:3, ct:6, lt:5, rt:5, la:3, ra:3, ll:4, rl:4 }
  },
  'marauder-mad-3r': {
    chassis: 'Marauder', variant: 'MAD-3R', tonnage: 75, color: '#6450a6',
    movement: { walk: 4, run: 6, jump: 0 },
    heat_sinks: 16, heat_sink_type: 'single',
    weapons: [
      { key: 'ppc', count: 1, location: 'Left Arm' },
      { key: 'med_laser', count: 1, location: 'Left Arm' },
      { key: 'ppc', count: 1, location: 'Right Arm' },
      { key: 'med_laser', count: 1, location: 'Right Arm' },
      { key: 'ac5', count: 1, location: 'Right Torso' }
    ],
    ammoBins: [{ id: 'marauder-ac5-lt', type: 'ac5', location: 'Left Torso', shots: 20 }],
    armor: { head:9, ct:35, ct_rear:10, lt:17, lt_rear:8, rt:17, rt_rear:8, la:22, ra:22, ll:18, rl:18 },
    structure: { head:3, ct:23, lt:16, rt:16, la:12, ra:12, ll:16, rl:16 }
  },
  'enforcer-enf-4r': {
    chassis: 'Enforcer', variant: 'ENF-4R', tonnage: 50, color: '#397b97',
    movement: { walk: 4, run: 6, jump: 4 },
    heat_sinks: 12, heat_sink_type: 'single',
    weapons: [
      { key: 'large_laser', count: 1, location: 'Left Arm' },
      { key: 'ac10', count: 1, location: 'Right Arm' },
      { key: 'small_laser', count: 1, location: 'Left Torso' }
    ],
    ammoBins: [{ id: 'enforcer-ac10-rt', type: 'ac10', location: 'Right Torso', shots: 10 }],
    armor: { head:9, ct:23, ct_rear:4, lt:17, lt_rear:3, rt:17, rt_rear:3, la:14, ra:14, ll:20, rl:20 },
    structure: { head:3, ct:16, lt:11, rt:11, la:8, ra:8, ll:11, rl:11 }
  },
  'centurion-cn9-a': {
    chassis: 'Centurion', variant: 'CN9-A', tonnage: 50, color: '#4b8051',
    movement: { walk: 4, run: 6, jump: 0 },
    heat_sinks: 10, heat_sink_type: 'single',
    weapons: [
      { key: 'ac10', count: 1, location: 'Right Arm' },
      { key: 'lrm10', count: 1, location: 'Left Torso' },
      { key: 'med_laser', count: 2, location: 'Center Torso' }
    ],
    ammoBins: [
      { id: 'centurion-lrm10-lt', type: 'lrm10', location: 'Left Torso', shots: 12 },
      { id: 'centurion-ac10-rt', type: 'ac10', location: 'Right Torso', shots: 20 }
    ],
    armor: { head:9, ct:18, ct_rear:7, lt:13, lt_rear:6, rt:13, rt_rear:6, la:16, ra:16, ll:16, rl:16 },
    structure: { head:3, ct:16, lt:11, rt:11, la:8, ra:8, ll:11, rl:11 }
  }
};

// Support status deliberately contains no copied unit statistics. Future
// MegaMek-derived records can be reviewed and enabled here by their catalogue
// ID after the VTT supports their equipment and rules.
const BT_UNIT_SUPPORT = Object.freeze({
  'atlas-as7-d': { status: 'supported' },
  'hunchback-hbk-4g': { status: 'supported' },
  'locust-lct-1v': { status: 'supported' },
  'marauder-mad-3r': { status: 'supported' },
  'enforcer-enf-4r': { status: 'supported' },
  'centurion-cn9-a': { status: 'supported' }
});

let activeCatalogueVersion = null;
const databaseSupportedUnitIds = new Set();
const BT_LOCATION_NAMES = Object.freeze({
  la: 'Left Arm', ra: 'Right Arm', lt: 'Left Torso', rt: 'Right Torso',
  ct: 'Center Torso', head: 'Head', ll: 'Left Leg', rl: 'Right Leg'
});

function catalogueUnitColor(unitId, index) {
  return BT_UNIT_CATALOGUE[unitId]?.color || ['#c4302b', '#d4800a', '#2a8a2a', '#6450a6', '#397b97', '#4b8051'][index % 6];
}

// PostgREST caps a single response at 1,000 rows by default. A full MegaMek
// catalogue has more critical-slot records than that, so fetch every page
// before constructing the client-side record sheets.
async function fetchCatalogueRows(table, columns, catalogueVersion) {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db.from(table)
      .select(columns)
      .eq('catalogue_version', catalogueVersion)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    rows.push(...(data || []));
    if (!data || data.length < pageSize) return rows;
  }
}

async function loadUnitCatalogue(catalogueVersion, forceReload = false) {
  if (!catalogueVersion || (!forceReload && activeCatalogueVersion === catalogueVersion)) return catalogueVersion;
  const [unitsResult, mountsResult, slotsResult, ammoResult] = await Promise.all([
    fetchCatalogueRows('btech_catalogue_units', 'unit_id,definition', catalogueVersion),
    fetchCatalogueRows('btech_catalogue_mounts', 'unit_id,mount_id,weapon_key,raw_name,location,definition', catalogueVersion),
    fetchCatalogueRows('btech_catalogue_critical_slots', 'unit_id,location,slot_index,label', catalogueVersion),
    fetchCatalogueRows('btech_catalogue_ammo_bins', 'unit_id,bin_id,ammo_type,raw_name,location,shots', catalogueVersion)
  ]);
  if (!unitsResult.length) throw new Error(`Catalogue ${catalogueVersion} contains no supported units.`);

  const groupByUnit = rows => (rows || []).reduce((groups, row) => {
    (groups[row.unit_id] ||= []).push(row);
    return groups;
  }, {});
  const mountsByUnit = groupByUnit(mountsResult);
  const slotsByUnit = groupByUnit(slotsResult);
  const ammoByUnit = groupByUnit(ammoResult);
  databaseSupportedUnitIds.clear();
  unitsResult.forEach((row, index) => {
    const definition = row.definition || {};
    if (definition.supported_by_vtt !== true) return;
    const mounts = mountsByUnit[row.unit_id] || [];
    // An unarmed custom BattleMech is still a valid, fully resolved unit.
    // Only reject malformed mount records, not an empty weapon list.
    if (mounts.some(mount => !mount.weapon_key)) return;
    for (const mount of mounts) {
      const weapon = mount.definition || {};
      if (Array.isArray(weapon.range)) {
        BT_WEAPONS[mount.weapon_key] = {
          name: mount.raw_name, damage: weapon.damage, heat: weapon.heat, range: weapon.range,
          ...(weapon.minimumRange ? { minimumRange: weapon.minimumRange } : {}),
          ...(weapon.ammoType ? { ammoType: weapon.ammoType } : {}),
          ...(weapon.clusterSize ? { clusterSize: weapon.clusterSize } : {}),
          ...(weapon.damagePerMissile ? { damagePerMissile: weapon.damagePerMissile } : {})
          , ...(weapon.toHitModifier ? { toHitModifier: weapon.toHitModifier } : {})
          , ...(weapon.streak ? { streak: true } : {})
          , ...(weapon.supportOnly ? { supportOnly: true } : {})
        };
      }
    }
    BT_UNIT_CATALOGUE[row.unit_id] = {
      chassis: definition.chassis,
      variant: definition.variant,
      tonnage: definition.mass,
      techBase: definition.tech_base || 'Inner Sphere',
      era: definition.era || null,
      color: catalogueUnitColor(row.unit_id, index),
      movement: definition.movement,
      heat_sinks: definition.heat_sinks,
      heat_sink_type: definition.heat_sink_type,
      heat_sink_capacity: definition.heat_sink_capacity || definition.heat_sinks,
      customDesign: definition.custom_design === true,
      customOwnerId: definition.custom_owner_id || null,
      customArchived: definition.custom_archived === true,
      armor: definition.armor,
      structure: definition.structure,
      weapons: mounts.map(mount => ({
        key: mount.weapon_key, count: 1,
        location: BT_LOCATION_NAMES[mount.location] || mount.location,
        mountId: mount.mount_id,
        // Weapon keys are shared by Clan and Inner Sphere variants. Retain
        // this mount's catalogue profile rather than inheriting another
        // unit's profile based on catalogue load order.
        weapon: { key: mount.weapon_key, name: mount.raw_name, ...(mount.definition || {}) }
      })),
      ammoBins: (ammoByUnit[row.unit_id] || []).map(bin => ({
        id: bin.bin_id, type: bin.ammo_type,
        location: BT_LOCATION_NAMES[bin.location] || bin.location,
        shots: bin.shots,
        rawName: bin.raw_name,
        narcCapable: /narc-capable/i.test(bin.raw_name || ''),
        artemisCapable: /artemis-capable/i.test(bin.raw_name || '')
      }))
    };
    const layout = {};
    for (const slot of slotsByUnit[row.unit_id] || []) {
      if (!layout[slot.location]) layout[slot.location] = Array(12).fill(null);
      layout[slot.location][slot.slot_index] = slot.label;
    }
    BT_CRITICAL_LAYOUTS[row.unit_id] = layout;
    databaseSupportedUnitIds.add(row.unit_id);
  });
  if (!databaseSupportedUnitIds.size) throw new Error(`Catalogue ${catalogueVersion} has no VTT-supported unit definitions.`);
  activeCatalogueVersion = catalogueVersion;
  return catalogueVersion;
}

async function loadLatestUnitCatalogue() {
  const { data, error } = await db.from('btech_catalogue_releases')
    .select('version').order('generated_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw error;
  if (!data?.version) throw new Error('No BattleMech catalogue release is installed.');
  return loadUnitCatalogue(data.version);
}

// Existing saved games used these short prototype IDs. Keep them readable as
// the game transitions to durable catalogue IDs.
const BT_UNIT_ID_ALIASES = Object.freeze({
  atlas: 'atlas-as7-d',
  hunchback: 'hunchback-hbk-4g',
  locust: 'locust-lct-1v'
});

function canonicalUnitId(unitId) {
  return BT_UNIT_ID_ALIASES[unitId] || unitId;
}

// The prototype 'Mechs use hyphenated variant ids (atlas-as7-d) while the
// durable catalogue release stores the same units without the inner hyphen
// (atlas-as7d). Once a match pins a catalogue, getSupportedUnit() switches to
// the database-backed set, so resolve both spellings to the same entry —
// otherwise the default vs-AI roster is orphaned and its 'Mechs lose their
// structure/armor, crashing movement. See issue #6.
function resolveCatalogueId(id) {
  if (databaseSupportedUnitIds.has(id)) return id;
  const normalized = id.replace(/-([a-z0-9]+)$/i, '$1');
  if (normalized !== id && databaseSupportedUnitIds.has(normalized)) return normalized;
  return id;
}

function getSupportedUnit(unitId) {
  const id = canonicalUnitId(unitId);
  if (activeCatalogueVersion) {
    const resolved = resolveCatalogueId(id);
    return databaseSupportedUnitIds.has(resolved) ? BT_UNIT_CATALOGUE[resolved] || null : null;
  }
  return BT_UNIT_SUPPORT[id]?.status === 'supported' ? BT_UNIT_CATALOGUE[id] || null : null;
}

// Rejoining a match must use precisely the catalogue release pinned to that
// match. A forced second read handles a stale browser cache; anything still
// absent is reported once and remains display-only rather than causing
// unrelated panels to fail on missing fields.
async function verifyMatchCatalogueUnits(catalogueVersion, instances = []) {
  const ids = [...new Set((instances || []).map(instance => canonicalUnitId(instance?.unitId)).filter(Boolean))];
  let missing = ids.filter(id => !getSupportedUnit(id));
  if (missing.length && catalogueVersion) {
    await loadUnitCatalogue(catalogueVersion, true);
    missing = ids.filter(id => !getSupportedUnit(id));
  }
  return missing;
}

async function repairScenarioCatalogueUnitIds(game, state) {
  const needsRepair = (state?.mech_instances || []).some(instance => resolveCatalogueId(instance?.unitId) !== instance?.unitId) ||
    Object.values(state?.rosters || {}).some(roster => (roster || []).some(unitId => resolveCatalogueId(unitId) !== unitId));
  if (!needsRepair || !game?.catalogue_version) return { game, state };
  const { data, error } = await db.rpc('repair_btech_match_catalogue_unit_ids', { p_game_id: currentGameId });
  if (error || !data?.state) return { game, state };
  return { game: { ...game, catalogue_version: data.catalogue_version || game.catalogue_version }, state: typeof data.state === 'string' ? JSON.parse(data.state) : data.state, repaired: data.repaired === true };
}

function isSupportedUnit(unitId) {
  return Boolean(getSupportedUnit(unitId));
}

// Compatibility name used throughout the current game code.
const BT_UNITS = BT_UNIT_CATALOGUE;

// First-pass standard weapon data. Cluster weapons are deliberately treated as
// one simplified damage packet until their individual-cluster rules are added.
const BT_WEAPONS = {
  ac20:       { name: 'AC/20', damage: 20, heat: 7, range: [3, 6, 9], ammoType: 'ac20' },
  lr20:       { name: 'LRM-20', damage: 20, heat: 6, range: [7, 14, 21], minimumRange: 6, ammoType: 'lrm20', clusterSize: 20, damagePerMissile: 1 },
  sr6:        { name: 'SRM-6', damage: 6, heat: 4, range: [3, 6, 9], ammoType: 'srm6', clusterSize: 6, damagePerMissile: 2 },
  med_laser:  { name: 'Medium Laser', damage: 5, heat: 3, range: [3, 6, 9] },
  small_laser: { name: 'Small Laser', damage: 3, heat: 1, range: [1, 2, 3] },
  machine_gun: { name: 'Machine Gun', damage: 2, heat: 0, range: [1, 2, 3], ammoType: 'machine_gun' },
  large_laser: { name: 'Large Laser', damage: 8, heat: 8, range: [5, 10, 15] },
  ppc:        { name: 'PPC', damage: 10, heat: 10, range: [3, 6, 12], minimumRange: 3 },
  ac5:        { name: 'AC/5', damage: 5, heat: 1, range: [6, 12, 18], ammoType: 'ac5' },
  ac10:       { name: 'AC/10', damage: 10, heat: 3, range: [5, 10, 15], ammoType: 'ac10' },
  lrm10:      { name: 'LRM-10', damage: 10, heat: 4, range: [7, 14, 21], minimumRange: 6, ammoType: 'lrm10', clusterSize: 10, damagePerMissile: 1 },
  erl:        { name: 'ER Large Laser', damage: 8, heat: 12, range: [7, 14, 19] },
  lr6:        { name: 'LRM-6', damage: 6, heat: 2, range: [7, 14, 21] },
  ac2:        { name: 'AC/2', damage: 2, heat: 1, range: [8, 16, 24] },
  rac2:       { name: 'Rotary AC/2', damage: 2, heat: 1, range: [6, 12, 18], ammoType: 'rac2', rotary: true },
  rac5:       { name: 'Rotary AC/5', damage: 5, heat: 1, range: [5, 10, 15], ammoType: 'rac5', rotary: true },
  rac10:      { name: 'Rotary AC/10', damage: 10, heat: 3, range: [4, 8, 12], ammoType: 'rac10', rotary: true },
  rac20:      { name: 'Rotary AC/20', damage: 20, heat: 7, range: [3, 6, 9], ammoType: 'rac20', rotary: true },
  atm3:       { name: 'ATM 3', damage: 6, heat: 2, range: [5, 10, 15], minimumRange: 4, ammoType: 'atm3', clusterSize: 3, damagePerMissile: 2, missileWeapon: true, atm: true },
  atm6:       { name: 'ATM 6', damage: 12, heat: 4, range: [5, 10, 15], minimumRange: 4, ammoType: 'atm6', clusterSize: 6, damagePerMissile: 2, missileWeapon: true, atm: true },
  atm9:       { name: 'ATM 9', damage: 18, heat: 6, range: [5, 10, 15], minimumRange: 4, ammoType: 'atm9', clusterSize: 9, damagePerMissile: 2, missileWeapon: true, atm: true },
  atm12:      { name: 'ATM 12', damage: 24, heat: 8, range: [5, 10, 15], minimumRange: 4, ammoType: 'atm12', clusterSize: 12, damagePerMissile: 2, missileWeapon: true, atm: true },
  tbolt5:     { name: 'Thunderbolt 5', damage: 5, heat: 3, range: [6, 12, 18], ammoType: 'tbolt5', missileWeapon: true, thunderbolt: true },
  tbolt10:    { name: 'Thunderbolt 10', damage: 10, heat: 5, range: [6, 12, 18], ammoType: 'tbolt10', missileWeapon: true, thunderbolt: true },
  tbolt15:    { name: 'Thunderbolt 15', damage: 15, heat: 7, range: [6, 12, 18], ammoType: 'tbolt15', missileWeapon: true, thunderbolt: true },
  tbolt20:    { name: 'Thunderbolt 20', damage: 20, heat: 8, range: [6, 12, 18], ammoType: 'tbolt20', missileWeapon: true, thunderbolt: true },
  streak_lrm5: { name: 'Streak LRM 5', damage: 5, heat: 2, range: [7, 14, 21], ammoType: 'streak_lrm5', clusterSize: 5, damagePerMissile: 1, missileWeapon: true, streak: true },
  streak_lrm10:{ name: 'Streak LRM 10', damage: 10, heat: 4, range: [7, 14, 21], ammoType: 'streak_lrm10', clusterSize: 10, damagePerMissile: 1, missileWeapon: true, streak: true },
  streak_lrm15:{ name: 'Streak LRM 15', damage: 15, heat: 5, range: [7, 14, 21], ammoType: 'streak_lrm15', clusterSize: 15, damagePerMissile: 1, missileWeapon: true, streak: true },
  streak_lrm20:{ name: 'Streak LRM 20', damage: 20, heat: 6, range: [7, 14, 21], ammoType: 'streak_lrm20', clusterSize: 20, damagePerMissile: 1, missileWeapon: true, streak: true },
  streak_sr4: { name: 'Streak SRM-4', damage: 4, heat: 3, range: [3, 6, 9] }
};
