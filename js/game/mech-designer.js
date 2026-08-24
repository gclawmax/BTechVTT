// Standard Inner Sphere biped construction. The browser provides immediate
// feedback; SQL 76 repeats every legality check before publishing a design.

const CUSTOM_STRUCTURE_TABLE = Object.freeze({
  20:[6,5,3,4],25:[8,6,4,6],30:[10,7,5,7],35:[11,8,6,8],40:[12,10,6,10],45:[14,11,7,11],
  50:[16,12,8,12],55:[18,13,9,13],60:[20,14,10,14],65:[21,15,10,15],70:[22,15,11,15],75:[23,16,12,16],
  80:[25,17,13,17],85:[27,18,14,18],90:[29,19,15,19],95:[30,20,16,20],100:[31,21,17,21]
});
const CUSTOM_ENGINE_WEIGHTS = Object.freeze([.5,.5,.5,.5,.5,1,1,1,1,1.5,1.5,1.5,2,2,2,2.5,2.5,3,3,3,3.5,3.5,4,4,4,4.5,4.5,5,5,5.5,5.5,6,6,6,7,7,7.5,7.5,8,8.5,8.5,9,9.5,10,10,10.5,11,11.5,12,12.5,13,13.5,14,14.5,15.5,16,16.5,17.5,18,19,19.5,20.5,21.5,22.5,23.5,24.5,25.5,27,28.5,29.5,31.5,33,34.5,36.5,38.5,41,43.5,46,49,52.5]);
const CUSTOM_EQUIPMENT = Object.freeze({
  small_laser:{name:'Small Laser',weight:.5,slots:1,heat:1}, med_laser:{name:'Medium Laser',weight:1,slots:1,heat:3}, large_laser:{name:'Large Laser',weight:5,slots:2,heat:8},
  ppc:{name:'PPC',weight:7,slots:3,heat:10}, flamer:{name:'Flamer',weight:1,slots:1,heat:3},
  ac2:{name:'Autocannon/2',weight:6,slots:1,heat:1,ammo:'ac2'}, ac5:{name:'Autocannon/5',weight:8,slots:4,heat:1,ammo:'ac5'}, ac10:{name:'Autocannon/10',weight:12,slots:7,heat:3,ammo:'ac10'}, ac20:{name:'Autocannon/20',weight:14,slots:10,heat:7,ammo:'ac20'},
  machine_gun:{name:'Machine Gun',weight:.5,slots:1,heat:0,ammo:'machine_gun'},
  lrm5:{name:'LRM 5',weight:2,slots:1,heat:2,ammo:'lrm5'}, lrm10:{name:'LRM 10',weight:5,slots:2,heat:4,ammo:'lrm10'}, lrm15:{name:'LRM 15',weight:7,slots:3,heat:5,ammo:'lrm15'}, lrm20:{name:'LRM 20',weight:10,slots:5,heat:6,ammo:'lrm20'},
  srm2:{name:'SRM 2',weight:1,slots:1,heat:2,ammo:'srm2'}, srm4:{name:'SRM 4',weight:2,slots:1,heat:3,ammo:'srm4'}, srm6:{name:'SRM 6',weight:3,slots:2,heat:4,ammo:'srm6'}
});
const CUSTOM_AMMO = Object.freeze({
  ac2:{name:'AC/2',shots:45},ac5:{name:'AC/5',shots:20},ac10:{name:'AC/10',shots:10},ac20:{name:'AC/20',shots:5},machine_gun:{name:'Machine Gun',shots:200},
  lrm5:{name:'LRM 5',shots:24},lrm10:{name:'LRM 10',shots:12},lrm15:{name:'LRM 15',shots:8},lrm20:{name:'LRM 20',shots:6},srm2:{name:'SRM 2',shots:50},srm4:{name:'SRM 4',shots:25},srm6:{name:'SRM 6',shots:15}
});
const CUSTOM_LOCATIONS = Object.freeze({ head:'Head',ct:'Center Torso',lt:'Left Torso',rt:'Right Torso',la:'Left Arm',ra:'Right Arm',ll:'Left Leg',rl:'Right Leg' });

let customDesignerState = null;
let customDesignerReturnScreen = 'menu-screen';
let customSavedDesigns = [];

