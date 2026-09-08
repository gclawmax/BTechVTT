# Skirmish polish — implementation and verification

Local build: `20260908-skirmish-polish-100`. Release prepared for GitHub Pages.

## BV correctness

Found and corrected two defects:

- Independent Gunnery/Piloting multiplication was incorrect. The combined
  table gives a 3/4 pilot 1.32× instead of the former 1.584×.
- Human matches omitted the `force_values` object. PostgreSQL nested JSON
  updates silently omitted the sealed totals when that parent was absent.

Reference: [MegaMek BVCalculator, combined skill table](https://github.com/MegaMek/megamek/blob/main/megamek/src/megamek/common/battleValue/BVCalculator.java), referencing TechManual p.315.

Apply `SQL/144_correct_bv2_pilot_skill_table.sql` before publishing this
frontend. It corrects the server lookup and makes sealing initialise its
parent object. It does not rewrite previously sealed match records.
The user applied SQL 144 successfully. Live player-account RPC verification
subsequently sealed a 3/4 Adder/Puma Prime at 2,750 BV and rejected an
over-cap roster. The opposing 4/5 Grand Dragon DRG-5K and Victor VTR-9B
sealed at 2,736 BV. New Clan hangar entries default to 3/4; new Inner Sphere
entries default to 4/5. Existing saved pilots are unchanged.

## Implemented UI improvements

- Human skirmishes default to BV2; mines default off and are available in
  creation only for Advanced 3060.
- Both force totals, remaining BV and their difference appear in the lobby.
- Roster precedes the deployment map; chassis headings include tonnage;
  hangar subtotal and Dropship labels distinguish selection from placement.
- Setup instructions, deployment-zone labels and map-description contrast
  are clearer. Setup scrolls; map previews include tree symbols.
- Larger battlefield tokens carry variant labels.
- Movement planning supports undo last segment, reset and a path trail.
- Alpha Strike selects eligible weapons through the existing selection
  handler, leaving final firing confirmation explicit.
- Lobby and log rendering use saved avatar callsigns where available.
  Legacy avatars can still contain generic P1/P2 callsigns.
- Rejoining loads the most recent log entries rather than the oldest 200;
  multiline log whitespace is preserved.
- Career expansion is secondary in the development roadmap. Skirmish
  staging removal and the final beginner-tutorial milestone are recorded.

## Verification

- Browser setup checks: BV2 default, mines unchecked, Standard disables
  mines, readable map-description colour, no page errors.
- BV reference examples, rounding and invalid inputs pass. All 81
  browser/server table combinations agree in the local test.
- BV import, roster contract, match creation and hangar checks pass.
- Live dedicated-account two-player smoke test passes through deployment,
  specialised ammunition, initiative, movement, combat, heat and rejoin.
- Separate live three-Mech lobby: Grand Dragon DRG-5K + Victor VTR-9B seal
  at 2,736 BV against Timber Wolf Prime at 2,737 BV, all pilots 4/5.
  Mines are disabled. The live server rejects an over-cap roster.
  This verifies lobby BV sealing, not a complete three-Mech battle.
- Local movement undo/reset check restores position, facing, path and costs.
- Broad historical source suite: 308/310. Remaining failures concern an
  obsolete exact build marker and Career avatar UI, outside this change.
- Changed JavaScript passes syntax checks; diff whitespace check passes.

## Remaining work before the full playtest roadmap is complete

Publish and verify the frontend, then complete a three-Mech battle.
Continue with lobby ruleset changes and authoritative setting revalidation,
full ammunition confirmation/callsign guidance, expanded action logs,
movement allocation/status presentation, standing facing verification,
additional curated graphics/maps and catalogue variants. Implement the
recorded staging simplification and beginner tutorials in their planned order.
