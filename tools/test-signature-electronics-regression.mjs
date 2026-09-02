import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../js/game/weapon-attack.js', import.meta.url), 'utf8');
const designer = fs.readFileSync(new URL('../js/game/mech-designer.js', import.meta.url), 'utf8');
const sql = fs.readFileSync(new URL('../SQL/119_signature_and_advanced_electronics.sql', import.meta.url), 'utf8');
const failures = [];
const check = (label, passed) => { console.log(`${passed ? 'PASS' : 'FAIL'}  ${label}`); if (!passed) failures.push(label); };
const context = vm.createContext({
  BT_CRITICAL_LAYOUTS: { test:{ ct:['Null Signature System', 'Void Signature System', 'Chameleon Light Polarization Shield', 'Angel ECM Suite', 'Watchdog CEWS', 'Clan Light Active Probe'] } },
  mechInstances: [], currentGameState:{round:1},
  axialDistance: () => 0, offsetToAxial: () => ({q:0,r:0}), axialRound: () => ({q:0,r:0}), axialToOffset: () => ({col:0,row:0}),
  weaponProfile: () => null
});
vm.runInContext(source, context, { filename:'weapon-attack.js' });
const active = { unitId:'test', signatureModes:{ null:true, chameleon:true }, criticalSlotDamage:{}, hexesMoved:0 };
const voidStill = { unitId:'test', signatureModes:{ void:true }, criticalSlotDamage:{}, hexesMoved:0 };
const voidMoved = { ...voidStill, hexesMoved:4 };
check('Null Signature and Chameleon add their heat while active', vm.runInContext('signatureHeat', context)(active) === 16);
check('signature systems apply medium-range defensive modifiers', vm.runInContext('signatureTargetModifier', context)(active, {label:'Medium'}) === 2);
check('Void Signature is strongest when stationary', vm.runInContext('signatureTargetModifier', context)(voidStill, {label:'Long'}) === 3);
check('Void Signature weakens after moving 3–5 hexes', vm.runInContext('signatureTargetModifier', context)(voidMoved, {label:'Long'}) === 1);
check('Void Signature applies the firing penalty to its user', vm.runInContext('voidSignatureAttackerModifier', context)(voidStill) === 1);
check('Angel ECM, Watchdog CEWS, light probes, and signature systems are in MechLab', ['angel_ecm','watchdog_cews','clan_light_active_probe','null_signature','void_signature','chameleon_lps'].every(key => designer.includes(`${key}:{`)));
for (const marker of ['sr5_signature_targeting_v1','sr5_signature_heat_v1','sr5_signature_override_heat_v1','set_battlemech_signature_mode','btech_active_probe_range']) check(`authoritative SQL includes ${marker}`, sql.includes(marker));
if (failures.length) { console.error(`\n${failures.length} signature/electronics regression failure(s).`); process.exit(1); }
console.log('\nSignature and advanced-electronics regression checks passed.');
