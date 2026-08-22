# Proposal: "How to Play" Page

Status: **Proposal** — not yet built.
Date: 2026-08-21
Author: Hermes (on behalf of Matt)

## 1. Purpose

BTechVTT has no in-product explanation of how the game works. A new visitor
lands on the home screen, sees three buttons (Create / Join / vs AI), and is
expected to already know BattleTech. This proposal specifies a **"How to Play"**
page that:

- Explains what BTechVTT is and how to start a game in under a minute.
- Teaches the core loop: initiative → movement → combat → heat → end.
- Documents the interface (board, record sheet, game log, phase controls).
- Serves as the canonical, always-current reference for implemented rules,
  so players never have to guess what the sim actually does.

## 2. Audience

1. **New BattleTech players** — need the full loop explained from zero.
2. **Returning BattleTech players** — need to know how *this sim* implements
   the rules (what's automated, what's manual, where it deviates).
3. **Guests** — someone handed a game code who has never seen the app.

Write for audience 1, but keep sections skimmable so audience 2 can jump
straight to the parts that matter (turn structure, combat, heat).

## 3. Format & Placement

**Recommendation: standalone page `how-to-play.html`**, linked from the home
screen (and optionally from the lobby while waiting for a second player).

Rationale:

- The app is a screen-based SPA (`showScreen()`), but a rules page is
  long-form reading, not a game screen. A standalone page keeps the game
  bundle lean and is trivially deep-linkable (`gclawmax.github.io/BTechVTT/how-to-play.html`).
- It reuses the existing `css/` framework and phosphor aesthetic, so it feels
  native.
- It can be written in plain HTML/Markdown-first and needs no Supabase.

Alternative considered: an in-app "Help" screen or modal. Rejected for v1 —
a modal is too small for this much content, and a full screen would compete
with the game UI. A standalone page can be opened in a second tab while
playing, which is exactly when players want it.

## 4. Proposed Structure

Suggested section order (top to bottom). Each section below lists the content
it should cover, grounded in what the sim actually implements today.

### 4.1 Welcome — What is BTechVTT?
- One paragraph: a free, browser-based BattleTech simulator. No download, no
  install — open it, sign in, play.
- Two ways to play: **solo vs AI** or **online with a friend** (real-time sync
  via game code).
- A "you can play in 60 seconds" callout pointing at §4.2.

### 4.2 Getting Started
- Sign in (account required; explain why — games are saved to your account).
- **Create Game**: choose a battlefield (map) and dropship tonnage per player
  (default 200t) → a game code is generated.
- **Join Game**: enter the code your opponent shared. Two seats per game.
- **Play vs AI**: pick a map, the sim fields an opponent.
- Note: both players see the same board live; no one hosts.

### 4.3 The Battlefield
- Flat-top hex grid; every hex has a code (2-digit column + 2-digit row, e.g.
  `0304`) used in the game log.
- The four maps: Training Grounds, Woodland Approach, Open Engagement,
  Ridge and Ford — one line each on what they offer (open ground, woods,
  elevation, mixed).
- Terrain: Clear, Light Woods (+1 MP), Heavy Woods (+2 MP); elevation.
- Line of sight: straight line between hex centres; 3+ intervening woods
  points block it. Intervening 'Mechs do not block.

### 4.4 Your 'Mech
- The **record sheet**: the 3×3 armor diagram (Head centred top; Left/Right
  Torso, Arms, Legs), armor values, and internal structure.
- Key stats and what they do:
  - Walking / Running / Jumping MP — movement options.
  - Gunnery Skill — your to-hit bonus.
  - Heat Dissipation — how much heat you shed each turn.
- Weapons: damage, range brackets (Short/Medium/Long), firing location,
  heat generated, and ammunition.
- The **hangar**: browse the curated IS + Clan catalogue, search, favourites,
  and skirmish hangars for quick picks.

### 4.5 Turn Structure
The heart of the page. Present the seven phases as a numbered flow:

