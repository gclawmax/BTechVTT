// ── INIT ──────────────────────────────────────────────────
(async () => {
  try {
    // Check if user is already logged in (session restored)
    const { data: { session } } = await db.auth.getSession();
    if (session?.user) {
      currentUser = session.user;
      await showMainMenu();
    } else {
      showScreen('login-screen');
    }

    // Keep the local user record current, but do not navigate on token refresh.
    // Supabase emits TOKEN_REFRESHED during an active game; treating it like a
    // fresh login used to send players back to the main menu mid-game.
    db.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') {
        currentUser = null;
        showScreen('login-screen');
        return;
      }

      if (session?.user) {
        const isNewSession = !currentUser;
        currentUser = session.user;
        if (event === 'SIGNED_IN' && isNewSession) showMainMenu();
      }
    });
  } catch (err) {
    console.error('BT-VTT auth init error:', err);
    showScreen('login-screen');
  }
})();