function customStructure(tonnage) {
  const [ct, torso, arm, leg] = CUSTOM_STRUCTURE_TABLE[tonnage] || [];
  return ct ? { head:3,ct,lt:torso,rt:torso,la:arm,ra:arm,ll:leg,rl:leg } : null;
}

function customMaximumArmor(tonnage) {
  const s = customStructure(tonnage);
  if (!s) return {};
  const rear = value => Math.min(8, Math.max(2, Math.floor(value / 2)));
  const ctRear = rear(s.ct), sideRear = rear(s.lt);
  return { head:9,ct:s.ct*2-ctRear,ct_rear:ctRear,lt:s.lt*2-sideRear,lt_rear:sideRear,rt:s.rt*2-sideRear,rt_rear:sideRear,la:s.la*2,ra:s.ra*2,ll:s.ll*2,rl:s.rl*2 };
}

function newCustomDesign() {
  return { name:'Custom',variant:'CST-1',tech_base:'IS_INTRO',tonnage:50,walking_mp:4,jump_mp:0,heat_sinks:10,armor:customMaximumArmor(50),weapons:[],ammo:[] };
}

function customEngineWeight(rating) {
  return rating >= 5 && rating <= 400 && rating % 5 === 0 ? CUSTOM_ENGINE_WEIGHTS[rating / 5 - 1] : null;
}

function calculateCustomDesign(design) {
  const errors = [];
  const tons = Number(design.tonnage), walk = Number(design.walking_mp), jump = Number(design.jump_mp), sinks = Number(design.heat_sinks);
  const structure = customStructure(tons), rating = tons * walk, engine = customEngineWeight(rating);
  if (!String(design.name || '').trim() || !String(design.variant || '').trim()) errors.push('Enter a chassis name and variant.');
  if (!structure) errors.push('Tonnage must be 20–100 in five-ton steps.');
  if (engine == null) errors.push('Engine rating must be 400 or less.');
  if (jump < 0 || jump > walk) errors.push('Jumping MP cannot exceed Walking MP.');
  if (sinks < 10 || sinks > 50) errors.push('Choose 10–50 heat sinks.');
  const armor = design.armor || {};
  const armorPoints = Object.values(armor).reduce((sum, value) => sum + Math.max(0, Number(value) || 0), 0);
  if (structure) {
    if (Number(armor.head || 0) > 9) errors.push('Head armour cannot exceed 9.');
    for (const loc of ['ct','lt','rt']) if (Number(armor[loc] || 0) + Number(armor[`${loc}_rear`] || 0) > structure[loc] * 2) errors.push(`${CUSTOM_LOCATIONS[loc]} front and rear armour exceed the location maximum.`);
    for (const loc of ['la','ra','ll','rl']) if (Number(armor[loc] || 0) > structure[loc] * 2) errors.push(`${CUSTOM_LOCATIONS[loc]} armour exceeds the location maximum.`);
  }
  const slots = { head:1,ct:2,lt:12,rt:12,la:8,ra:8,ll:2,rl:2 };
  let weaponWeight = 0, ammoWeight = 0, weaponHeat = 0;
  for (const item of design.weapons || []) {
    const profile = CUSTOM_EQUIPMENT[item.key];
    if (!profile || !(item.location in slots)) { errors.push('A weapon selection is unsupported.'); continue; }
    slots[item.location] -= profile.slots; weaponWeight += profile.weight; weaponHeat += profile.heat;
  }
  for (const item of design.ammo || []) {
    const bins = Math.max(0, Number(item.bins) || 0);
    if (!CUSTOM_AMMO[item.type] || !(item.location in slots) || item.location === 'head') { errors.push('An ammunition selection is unsupported.'); continue; }
    slots[item.location] -= bins; ammoWeight += bins;
    if (!(design.weapons || []).some(weapon => CUSTOM_EQUIPMENT[weapon.key]?.ammo === item.type)) errors.push(`${CUSTOM_AMMO[item.type].name} ammunition has no matching weapon.`);
  }
  for (const weapon of design.weapons || []) {
    const ammoType = CUSTOM_EQUIPMENT[weapon.key]?.ammo;
    if (ammoType && !(design.ammo || []).some(bin => bin.type === ammoType && Number(bin.bins) > 0)) errors.push(`${CUSTOM_EQUIPMENT[weapon.key].name} needs ammunition.`);
  }
  for (const [loc, remaining] of Object.entries(slots)) if (remaining < 0) errors.push(`${CUSTOM_LOCATIONS[loc]} is over critical-slot capacity by ${-remaining}.`);
  const allocationSlots = Object.fromEntries(Object.entries(slots).map(([loc,value]) => [loc,Math.max(0,value)]));
  const allocateAutomatic = (count, locations, label) => {
    for (let index=0;index<count;index++) {
      const location=locations.find(loc=>allocationSlots[loc]>0);
      if (!location) { errors.push(`${label} need more legal critical slots.`); return; }
      allocationSlots[location]-=1;
    }
  };
  allocateAutomatic(jump,['ll','rl','lt','rt','ct'],'Jump jets');
  allocateAutomatic(Math.max(0,sinks-Math.min(10,Math.floor(rating/25))),['lt','rt','la','ra','ll','rl','ct','head'],'Heat sinks');
  const structureWeight = tons / 10, gyro = Math.ceil(rating / 100), armorWeight = Math.ceil(armorPoints / 8) * .5;
  const sinkWeight = Math.max(0, sinks - 10), jumpWeight = jump * (tons <= 55 ? .5 : tons <= 85 ? 1 : 2);
  const total = structureWeight + (engine || 0) + gyro + 3 + armorWeight + weaponWeight + ammoWeight + sinkWeight + jumpWeight;
  if (total > tons) errors.push(`Design is ${(total - tons).toFixed(1)} tons overweight.`);
  return { valid: errors.length === 0, errors:[...new Set(errors)], rating, structure, armorPoints, weaponHeat, slots, weights:{structure:structureWeight,engine:engine || 0,gyro,cockpit:3,armor:armorWeight,weapons:weaponWeight,ammo:ammoWeight,heatSinks:sinkWeight,jumpJets:jumpWeight,total,remaining:tons-total} };
}

