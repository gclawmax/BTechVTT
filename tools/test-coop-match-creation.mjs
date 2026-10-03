#!/usr/bin/env node
// Regression guard for Coop 1-a match creation (issue #12).
// Executes the REAL creator scripts (board/maps/team-model/game-code/vs-ai/
// coop) in one shared realm like the browser does, with the database stubbed.
// Catches two classes of bug the string-grep suites cannot:
//   1. errors thrown during creation (the TDZ self-reference shipped because
//      no execution-level test covered createCoopGame at all);
//   2. AI deployment landing on the humans' side (deployment zones are keyed
//      per FORCE, so seat→force resolution must happen before placement).
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');

// Catalogue stand-in: 12 machines, 20–50 t, all ruleset-legal. Only shapes
// the two creator scripts actually read (tonnage/movement) are provided.
const CATALOGUE_PRELUDE = `
const BT_UNIT_CATALOGUE = {};
for (let i = 0; i < 12; i++) {
  BT_UNIT_CATALOGUE['mech-' + i] = { chassis: 'TestMech ' + i, tonnage: 20 + (i % 6) * 6, movement: { walk: 4 }, customDesign: false };
}
function getSupportedUnit(id) { return BT_UNIT_CATALOGUE[id]; }
function isSupportedUnit(id) { return Object.prototype.hasOwnProperty.call(BT_UNIT_CATALOGUE, id); }
function unitRulesetStatus() { return { allowed: true }; }
const AI_DIFFICULTY_KEYS = ['beginner', 'intermediate', 'advanced'];
const AI_PERSONALITY_KEYS = ['balanced'];
const BT_AI_ENGINE_VERSION = 'test';
const BT_RULESETS = { standard_3060: { label: 'Standard 3060' }, advanced_3060: { label: 'Advanced 3060' } };
let aiDifficulty = 'beginner';
let aiPersonality = 'balanced';
const currentUser = { id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' };
const CAPTURE = { alerts: [], tables: [], state: null };
const document = { querySelectorAll: () => [], getElementById: () => null, body: { dataset: {} } };
function showLoading() {}
function showScreen(name) { CAPTURE.screen = name; }
async function loadLobby() {}
function alert(message) { CAPTURE.alerts.push(String(message)); }
function makeThenable(payload) {
  return {
    select() { return { single() { return Promise.resolve(payload); } }; },
    then(resolve, reject) { return Promise.resolve(payload).then(resolve, reject); }
  };
}
const db = {
  from(table) {
    return {
      insert(row) {
        CAPTURE.tables.push(table);
        if (table === 'btech_games') {
          CAPTURE.state = JSON.parse(row.state);
          return makeThenable({ data: { id: 'game-under-test' }, error: null });
        }
        return makeThenable({ data: null, error: null });
      }
    };
  }
};
async function loadLatestUnitCatalogue() { return 'test-catalogue'; }
`;

const sources = [
  CATALOGUE_PRELUDE,
  await read('js/game/board.js'),
  await read('js/game/maps.js'),
  await read('js/game/team-model.js'),
  await read('js/network/game-code.js'),
  await read('js/network/create-vs-ai.js'),
  await read('js/network/create-coop.js')
];

const context = vm.createContext({ console });
for (const source of sources) {
  vm.runInContext(source, context, { filename: 'coop-realm.js' });
}
vm.runInContext(`
var runCoopCreate = (mapId) => createCoopGame({ mapId, dropshipTonnage: 200, victoryMode: 'annihilation', ruleset: 'advanced_3060' });
var seedStaleTeamModel = () => refreshCurrentTeamModel({ team_assignments: { A: [1], B: [2] } });
`, context, { filename: 'harness-tail.js' });

let failures = 0;
function check(label, condition) { console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`); if (!condition) failures += 1; }

// --- Run 1: creation from a clean context ----------------------------------
vm.runInContext('CAPTURE.alerts.length = 0; CAPTURE.tables.length = 0; CAPTURE.state = null;', context);
await vm.runInContext('createCoopGame({ mapId: "training-grounds", dropshipTonnage: 200, victoryMode: "annihilation", ruleset: "advanced_3060" })', context);
let capture = vm.runInContext('CAPTURE', context);
check('coop creation completes without a thrown error (issue #12 TDZ)', capture.alerts.length === 0);
check('coop creation writes the game row plus host and AI player rows', capture.tables.join(',') === 'btech_games,btech_players,btech_players');

const state = capture.state;
const aiRoster = state.rosters['3'];
const aiDeploys = state.deployment_positions['3'];
check('the AI force was generated for seat 3', Array.isArray(aiRoster) && aiRoster.length > 0);
check('every AI unit received a deployment position', Array.isArray(aiDeploys) && aiDeploys.length === aiRoster.length && aiDeploys.every(p => Number.isInteger(p.col) && Number.isInteger(p.row)));
const enemyColumns = aiDeploys.filter(p => p.col >= 11);
check('the AI deploys on the enemy side (columns 11-15), never the humans\' columns 0-4', enemyColumns.length === aiDeploys.length);
check('AI units face their own edge (facing 3, toward centre)', aiDeploys.every(p => p.facing === 3));
const aiForce = vm.runInContext('getCurrentTeamModel().forceOfSeat(3)', context);
check('the team model ends the game on THIS match\'s assignments (seat 3 on team B / force 2)', aiForce === '2');

// --- Run 2: a stale team model from a previous match must not leak ---------
// (Regression for zone-keying: resolving seat 3 against the 2-seat default
// model would give the humans' side to the AI.)
vm.runInContext('CAPTURE.alerts.length = 0; CAPTURE.tables.length = 0; CAPTURE.state = null; seedStaleTeamModel();', context);
await vm.runInContext('createCoopGame({ mapId: "training-grounds", dropshipTonnage: 200, victoryMode: "annihilation", ruleset: "advanced_3060" })', context);
capture = vm.runInContext('CAPTURE', context);
const second = capture.state && capture.state.deployment_positions && capture.state.deployment_positions['3'];
check('a stale team model from a previous match cannot put the AI on the wrong side (second run)', capture.alerts.length === 0 && Array.isArray(second) && second.length > 0 && second.every(p => p.col >= 11));

if (failures) { console.error(`Coop creation regression failed: ${failures} checks failing`); process.exit(1); }
console.log('coop creation regression green');
