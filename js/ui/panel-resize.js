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
  const panel = document.getElementById('panel');
  const detailPanel = document.getElementById('mech-panel');
  const gameScreen = document.getElementById('game-screen');
  if (!panel || !detailPanel || !gameScreen) return;

  const savedWidth = Number(localStorage.getItem('bt-vtt-side-panel-width'));
  if (Number.isFinite(savedWidth) && savedWidth >= 260) {
    gameScreen.style.setProperty('--side-panel-width', `${savedWidth}px`);
  }
  const savedDetailWidth = Number(localStorage.getItem('bt-vtt-detail-panel-width'));
  if (Number.isFinite(savedDetailWidth) && savedDetailWidth >= 240) {
    gameScreen.style.setProperty('--detail-panel-width', `${savedDetailWidth}px`);
  }
  if (localStorage.getItem('bt-vtt-detail-panel-collapsed') === '1') toggleMechPanel(false);

  let resizing = false;
  const isResizeHandle = event => Math.abs(event.clientX - panel.getBoundingClientRect().left) <= 10;

  panel.addEventListener('pointerdown', event => {
    if (!isResizeHandle(event)) return;
    resizing = true;
    panel.setPointerCapture(event.pointerId);
    document.body.classList.add('resizing-side-panel');
    event.preventDefault();
  });

  panel.addEventListener('pointermove', event => {
    if (!resizing) return;
    const width = Math.max(260, Math.min(640, window.innerWidth - event.clientX));
    gameScreen.style.setProperty('--side-panel-width', `${width}px`);
  });

  const finishResize = () => {
    if (!resizing) return;
    resizing = false;
    document.body.classList.remove('resizing-side-panel');
    const width = Math.round(panel.getBoundingClientRect().width);
    localStorage.setItem('bt-vtt-side-panel-width', String(width));
  };
  panel.addEventListener('pointerup', finishResize);
  panel.addEventListener('pointercancel', finishResize);

  let resizingDetail = false;
  const isDetailResizeHandle = event => Math.abs(event.clientX - detailPanel.getBoundingClientRect().right) <= 10;
  detailPanel.addEventListener('pointerdown', event => {
    if (gameScreen.classList.contains('mech-panel-collapsed') || !isDetailResizeHandle(event)) return;
    resizingDetail = true;
    detailPanel.setPointerCapture(event.pointerId);
    document.body.classList.add('resizing-detail-panel');
    event.preventDefault();
  });
  detailPanel.addEventListener('pointermove', event => {
    if (!resizingDetail) return;
    const width = Math.max(240, Math.min(620, event.clientX));
    gameScreen.style.setProperty('--detail-panel-width', `${width}px`);
  });
  const finishDetailResize = () => {
    if (!resizingDetail) return;
    resizingDetail = false;
    document.body.classList.remove('resizing-detail-panel');
    localStorage.setItem('bt-vtt-detail-panel-width', String(Math.round(detailPanel.getBoundingClientRect().width)));
  };
  detailPanel.addEventListener('pointerup', finishDetailResize);
  detailPanel.addEventListener('pointercancel', finishDetailResize);
})();
