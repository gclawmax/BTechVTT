#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
const failures=[];const check=(label,ok)=>{console.log(`${ok?'PASS':'FAIL'}  ${label}`);if(!ok)failures.push(label);};
const sql=await readFile(new URL('../SQL/117_advanced_direct_fire_weapons.sql',import.meta.url),'utf8');
const catalogue=await readFile(new URL('../js/game/unit-catalogue.js',import.meta.url),'utf8');
const designer=await readFile(new URL('../js/game/mech-designer.js',import.meta.url),'utf8');
const importer=await readFile(new URL('./build-megamek-content-pack.mjs',import.meta.url),'utf8');
check('all Ultra AC sizes have profiles and ammunition', ['uac2','uac5','uac10','uac20'].every(key=>catalogue.includes(`${key}:`)&&designer.includes(`${key}:{`))&&sql.includes('advanced_direct_fire_ammo_v1'));
check('Light and Heavy Gauss ammunition is non-explosive',sql.includes("'light_gauss' THEN 0")&&sql.includes("'heavy_gauss' THEN 0")&&sql.includes('advanced_direct_fire_gauss_safety_v1'));
check('Heavy Gauss retains its 25/20/10 range damage',catalogue.includes('damageByRange: [25, 20, 10]')&&sql.includes('WHEN dist<=6 THEN 25 WHEN dist<=13 THEN 20 ELSE 10'));
check('ER and pulse laser/PPC profiles preserve their direct-fire modifiers',importer.includes("'ER PPC'")&&importer.includes("'Medium Pulse Laser'")&&sql.includes('toHitModifier'));
if(failures.length){console.error(`\n${failures.length} advanced direct-fire regression failure(s).`);process.exit(1);}console.log('\nAdvanced direct-fire regression checks passed.');
