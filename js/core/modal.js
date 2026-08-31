// ── CONFIRMATION MODAL ───────────────────────────────────
let confirmCallback = null;

function showConfirmModal(title, message, onConfirm, confirmLabel = 'Confirm', cancelLabel = 'Cancel') {
  document.getElementById('confirm-title').textContent = title;
  document.getElementById('confirm-message').textContent = message;
  document.getElementById('confirm-ok').textContent = confirmLabel;
  document.getElementById('confirm-cancel').textContent = cancelLabel;
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
        // A hosted game owns its player seats. Delete it first so its ON DELETE
        // CASCADE cleans up all seats without violating an initiative reference.
        if (game.host_id === currentUser.id) {
          const { error } = await db
            .from('btech_games')
            .update({ active_player_id: null, initiative_winner: null })
            .eq('id', game.id);
          if (error) throw error;

          const { error: deleteError } = await db.from('btech_games').delete().eq('id', game.id);
          if (deleteError) throw deleteError;
        } else {
          const { error } = await db
            .from('btech_players')
            .delete()
            .eq('game_id', game.id)
            .eq('user_id', currentUser.id);
          if (error) throw error;
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
    currentGameCode = null;
    showScreen('login-screen');
  } catch (err) {
    console.error('Logout error:', err);
  } finally {
    showLoading(false);
  }
}
