import fs from 'node:fs';
import vm from 'node:vm';

const movementSource = fs.readFileSync(new URL('../js/movement/movement.js', import.meta.url), 'utf8');
const physicalSource = fs.readFileSync(new URL('../js/game/physical-attack.js', import.meta.url), 'utf8');
const criticalSource = fs.readFileSync(new URL('../js/game/critical-hits.js', import.meta.url), 'utf8');
const designerSource = fs.readFileSync(new URL('../js/game/mech-designer.js', import.meta.url), 'utf8');
const sqlSource = fs.readFileSync(new URL('../SQL/118_supercharger_and_triple_strength_myomer.sql', import.meta.url), 'utf8');
const failures = [];

function check(label, passed, detail = '') {
  console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!passed) failures.push(label);
}

const context = vm.createContext({
  console,
  currentGameState: { round: 4 },
  BT_CRITICAL_LAYOUTS: {
    test: { ct: ['Fusion Engine', 'Supercharger'], lt: ['Triple Strength Myomer'], rt: ['Triple Strength Myomer'] }
  },
  criticalSlotName: value => String(value || ''),
  criticalEquipmentKey: value => String(value || '').toLowerCase().replace(/^(is|clan|cl)/, '').replace(/[^a-z0-9]/g, ''),
  criticalMovementProfile: () => ({ walk: 4, run: 6, jump: 0, destroyedLegs: 0 })
});
vm.runInContext(movementSource, context, { filename: 'movement.js' });

const cold = { unitId: 'test', heat: 8 };
const hot = { unitId: 'test', heat: 9 };
check('Supercharger critical slot is detected as operational', vm.runInContext('hasOperationalSupercharger', context)(cold));
check('TSM remains inactive below Heat Level 9', !vm.runInContext('hasActiveTSM', context)(cold));
check('TSM activates at Heat Level 9', vm.runInContext('hasActiveTSM', context)(hot));
check('active TSM adds one Walking MP', vm.runInContext('boostedWalkingMP', context)(hot) === 5);
check('MASC plus Supercharger supplies 2.5× boosted Walking MP', vm.runInContext('boosterRunMP', context)(hot, true, true) === 13);
check('Supercharger uses its own escalating activation sequence', vm.runInContext('superchargerTargetNumber', context)({ superchargerUseLevel: 2, superchargerLastRound: 3 }, 4) === 7);

check('client physical attacks double for active TSM except Push and DFA', physicalSource.includes("!['push', 'dfa'].includes(type) ? damage * 2 : damage"));
check('client critical selection excludes distributed TSM slots', criticalSource.includes('Triple[- ]Strength Myomer'));
check('MechLab offers both Supercharger and TSM equipment', designerSource.includes("supercharger:{name:'Supercharger'") && designerSource.includes("tsm:{name:'Triple-Strength Myomer'"));
check('MechLab constrains Superchargers to the Center Torso', designerSource.includes("item.key === 'supercharger' && item.location !== 'ct'"));

for (const marker of [
  'sr4_supercharger_movement_v1',
  'sr4_tsm_physical_v1',
  'sr4_tsm_non_hittable_v1',
  'sr4_tsm_masc_protection_v1',
  'sr4_heat_mobility_construction_v1'
]) check(`authoritative SQL includes ${marker}`, sqlSource.includes(marker));
check('authoritative Supercharger failure can allow an ordinary replot', sqlSource.includes("jsonb_build_object(''activation_ends''"));
check('server physical resolver excludes Push and DFA from TSM doubling', sqlSource.includes("p_attack_type NOT IN (''push'',''dfa'')"));

if (failures.length) {
  console.error(`\n${failures.length} heat-and-mobility equipment regression failure(s).`);
  process.exit(1);
}
console.log('\nHeat-and-mobility equipment regression checks passed.');
