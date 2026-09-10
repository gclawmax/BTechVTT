const {chromium}=require('/Users/mattperkins/.hermes/hermes-agent/node_modules/playwright');
(async()=>{const b=await chromium.launch({headless:true,channel:'chrome'});try{const page=await b.newPage({viewport:{width:1633,height:946}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:8790/index.html');await page.locator('#login-screen.active').waitFor();
await page.evaluate(async()=>{await loadUnitCatalogue();currentUser={id:'preview',user_metadata:{callsign:'Test-Sign'}};currentGameId='ui-fixture';mySeatNumber=1;myInitiativePlayerId='host';isHost=true;vsAiMode=false;setActiveMap('woodland-approach');setActiveTerrainState({});window.fixtureUnit=Object.keys(BT_UNITS).find(id=>getSupportedUnit(id)&&isSupportedUnit(id));mechInstances=buildRosterInstances({'1':[fixtureUnit],'2':[fixtureUnit]});mechInstances.forEach(ensureMechCombatState);selectedInstanceId=mechInstances[0].instanceId;currentGameState={...currentGameState,round:3,phase:'movement',active_player_id:'host',initiative_order:[{player_id:'host',seat_number:1},{player_id:'guest',seat_number:2}],initiative_rolls:[],initiative_pending:[],skirmish_avatars:{'2':{callsign:'Wolf'}}};currentMatchConfig={};showScreen('game-screen');canvas=document.getElementById('hexmap');ctx=canvas.getContext('2d');resizeCanvas();updateGameHeader();renderInitiativeDisplay();renderRoster();renderDetail();renderMovementPanel();});


await page.evaluate(()=>handleCreateGame());
if(await page.locator('#create-map-select option[value^="reference-"]').count()!==9)throw Error('Missing map choices');
for(const id of ['reference-woodland-single','reference-river-landscape','reference-highland-portrait']){
await page.selectOption('#create-map-select',id);await page.evaluate(()=>renderCreateMapPreview());
if(await page.locator('.map-preview-grid').evaluate(e=>e.getBoundingClientRect().height)>470)throw Error('Map preview too tall');
await page.screenshot({path:'/tmp/'+id+'.png',fullPage:true});
}
await page.evaluate(()=>{setActiveMap('reference-highland-portrait');currentMatchConfig={map_id:'reference-highland-portrait'};if(!scenarioDeploymentZoneContains(1,8,1)||scenarioDeploymentZoneContains(1,8,32)||!scenarioDeploymentZoneContains(2,8,32))throw Error('Portrait ends wrong');showScreen('game-screen');resizeCanvas();});
if(errors.length)throw Error(errors.join(';'));console.log('PASS nine setup choices, single/wide/deep previews and portrait deployment ends; no browser errors');
}finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});