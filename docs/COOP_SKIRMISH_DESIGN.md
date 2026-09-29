# Coop Skirmish — Design Document (slice 1-a)

**Status: APPROVED for implementation.** Signed off by GClaw 2026-09-29 (all
nine spec-level items confirmed; 1-b seat numbering left deliberately open for
implementation, per sign-off). Code may proceed per §11 implementation order.
**Date:** 2026-09-28 (approved 2026-09-29)
**Governing record:** Design decisions 1–11 in `docs/DEVELOPMENT_ROADMAP.md`
(commits `fc759ff`, `981738a`, `2c2c311`, `eaa810e`, `a50a913`). This document
re-states those decisions in implementation-spec form, adds the data model,
the seat-team helper contract, the visibility rule in precise terms, and the
Battle-C acceptance harness. Where the two differ, the roadmap decisions win;
flag any conflict during sign-off.
**Working Q&A trail:** `Coop Design Discussion.md` (Hermes workspace, not in
this repo).

---

## 1. What ships

**Slice 1-a:** two humans on the **same friendly team** versus an AI force, on
existing large/dual-sheet maps, with existing victory modes
(Annihilation / Control / Breakthrough), plus a shared lance sensor picture
on enemy tokens.

**Slice 1-b** (after 1-a acceptance): up to four humans on the friendly team;
its own acceptance harness (Battle-D, §9).

### Fixed scope — not open questions

From the MW5 Co-op Company Drop Proposal and the roadmap; implementation must
not re-open these:

- Two (then four) humans, same force, vs AI on the opposing force.
- **No Career persistence** — skirmish isolation: no credits, damage, or
  salvage carryover of any kind.
- **No hex fog of war** — enemy *tokens* hide; terrain stays visible.
- Activation remains Total Warfare alternating rounds; "whose turn" is
  **per unit owner**, not per team.
- Existing maps and existing victory modes only.
- Explicitly out of scope: career memberships, shared hangar drops,
  vehicles/VTOL/infantry, PvP.

### Async is a core property

There is no shared clock and no real-time requirement. A player can log in
any time, load the latest game state, and take their pending activations.
Any mechanic that would block, auto-act, or disadvantage an absent seat is
out of bounds (§7).

---

## 2. Match model and data changes

### 2.1 Match type

The match row gains `match_type`: `'skirmish'` (all existing behaviour,
default) or `'coop_skirmish'`. Every mode-dependent behaviour below keys off
this single field — join side, lobby surface, AI roll.

### 2.2 Team assignment is data, not seat arithmetic (decision 4)

At match creation the match state records which seats are on which team:

```jsonc
// match state
{
  "match_type": "coop_skirmish",
  "team_assignments": { "A": [1, 2], "B": [3] }   // 1-a payload
}
```

- `A` = the friendly team (human-operated seats), `B` = the opposing force
  (AI seat). Seat numbers follow the existing `btech_players.seat_number`
  convention (1 = host).
- **1-b** is different data only: `"A": [1, 2, 3, 4], "B": [5]` (or the
  equivalent within the existing 4-seat table if a different numbering is
  chosen at implementation — the point is the field, not the numbers).
- A single SQL function — the **seat-team helper** — reads this data and is
  the *only* place sides are compared (see contract below). No function
  anywhere may inline seat arithmetic (no `seat < 3`, no `floor(seat/2)`) to
  decide a side, check ownership, scope visibility, gate RLS, or build
  reports.
- Today's human-vs-human skirmish and Vs-AI keep working: their creation
  payloads are just other `team_assignments` shapes. Future 1v3, 3-humans-vs-AI,
  or 2v2 PvP are new creation data, zero logic changes.
- A full `force_id` schema migration stays **deferred** to Company Drop
  scope; the helper makes that swap one line.

**Seat-team helper contract (new SQL function):**

```sql
-- Suggested name; final name at implementation.
btech_seat_team(match uuid, seat int) returns text
-- Reads state.team_assignments; returns 'A' or 'B'.
-- RAISEs if the seat has no recorded team (creation data is missing or
-- corrupted) — fail closed, never default to a side.
-- Used by: unit-ownership checks, active-player logic, visibility union
-- (§5), RLS scoping, report building, join-side placement (§4).
```

