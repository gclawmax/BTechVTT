import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

for (const file of ['SQL/42_lb_x_ammunition.sql', 'SQL/46_fix_lb_x_loadout_key.sql']) {
  const sql = readFileSync(file, 'utf8');
  assert.match(sql, /bin_key:=\(mech->>'instanceId'\)\|\|':'\|\|\(bin->>'id'\)/,
    `${file} must parenthesize JSON text extraction before concatenation`);
}
const snapshotFix = readFileSync('SQL/48_fix_lb_x_snapshot_validation.sql', 'utf8');
assert.ok(snapshotFix.includes("'attacker_start->''ammoBins''','attacker->''ammoBins''"),
  'existing deployments must validate the persisted LB-X bin rather than a stale weapon snapshot');
console.log('LB-X loadout SQL test passed');
