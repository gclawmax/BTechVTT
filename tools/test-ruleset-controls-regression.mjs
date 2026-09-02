import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../js/game/rulesets.js', import.meta.url), 'utf8');
const sql = fs.readFileSync(new URL('../SQL/120_ruleset_controls_and_equipment_audit.sql', import.meta.url), 'utf8');
const failures = [];
const check = (label, passed) => { console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}`); if (!passed) failures.push(label); };
const context = vm.createContext({ BT_CRITICAL_LAYOUTS:{ standard:{}, later:{}, void:{ct:['Void Signature System']}, advanced:{ct:['Supercharger']} } });
vm.runInContext(source, context, { filename:'rulesets.js' });
const status = vm.runInContext('unitRulesetStatus', context);
check('Standard 3060 permits an eligible era-appropriate catalogue unit', status('standard',{era:3050},'standard_3060').allowed);
check('Standard 3060 excludes advanced booster equipment', !status('advanced',{era:3050},'standard_3060').allowed);
check('Advanced 3060 retains supported advanced equipment', status('advanced',{era:3050},'advanced_3060').allowed);
check('3060 rulesets exclude later-era units', !status('later',{era:3067},'advanced_3060').allowed);
check('Void Signature stays Open-only', !status('void',{era:3050},'advanced_3060').allowed && status('void',{era:3070},'open_experimental').allowed);
for (const marker of ['btech_ruleset_unit_allowed','sr6_ruleset_hangar_v1','update_lobby_roster']) check(`authoritative SQL includes ${marker}`, sql.includes(marker));
if (failures.length) { console.error(`\n${failures.length} ruleset-control regression failure(s).`); process.exit(1); }
console.log('\nRuleset-control regression checks passed.');
