const {chromium}=require('/Users/mattperkins/.hermes/hermes-agent/node_modules/playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
(async()=>{
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try {
  const page=await browser.newPage();
  if(!process.env.BT_TEST_HOSTED) await page.route('**/js/game/mech-designer.js?*',route=>route.fulfill({path:path.resolve(__dirname,'../js/game/mech-designer.js'),contentType:'application/javascript'}));
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(process.env.SHOT_URL||'https://gclawmax.github.io/BTechVTT/');
  await page.locator('#login-screen.active').waitFor();
  // Exercise the actual renderer and navigation with a read-only catalogue fixture.
  await page.evaluate(()=>{loadLatestUnitCatalogue=async()=>{activeCatalogueVersion='ui-test';};loadCustomSavedDesigns=async()=>{};showScreen('menu-screen');});
  await page.evaluate(()=>openMechDesigner());
  await page.locator('#mech-designer-screen.active h2').waitFor();
  assert.match(await page.locator('#mech-designer-root').innerText(),/Standard/);
  await page.locator('select[onchange*="armor_type"]').selectOption('is_ferro_fibrous');
  assert.match(await page.locator('.designer-armor-grid + .designer-note').innerText(),/Ferro/);
  await page.getByRole('button',{name:'Add weapon',exact:true}).click();
  assert.equal(await page.locator('select[onchange*="updateCustomWeapon"]').count(),2);
  await page.getByRole('button',{name:'Back',exact:true}).click();
  assert.equal(await page.locator('#menu-screen.active').count(),1);
  await page.evaluate(async()=>{currentGameId='ui-test';loadLobbyUI=()=>{};await openMechDesigner();});
  await page.getByRole('button',{name:'Back',exact:true}).click();
  assert.equal(await page.locator('#lobby-screen.active').count(),1);
  assert.deepEqual(errors,[]);
  console.log('PASS MechLab opens, edits armour/weapons, and returns to menu/lobby without errors');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
