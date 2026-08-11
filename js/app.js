// Extracted from index_3_1.html — init

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

    // Listen for auth state changes
    db.auth.onAuthStateChange((event, session) => {
      if (session?.user) {
        currentUser = session.user;
        showMainMenu();
      } else {
        currentUser = null;
        showScreen('login-screen');
      }
    });
  } catch (err) {
    console.error('BT-VTT auth init error:', err);
    showScreen('login-screen');
  }
})();
