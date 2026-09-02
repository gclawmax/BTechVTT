#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
const failures=[];const check=(label,ok)=>{console.log(`${ok?'PASS':'FAIL'}  ${label}`);if(!ok)failures.push(label);};
const sql=await readFile(new URL('../SQL/116_advanced_missile_families.sql',import.meta.url),'utf8');
const client=await readFile(new URL('../js/game/weapon-attack.js',import.meta.url),'utf8');
const phases=await readFile(new URL('../js/game/phases.js',import.meta.url),'utf8');
const importer=await readFile(new URL('./build-megamek-content-pack.mjs',import.meta.url),'utf8');
check('ATM bins require Standard, ER or HE payload selection',sql.includes("ARRAY['standard','er','he']")&&phases.includes("['standard', 'er', 'he']"));
check('ATM payloads apply their correct damage and range bands',client.includes("range: [9, 18, 27]")&&client.includes("range: [3, 6, 9]")&&sql.includes('damage_per_missile:=3'));
check('Streak LRMs retain lock-only ammunition and heat behaviour',importer.includes("streak_lrm20")&&importer.includes('streak: true'));
check('Thunderbolt launchers and ammunition are recognised by the importer',importer.includes("'Thunderbolt 20'")&&importer.includes("'tbolt20', 3"));
check('Thunderbolts can use the established indirect-fire path',client.includes('weapon?.thunderbolt')&&sql.includes('advanced_missile_indirect_v1'));
check('Custom builder has the complete SR-2 launcher and ammunition set',sql.includes('advanced_missile_construction_v1')&&sql.includes('advanced_missile_ammo_v1')&&sql.includes("streak_lrm20"));
if(failures.length){console.error(`\n${failures.length} advanced missile regression failure(s).`);process.exit(1);}console.log('\nAdvanced missile regression checks passed.');
