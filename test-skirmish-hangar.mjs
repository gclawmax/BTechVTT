import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync('SQL/49_skirmish_avatars_and_hangars.sql', 'utf8');
assert.match(sql, /ensure_skirmish_avatar/);
assert.match(sql, /update_skirmish_hangar/);
assert.match(sql, /jsonb_array_length\(p_hangar\)>12/);
assert.match(sql, /count\(DISTINCT entry->>'id'\)/);
assert.match(sql, /FROM jsonb_array_elements\(p_hangar\) entry\s+JOIN btech_catalogue_units unit/);
const lobby = readFileSync('js/network/lobby.js', 'utf8');
assert.match(lobby, /addMechToSkirmishHangar/);
assert.match(lobby, /toggleSkirmishDeployment/);
assert.match(lobby, /buildRosterInstances\(gameState\.rosters, gameState\.skirmish_avatars\)/);
const movement = readFileSync('js/movement/rules.js', 'utf8');
assert.match(movement, /function rotateMapView/);
assert.match(movement, /ctx\.rotate\(mapRotation/);
assert.match(movement, /const radians = -mapRotation/);
console.log('Skirmish Hangar and map rotation tests passed');