### 2.3 Unit ownership (unchanged mechanism, preserved invariant)

`units[].owner = seat_number` stays exactly as it is. Ownership is
**per-unit and per-person**, never collapsed to team level:

- Each friendly seat may activate only units it owns (existing server-side
  check, now side-aware via the helper).
- A seat may own **zero** units (spectator, decision 2) or **several**
  (tonnage permitting); survivors keep their activations.
- **Open-cockpit / no-owner deployment is explicitly ruled out** (decision
  6) — it would silently destroy future per-pilot attribution.

### 2.4 Sealed report stamp (decision 6)

`btech_seal_match_report` is extended so every sealed report records, per
friendly seat: `user_id → seat → unit` (which 'Mechs each account operated),
plus the exact rolled AI roster with chassis and loadouts (decision 7).
Record only — no settlement, XP, or persistence. This is the day-one
insurance that keeps persistent MechWarriors viable later.

### 2.5 Tonnage soft cap (decision 1)

The host sets a tonnage cap for the skirmish; the team's selections are
expected under it. Over-tonnage deploy is allowed **after** the confirmation
prompt ("You are over tonnage, do you wish to continue anyway?") and the
confirmed overage is recorded in match state and surfaced in the sealed
report. Implementation replaces the hard rejection in
`update_skirmish_hangar` (SQL 132) when that path is next touched — not a
standalone migration ahead of the milestone.

---

## 3. Lobby (decision 5)

Per-seat loadout generation; the lobby dropdown is a **permission model**,
not a draft mechanic:

| Mode | Who may edit a seat's loadout |
|------|-------------------------------|
| **A — Host assigns** | Host only |
| **B — Pick own** | That seat's player only |
| **C — Pick any** | Any player, until that seat is Readied |

Rules:

- No shared finite pool, **no in-game draft board** — drafting happens
  out-of-game at the host's table.
- Nothing restricts two players selecting the same chassis.
- **Ready locks** a seat's loadout from *everyone, including the host*,
  until Unready. The host may force a seat Ready or Unready.
- Edit permissions and the ready lock are **enforced server-side**, not only
  in the UI.
- The lobby also carries: tonnage cap, AI force preset (decision 7, below),
  map/victory-mode selection (existing controls).

---

## 4. Join flow (decision 10)

The existing game-code join is reused; deltas are small and keyed off
`match_type`:

- **`coop_skirmish`:** a second human entering the game code lands on the
  **friendly team** (host seat 1, joiner seat 2; in 1-b, joiners fill
  friendly seats in order). AI occupies the opposing force.
- **Regular skirmish:** a joining player takes the **opposing side**, as
  today.
- Seat→team mapping at join writes/reads the decision-4 data, so the
  helper — not the join code — decides the side.

### AI roll timing

The preset AI force is rolled **at match start**, not at creation: the
budget is a ratio of the *final* friendly team BV, so rolling earlier would
size the wave against an incomplete force. **Custom is the exception — no
roll at all**; the host's hand-picked line-up is used as-is.

### Explicit host start

The match begins on the host's **start** button, consistent with the lobby
permission model. No auto-start on all-ready.

---

## 5. Shared sensor picture (decision 9) — the precise rule

**Definition.** An enemy unit E is visible to a given friendly seat S **iff**
there exists at least one friendly unit F (owned by any seat on team A,
including S's own) such that F currently has line-of-sight to E within
sensor range (probe/ECM interactions reuse the existing rules, per unit).

- The picture is the **real-time union** of the team's sensor bubbles. The
  moment E leaves *every* friendly unit's sensors, it is hidden from *all*
  friendly seats — no seat retains private memory of where it was.
- **Per-unit contribution:** each unit contributes its own bubble modified
  by *its own* ECM/probe state. One jammed unit degrades only its own
  contribution; the rest of the lance still sees through the others.
- **No stored state in 1-a.** This is a per-team extension of the existing
  per-unit LOS/sensor rule (the `hidden` flag and `btech_los_analysis`
  machinery already implement unit-level detection; the change is that the
  *team's* union drives the flag for team-A observers). Nothing new to
  persist.
- **Deferred — last-known-position memory** ("last seen N turns ago" faded
  markers): a fast follow-up gated on 1-a acceptance. Purely additive stored
  state per team; does not change the real-time rule.

---

## 6. AI force (decision 7)

At match creation the host selects, alongside the tonnage cap, one of three
auto-composed **difficulty presets** or **Custom**. Names describe
opposition strength relative to the players — not classes deployed:

| Preset | Target AI BV | Composition cap |
|--------|--------------|-----------------|
| **Easy** | ~1.0× friendly team BV | lights only |
| **Standard** *(default)* | ~1.1× | at most two mediums |
| **Hard** | ~1.3× | a heavy mech permitted |

- Ratios are **starting points** to be tested and adjusted with live
  matches; the default is a single setting, trivially changeable.
- **Auto-composition:** the target BV budget is filled from the light class
  first; unit count emerges from the budget. What 'Mechs appear follows from
  the budget and the friendly team's own selections (two assault-friendly
  teams earn a credible challenge on Hard).
- **Custom:** the host hand-picks the specific AI line-up from the catalogue,
  bypassing the budget and caps. Reuses the existing host-editable AI force
  surface (`update_ai_skirmish_force`, SQL 152).
- **Sanity ceiling: 10 AI units in every mode, including Custom** — two full
  Clan Stars (a "Binary" in BattleTech terms). Map-capacity guard, not a
  balance knob.
- **Determinism:** roster selection is seeded from the match ID; materialised
  at start as ordinary units owned by the AI seat — the same mechanism as
  Vs-AI. No new runtime mechanics; no AI behaviour changes in 1-a (pack /
  formation tactics are later behaviour-layer polish).
- **1-b scaling:** automatic via the BV ratio (bigger friendly team → bigger
  wave); Custom scales by host choice. No per-seat sizing knobs.
- **Prerequisite:** the catalogue gains a small batch of light-class chassis
  (static data) so auto-composition has variety.

---

## 7. Absent players (decision 8)

**No automatic offline mechanic** — no auto-pass, no AI-driven ally, no
forfeit:

- An absent seat's activations simply **wait**. On rejoin the seat reloads
  the latest game state and resumes its pending activations. The rest of the
  team keeps acting on its own units — nothing is blocked or disadvantaged.
- Auto-pass was rejected on the merits: it cedes a full activation to the
  opposition while a friendly 'Mech idles — a real tactical cost the team
  should not pay for a simple disconnect.
- An optional **cosmetic** "pilot offline" indicator may be shown so the
  team knows why a seat is quiet. No game-mechanic consequence.
- **Long-term absence:** the host transfers the absent player's units to
  another seated player, or takes them over directly, mid-match — reusing
  the host mid-match ownership transfer (decision 2). No new authority
  model.
- **Forfeit** remains a possible host choice; it is never the default.

---

## 8. Spectating and mid-match transfer (decision 2)

- A seat may deploy **zero chassis** and remain in the match: present, able
  to follow, no activations.
- The host may **transfer control** of a deployed mech to another seated
  player mid-match.
- A multi-chassis player keeps the activations of survivors, staying
  involved after some of their Mechs are destroyed.
- Transfer of custom designs and pilot progression (XP) is deferred to the
  later salvage-rights patch — the context in which those rules need to
  exist.

### Persistence compatibility (why 1-a is good groundwork)

Two invariants are protected from day one, which is what keeps future
persistent MechWarriors / XP possible:

1. **Per-unit attribution to a real person** — every friendly activation is
   attributable to a concrete `user_id` (decisions 2.3/6 above;
   open-cockpit ruled out).
2. **A stable identity to hang XP on** — the user's `user_id`, stamped in
   every sealed report, not the seat.

Skirmish therefore becomes a training-data generator for the future system
without any settlement happening now.

---

## 9. Acceptance — Battle-C harness (decision 11)

A live two-account harness driving the real RPC stack, same style and
game-code reporting as Battles A/B (tools/step0-common.mjs conventions).
Assertions:

1. **Same-side join** — both accounts land on the friendly team; AI on the
   opposing force (seat→team mapping correct).
2. **Per-unit ownership** — each account acts only on its own units; a
   cross-ownership activation attempt is rejected by the server.
3. **Shared sensor picture (the core claim)** — an enemy in A's sensors but
   outside B's is visible to B via the team union; an enemy out of *both*
   seats' sensors is hidden from both.
4. **Reliability** — reconnect restores state; no duplicate activations
   (standard A/B checks).
5. **Host transfer** — mid-match transfer of a unit to the other seat
   (decision 2): new owner can act, old owner cannot.
6. **Sealed report** — produced with per-pilot attributions
   (`user_id → seat → unit`) and the exact AI roster.
7. **AI composition** — the rolled roster respects the selected preset (e.g.
   Standard: ≤2 mediums, ≤10 units, total BV ≈ 1.1× friendly team BV within
   tolerance).

Battle-C covers **1-a only**. 1-b gets **Battle-D** after 1-a ships (four
seats, joiner ordering, scaled ratio, plus the same core assertions).

---

## 10. Match lifecycle (summary)

```
create match (match_type=coop_skirmish, team_assignments written)
  → lobby: per-seat loadouts (A/B/C permissions), tonnage cap, AI preset,
     map/victory mode; ready lock per seat; host force-ready
  → host START (explicit button)
     → AI force rolled from final friendly BV (presets only; Custom as-is),
       seeded from match ID, ≤10 units, materialised on the AI seat
     → deployment (existing flow; over-tonnage confirmation if triggered)
  → play: Total Warfare alternating rounds, activation by unit owner,
     shared team-union sensor picture, async (absent seats wait)
  → end: existing victory resolution (Annihilation / Control / Breakthrough)
  → sealed report: results + pilot attributions + AI roster (+ tonnage
     overage if confirmed)
```

---

## 11. Implementation order (proposed, for 1-a)

1. **Catalogue prerequisite** — small batch of light-class chassis
   (static data), giving auto-composition variety.
   - **DONE (2026-09-29):** already satisfied by `megamek-2026-08-curated-05`
     (SQL/97) — 11 lights, all supported. No new batch needed. See roadmap log.
2. **Data model** — `match_type` field, `team_assignments` creation payload,
   `btech_seat_team` helper; convert existing side comparisons to read the
   helper (human-vs-human and Vs-AI payloads unchanged behaviourally).
   - **IN PROGRESS:** `SQL/160` (applied to live Supabase; parse-checked) widens
   `match_type` and adds the fail-closed `btech_seat_team` reader. Client
   team model `js/game/team-model.js` landed (`ca47ca8`) with creation
   payloads writing `team_assignments`. Remaining: server-side match-end /
   concede / minefield-reveal functions + the latent client
   `determineMatchResult` (team-aware, SQL 161), then the lobby UI, join, AI
   roll, visibility.
3. **Join side** — mode-dependent placement on the existing game-code join.
4. **Lobby** — permission dropdown, ready lock, tonnage cap + confirmation,
   AI preset selection (server-enforced).
5. **AI roll** — seeded budget auto-composition with caps and the 10-unit
   ceiling at start; Custom via the existing editable-force surface.
6. **Visibility union** — team-A union of per-unit sensor bubbles (per-unit
   ECM contribution).
7. **Report stamp** — `user_id → seat → unit` + AI roster in the sealed
   report; over-tonnage record.
8. **Spectator seats + host transfer** (zero-chassis seats; mid-match
   ownership transfer).
9. **Battle-C harness** — the seven assertions; step-0 gate applies
   (harness files uncommitted until the battle passes).

Each step is independently verifiable; nothing here requires an AI
behaviour change, a schema migration beyond the match-row field, or a new
RLS model beyond helper-driven scoping.

---

## 12. Explicitly deferred (track, don't forget)

- **Last-known-position markers** — fast follow-up after 1-a acceptance.
- **Slice 1-b** — four friendly seats; Battle-D harness; ratio scaling
  verified live.
- **AI pack/formation tactics** — behaviour-layer polish, baseline-led per
  `docs/AI_OPPONENT_ROADMAP.md`.
- **Preset ratios** — test-and-adjust after live play; default change is a
  one-setting edit.
- **Company Drop / career co-op, XP, salvage duels, `force_id` migration** —
  later programmes per the MW5 proposal.
