#!/usr/bin/env node
// Weapon inventory presentation regression: the selected-unit panel and full
// record sheet expose the catalogue's combat data without duplicating rules.
import { readFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const [panels, record, css, index] = await Promise.all([
  readFile(new URL('js/ui/panels.js', root), 'utf8'),
  readFile(new URL('js/ui/record-sheet.js', root), 'utf8'),
  readFile(new URL('css/main.css', root), 'utf8'),
  readFile(new URL('index.html', root), 'utf8')
]);
let failures = 0;
function check(label, condition) { console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`); if (!condition) failures += 1; }
check('inventory reads each mount catalogue profile', panels.includes("...(BT_WEAPONS?.[mount.key] || {})") && panels.includes('...(mount.weapon || {})'));
check('inventory displays quantity, type, location and full combat data', ['Weapon','Loc.','Heat','Dmg','Min.','Short','Med.','Long'].every(label => panels.includes(`>${label}<`)));
check('range-dependent damage remains visible', panels.includes('profile.damageByRange.join'));
check('identical mounts are grouped without losing quantity', panels.includes('grouped.get(key).count += row.count'));
check('Clan weapons and rear mounts remain identified', panels.includes('Clan weapon') && panels.includes("${rear ? ' (R)' : ''}"));
check('the selected BattleMech panel uses the inventory', panels.includes('${renderWeaponInventory(unit)}'));
check('the full record sheet uses the same inventory', record.includes("renderWeaponInventory(unit, 'record-weapon-table')"));
check('narrow panels retain horizontal access to every column', css.includes('.weapon-inventory-wrap') && css.includes('overflow-x:auto'));
check('the browser exposes the weapon-inventory build', index.includes('20260908-weapon-inventory-98'));
if (failures) { console.error(`Weapon inventory display regression failed: ${failures} check(s).`); process.exitCode = 1; }
else console.log('Weapon inventory display regression passed.');
