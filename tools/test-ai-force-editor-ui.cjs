const {chromium}=require('/Users/mattperkins/.hermes/hermes-agent/node_modules/playwright');
(async()=>{const b=await chromium.launch({headless:true,channel:'chrome'});try{const page=await b.newPage({viewport:{width:1633,height:946}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:8790/index.html');await page.locator('#login-screen.active').waitFor();
await page.evaluate(async()=>{await loadUnitCatalogue();currentUser={id:'preview',user_metadata:{callsign:'Test-Sign'}};currentGameId='ui-fixture';mySeatNumber=1;myInitiativePlayerId='host';isHost=true;vsAiMode=false;setActiveMap('woodland-approach');setActiveTerrainState({});window.fixtureUnit=Object.keys(BT_UNITS).find(id=>getSupportedUnit(id)&&isSupportedUnit(id));mechInstances=buildRosterInstances({'1':[fixtureUnit],'2':[fixtureUnit]});mechInstances.forEach(ensureMechCombatState);selectedInstanceId=mechInstances[0].instanceId;currentGameState={...currentGameState,round:3,phase:'movement',active_player_id:'host',initiative_order:[{player_id:'host',seat_number:1},{player_id:'guest',seat_number:2}],initiative_rolls:[],initiative_pending:[],skirmish_avatars:{'2':{callsign:'Wolf'}}};currentMatchConfig={};showScreen('game-screen');canvas=document.getElementById('hexmap');ctx=canvas.getContext('2d');resizeCanvas();updateGameHeader();renderInitiativeDisplay();renderRoster();renderDetail();renderMovementPanel();});


await page.evaluate(async()=>{
// Explicit local fixtures: no catalogue or production match is mutated.
const fixtures=Object.entries(BT_UNIT_CATALOGUE).filter(([id])=>isSupportedUnit(id));
fixtures.forEach(([id,u],i)=>{u.techBase=i===0?'Clan':'Inner Sphere';u.battleValue={system:'BV2',stock:1000+i*50};});
vsAiMode=true;
const entries=vsAiUnitEntries('standard_3060'),clan=entries.find(([id,u])=>techBaseForUnit(u)==='clan'),is=entries.find(([id,u])=>techBaseForUnit(u)==='inner_sphere')||entries.find(([id,u])=>techBaseForUnit(u)!=='clan');
if(!clan||!is)throw Error('Missing catalogue tech bases');
if(defaultSkirmishPilot(clan[1]).gunnery!==3||defaultSkirmishPilot(clan[1]).piloting!==4||defaultSkirmishPilot(is[1]).gunnery!==4)throw Error('Wrong defaults');
for(let seed=0;seed<12;seed++){const force=buildVsAiSuggestedBvForce(entries,3500,'test'+seed);if(bv2ForceSnapshot(force).adjusted>3500)throw Error('Generated force over adjusted BV');}
handleCreateVsAI();if(document.getElementById('vs-ai-minefields-enabled').checked)throw Error('Mines default on');document.getElementById('vs-ai-minefields-enabled').checked=true;document.getElementById('vs-ai-ruleset-select').value='standard_3060';syncVsAiMinefieldControls();if(!document.getElementById('vs-ai-minefields-enabled').disabled||document.getElementById('vs-ai-minefields-enabled').checked)throw Error('Standard permits mines');
window.aiTestState={map_id:'training-grounds',ruleset:'standard_3060',vs_ai_mode:true,force_limit:{mode:'bv2',limit:10000},rosters:{'1':[],'2':[clan[0]]},skirmish_avatars:{'2':{hangar:[{id:'enemy',unit_id:clan[0],pilot:{name:'Star Pilot',gunnery:3,piloting:4}}],deployed:['enemy']}}};
db.from=()=>({select:()=>({eq:()=>({single:async()=>({data:{status:'lobby',state:aiTestState}})})})});
});
await page.evaluate(()=>openAiForceEditor());
if(await page.locator('#ai-force-editor').count()!==1)throw Error('Editor not opened');
await page.locator('#ai-force-search').fill('atlas');
if(await page.locator('#ai-force-unit option').count()!==1)throw Error('Chassis search failed');
await page.locator('#ai-force-search').fill('nonexistent-unit');
if(await page.locator('#ai-force-unit').inputValue()!=='')throw Error('Empty search is selectable');
await page.locator('#ai-force-search').fill('');
await page.locator('.ai-pilot-fields input').first().fill('Test Ace');
await page.locator('.ai-pilot-fields select').first().selectOption('2');
await page.evaluate(()=>{window.aiSave=null;db.rpc=async(name,args)=>{if(name!=='update_ai_skirmish_force')throw Error('Wrong endpoint');aiSave=args;return{error:null}};loadLobbyUI=async()=>{};});
for(const width of [1280,390]){await page.setViewportSize({width,height:900});if(await page.locator('#ai-force-editor .record-sheet').evaluate(e=>e.scrollWidth>e.clientWidth))throw Error('Editor overflows');await page.screenshot({path:'/tmp/ai-force-editor-'+width+'.png'});}
await page.locator('#ai-force-save').click();
await page.evaluate(()=>{if(aiSave.p_hangar[0].pilot.name!=='Test Ace'||aiSave.p_hangar[0].pilot.gunnery!==2||aiSave.p_positions.length!==1)throw Error('Pilot/force save mismatch');if(aiForceEditor!==null)throw Error('Editor not closed');});
if(errors.length)throw Error(errors.join(';'));console.log('PASS Clan/IS defaults, adjusted suggestions, mines off/Standard disabled, AI pilot editing and save, desktop/mobile layout.');
}finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});