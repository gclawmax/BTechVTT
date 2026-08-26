// ── LOCAL GAME SETTINGS & COMBAT PRESENTATION ────────────
// These preferences affect only this browser. Combat remains authoritative
// and resolves immediately on the server; this queue only narrates saved
// results at a comfortable pace.

const BT_GAME_SETTINGS_KEY = 'bt-vtt-game-settings-v1';
const DEFAULT_GAME_SETTINGS = Object.freeze({ combatLogSpeed: 'standard', sfxMuted: false, sfxVolume: 0.55 });
const COMBAT_PRESENTATION_SPEEDS = Object.freeze({
  instant: { shotDelay: 0, mechDelay: 0 },
  fast: { shotDelay: 120, mechDelay: 350 },
  standard: { shotDelay: 260, mechDelay: 800 },
  cinematic: { shotDelay: 450, mechDelay: 1400 }
});
const WEAPON_SOUND_FILES = Object.freeze({
  ballistic: 'assets/audio/ballistic-fire.wav',
  missile: 'assets/audio/missile-fire.wav',
  laser: 'assets/audio/laser-fire.wav'
});

function loadGameSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(BT_GAME_SETTINGS_KEY) || '{}');
    return {
      combatLogSpeed: COMBAT_PRESENTATION_SPEEDS[saved.combatLogSpeed] ? saved.combatLogSpeed : DEFAULT_GAME_SETTINGS.combatLogSpeed,
      sfxMuted: typeof saved.sfxMuted === 'boolean' ? saved.sfxMuted : DEFAULT_GAME_SETTINGS.sfxMuted,
      sfxVolume: Number.isFinite(Number(saved.sfxVolume)) ? Math.min(1, Math.max(0, Number(saved.sfxVolume))) : DEFAULT_GAME_SETTINGS.sfxVolume
    };
  } catch (_) {
    return { ...DEFAULT_GAME_SETTINGS };
  }
}

let btGameSettings = loadGameSettings();
let combatPresentationQueue = Promise.resolve();
let combatPresentationGeneration = 0;
let weaponCombatPresentationHydrated = false;
const knownResolvedWeaponEvents = new Set();
const activeWeaponSounds = new Set();

function saveGameSettings() {
  localStorage.setItem(BT_GAME_SETTINGS_KEY, JSON.stringify(btGameSettings));
  renderGameSettingsControls();
}

function openGameSettings() {
  const overlay = document.getElementById('game-settings-overlay');
  if (!overlay) return;
  renderGameSettingsControls();
  overlay.hidden = false;
  document.getElementById('combat-log-speed')?.focus();
}

function closeGameSettings() {
  const overlay = document.getElementById('game-settings-overlay');
  if (overlay) overlay.hidden = true;
}

function setCombatLogSpeed(speed) {
  if (!COMBAT_PRESENTATION_SPEEDS[speed]) return;
  btGameSettings.combatLogSpeed = speed;
  saveGameSettings();
}

function setSoundEffectsVolume(value) {
  const volume = Math.min(1, Math.max(0, Number(value) / 100));
  btGameSettings.sfxVolume = volume;
  if (volume > 0 && btGameSettings.sfxMuted) btGameSettings.sfxMuted = false;
  for (const sound of activeWeaponSounds) sound.volume = btGameSettings.sfxMuted ? 0 : volume;
  saveGameSettings();
}

function toggleSoundEffectsMuted() {
  btGameSettings.sfxMuted = !btGameSettings.sfxMuted;
  if (btGameSettings.sfxMuted) {
    for (const sound of activeWeaponSounds) { sound.pause(); sound.currentTime = 0; }
    activeWeaponSounds.clear();
  }
  saveGameSettings();
}

function renderGameSettingsControls() {
  const speed = document.getElementById('combat-log-speed');
  const volume = document.getElementById('sound-effects-volume');
  const volumeLabel = document.getElementById('sound-effects-volume-label');
  const mute = document.getElementById('sound-effects-mute');
  if (speed) speed.value = btGameSettings.combatLogSpeed;
  if (volume) volume.value = String(Math.round(btGameSettings.sfxVolume * 100));
  if (volumeLabel) volumeLabel.textContent = `${Math.round(btGameSettings.sfxVolume * 100)}%`;
  if (mute) {
    mute.textContent = btGameSettings.sfxMuted ? 'Sound Effects Muted' : 'Sound Effects On';
    mute.setAttribute('aria-pressed', String(btGameSettings.sfxMuted));
    mute.classList.toggle('muted', btGameSettings.sfxMuted);
  }
}

