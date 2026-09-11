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

// Persistent signed-in identity, independent of Career participation.
function renderSignedInIdentity() {
  const badge = document.getElementById('signed-in-identity');
  if (!badge) return;
  const signedIn = Boolean(currentUser);
  badge.hidden = !signedIn;
  document.body.classList.toggle('signed-in', signedIn);
  if (!signedIn) return;
  const metadata = currentUser.user_metadata || {};
  const avatar = metadata.career_avatar || {};
  const callsign = String(metadata.callsign || avatar.callsign || metadata.username || currentUser.email?.split('@')[0] || 'MechWarrior');
  document.getElementById('signed-in-callsign').textContent = callsign;
  const emblem = document.getElementById('signed-in-emblem');
  emblem.textContent = callsign.trim().split(/\s+/).slice(0,2).map(word => word[0] || '').join('').toUpperCase();
  emblem.style.borderColor = /^#[0-9a-f]{6}$/i.test(avatar.color || '') ? avatar.color : '#b87d28';
}

function signedInProfileName() {
  const metadata = currentUser?.user_metadata || {};
  return String(metadata.callsign || metadata.career_avatar?.callsign || metadata.username || currentUser?.email?.split('@')[0] || 'MechWarrior');
}
