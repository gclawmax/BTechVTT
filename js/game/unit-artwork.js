// Optional, licence-tracked BattleMech artwork. The game remains fully usable
// when the manifest or an individual sprite is absent.
const BT_MECH_ARTWORK = { manifest: {}, images: new Map(), loaded: false };

async function loadMechArtworkManifest() {
  try {
    const response = await fetch('assets/mechs/manifest.json?v=20260908-commander-wolverine-102', { cache: 'no-cache' });
    if (!response.ok) return;
    const manifest = await response.json();
    BT_MECH_ARTWORK.manifest = manifest.units || {};
    BT_MECH_ARTWORK.loaded = true;
    if (typeof draw === 'function') draw();
  } catch (error) {
    console.info('BattleMech artwork manifest unavailable; using tactical tokens.', error);
  }
}

function mechArtworkImage(unitId) {
  const entry = BT_MECH_ARTWORK.manifest[unitId];
  if (!entry?.file) return null;
  if (BT_MECH_ARTWORK.images.has(unitId)) return BT_MECH_ARTWORK.images.get(unitId);
  const image = new Image();
  image.onload = () => { image.dataset.ready = 'true'; if (typeof draw === 'function') draw(); };
  image.onerror = () => image.dataset.failed = 'true';
  image.src = `assets/mechs/${entry.file}`;
  BT_MECH_ARTWORK.images.set(unitId, image);
  return image;
}

loadMechArtworkManifest();

function unitArtworkThumbnail(unitId) {
  const file = BT_MECH_ARTWORK.manifest[unitId]?.file;
  if (!file || !/^[a-z0-9_-]+\.png$/i.test(file)) return '';
  return `<img class="hangar-unit-art" src="assets/mechs/${file}" alt="BattleMech sprite" loading="lazy">`;
}
