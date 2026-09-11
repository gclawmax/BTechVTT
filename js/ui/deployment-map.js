// Deployment shares terrain painting with the battlefield but owns its view controls.
const deploymentMapView = { key:null, rotation:0, zoom:1, left:0, top:0, state:null, terrainKey:null, terrainImage:null };
function prepareDeploymentMapView(state) {
  const key = `${currentGameId}:${state.map_id}:${mySeatNumber}`;
  if (deploymentMapView.key !== key) Object.assign(deploymentMapView, {key,rotation:0,zoom:1,left:0,top:0,terrainKey:null});
  deploymentMapView.state = state;
}
function deploymentMapCentre(col,row) {
  return {x:Math.sqrt(3)*(col+.5*(row&1))+Math.sqrt(3)/2,y:row*1.5+1};
}
function deploymentTerrainImage(state,width,height) {
  const key = JSON.stringify([state.map_id,GRID_COLS,GRID_ROWS,state.terrain_overrides,state.elevation_overrides,state.building_cf]);
  if (key === deploymentMapView.terrainKey) return deploymentMapView.terrainImage;
  const surface = document.createElement('canvas');
  surface.width = Math.ceil(width*HEX_SIZE*2); surface.height = Math.ceil(height*HEX_SIZE*2);
  const paint = surface.getContext('2d'); paint.scale(2,2);
  for(let row=0;row<GRID_ROWS;row++) for(let col=0;col<GRID_COLS;col++) {
    const point=deploymentMapCentre(col,row);
    drawMapHex(point.x*HEX_SIZE,point.y*HEX_SIZE,col,row,terrainAt(col,row),elevationAt(col,row),paint);
  }
  deploymentMapView.terrainKey=key; deploymentMapView.terrainImage=surface.toDataURL();
  return deploymentMapView.terrainImage;
}
function deploymentMapMarkup(state,cells,codes,width,height) {
  const angle=deploymentMapView.rotation, radians=angle*Math.PI/180;
  const sideways=angle%180!==0, w=sideways?height:width, h=sideways?width:height;
  const project=point=>({x:w/2+(point.x-width/2)*Math.cos(radians)-(point.y-height/2)*Math.sin(radians),y:h/2+(point.x-width/2)*Math.sin(radians)+(point.y-height/2)*Math.cos(radians)});
  const centres=[1,2].map(seat=>{
    const points=[];
    for(let row=0;row<GRID_ROWS;row++) for(let col=0;col<GRID_COLS;col++) if(deploymentZoneContains(seat,col,row,state)) points.push(deploymentMapCentre(col,row));
    const point=points.length?{x:points.reduce((sum,p)=>sum+p.x,0)/points.length,y:points.reduce((sum,p)=>sum+p.y,0)/points.length}:{x:seat===1?0:width,y:height/2};
    return {seat,...project(point)};
  });
  const horizontal=Math.abs(centres[0].x-centres[1].x)>=Math.abs(centres[0].y-centres[1].y);
  const labels=centres.map(point=>{
    const friendly=point.seat===Number(mySeatNumber);
    const x=horizontal?Math.max(4,Math.min(w-4,point.x)):w/2;
    const y=horizontal?-.75:point.y<h/2?-.75:h+1;
    return `<text class="deployment-zone-title ${friendly?'friendly':'enemy'}" data-seat="${point.seat}" x="${x}" y="${y}">${friendly?'Friendly':'Enemy'} deployment zone</text>`;
  }).join('');
  const tokens=Object.entries(state.deployment_positions||{}).flatMap(([seat,positions])=>(positions||[]).map((position,index)=>{
    if(Number(seat)!==Number(mySeatNumber)&&position.hidden)return '';
    const point=deploymentMapCentre(position.col,position.row), id=state.rosters?.[seat]?.[index];
    const file=BT_MECH_ARTWORK.manifest[id]?.file;
    const facing=HEX_DIRS[position.facing||0].angle+MEGAMEK_SPRITE_FORWARD_OFFSET_DEGREES;
    return file&&/^[a-z0-9_-]+\.png$/i.test(file)?`<image pointer-events="none" href="assets/mechs/${file}" x="${point.x-.65}" y="${point.y-.65}" width="1.3" height="1.3" transform="rotate(${facing} ${point.x} ${point.y})"/>`:'';
  })).join('');
  return `<div class="deployment-view-controls" aria-label="Deployment map controls"><button type="button" onclick="zoomDeploymentMap(.8)" aria-label="Zoom deployment map out">−</button><output id="deployment-view-readout">${Math.round(deploymentMapView.zoom*100)}% · ${angle}°</output><button type="button" onclick="zoomDeploymentMap(1.25)" aria-label="Zoom deployment map in">+</button><button type="button" onclick="rotateDeploymentMap(-90)">Rotate left</button><button type="button" onclick="rotateDeploymentMap(90)">Rotate right</button><button type="button" onclick="resetDeploymentMapView()">Fit map</button><span>Scroll to zoom · middle/right-drag to pan</span></div><div class="deployment-map-viewport"><svg class="deployment-map detailed" style="width:${deploymentMapView.zoom*100}%" viewBox="-1 -1.8 ${w+2} ${h+3.6}" aria-label="Battlefield deployment hexes">${labels}<g transform="translate(${w/2} ${h/2}) rotate(${angle}) translate(${-width/2} ${-height/2})"><image pointer-events="none" href="${deploymentTerrainImage(state,width,height)}" x="0" y="0" width="${width}" height="${height}"/>${cells}${tokens}${codes}</g></svg></div>`;
}
function zoomDeploymentMap(factor,anchor=null) {
  const viewport=document.querySelector('.deployment-map-viewport'), map=viewport?.querySelector('svg');if(!map)return;
  const old=deploymentMapView.zoom, next=Math.max(1,Math.min(4,old*factor));
  const x=anchor?.x??viewport.clientWidth/2,y=anchor?.y??viewport.clientHeight/2;
  const left=(viewport.scrollLeft+x)*next/old-x,top=(viewport.scrollTop+y)*next/old-y;
  deploymentMapView.zoom=next;map.style.width=`${next*100}%`;
  viewport.scrollLeft=left;viewport.scrollTop=top;
  deploymentMapView.left=viewport.scrollLeft;deploymentMapView.top=viewport.scrollTop;
  document.getElementById('deployment-view-readout').textContent=`${Math.round(next*100)}% · ${deploymentMapView.rotation}°`;
}
function rotateDeploymentMap(delta) {
  deploymentMapView.rotation=(deploymentMapView.rotation+delta+360)%360;
  deploymentMapView.left=0;deploymentMapView.top=0;
  renderLobbyDeployment(deploymentMapView.state);
}
function resetDeploymentMapView() {
  Object.assign(deploymentMapView,{rotation:0,zoom:1,left:0,top:0});
  renderLobbyDeployment(deploymentMapView.state);
}
function attachDeploymentMapControls() {
  const viewport=document.querySelector('.deployment-map-viewport');if(!viewport)return;
  // Own middle-button scrolling so the browser cannot start native autoscroll.
  let drag=null;
  viewport.addEventListener('mousedown',event=>{if(event.button===1||event.button===2)event.preventDefault();});
  viewport.addEventListener('auxclick',event=>{if(event.button===1||event.button===2)event.preventDefault();});
  viewport.addEventListener('contextmenu',event=>event.preventDefault());
  viewport.addEventListener('pointerdown',event=>{
    if(event.button!==1&&event.button!==2)return;
    event.preventDefault();
    drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:viewport.scrollLeft,top:viewport.scrollTop};
    viewport.setPointerCapture(event.pointerId);viewport.classList.add('panning');
  });
  viewport.addEventListener('pointermove',event=>{
    if(!drag||event.pointerId!==drag.id)return;
    event.preventDefault();viewport.scrollLeft=drag.left+drag.x-event.clientX;viewport.scrollTop=drag.top+drag.y-event.clientY;
    deploymentMapView.left=viewport.scrollLeft;deploymentMapView.top=viewport.scrollTop;
  });
  const finish=event=>{
    if(!drag||event.pointerId!==drag.id)return;
    drag=null;viewport.classList.remove('panning');
    if(viewport.hasPointerCapture(event.pointerId))viewport.releasePointerCapture(event.pointerId);
  };
  viewport.addEventListener('pointerup',finish);viewport.addEventListener('pointercancel',finish);viewport.addEventListener('lostpointercapture',finish);
  viewport.scrollLeft=deploymentMapView.left;viewport.scrollTop=deploymentMapView.top;
  viewport.addEventListener('scroll',()=>{deploymentMapView.left=viewport.scrollLeft;deploymentMapView.top=viewport.scrollTop;});
  viewport.addEventListener('wheel',event=>{event.preventDefault();const rect=viewport.getBoundingClientRect();zoomDeploymentMap(event.deltaY<0?1.1:1/1.1,{x:event.clientX-rect.left,y:event.clientY-rect.top});},{passive:false});
}