async function openMechDesigner() {
  customDesignerReturnScreen = currentGameId ? 'lobby-screen' : 'menu-screen';
  try {
    if (currentGameId) { if (!activeCatalogueVersion) throw new Error('Open the match lobby once before entering MechLab.'); }
    else await loadLatestUnitCatalogue();
  } catch (error) { alert(`The designer needs an installed unit catalogue: ${error.message}`); return; }
  customDesignerState ||= newCustomDesign();
  await loadCustomSavedDesigns();
  showScreen('mech-designer-screen');
  renderMechDesigner();
}

function closeMechDesigner() {
  showScreen(customDesignerReturnScreen);
  if (customDesignerReturnScreen === 'lobby-screen') loadLobbyUI();
}

async function loadCustomSavedDesigns() {
  if (!currentUser?.id) return;
  const { data, error } = await db.from('btech_custom_designs').select('id,unit_id,name,design,calculation,created_at').eq('owner_id',currentUser.id).eq('archived',false).order('created_at',{ascending:false});
  if (!error) customSavedDesigns = data || [];
}

function resetMechDesigner() { customDesignerState = newCustomDesign(); renderMechDesigner(); }

function updateCustomDesignField(field, value) {
  const numeric = ['tonnage','walking_mp','jump_mp','heat_sinks'].includes(field);
  const previousTonnage = customDesignerState.tonnage;
  customDesignerState[field] = numeric ? Number(value) : value;
  if (field === 'tonnage' && Number(value) !== previousTonnage) customDesignerState.armor = customMaximumArmor(Number(value));
  if (field === 'walking_mp' && customDesignerState.jump_mp > Number(value)) customDesignerState.jump_mp = Number(value);
  renderMechDesigner();
}

function updateCustomArmor(location, value) { customDesignerState.armor[location] = Math.max(0, Math.floor(Number(value) || 0)); renderMechDesigner(); }
function addCustomWeapon() { customDesignerState.weapons.push({ key:'med_laser',location:'ct' }); renderMechDesigner(); }
function removeCustomWeapon(index) { customDesignerState.weapons.splice(index,1); renderMechDesigner(); }
function updateCustomWeapon(index, field, value) { customDesignerState.weapons[index][field] = value; renderMechDesigner(); }
function addCustomAmmo() {
  const type = customDesignerState.weapons.map(item => CUSTOM_EQUIPMENT[item.key]?.ammo).find(Boolean) || 'ac5';
  customDesignerState.ammo.push({ type,location:'lt',bins:1 });renderMechDesigner();
}
function removeCustomAmmo(index) { customDesignerState.ammo.splice(index,1);renderMechDesigner(); }
function updateCustomAmmo(index, field, value) { customDesignerState.ammo[index][field] = field === 'bins' ? Number(value) : value;renderMechDesigner(); }

