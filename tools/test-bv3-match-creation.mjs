#!/usr/bin/env node
// Regression guard for BV-3's creation, deterministic AI, and server seal.
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const [html, human, ai, editor, lobby, sql, isolationSql] = await Promise.all([
  read('index.html'), read('js/network/create-game.js'), read('js/network/create-vs-ai.js'),
  read('js/game/scenario-editor.js'), read('js/network/lobby.js'), read('SQL/133_bv2_match_creation_and_ai_sealing.sql'),
  read('SQL/137_bv2_without_tonnage.sql')
]);
let failures = 0;
function check(label, condition) { console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}`); if (!condition) failures += 1; }

check('Create Match offers tonnage and BV2 formats with presets and custom caps', html.includes('create-force-format-select') && html.includes('create-bv-custom-limit') && html.includes('10,000 BV'));
check('Vs AI offers the same force-format controls', html.includes('vs-ai-force-format-select') && html.includes('vs-ai-bv-custom-limit'));
check('new matches seal a versioned BV2 force limit only when selected', human.includes("bv_version:'BV2.1'") && human.includes('force_limit:sealedForceLimit'));
check('AI selects only verified BV2 candidates and stores its deterministic force format', ai.includes('buildVsAiSuggestedBvForce') && ai.includes('battleValue?.stock') && ai.includes("force_format:sealedForceLimit"));
check('the scenario editor persists and launches its selected force format', editor.includes('force_limit: { mode:\'tonnage\' }') && editor.includes('scenarioEditorSetForceFormat') && editor.includes('forceLimit:scenarioEditorState.force_limit'));
check('BV2 hides and omits the unrelated Dropship tonnage limit', html.includes('create-tonnage-controls') && html.includes('vs-ai-tonnage-controls') && human.includes("sealedForceLimit.mode === 'tonnage' ? { dropship_tonnage") && ai.includes("sealedForceLimit.mode === 'tonnage' ? { dropship_tonnage") && editor.includes('delete scenarioEditorState.dropship_tonnage'));
check('starting a BV2 match calls the server seal', lobby.includes("db.rpc('seal_bv2_match_force_values'"));
check('the server seals both seats and rejects over-cap values', sql.includes('FOR seat_no IN SELECT player.seat_number') && sql.includes('exceeds the BV2 limit'));
check('custom BV2 scenarios do not require a Dropship-tonnage field', isolationSql.includes('bv2_scenario_without_tonnage_v1') && isolationSql.includes("force_limit''->>''mode''"));

if (failures) { console.error(`BV-3 regression failed: ${failures} check(s).`); process.exitCode = 1; }
else console.log('BV-3 match-creation regression passed.');
