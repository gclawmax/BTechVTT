# BT-VTT Rules --- Token-Optimised Development Set

These Markdown files are compact, implementation-oriented references for
BT-VTT. Files `00`--`08` summarise the supplied BattleTech Beginner Box
Quick-Start Rules. Files `09`--`12` record the currently relevant Total
Warfare expansion scope and implementation boundaries.

The complete Total Warfare PDF is a local reference only and is deliberately
ignored by Git. The Gemini-generated extraction material is also kept locally
and ignored; its useful content has been distilled into the tracked files
below. Generated pseudocode is a planning aid, not a rules authority.

## Recommended use with LLM coding assistants

Do NOT normally provide the entire set.

Load only the files relevant to the task.

### Movement work

Use: 1. `01_movement_rules.md` 2. `02_movement_engine_checklist.md` 3.
`03_movement_dice.md`

Also provide the relevant current VTT source file(s).

### Phase/state work

Use: 1. `00_sequence_of_play.md` 2. the relevant phase/state source file

### Combat work

Use: 1. `04_combat_rules.md` 2. `05_line_of_sight_and_range.md` 3.
`06_damage_rules.md` 4. the relevant `10` or `11` Total Warfare file

### Total Warfare expansion work

Use only the relevant focused file:

1. `09_total_warfare_turn_and_facing.md` for initiative, activation, and
   torso/leg facing.
2. `10_total_warfare_weapon_attacks.md` for declarations, arcs, and weapon
   resolution.
3. `11_total_warfare_damage_heat.md` for physical attacks, damage, criticals,
   and heat.
4. `12_total_warfare_unit_data.md` for unit records, equipment data, and any
   future construction/import work.
5. `14_weathered_advanced_terrain.md` for ice, weathered ground, swamp,
   bridges, and magma.
6. `15_arm_flipping_and_improvised_clubs.md` for reversed arm weapon arcs and
   improvised tree/girder clubs.
7. `16_custom_map_and_scenario_editor.md` for authored terrain, elevation,
   deployment zones and objectives.
8. `17_targeting_computers_and_electronic_warfare.md` for Targeting Computer
   modifiers and aimed shots, C3/C3i range sharing, ECM and Active Probes.

### Unit/data work

Use: 1. `07_units_and_records.md`

### Scenario/setup work

Use: 1. `08_beginner_scenario.md`

## Token-saving principle

The rule summaries are deliberately: - implementation-oriented -
redundant only where useful for a coding task - free of flavour,
examples and prose that do not affect implementation - separated by
concern - explicit about values that are easy to misread

The relevant published rules text remains the authority for resolving anything
not represented here. Before implementing an exact Total Warfare mechanic,
verify the corresponding local PDF section rather than relying on the older
Quick-Start summaries or generated pseudocode.

## Recommended development workflow

For each feature, give the coding LLM: 1. The smallest relevant rules
file(s). 2. The smallest relevant VTT source file(s). 3. A precise task.
4. Any current bug/error output.

Avoid giving the assistant the whole rulebook and whole application
unless the task genuinely requires system-wide reasoning.
