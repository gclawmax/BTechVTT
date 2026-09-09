// ── RESIZABLE GAME SIDE PANELS ────────────────────────────
// Width and collapsed state are local display preferences only.
function toggleMechPanel(forceExpanded = null) {
  const gameScreen = document.getElementById('game-screen');
  const button = document.getElementById('btn-toggle-mech-panel');
  if (!gameScreen || !button) return;
  const collapsed = forceExpanded == null
    ? !gameScreen.classList.contains('mech-panel-collapsed')
    : !forceExpanded;
  gameScreen.classList.toggle('mech-panel-collapsed', collapsed);
  button.setAttribute('aria-expanded', String(!collapsed));
  button.setAttribute('aria-label', collapsed ? 'Expand selected BattleMech sidebar' : 'Collapse selected BattleMech sidebar');
  button.title = button.getAttribute('aria-label');
  localStorage.setItem('bt-vtt-detail-panel-collapsed', collapsed ? '1' : '0');
}

(function initPanelResize() {
 const screen = document.getElementById('game-screen');
 if (!screen) return;
 for (const [side, panelId, minimum, maximum] of [['detail','mech-panel',240,620],['side','panel',260,640]]) {
  const panel = document.getElementById(panelId);
  const handle = document.createElement('div');
  handle.className = `panel-resize-handle ${side}-resize-handle`;
  handle.tabIndex = 0; handle.setAttribute('role','separator'); handle.setAttribute('aria-orientation','vertical');
  handle.setAttribute('aria-label',side === 'detail' ? 'Resize selected BattleMech panel' : 'Resize roster and game log panel');
  handle.title = 'Drag to resize; arrow keys adjust width'; screen.appendChild(handle);
  const key = `bt-vtt-${side}-panel-width`;
  const setWidth = value => {
   const other = document.getElementById(side === 'detail' ? 'panel' : 'mech-panel').getBoundingClientRect().width;
   const limit = Math.max(minimum, Math.min(maximum, window.innerWidth - (other || 300) - 180));
   const width = Math.round(Math.max(minimum, Math.min(limit,value)));
   screen.style.setProperty(`--${side}-panel-width`,`${width}px`);
   handle.setAttribute('aria-valuemin',minimum); handle.setAttribute('aria-valuemax',limit); handle.setAttribute('aria-valuenow',width);
   return width;
  };
  setWidth(Number(localStorage.getItem(key)) || (side === 'detail' ? 300 : 360));
  let drag = null;
  handle.addEventListener('pointerdown',event => {
   if (event.button !== 0) return;
   drag = {id:event.pointerId,x:event.clientX,width:panel.getBoundingClientRect().width};
   handle.setPointerCapture(event.pointerId); document.body.classList.add('resizing-side-panel'); event.preventDefault();
  });
  handle.addEventListener('pointermove',event => {
   if (!drag || event.pointerId !== drag.id) return;
   setWidth(drag.width + (event.clientX - drag.x) * (side === 'detail' ? 1 : -1));
  });
  const finish = () => {
   if (!drag) return; drag = null; document.body.classList.remove('resizing-side-panel');
   localStorage.setItem(key,String(Math.round(panel.getBoundingClientRect().width)));
  };
  handle.addEventListener('pointerup',finish); handle.addEventListener('pointercancel',finish); handle.addEventListener('lostpointercapture',finish);
  handle.addEventListener('keydown',event => {
   if (!['ArrowLeft','ArrowRight'].includes(event.key)) return;
   event.preventDefault(); const delta = (event.key === 'ArrowRight' ? 20 : -20) * (side === 'detail' ? 1 : -1);
   localStorage.setItem(key,String(setWidth(panel.getBoundingClientRect().width + delta)));
  });
 }
 if (localStorage.getItem('bt-vtt-detail-panel-collapsed') === '1') toggleMechPanel(false);
})();