1. **Initiative** — one player per side rolls 2D6; higher wins. The *loser*
   moves first; in the Weapon phase the *winner* declares attacks first.
   Ties re-roll.
2. **Movement** — every 'Mech acts (see §4.6).
3. **Reaction** — defend against the opponent's movement (see §4.9).
4. **Weapon** — declare and resolve attacks (see §4.7).
5. **Physical** — punches, kicks, grabs (see §4.9).
6. **Heat** — dissipate heat; check for overheat.
7. **End** — clean up destroyed units, advance to next turn.

Include a simple diagram of the phase order and a note that the sim walks
players through each phase in order.

### 4.6 Movement
- Choose exactly one mode per 'Mech: **Stand / Walk / Run / Jump**.
  - Attack modifiers: +0 / +1 / +2 / +3 respectively.
  - Mode is locked once chosen; unspent MP is lost.
- **Facing**: six directions; turning costs 1 MP per hexside (180° = 3 MP).
  Backward movement is walk-only and doesn't change facing.
- **Terrain costs**: every hex entered costs 1 MP + terrain penalty.
- **Jumping**: 1 Jumping MP per hex; ignores terrain and other 'Mechs in
  transit; can't land in an occupied hex; choose any facing on landing.
- **Rough ground**: running/jumping in certain terrain triggers a stability
  check.
- The sim shows a **movement preview** before you commit, and enforces all
  costs automatically.

### 4.7 Combat
- **To-hit**: roll 2D6. Target number = `12 − Gunnery + facing + range +
  movement modifier`. Explain each term with a worked example.
- **Hit location**: on a hit, roll 2D6 on the hit-location table (2 CT,
  3–4 RA, 5 RL, 6 RT, 7 CT, 8 LT, 9 LL, 10–11 LA, 12 Head).
- **Damage**: applied to armor first; once armor is exhausted, remaining
  damage transfers inward to structure per the damage-transfer diagram.
- **Criticals**: when structure in a location is exhausted, roll for a
  critical hit.
- **Missiles**: SRM (2 damage per missile, separate location roll each) and
  LRM (1 damage per missile, grouped in 5s) use the cluster-hits table.
- **Special weapons**: LB-X ammo modes, Ultra AC ricochet, hatchets,
  flamers — one short paragraph each on when they matter.
- **Destruction**:
  - Head or Center Torso destroyed → 'Mech destroyed.
  - Torso destroyed → corresponding arm destroyed.
  - Leg destroyed → no further movement or facing changes, but it can still fire.
  - Destroyed 'Mechs are removed at the end of the phase.

### 4.8 Heat
- Firing weapons generates heat (shown on the record sheet).
- In the Heat phase, the 'Mech dissipates its Heat Dissipation rating.
- **Overheat**: if heat exceeds the limit, the 'Mech suffers a movement
  penalty next turn. Explain why heat management is a core decision.

### 4.9 Reactions & Physical Attacks
- **Reactions**: after the opponent moves, you may react (e.g. fire in
  response) per the reaction rules.
- **Physical attacks**: when adjacent, a 'Mech may punch, kick, or grab —
  2D6 vs `12 − Strength`. One line on what each does.

### 4.10 Winning
- First side to destroy all enemy 'Mechs wins.
- Note how the sim declares victory and ends the game.

### 4.11 Interface Tour
A short, screenshot-annotated walkthrough of the actual UI. Real captures
already exist in `assets/screenshots/` (captured 2026-08-22 from the running
app via `tools/capture-screenshots.mjs`):

- `01_login.jpg` — sign-in screen.
- `02_menu.jpg` — home screen (Create / Play vs AI / Join by code).
- `03_lobby.jpg` — game lobby (code, players, ready states, Start).
- `05_board.jpg` — hex board with unit sprites, roster, game log.
- `06_detail.jpg` — selected 'Mech detail panel (stats, weapons, ammo).
- `08_movement_stand.jpg` — movement phase with mode buttons.
- `09_weapon_panel.jpg` — weapon attack declaration panel.
- `10_weapon_selected.jpg` — weapons checked, target chosen, TN shown.
- `11_combat_result.jpg` — post-attack state (heat, log entries).

