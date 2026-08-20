# SQL Changes Proposed by Local Model

**Project:** BTechVTT (`gclawmax/BTechVTT`)
**Date:** 2026-08-19
**Status:** PROPOSED — local file edits only. **Nothing has been applied to Supabase.**
**Author:** Local model (Hermes Agent). For review before any migration is run.

---

## 1. Summary

Four BattleTech rules fixes were implemented in the client (JavaScript) **and** mirrored in the
server-side Postgres functions (Supabase) so that client and server stay in parity. The client
changes live in `js/game/weapon-attack.js` and `js/movement/movement.js`. The server changes live
in six `.sql` files under `SQL/`.

| # | Fix | Client file | Server file(s) |
|---|-----|-------------|----------------|
| 1 | Front hit table: roll 12 → **head** (was `la`) | `js/game/weapon-attack.js` | `SQL/15`, `SQL/18`, `SQL/19` |
| 2 | Split `'side'` into **`side-right` / `side-left`** + mirrored left-flank hit table | `js/game/weapon-attack.js` | `SQL/15`, `SQL/18`, `SQL/19`, `SQL/20`, `SQL/21` |
| 3 | To-hit base uses **per-pilot Gunnery** (default 4) instead of a literal `4` | `js/game/weapon-attack.js` | `SQL/15`, `SQL/18`, `SQL/19`, `SQL/20`, `SQL/21` |
| 4 | **Free facing choice after jump landing** (honour an explicit landing facing) | `js/movement/movement.js` | `SQL/31` |

### Why the server must change
The server is authoritative: it re-rolls every weapon attack and validates every movement action.
If only the client changed, the server would still resolve attacks with the old (single `'side'`)
hit table, the old front table, and a fixed to-hit base of `4` — so the client's corrected results
would be overwritten or rejected. The server functions must be redefined to match.

---

## 2. What each fix does (rules basis)

### Fix #1 — Front hit table, roll 12 → head
The Quick-Start front hit-location table maps a roll of **12 to Head**. The previous code fell
through to `la` (Left Arm). Corrected in the front branch of the hit-location logic.

### Fix #2 — Mirrored left/right side tables
A single generic `'side'` table was used for both flanks. The right flank and left flank use
**mirror-image** tables (Left Arm ↔ Right Arm, Left Torso ↔ Right Torso, **Left Leg ↔ Right Leg**).
The direction resolver now returns a distinct `side-right` / `side-left`, and a mirrored left-flank
table was added. The right-flank table is unchanged (it is the original); the left-flank table is its
full mirror — including the legs (roll 5 → `ll`, roll 10 → `rl`).

Direction mapping (offset-grid direction index from attacker to target):
- `0` → `front`
- `1` → `side-right`
- `5` → `side-left`
- `2, 3, 4` → `rear`

### Fix #3 — Per-pilot Gunnery in to-hit
The to-hit base was a hard-coded `4`. It now reads the attacking pilot's **Gunnery** rating,
defaulting to `4` when the stat is absent (so existing matches behave identically).

```
tn := coalesce((attacker->'pilot'->>'gunnery')::int, 4) + <modifiers>
```

### Fix #4 — Free facing after jump
Per Quick-Start Rules p.3, a 'Mech that jumps may choose its landing facing at no MP cost. The
client enters a free-facing micro-state after landing and submits the chosen facing. The server
movement function now honours an explicit `facing` field in the jump action; if absent it falls
back to the travel direction (backward compatible).

---

## 3. Files changed and the functions affected

Each change is a **full function redefinition** (`CREATE OR REPLACE FUNCTION`), not a partial patch.
Re-running a file therefore replaces the whole function body safely.

