// ── CONFIRMATION MODAL ───────────────────────────────────
let confirmCallback = null;

function showConfirmModal(title, message, onConfirm) {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = message;
  document.getElementById('confirm-modal').classList.remove('hidden');
  confirmCallback = onConfirm;

  document.getElementById('confirm-ok').onclick = () => {
    document.getElementById('confirm-modal').classList.add('hidden');
    if (confirmCallback) confirmCallback();
    confirmCallback = null;
  };

  document.getElementById('confirm-cancel').onclick = () => {
    document.getElementById('confirm-modal').classList.add('hidden');
    confirmCallback = null;
  };
}

async function handleConcedeGame(code) {
  const { data: game } = await db
    .from('btech_games')
    .select('*')
    .eq('game_code', code)
    .single();

  if (!game) return;

  showConfirmModal(
    'Concede Game?',
    `This will remove you from ${game.game_code} (${game.status}). You cannot undo this action.`,
    async () => {
      showLoading(true);
      try {
        // Remove player record
        await db
          .from('btech_players')
          .delete()
          .eq('game_id', game.id)
          .eq('user_id', currentUser.id);

        // If host, delete the entire game
        if (game.host_id === currentUser.id) {
          await db.from('btech_players').delete().eq('game_id', game.id);
          await db.from('btech_games').delete().eq('id', game.id);
        }

        // Refresh the active games list
        await populateActiveGames();
      } catch (err) {
        console.error('Concede error:', err);
        alert('Failed to concede game: ' + (err.message || 'Unknown error'));
      } finally {
        showLoading(false);
      }
    }
  );
}

async function handleLogout() {
  showLoading(true);
  try {
    await db.auth.signOut();
    currentUser = null;
    currentGameId = null;
    showScreen('login-screen');
  } catch (err) {
    console.error('Logout error:', err);
  } finally {
    showLoading(false);
  }
}