Annotate each with callouts for:
- The board (hexes, unit tokens, facing indicators, selection).
- The record sheet panel (armor diagram, stats, weapons).
- The game log (what it records, hex codes, how to read an attack entry).
- Phase controls (how the sim advances phases, what's clickable when).
- Mobile: the responsive layout and how panels behave on a phone.

## 5. Design Notes

- **Phosphor aesthetic**: light background, dark text, amber accents — match
  the existing `css/` so the page feels part of the app.
- **Mobile-first**: the game is mobile-responsive; the page must be too.
  Single-column on phones, generous tap targets.
- **Skimmable**: each section starts with a one-line summary; details follow.
  Use tables for numeric rules (movement modes, hit-location table, terrain
  costs) rather than prose.
- **Worked examples**: at least one fully-worked attack (initiative → move →
  to-hit → hit location → damage) so a new player can trace a real exchange.
- **No walls of text**: favour short paragraphs, tables, and diagrams.

## 6. Content Sources

The page must describe what the sim *actually does*, not idealised rules.
Authoritative sources, in priority order:

1. `rules/*.md` — the token-optimised rule set the engine implements
   (sequence of play, movement, combat, LOS/range, damage, reactions,
   physical, heat, criticals, Total Warfare turn/facing/attacks/damage).
2. `README2.md` — current feature status (phases 1–6 complete).
3. The code itself (`js/game/phases.js`, `js/movement/rules.js`,
   `js/game/weapon-attack.js`, `js/game/heat.js`,
   `js/game/critical-hits.js`) — where rules and code disagree, the code
   wins and the page should say so.

Known deviations to flag honestly (open issues as of 2026-08-22):
- Clan weapons using IS stats (issue #5).

(Issues #1–#4 — front hit table 10–12, side-table left/right flank handling,
hardcoded gunnery, and jump-landing facing — were fixed in commit e7a8a33 and
are no longer open, so they do not appear in the box.)

The page should carry a small "known simplifications" box listing the open
items above, so players aren't surprised and the team owns the gaps
transparently.

## 7. Maintenance

- Treat the page as **living documentation**: any rules change that lands in
  `js/` or `rules/` gets a matching edit to the page in the same PR.
- Add a "Last updated" line and link to `rules/README.md` for the dev-facing
  set.
- Keep the page and `rules/*.md` in sync; if they diverge, the page is the
  player-facing truth and `rules/` is the dev-facing truth.

## 8. Open Questions (need Matt's call)

1. **Standalone page vs in-app screen?** — Proposal recommends standalone
   `how-to-play.html`. Confirm.
2. **Screenshots?** — Interface Tour (§4.11) is much stronger with annotated
   screenshots. Do we capture them now, or stub the section and add later?
3. **Depth** — Quick-Start depth only (recommended for v1), or also cover
   Total Warfare nuances (facing-dependent attacks, full heat/critical
   tables)?
4. **Beginner scenario** — include a guided 2-Locust vs 2-Griffin scenario
   as a "try it yourself" appendix?
5. **Link placement** — home screen only, or also a "Help" link in the lobby
   and game HUD?

## 9. Implementation Sketch

- New file: `how-to-play.html` (reuses `css/` framework; no new JS required
  beyond the existing screen/nav helpers if a back-link is wanted).
- Edit `index.html`: add a "How to Play" link/button on the home screen
  (and optionally the lobby).
- No Supabase, no build step — pure static, deploys with the existing
  GitHub Pages setup.
- Estimated size: ~600–900 lines of HTML across the 11 sections.
- Verification: open locally, check mobile viewport, confirm all internal
  links resolve, and diff the numeric tables against `rules/*.md`.
