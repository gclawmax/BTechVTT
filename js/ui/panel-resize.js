// ── RESIZABLE GAME SIDE PANEL ─────────────────────────────
// The width is local display preference only; it is never shared with the
// other player or written to the game state.
(function initPanelResize() {
  const panel = document.getElementById('panel');
  const gameScreen = document.getElementById('game-screen');
  if (!panel || !gameScreen) return;

  const savedWidth = Number(localStorage.getItem('bt-vtt-side-panel-width'));
  if (Number.isFinite(savedWidth) && savedWidth >= 260) {
    gameScreen.style.setProperty('--side-panel-width', `${savedWidth}px`);
  }

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
})();