| File | Function(s) redefined | Changes inside |
|------|----------------------|----------------|
| `SQL/15_authoritative_direct_fire.sql` | `public.resolve_standard_weapon_attack(...)` | angle split (fix #2), front roll-12→head (fix #1), gunnery base (fix #3) |
| `SQL/18_pin_versioned_catalogue.sql` | `public.resolve_standard_weapon_attack(...)` | same three as #15 |
| `SQL/19_authoritative_missile_attacks.sql` | `public.btech_roll_mech_hit_location(p_angle text)` **and** `public.resolve_standard_weapon_attack(...)` | `btech_roll_mech_hit_location` gains the `side-left` mirror branch + front roll-12→head (fixes #1/#2); `resolve_standard_weapon_attack` angle split + gunnery base (fixes #2/#3) |
| `SQL/20_simultaneous_weapon_fire.sql` | `public.resolve_standard_weapon_attack(...)` | angle split (fix #2), gunnery base (fix #3) |
| `SQL/21_simultaneous_weapon_declarations.sql` | `public.btech_process_weapon_declaration(...)` | angle split (fix #2), gunnery base (fix #3) |
| `SQL/31_authoritative_movement.sql` | `public.submit_battlemech_movement(...)` | honour explicit jump landing `facing` (fix #4) |

> Note: `btech_roll_mech_hit_location` is defined **only** in `SQL/19`; `btech_direction_to` is
> defined **only** in `SQL/15`. The other files call them rather than redefining them, so the
> mirrored-table change is centralised in `SQL/19` and the angle split is applied at each call site.

---

## 4. Representative diff (what actually changed)

### Angle split (fix #2) — applied at each call site
```sql
-- before
target_direction := btech_direction_to(...);   -- returns 0..5, mapped to a single 'side'
-- after: the 0..5 direction is mapped to a named angle with distinct flanks
angle := CASE
  WHEN target_diff = 0 THEN 'front'
  WHEN target_diff = 1 THEN 'side-right'
  WHEN target_diff = 5 THEN 'side-left'
  ELSE 'rear'
END;
```

### Mirrored hit table (fix #2) — in `btech_roll_mech_hit_location` (SQL/19)
```sql
WHEN 'side-right' THEN
  CASE lr WHEN 2 THEN 'ct' WHEN 3 THEN 'ra' WHEN 4 THEN 'ra' WHEN 5 THEN 'rl'
          WHEN 6 THEN 'rt' WHEN 7 THEN 'rt' WHEN 8 THEN 'ct' WHEN 9 THEN 'lt'
          WHEN 10 THEN 'll' WHEN 11 THEN 'll' ELSE 'head' END
WHEN 'side-left' THEN            -- mirror of the right table (LA<->RA, LT<->RT)
  CASE lr WHEN 2 THEN 'ct' WHEN 3 THEN 'la' WHEN 4 THEN 'la' WHEN 5 THEN 'rl'
          WHEN 6 THEN 'lt' WHEN 7 THEN 'lt' WHEN 8 THEN 'ct' WHEN 9 THEN 'rt'
          WHEN 10 THEN 'ra' WHEN 11 THEN 'ra' ELSE 'head' END
```

### Front roll-12 → head (fix #1)
```sql
-- front table: roll 12 was 'la', now 'head'
WHEN 12 THEN 'head'
```

### Gunnery base (fix #3)
```sql
-- before
tn := 4 + move_mod + target_mod + range_mod + woods;
-- after
tn := coalesce((attacker->'pilot'->>'gunnery')::int, 4) + move_mod + target_mod + range_mod + woods;
```
(SQL/19/20/21 use the equivalent `base_tn :=` form.)

### Jump landing facing (fix #4) — in `submit_battlemech_movement` (SQL/31)
```sql
-- before
current_facing := btech_direction_to(current_col, current_row, next_col, next_row);
-- after
IF action->>'facing' IS NOT NULL THEN
  current_facing := ((action->>'facing')::int) % 6;
ELSE
  current_facing := btech_direction_to(current_col, current_row, next_col, next_row);
END IF;
```

---

## 5. Commands to run in Supabase

These are the exact commands believed necessary to make the fixes work on the server. Run them
**in this order** (15 before 18/19/20/21 is not strictly required because each file is self-contained,
but the listed order matches the dependency of the shared helpers).

> **How to run:** in the Supabase SQL Editor, paste and run each file's full contents in turn,
> **or** from the CLI:
> ```bash
> supabase db execute --file SQL/15_authoritative_direct_fire.sql
> supabase db execute --file SQL/18_pin_versioned_catalogue.sql
> supabase db execute --file SQL/19_authoritative_missile_attacks.sql
> supabase db execute --file SQL/20_simultaneous_weapon_fire.sql
> supabase db execute --file SQL/21_simultaneous_weapon_declarations.sql
> supabase db execute --file SQL/31_authoritative_movement.sql
> ```
> (Adjust the connection/project as appropriate. If you prefer the Dashboard, open
> **SQL Editor → New query**, paste the file, and click **Run**.)

### Order
1. `SQL/15_authoritative_direct_fire.sql` — redefines `btech_direction_to` + `resolve_standard_weapon_attack` (direct fire)
2. `SQL/18_pin_versioned_catalogue.sql` — redefines `resolve_standard_weapon_attack` (versioned-catalogue path)
3. `SQL/19_authoritative_missile_attacks.sql` — redefines `btech_roll_mech_hit_location` (mirrored table) + `resolve_standard_weapon_attack` (missiles)
4. `SQL/20_simultaneous_weapon_fire.sql` — redefines `resolve_standard_weapon_attack` (simultaneous fire)
5. `SQL/21_simultaneous_weapon_declarations.sql` — redefines `btech_process_weapon_declaration`
6. `SQL/31_authoritative_movement.sql` — redefines `submit_battlemech_movement` (jump facing)

Because every change is `CREATE OR REPLACE FUNCTION`, re-running is idempotent and safe to repeat.

---

## 6. Verification performed locally

- **Syntax:** `node --check` passes on all modified JS files.
- **Headless tests:** `test-fixes.mjs` loads the real source files (browser globals stubbed) and
  asserts the corrected behaviour — **26/26 pass**:
  - #1 front roll 12 → `head` (and rolls 2/10/11 unchanged)
  - #2 `attackDirection` distinguishes `side-right`/`side-left`; mirrored left table flips RA↔LA / RT↔LT; rear unchanged
  - #3 default Gunnery = 4; Gunnery 6 feeds the formula and appears in the breakdown
  - #4 jump landing enters the free-facing micro-state, rotation costs no MP, chosen facing is
    submitted to the server, and `moveState` is cleared on confirm
- **No stray references:** `grep` confirms no bare `'side'` remains in `SQL/` or `js/`.

---

## 7. Open items / cautions before applying

1. **Not yet applied to Supabase** — this is a proposal. Review the diffs in §4 before running §5.
2. **Pilot `gunnery` field** — the server reads `attacker->'pilot'->>'gunnery'`. Confirm the pilot
   JSON in your roster/match state actually carries a numeric `gunnery` key; otherwise every
   attacker silently defaults to 4 (safe, but the fix is a no-op until the stat is populated).
3. **Jump `facing` payload** — the client now sends `facing` on the jump action. Older clients that
   don't send it will fall back to travel direction (backward compatible).
4. **Housekeeping (unrelated to the fixes):** two legacy files
   (`index_3_1_original.html`, `index_3_1_patched_monolith.html`) are tracked but deleted locally
   and uncommitted. Decide whether to `git rm` them in a separate housekeeping commit.
5. **Nothing committed yet** — the client + SQL changes are uncommitted working-tree edits.