const {chromium}=require('/Users/mattperkins/.hermes/hermes-agent/node_modules/playwright');
(async()=>{const b=await chromium.launch({headless:true,channel:'chrome'});try{const page=await b.newPage({viewport:{width:1633,height:946}});const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:8790/index.html');await page.locator('#login-screen.active').waitFor();
await page.evaluate(async()=>{await loadUnitCatalogue();currentUser={id:'preview',user_metadata:{callsign:'Test-Sign'}};currentGameId='ui-fixture';mySeatNumber=1;myInitiativePlayerId='host';isHost=true;vsAiMode=false;setActiveMap('woodland-approach');setActiveTerrainState({});window.fixtureUnit=Object.keys(BT_UNITS).find(id=>getSupportedUnit(id)&&isSupportedUnit(id));mechInstances=buildRosterInstances({'1':[fixtureUnit],'2':[fixtureUnit]});mechInstances.forEach(ensureMechCombatState);selectedInstanceId=mechInstances[0].instanceId;currentGameState={...currentGameState,round:3,phase:'movement',active_player_id:'host',initiative_order:[{player_id:'host',seat_number:1},{player_id:'guest',seat_number:2}],initiative_rolls:[],initiative_pending:[],skirmish_avatars:{'2':{callsign:'Wolf'}}};currentMatchConfig={};showScreen('game-screen');canvas=document.getElementById('hexmap');ctx=canvas.getContext('2d');resizeCanvas();updateGameHeader();renderInitiativeDisplay();renderRoster();renderDetail();renderMovementPanel();});

await page.evaluate(()=>{setActiveTerrainState({terrain_overrides:{'0808':'shallow_water'}});mapZoom=.7;mapRotation=0;resizeCanvas();});
for(const [terrain,label] of [['shallow_water','Depth 1'],['deep_water','Depth 2'],['bridge','Bridge'],['light_woods','Light woods'],['heavy_woods','Heavy woods']]) {
 for(const angle of [0,90]) {
 const point=await page.evaluate(({terrain,angle})=>{setActiveTerrainState({terrain_overrides:{'0808':terrain}});mapRotation=angle;draw();const rect=canvas.getBoundingClientRect(),p=hexToPixel(8,8);const x=(p.x+gridOffsetX+mapPanX-rect.width/2)*mapZoom,y=(p.y+gridOffsetY+mapPanY-rect.height/2)*mapZoom,r=angle*Math.PI/180;return{x:rect.left+rect.width/2+x*Math.cos(r)-y*Math.sin(r),y:rect.top+rect.height/2+x*Math.sin(r)+y*Math.cos(r)}},{terrain,angle});
 await page.mouse.move(point.x+1,point.y+1);await page.mouse.move(point.x,point.y);
 const tip=page.locator('#terrain-tooltip');if(!await tip.isVisible()||!(await tip.innerText()).includes(label)||!(await tip.innerText()).includes('0808'))throw Error('Terrain tooltip mismatch '+terrain+' '+angle);
 }
 console.log('PASS terrain hover with zoom and rotation:',label);
}
await page.mouse.move(10,60);if(await page.locator('#terrain-tooltip').isVisible())throw Error('Tooltip should hide off map');
for(const [side,selector,direction] of [['side','#panel',-1],['detail','#mech-panel',1]]) {
 const handle=page.locator('.'+side+'-resize-handle');const start=await page.locator(selector).evaluate(e=>e.getBoundingClientRect().width);const rect=await handle.boundingBox();
 await page.mouse.move(rect.x+rect.width/2,rect.y+100);await page.mouse.down();await page.mouse.move(rect.x+rect.width/2+direction*90,rect.y+100,{steps:8});await page.mouse.up();
 const end=await page.locator(selector).evaluate(e=>e.getBoundingClientRect().width);if(end-start<85)throw Error('Drag failed '+side+' '+start+' -> '+end);
 await page.locator(selector).evaluate(e=>e.scrollTop=1000);const rect2=await handle.boundingBox();if(rect.y!==rect2.y)throw Error('Handle scrolled away');
 await handle.focus();await page.keyboard.press(side==='side'?'ArrowLeft':'ArrowRight');const keyWidth=await page.locator(selector).evaluate(e=>e.getBoundingClientRect().width);if(keyWidth<=end)throw Error('Keyboard resize failed');console.log('PASS drag, scroll and keyboard resizing:',side);
}
await page.evaluate(()=>{document.getElementById('game-screen').style.setProperty('--detail-panel-width','240px');document.getElementById('mech-panel').scrollTop=0;renderDetail();});
const compact=await page.locator('#mech-panel .weapon-inventory-wrap').evaluate(e=>({width:e.clientWidth,scroll:e.scrollWidth,text:e.textContent}));if(compact.scroll>compact.width+1||!compact.text.includes('Range (hexes)')||!compact.text.includes('Long'))throw Error('Weapons overflow '+JSON.stringify(compact));console.log('PASS all weapon values fit minimum sidebar width');
await page.screenshot({path:'/tmp/btech-terrain-panels-105.png'});
await page.evaluate(()=>{localStorage.setItem('bt-vtt-side-panel-width', '450');});await page.reload();await page.locator('#login-screen.active').waitFor();const saved=await page.evaluate(()=>document.getElementById('game-screen').style.getPropertyValue('--side-panel-width'));if(saved!=='450px')throw Error('Saved width lost');
if(errors.length)throw Error(errors.join(';'));console.log('PASS saved width restored; no browser errors');
}finally{await b.close()}})().catch(e=>{console.error(e);process.exitCode=1});
