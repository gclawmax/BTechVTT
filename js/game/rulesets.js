// Match rulesets keep the curated catalogue useful for both era-focused
// Total Warfare games and deliberately broader experimental skirmishes.
const BT_RULESETS = Object.freeze({
  standard_3060: { name:'Standard 3060', short:'Standard', description:'3060-era, tournament-oriented BattleMech duels. Experimental and advanced signature/booster systems are excluded.' },
  advanced_3060: { name:'Advanced 3060', short:'Advanced', description:'3060-era BattleMechs, including supported advanced equipment. Later-era equipment remains excluded.' },
  open_experimental: { name:'Open / Experimental', short:'Open', description:'All supported BattleMechs and equipment, regardless of era or rules tier.' }
});

const STANDARD_3060_EXCLUDED_EQUIPMENT = new Set([
  'supercharger','triplestrengthmyomer','angelecmsuite','watchdogcews','watchdogecm',
  'nullsignaturesystem','voidsignaturesystem','chameleonlightpolarizationshield','chameleonlightpolarizationfield'
]);

function matchRuleset(state) {
  const key = state?.ruleset;
  return BT_RULESETS[key] ? key : 'advanced_3060';
}

function rulesetLabel(state) { return BT_RULESETS[matchRuleset(state)].name; }

function unitRulesetStatus(unitId, unit, ruleset = 'advanced_3060') {
  if (ruleset === 'open_experimental') return { allowed:true, reason:'' };
  const era = Number(unit?.era || 0);
  if (era && era > 3060) return { allowed:false, reason:`introduced in ${era}` };
  const labels = Object.values(BT_CRITICAL_LAYOUTS?.[unitId] || {}).flat().map(label => String(label || '').toLowerCase().replace(/(?:\s*\([^)]*\))+$/, '').replace(/^(is|clan|cl)/, '').replace(/[^a-z0-9]/g, ''));
  if (labels.includes('voidsignaturesystem')) return { allowed:false, reason:'Void Signature is later-era equipment' };
  if (ruleset === 'standard_3060') {
    if (unit?.customDesign) return { allowed:false, reason:'custom designs require Advanced or Open rules' };
    const excluded = labels.find(label => STANDARD_3060_EXCLUDED_EQUIPMENT.has(label));
    if (excluded) return { allowed:false, reason:'uses advanced equipment' };
  }
  return { allowed:true, reason:'' };
}
