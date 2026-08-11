// ── AUTH ─────────────────────────────────────────────────
async function handleLogin() {
  const username = document.getElementById('login-username').value.trim().toLowerCase();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';

  if (!username || !password) {
    errorEl.textContent = 'Please enter username and password.';
    return;
  }

  showLoading(true);
  try {
    const email = `${username}@FreeGames.com`;
    const { data, error } = await db.auth.signInWithPassword({ email, password });
    if (error) throw error;
    currentUser = data.user;
    await showMainMenu();
  } catch (err) {
    errorEl.textContent = 'Login failed: ' + (err.message || 'Check credentials.');
  } finally {
    showLoading(false);
  }
}

async function handleSignup() {
  const username = document.getElementById('login-username').value.trim().toLowerCase();
  const password = document.getElementById('login-password').value;
  const errorEl = document.getElementById('login-error');
  errorEl.textContent = '';

  if (!username || !password) {
    errorEl.textContent = 'Please enter username and password.';
    return;
  }

  showLoading(true);
  try {
    const email = `${username}@FreeGames.com`;
    const { data, error } = await db.auth.signUp({ email, password });
    if (error) throw error;
    if (!data.user) {
      // Email confirmation required — try to sign in instead
      const { data: signInData, error: signInErr } = await db.auth.signInWithPassword({ email, password });
      if (signInErr) throw signInErr;
      currentUser = signInData.user;
    } else {
      currentUser = data.user;
    }
    // Create profile
    await createProfile(username);
    await showMainMenu();
  } catch (err) {
    errorEl.textContent = 'Signup failed: ' + (err.message || 'Try logging in instead.');
  } finally {
    showLoading(false);
  }
}

async function createProfile(username) {
  try {
    const { error } = await db
      .from('profiles')
      .upsert({
        id: currentUser.id,
        username: username,
        email: `${username}@FreeGames.com`,
      }, { onConflict: 'id' });
    if (error) console.warn('Profile create error:', error);
  } catch (err) {
    console.warn('Profile table may not exist yet:', err.message);
  }
}
