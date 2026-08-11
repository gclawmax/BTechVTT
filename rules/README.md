# BT-VTT Quick-Start Rules --- Token-Optimised Development Set

These Markdown files are a compact, implementation-oriented summary of
the supplied BattleTech Beginner Box Quick-Start Rules.

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
`06_damage_rules.md`

### Unit/data work

Use: 1. `07_units_and_records.md`

### Scenario/setup work

Use: 1. `08_beginner_scenario.md`

## Token-saving principle

The rule summaries are deliberately: - implementation-oriented -
redundant only where useful for a coding task - free of flavour,
examples and prose that do not affect implementation - separated by
concern - explicit about values that are easy to misread

The source PDF remains the authority for resolving anything not
represented here.

## Recommended development workflow

For each feature, give the coding LLM: 1. The smallest relevant rules
file(s). 2. The smallest relevant VTT source file(s). 3. A precise task.
4. Any current bug/error output.

Avoid giving the assistant the whole rulebook and whole application
unless the task genuinely requires system-wide reasoning.
