// ── PERSISTENT CAREER COMMANDER AVATAR ──────────────────
// Stored in Supabase auth metadata so the identity follows the signed-in
// account without introducing a temporary browser-only career data model.

function savedCareerAvatar() {
  const avatar = currentUser?.user_metadata?.career_avatar;
  return avatar && typeof avatar === 'object' ? avatar : null;
}

function openCareerAvatarCreator() {
  const avatar = savedCareerAvatar();
  const username = currentUser?.user_metadata?.username || currentUser?.email?.split('@')[0] || 'MechWarrior';
  document.getElementById('career-avatar-callsign').value = avatar?.callsign || titleCase(username);
  document.getElementById('career-avatar-company').value = avatar?.companyName || `${titleCase(username)} Command`;
  document.getElementById('career-avatar-affiliation').value = avatar?.affiliation || 'Independent';
  document.getElementById('career-avatar-color').value = /^#[0-9a-f]{6}$/i.test(avatar?.color || '') ? avatar.color : '#d4800a';
  document.getElementById('career-avatar-status').textContent = avatar ? 'Your saved commander profile is ready to update.' : 'Create the commander identity that will anchor your Career.';
  renderCareerAvatarPreview();
  showScreen('career-avatar-screen');
}

function closeCareerAvatarCreator() { showScreen('menu-screen'); }

function careerAvatarInitials(callsign) {
  const words = String(callsign || 'Mech Warrior').trim().split(/\s+/).filter(Boolean);
  return (words.length > 1 ? words[0][0] + words.at(-1)[0] : words[0]?.slice(0, 2) || 'MW').toUpperCase();
}

function renderCareerAvatarPreview() {
  const callsign = document.getElementById('career-avatar-callsign')?.value.trim() || 'MechWarrior';
  const companyName = document.getElementById('career-avatar-company')?.value.trim() || 'Independent Command';
  const affiliation = document.getElementById('career-avatar-affiliation')?.value || 'Independent';
  const color = document.getElementById('career-avatar-color')?.value || '#d4800a';
  const emblem = document.getElementById('career-avatar-emblem');
  if (emblem) { emblem.textContent = careerAvatarInitials(callsign); emblem.style.borderColor = color; emblem.style.backgroundColor = `${color}26`; }
  document.getElementById('career-avatar-preview-callsign').textContent = callsign;
  document.getElementById('career-avatar-preview-company').textContent = companyName;
  document.getElementById('career-avatar-preview-affiliation').textContent = affiliation;
}

async function saveCareerAvatar(event) {
  event?.preventDefault();
  const callsign = document.getElementById('career-avatar-callsign').value.trim();
  const companyName = document.getElementById('career-avatar-company').value.trim();
  const affiliation = document.getElementById('career-avatar-affiliation').value;
  const color = document.getElementById('career-avatar-color').value;
  const status = document.getElementById('career-avatar-status');
  const button = document.getElementById('career-avatar-save');
  if (!callsign || !companyName) { status.textContent = 'Enter both a commander callsign and company name.'; return; }

  const previous = savedCareerAvatar();
  const careerAvatar = {
    callsign, companyName, affiliation, color,
    createdAt: previous?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
  button.disabled = true;
  button.textContent = 'Saving…';
  status.textContent = 'Saving this commander to your account…';
  try {
    const { data, error } = await db.auth.updateUser({ data: { ...(currentUser?.user_metadata || {}), career_avatar: careerAvatar } });
    if (error) throw error;
    currentUser = data.user || { ...currentUser, user_metadata: { ...(currentUser?.user_metadata || {}), career_avatar: careerAvatar } };
    status.textContent = 'Career commander saved. This identity will be available whenever you sign in.';
  } catch (error) {
    status.textContent = `Could not save the Career commander: ${error.message || 'please try again.'}`;
  } finally {
    button.disabled = false;
    button.textContent = 'Save Persistent Avatar';
  }
}
