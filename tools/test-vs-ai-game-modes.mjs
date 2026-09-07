import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const check = (label, condition, detail = '') => {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`);
  if (!condition) failures.push(label);
};

const create = fs.readFileSync(path.join(ROOT, 'js/network/create-vs-ai.js'), 'utf8');
const lobby = fs.readFileSync(path.join(ROOT, 'js/network/lobby.js'), 'utf8');
const editor = fs.readFileSync(path.join(ROOT, 'js/game/scenario-editor.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

check('Play vs AI opens a dedicated scenario setup screen', html.includes('id="vs-ai-setup-screen"') && create.includes("showScreen('vs-ai-setup-screen')"));
check('the solo setup exposes map, budget, victory, ruleset and opponent controls', ['vs-ai-map-select','vs-ai-tonnage-select','vs-ai-victory-select','vs-ai-ruleset-select','vs-ai-difficulty-setup-select','vs-ai-personality-setup-select'].every(id => html.includes(id)));
check('configured AI games persist map, budget, ruleset, victory and deterministic seed', ['map_id:mapId','dropship_tonnage:Number(dropshipTonnage)','victory_mode:validMode','ruleset:validRuleset','ai_seed:aiSeed'].every(marker => create.includes(marker)));
check('AI deployment is mission-aware and map-aware', ['buildVsAiDeployment','objectiveHexesForMap','scenarioDeploymentZoneHexes','generated_deployment'].every(marker => create.includes(marker)));
check('both suggested forces begin with legal editable deployments', ["deployment_positions['1'] = buildVsAiDeployment(humanRoster, 1, setupState)", "deployment_positions['2'] = buildVsAiDeployment(aiRoster, 2, setupState)"].every(marker => create.includes(marker)));
check('the player receives the normal Hangar and deployment workflow in AI lobbies', !lobby.includes('if (vsAiMode || !mySeatNumber || !gameState.map_id)') && !lobby.includes('if (!currentGameId || !currentUser || vsAiMode || !isSupportedUnit(unitId))'));
check('starting a solo game constructs its configured rosters rather than the old fixed demonstration force', lobby.includes('buildRosterInstances(gameState.rosters') && !lobby.includes('gameState.mech_instances = buildDefaultVsAIMechInstances()'));
check('custom scenarios can launch directly into a solo lobby', editor.includes('launchScenarioEditorVsAI') && editor.includes('createVsAIGame({ mapId'));

const sandbox = {
  BT_UNIT_CATALOGUE: {
    light:{ tonnage:35, movement:{ walk:6 } }, medium:{ tonnage:55, movement:{ walk:5 } }, heavy:{ tonnage:75, movement:{ walk:4 } }, assault:{ tonnage:100, movement:{ walk:3 } }
  },
  isSupportedUnit: () => true,
  unitRulesetStatus: () => ({ allowed:true }),
  getSupportedUnit: id => ({ light:{ tonnage:35 }, medium:{ tonnage:55 }, heavy:{ tonnage:75 }, assault:{ tonnage:100 } })[id]
};
vm.createContext(sandbox);
vm.runInContext(create, sandbox, { filename:'js/network/create-vs-ai.js' });
const first = sandbox.buildVsAiSuggestedForce(Object.entries(sandbox.BT_UNIT_CATALOGUE), 200, 'gm2-seed');
const second = sandbox.buildVsAiSuggestedForce(Object.entries(sandbox.BT_UNIT_CATALOGUE), 200, 'gm2-seed');
check('suggested forces are deterministic and remain within their budget', JSON.stringify(first) === JSON.stringify(second) && first.reduce((total, id) => total + sandbox.BT_UNIT_CATALOGUE[id].tonnage, 0) <= 200, JSON.stringify(first));
const other = sandbox.buildVsAiSuggestedForce(Object.entries(sandbox.BT_UNIT_CATALOGUE), 200, 'gm2-seed', new Set(first));
check('AI generation avoids the initially suggested human variants when alternatives exist', other.every(id => !first.includes(id)), JSON.stringify({ first, other }));

if (failures.length) {
  console.error(`\n${failures.length} GM-2 regression failure(s).`);
  process.exitCode = 1;
} else console.log('\nConfigurable Play vs AI regression passed.');