function weaponSoundFamily(result) {
  const label = `${result?.weapon || ''} ${result?.mount_id || ''}`.toLowerCase();
  if (/laser/.test(label)) return 'laser';
  if (/\b(lrm|srm)\b|lrm-|srm-|streak|missile|narc/.test(label)) return 'missile';
  if (/ac\/?\d|autocannon|\buac\b|lb[- ]?x|gauss|machine gun|rifle/.test(label)) return 'ballistic';
  return null;
}

function playWeaponSound(family) {
  const source = WEAPON_SOUND_FILES[family];
  if (!source || btGameSettings.sfxMuted || btGameSettings.sfxVolume <= 0) return;
  const sound = new Audio(source);
  sound.preload = 'auto';
  sound.volume = btGameSettings.sfxVolume;
  activeWeaponSounds.add(sound);
  const release = () => activeWeaponSounds.delete(sound);
  sound.addEventListener('ended', release, { once: true });
  sound.addEventListener('error', release, { once: true });
  sound.play().catch(release);
}

function combatPresentationDelay(ms, generation) {
  if (!ms || generation !== combatPresentationGeneration) return Promise.resolve();
  return new Promise(resolve => setTimeout(resolve, ms));
}

function revealCombatPresentationEntry(entry, persist) {
  if (persist) logEvent(entry.msg, entry.cat || 'attack', entry.team, entry.kind ? { kind: entry.kind } : null);
  else mergeRemoteLog([entry]);
}

function queueCombatPresentation(group, { persist = false } = {}) {
  const generation = combatPresentationGeneration;
  combatPresentationQueue = combatPresentationQueue.then(async () => {
    if (generation !== combatPresentationGeneration) return;
    const timing = COMBAT_PRESENTATION_SPEEDS[btGameSettings.combatLogSpeed] || COMBAT_PRESENTATION_SPEEDS.standard;
    const groupEntries = group.entries || [];
    const entries = [group.header, ...groupEntries].filter(Boolean);
    if (!timing.shotDelay && !timing.mechDelay) {
      if (persist) entries.forEach(entry => revealCombatPresentationEntry(entry, true));
      else mergeRemoteLog(entries);
      playWeaponSound(groupEntries.find(entry => entry.soundFamily)?.soundFamily);
      return;
    }
    revealCombatPresentationEntry(group.header, persist);
    await combatPresentationDelay(Math.min(180, timing.shotDelay), generation);
    for (let index = 0; index < groupEntries.length; index++) {
      if (generation !== combatPresentationGeneration) return;
      const entry = groupEntries[index];
      revealCombatPresentationEntry(entry, persist);
      playWeaponSound(entry.soundFamily);
      if (index < groupEntries.length - 1) await combatPresentationDelay(timing.shotDelay, generation);
    }
    await combatPresentationDelay(timing.mechDelay, generation);
  }).catch(error => console.warn('[BT-PRESENTATION] combat narration failed:', error));
  return combatPresentationQueue;
}

function registerResolvedWeaponEvent(eventId) {
  if (knownResolvedWeaponEvents.has(eventId)) return 'known';
  knownResolvedWeaponEvents.add(eventId);
  return weaponCombatPresentationHydrated ? 'animate' : 'hydrate';
}

function markWeaponCombatPresentationHydrated() {
  weaponCombatPresentationHydrated = true;
}

function queueAuthoritativeWeaponPresentation(group) {
  return queueCombatPresentation(group, { persist: false });
}

function queueLocalWeaponPresentation(attacker, outcomes) {
  const now = Date.now();
  return queueCombatPresentation({
    header: { msg: `${mechLabel(attacker)} — WEAPON FIRE`, cat: 'attack', team: attacker.owner, kind: 'weapon-header' },
    entries: outcomes.map((outcome, index) => ({ msg: outcome.msg, cat: 'attack', team: attacker.owner, soundFamily: outcome.soundFamily, ts: now + index }))
  }, { persist: true });
}

function resetCombatPresentation() {
  combatPresentationGeneration += 1;
  combatPresentationQueue = Promise.resolve();
  weaponCombatPresentationHydrated = false;
  knownResolvedWeaponEvents.clear();
  for (const sound of activeWeaponSounds) { sound.pause(); sound.currentTime = 0; }
  activeWeaponSounds.clear();
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && !document.getElementById('game-settings-overlay')?.hidden) closeGameSettings();
});
