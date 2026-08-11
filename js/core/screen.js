// ── SCREEN MANAGEMENT ────────────────────────────────────
function showScreen(screenId) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(screenId).classList.add('active');
}

function showLoading(show) {
  document.getElementById('loading-overlay').classList.toggle('hidden', !show);
}
