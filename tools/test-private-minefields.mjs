// GM-4 static contract: protected minefield storage, scenario budgets and
// client delivery must stay aligned. Live movement/probe fixtures remain in
// the focused regression; this is cheap enough for every soak iteration.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const failures=[];const check=(label,ok)=>{console.log(`${ok?'PASS':'FAIL'}  ${label}`);if(!ok)failures.push(label);};
const sql=fs.readFileSync(path.join(ROOT,'SQL/130_private_minefield_rules_and_delivery.sql'),'utf8');
const editor=fs.readFileSync(path.join(ROOT,'js/game/scenario-editor.js'),'utf8');
const lobby=fs.readFileSync(path.join(ROOT,'js/network/lobby.js'),'utf8');
const phases=fs.readFileSync(path.join(ROOT,'js/game/phases.js'),'utf8');
const create=fs.readFileSync(path.join(ROOT,'js/network/create-game.js'),'utf8');
const aiCreate=fs.readFileSync(path.join(ROOT,'js/network/create-vs-ai.js'),'utf8');
check('private minefields use a dedicated RLS-protected table',sql.includes('CREATE TABLE IF NOT EXISTS public.btech_minefields')&&sql.includes('ENABLE ROW LEVEL SECURITY')&&sql.includes('Minefield owners and discoverers can view fields'));
check('the public minefield view filters by owner or revealed seat',sql.includes('get_match_minefield_view')&&sql.includes('owner_seat=seat OR EXISTS'));
check('legacy shared minefield state is migrated then removed',sql.includes('INSERT INTO public.btech_minefields')&&sql.includes("-'minefields'"));
check('scenario budgets charge density and constrain allowed equipment',sql.includes('spent:=spent+(field->>\'density\')::int')&&sql.includes('permitted_types')&&sql.includes('permitted_densities')&&sql.includes('vibrabomb_sensitivities'));
check('server mine resolution reads the protected table and preserves probes, ECM, triggers and depletion',['FROM btech_minefields','btech_ecm_interferes_line','minefield_detected','minefield_triggered','density=greatest(0,density-5)'].every(marker=>sql.includes(marker)));
check('solo AI minefields are seeded server-side without returning coordinates',sql.includes('seed_ai_minefield_plan')&&sql.includes("'status','prepared','count'")&&lobby.includes("seed_ai_minefield_plan"));
check('editor exposes a minefield budget and permitted types',editor.includes('normalizeMinefieldRules')&&editor.includes('Minefield rules')&&editor.includes('Budget per side'));
check('new human and AI scenarios persist rules rather than shared fields',create.includes('minefield_rules')&&!create.includes('minefields: []')&&aiCreate.includes('minefield_rules')&&!aiCreate.includes('minefields:[]'));
check('lobby and battlefield request a private view instead of reading shared state',lobby.includes('get_match_minefield_view')&&phases.includes('get_match_minefield_view')&&lobby.includes('minefieldBudget'));
if(failures.length){console.error(`\n${failures.length} GM-4 minefield regression failure(s).`);process.exitCode=1;}else console.log('\nGM-4 private minefield regression passed.');