function customOptions(entries, selected) { return entries.map(([value,label]) => `<option value="${value}" ${value===selected?'selected':''}>${label}</option>`).join(''); }
function customLocationOptions(selected, allowHead=true) { return customOptions(Object.entries(CUSTOM_LOCATIONS).filter(([key]) => allowHead || key!=='head'),selected); }

function renderMechDesigner() {
  const root = document.getElementById('mech-designer-root');if (!root || !customDesignerState) return;
  const d = customDesignerState, calc = calculateCustomDesign(d), s = calc.structure || customStructure(50);
  const armorFields = [
    ['head','Head',9],['ct','Centre torso front',s.ct*2],['ct_rear','Centre torso rear',s.ct*2],['lt','Left torso front',s.lt*2],['lt_rear','Left torso rear',s.lt*2],['rt','Right torso front',s.rt*2],['rt_rear','Right torso rear',s.rt*2],['la','Left arm',s.la*2],['ra','Right arm',s.ra*2],['ll','Left leg',s.ll*2],['rl','Right leg',s.rl*2]
  ];
  const weaponRows = d.weapons.map((item,index) => `<div class="designer-equipment-row"><select onchange="updateCustomWeapon(${index},'key',this.value)">${customOptions(Object.entries(CUSTOM_EQUIPMENT).map(([key,p])=>[key,`${p.name} · ${p.weight}t / ${p.slots} slots`]),item.key)}</select><select onchange="updateCustomWeapon(${index},'location',this.value)">${customLocationOptions(item.location)}</select><button onclick="removeCustomWeapon(${index})">Remove</button></div>`).join('');
  const ammoRows = d.ammo.map((item,index) => `<div class="designer-equipment-row"><select onchange="updateCustomAmmo(${index},'type',this.value)">${customOptions(Object.entries(CUSTOM_AMMO).map(([key,p])=>[key,`${p.name} ammo · ${p.shots} shots/ton`]),item.type)}</select><select onchange="updateCustomAmmo(${index},'location',this.value)">${customLocationOptions(item.location,false)}</select><label>Bins <input type="number" min="1" max="4" value="${item.bins}" onchange="updateCustomAmmo(${index},'bins',this.value)"></label><button onclick="removeCustomAmmo(${index})">Remove</button></div>`).join('');
  const weights = calc.weights;
  const saved = customSavedDesigns.map(item => `<div class="designer-saved-row"><div><strong>${escapeHtml(item.name)}</strong><span>${item.design?.tonnage || '?'} tons · ${item.design?.walking_mp || '?'} / ${Math.ceil(Number(item.design?.walking_mp||0)*1.5)} / ${item.design?.jump_mp || 0}</span></div><button onclick="loadSavedCustomDesign('${item.id}')">Use as new revision</button><button onclick="archiveCustomDesign('${item.id}')">Archive</button></div>`).join('') || '<div class="roster-empty">No saved custom BattleMechs yet.</div>';
  root.innerHTML = `<div class="designer-heading"><div><div class="panel-eyebrow">MechLab · Standard Inner Sphere</div><h2>Custom BattleMech Designer</h2><p>Build an immutable, match-ready variant from equipment the VTT fully resolves.</p></div><div><button onclick="resetMechDesigner()">New design</button><button onclick="closeMechDesigner()">Back</button></div></div>
  <div class="designer-grid"><section class="designer-card"><h3>Chassis</h3><div class="designer-fields"><label>Name<input maxlength="48" value="${escapeHtml(d.name)}" onchange="updateCustomDesignField('name',this.value)"></label><label>Variant<input maxlength="24" value="${escapeHtml(d.variant)}" onchange="updateCustomDesignField('variant',this.value)"></label><label>Tonnage<select onchange="updateCustomDesignField('tonnage',this.value)">${customOptions(Object.keys(CUSTOM_STRUCTURE_TABLE).map(t=>[t,`${t} tons`]),String(d.tonnage))}</select></label><label>Walking MP<input type="number" min="1" max="20" value="${d.walking_mp}" onchange="updateCustomDesignField('walking_mp',this.value)"></label><label>Jumping MP<input type="number" min="0" max="${d.walking_mp}" value="${d.jump_mp}" onchange="updateCustomDesignField('jump_mp',this.value)"></label><label>Single heat sinks<input type="number" min="10" max="50" value="${d.heat_sinks}" onchange="updateCustomDesignField('heat_sinks',this.value)"></label></div><div class="designer-note">Engine ${calc.rating || '—'} · movement ${d.walking_mp}/${Math.ceil(d.walking_mp*1.5)}/${d.jump_mp}. Standard engine, structure and armour are fixed for this construction tier.</div></section>
  <section class="designer-card"><h3>Armour</h3><div class="designer-armor-grid">${armorFields.map(([key,label,max])=>`<label>${label}<input type="number" min="0" max="${max}" value="${d.armor[key]||0}" onchange="updateCustomArmor('${key}',this.value)"><span>max ${max}</span></label>`).join('')}</div><div class="designer-note">${calc.armorPoints} points · ${weights.armor.toFixed(1)} tons. Torso front and rear share their location maximum.</div></section>
  <section class="designer-card designer-wide"><div class="designer-section-title"><h3>Weapons</h3><button onclick="addCustomWeapon()">Add weapon</button></div>${weaponRows || '<div class="roster-empty">No weapons fitted.</div>'}<div class="designer-section-title"><h3>Ammunition</h3><button onclick="addCustomAmmo()">Add ammunition</button></div>${ammoRows || '<div class="roster-empty">No ammunition bins fitted.</div>'}</section>
  <section class="designer-card"><h3>Construction report</h3><div class="designer-weight-list">${Object.entries({Structure:weights.structure,Engine:weights.engine,Gyro:weights.gyro,Cockpit:weights.cockpit,Armour:weights.armor,Weapons:weights.weapons,Ammunition:weights.ammo,'Extra heat sinks':weights.heatSinks,'Jump jets':weights.jumpJets}).map(([label,value])=>`<div><span>${label}</span><strong>${Number(value).toFixed(1)} t</strong></div>`).join('')}<div class="total"><span>Total</span><strong>${weights.total.toFixed(1)} / ${d.tonnage} t</strong></div></div><div class="designer-heat">Alpha-strike heat ${calc.weaponHeat} · dissipation ${d.heat_sinks}</div></section>
  <section class="designer-card"><h3>Legality</h3><div class="designer-validity ${calc.valid?'valid':'invalid'}">${calc.valid?`LEGAL · ${weights.remaining.toFixed(1)} tons unused`:`${calc.errors.length} issue${calc.errors.length===1?'':'s'} to fix`}</div>${calc.errors.length?`<ul class="designer-errors">${calc.errors.map(error=>`<li>${escapeHtml(error)}</li>`).join('')}</ul>`:'<p>This design can be published to the active catalogue and added to your Hangar.</p>'}<button class="primary designer-save" onclick="saveCustomDesign()" ${calc.valid?'':'disabled'}>Save immutable design</button><div id="designer-save-status" aria-live="polite"></div></section>
  <section class="designer-card designer-wide"><h3>Your saved designs</h3>${saved}</section></div>`;
}

