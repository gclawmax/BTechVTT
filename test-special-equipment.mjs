import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync('SQL/51_canonical_special_equipment_resolver.sql', 'utf8');
assert.doesNotMatch(sql, /pg_get_functiondef|regexp_replace\(source|EXECUTE patched/);
assert.match(sql, /canonical-special-equipment-resolver-v1/);
assert.match(sql, /CREATE OR REPLACE FUNCTION public\.resolve_heat_management/);
assert.match(sql, /value->>'type'<>'gauss'/);
assert.match(sql, /btech_weapon_slot_matches/);
assert.match(sql, /catalogue_bin\.bin_id=loc\|\|':'\|\|chosen/);
assert.match(sql, /IF streak AND hit THEN attacker:=btech_consume_one_live_ammo/);
assert.match(sql, /IF NOT streak OR hit THEN heat_added/);
assert.match(sql, /ams_modifier:=-4/);
assert.match(sql, /weapon->>'missileWeapon'/);
assert.match(sql, /Narc-capable/);
assert.match(sql, /taggedRound/);
assert.match(sql, /narcPod/);
assert.match(sql, /btech_apply_internal_damage\(m,loc,20\)/);
assert.match(sql, /btech_elevation_blocks_los/);
assert.match(sql, /btech_expand_ultra_ac_mounts/);
assert.match(sql, /proneSupportArm/);

const profiles = readFileSync('tools/build-megamek-content-pack.mjs', 'utf8');
for (const key of ['gauss_rifle', 'streak_srm2', 'large_pulse_laser', 'small_pulse_laser', 'ams', 'narc', 'tag']) assert.ok(profiles.includes(key), `${key} profile missing`);
assert.match(profiles, /CLAN_WEAPON_OVERRIDES/);
assert.match(profiles, /'ER Medium Laser': \{ damage: 7/);
assert.doesNotMatch(profiles, /Narc: \{[^\n]*supportOnly/);
assert.doesNotMatch(profiles, /TAG: \{[^\n]*supportOnly/);
const sql50 = readFileSync('SQL/50_extended_weapon_profiles.sql', 'utf8');
assert.doesNotMatch(sql50, /pg_get_functiondef|EXECUTE patched|''gauss'' THEN 15/);

const artwork = readFileSync('js/game/unit-artwork.js', 'utf8');
const importer = readFileSync('tools/import-megamek-sprites.mjs', 'utf8');
assert.match(artwork, /manifest\.json/);
assert.match(importer, /CC-BY-NC-4\.0/);
assert.match(importer, /source_release/);
assert.match(importer, /--additional-catalogue/);
assert.match(importer, /reason: candidates\.length \? 'ambiguous' : 'not_found'/);
console.log('Special equipment and artwork pipeline tests passed');
