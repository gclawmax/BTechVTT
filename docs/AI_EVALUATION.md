# AI-7 evaluation and tuning

AI-7 is a deterministic, catalogue-backed planner tournament. It exercises the
production AI against both sides of a duel across supported BattleMechs, maps,
victory conditions, difficulties and personalities. It writes no game rows to
Supabase, so large evaluation batches do not fill the retained-match list.

The evaluator uses expected damage to advance its private tournament state.
It is intended to compare decision quality and expose illegal or stalled plans;
the dedicated Play-vs-AI live acceptances remain responsible for proving that
real server dice, damage, ammunition and phase authority accept those plans.
Objective modes use two BattleMechs per side. Control is scored after Heat;
Breakthrough requires two different units to enter the enemy deployment zone,
matching the live mode contract.

## Run it

From the project folder:

```sh
node tools/run-ai-evaluation.mjs
```

The default run performs 12 duels of up to 12 rounds. A larger release sample:

```sh
BT_AI7_RUNS=100 BT_AI7_MAX_ROUNDS=20 BT_AI7_SEED=release-1 node tools/run-ai-evaluation.mjs
```

Useful options:

- `BT_AI7_RUNS` — 1–500 deterministic duels.
- `BT_AI7_MAX_ROUNDS` — 1–50 rounds before remaining force strength decides.
- `BT_AI7_SEED` — repeatable unit and initiative selection.
- `BT_AI7_RULESET` — catalogue eligibility ruleset; defaults to `advanced_3060`.
- `BT_AI7_REPRESENTATIVES` — maximum routine replays retained; defaults to 6.
- `BT_AI7_REPORT_DIR` — output folder; defaults to the system temporary folder.
- `BT_AI7_BASELINE` — path to an earlier `ai7-summary.json` for win-rate deltas.
- `SHOT_URL` — evaluate a deployed build instead of starting the local page.

The dedicated evaluation account only reads the catalogue. No lobby or match
is created. The runner reports the build and source URL so local and deployed
results cannot be confused.

## Measurements

The consolidated report records:

- illegal action contracts and missing-action stalls;
- average and maximum planner decision time;
- damage per generated heat and overheated rounds;
- legal weapon opportunities left unused;
- objective points and victory results;
- results grouped by difficulty, personality, map and victory condition;
- win-rate changes from an optional prior baseline.

Timing is observational and naturally varies by machine. Unit selection,
initiative order, plans and simulated outcomes remain repeatable for a fixed
build, seed and catalogue.

## Retention

`ai7-summary.json` contains compact statistics for every duel. The `replays/`
folder contains every failed duel plus a bounded, diverse sample of successful
duels. Routine successful replays are discarded. Reusing the output folder
replaces its generated replay folder, preventing an unbounded local backlog.
