// A local draft is committed atomically with pilot-adjusted BV and deployment.
let aiForceEditor = null;
async function openAiForceEditor() {
  if (aiForceEditor) return;
  if (!isHost || !vsAiMode || !currentGameId) return;
  const {data,error}=await db.from('btech_games').select('state,status').eq('id',currentGameId).single();
  if(error || data?.status!=='lobby'){showGameToast('AI forces can only be edited in the lobby.','error');return;}
  const state=typeof data.state==='string'?JSON.parse(data.state):data.state;
  const avatar=state.skirmish_avatars?.['2'];
  const entries=avatar?.deployed?.length ? avatar.deployed.map(id=>avatar.hangar.find(e=>e.id===id)).filter(Boolean) : (state.rosters?.['2']||[]).map((unitId,index)=>({id:`ai-edit-${index}`,unit_id:unitId,pilot:{name:'MechWarrior',gunnery:4,piloting:5}}));
  aiForceEditor={gameId:currentGameId,state,entries:JSON.parse(JSON.stringify(entries)),saving:false};
  const modal=document.createElement('div');modal.id='ai-force-editor';modal.className='record-sheet-modal';document.body.appendChild(modal);renderAiForceEditor();
}
function closeAiForceEditor(){if(aiForceEditor?.saving)return;document.getElementById('ai-force-editor')?.remove();aiForceEditor=null;}
function updateAiPilot(index,field,value){if(!aiForceEditor||aiForceEditor.saving)return;aiForceEditor.entries[index].pilot[field]=field==='name'?value:Number(value);updateAiForceTotal();}
function updateAiForceTotal(){
 const draft=aiForceEditor;if(!draft)return;
 const values=draft.entries.map(e=>bv2EntryValue(getSupportedUnit(e.unit_id),e.pilot));
 const total=values.every(Boolean)?values.reduce((sum,v)=>sum+v.adjusted,0):null,limit=bv2ForceLimit(draft.state);
 const tons=rosterTonnage(draft.entries.map(e=>e.unit_id));
 const legal=draft.entries.length>0&&draft.entries.length<=6&&(limit!=null?total!=null&&total<=limit:tons<=Number(draft.state.dropship_tonnage));
 document.getElementById('ai-force-total').textContent=`${draft.entries.length} mechs · ${tons} tons · ${total==null?'BV pending':total.toLocaleString()+' adjusted BV'}${limit!=null?' / '+limit.toLocaleString()+' BV limit':''}${legal?'':' — force exceeds its limit or is empty'}`;
 document.getElementById('ai-force-save').disabled=!legal||draft.saving;
}
function addAiForceMech(){if(!aiForceEditor||aiForceEditor.saving)return;const id=document.getElementById('ai-force-unit').value;if(!id||aiForceEditor.entries.length>=6)return;aiForceEditor.entries.push({id:skirmishHangarId(),unit_id:id,pilot:defaultSkirmishPilot(getSupportedUnit(id))});renderAiForceEditor();}
function removeAiForceMech(index){if(aiForceEditor.saving)return;aiForceEditor.entries.splice(index,1);renderAiForceEditor();}
function renderAiForceEditor(){
 const draft=aiForceEditor;if(!draft)return;
 const options=vsAiUnitEntries(matchRuleset(draft.state)).map(([id,u])=>`<option value="${escapeHtml(id)}">${escapeHtml(u.chassis+' '+u.variant)} · ${u.tonnage} t</option>`).join('');
 document.getElementById('ai-force-editor').innerHTML=`<div class="record-sheet" role="dialog" aria-modal="true" aria-label="Edit AI force"><header><h2>AI force & pilots</h2><button onclick="closeAiForceEditor()">Cancel</button></header><p>Clan additions start at Gunnery 3 / Piloting 4; Inner Sphere at 4 / 5. Edit either skill below. Save applies all changes and automatically deploys the AI force.</p><div class="hangar-list">${draft.entries.map((e,i)=>`<section class="record-system-damage"><strong>${escapeHtml(getSupportedUnit(e.unit_id)?.chassis+' '+getSupportedUnit(e.unit_id)?.variant)}</strong><div class="ai-pilot-fields"><label>Pilot name<input maxlength="48" value="${escapeHtml(e.pilot.name||'MechWarrior')}" oninput="updateAiPilot(${i},'name',this.value)"></label><label>Gunnery<select onchange="updateAiPilot(${i},'gunnery',this.value)">${skirmishSkillOptions(e.pilot.gunnery)}</select></label><label>Piloting<select onchange="updateAiPilot(${i},'piloting',this.value)">${skirmishSkillOptions(e.pilot.piloting)}</select></label><button onclick="removeAiForceMech(${i})">Remove</button></div></section>`).join('')}</div><label>Add an enemy mech<select id="ai-force-unit">${options}</select></label><button onclick="addAiForceMech()" ${draft.entries.length>=6?'disabled':''}>Add mech</button><p id="ai-force-total" role="status"></p><p id="ai-force-error" role="alert"></p><button id="ai-force-save" onclick="saveAiForceEditor()">Save AI force & pilots</button></div>`;
 updateAiForceTotal();
}
async function saveAiForceEditor(){
 const draft=aiForceEditor;if(!draft||draft.saving)return;
 draft.saving=true;updateAiForceTotal();
 try{
  if(draft.entries.some(e=>!String(e.pilot.name||'').trim()))throw Error('Give each pilot a name.');
  const positions=buildVsAiDeployment(draft.entries.map(e=>e.unit_id),2,draft.state);
  const {error}=await db.rpc('update_ai_skirmish_force',{p_game_id:draft.gameId,p_hangar:draft.entries,p_deployed:draft.entries.map(e=>e.id),p_positions:positions});
  if(error)throw error;
  draft.saving=false;closeAiForceEditor();isReady=false;await loadLobbyUI();showGameToast('AI force and pilots saved. Review your force, then Ready.');
 }catch(error){draft.saving=false;document.getElementById('ai-force-error').textContent=error.message;updateAiForceTotal();}
}
