import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../js/game/specialist-physical-equipment.js', import.meta.url), 'utf8');
const sql = fs.readFileSync(new URL('../SQL/121_specialist_physical_equipment.sql', import.meta.url), 'utf8');
const failures = [];
const check = (label, passed) => { console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}`); if (!passed) failures.push(label); };
const context = vm.createContext({
  BT_UNITS: { talon:{ mechanical_jump_booster_mp:0 }, booster:{ mechanical_jump_booster_mp:5 } },
  BT_CRITICAL_LAYOUTS: { talon:{ ll:['Foot Actuator','Talons'], rl:['Foot Actuator'] }, booster:{ ct:['Mechanical Jump Booster'] } },
  criticalEquipmentKey: value => String(value).toLowerCase().replace(/[^a-z0-9]/g,''),
  physicalComponentState: (mech, location, label) => ({ damaged:(mech.criticalSlotDamage?.[location] || []).includes(0) && label === 'Foot Actuator' })
});
vm.runInContext(source, context, { filename:'specialist-physical-equipment.js' });
const talonDamage = vm.runInContext('talonAdjustedDamage', context);
const jumpBooster = vm.runInContext('mechanicalJumpBoosterMP', context);
check('operational Talons increase only their leg kick damage by 50%', talonDamage({ unitId:'talon', structure:{ ll:10 }, criticalSlotDamage:{} }, 'll', 10) === 15);
check('destroyed Talons provide no kick bonus', talonDamage({ unitId:'talon', structure:{ ll:10 }, criticalSlotDamage:{ ll:[1] } }, 'll', 10) === 10);
check('a recorded operational mechanical jump-booster rating is available to movement', jumpBooster({ unitId:'booster', structure:{ ct:20 }, criticalSlotDamage:{} }) === 5);
for (const marker of ['btech_talon_operational','sr6b_talon_kick_v1','sr6b_talon_dfa_v1']) check(`authoritative SQL includes ${marker}`, sql.includes(marker));
if (failures.length) { console.error(`\n${failures.length} specialist-physical equipment regression failure(s).`); process.exit(1); }
console.log('\nSpecialist physical-equipment regression checks passed.');