async function saveCustomDesign() {
  const calc = calculateCustomDesign(customDesignerState);if (!calc.valid || !activeCatalogueVersion) return;
  const status = document.getElementById('designer-save-status');if (status) status.textContent='Validating and publishing…';
  const { data,error } = await db.rpc('save_btech_custom_design',{p_catalogue_version:activeCatalogueVersion,p_design:customDesignerState});
  if (error) { if(status) status.textContent=`Design rejected: ${error.message}`;return; }
  await loadUnitCatalogue(activeCatalogueVersion,true);await loadCustomSavedDesigns();renderMechDesigner();
  const refreshedStatus=document.getElementById('designer-save-status');if(refreshedStatus) refreshedStatus.textContent=`Saved ${data.name}. It is now available in your Hangar.`;
}

function loadSavedCustomDesign(id) {
  const saved=customSavedDesigns.find(item=>item.id===id);if(!saved)return;customDesignerState=structuredClone(saved.design);customDesignerState.variant=`${customDesignerState.variant}-R`.slice(0,24);renderMechDesigner();
}

async function archiveCustomDesign(id) {
  const {error}=await db.rpc('archive_btech_custom_design',{p_design_id:id});if(error)return;await loadUnitCatalogue(activeCatalogueVersion,true);await loadCustomSavedDesigns();renderMechDesigner();
}
