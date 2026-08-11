# Split version — refactor notes

This is a **safe first-pass split**, not a behavioural rewrite.

The original `index_3_1.html` was a monolith containing HTML, CSS and JavaScript.
The split preserves the original JavaScript sections rather than rewriting logic,
so behaviour can be tested before further refactoring.

## Current boundaries

- `css/main.css` — all original inline CSS
- `js/network/supabase.js` — Supabase configuration/client
- `js/core/state.js` — global state declarations
- `js/core/game-log.js` — game log
- `js/core/auth-ui.js` — screen/auth functions
- `js/network/lobby.js` — lobby/realtime player management
- `js/game/phases.js` — phase/initiative logic
- `js/game/board.js` — board, unit data and rendering
- `js/movement/movement.js` — movement controls/rules/UI
- `js/ai/ai-opponent.js` — current AI system
- `js/app.js` — application initialisation
- `js/core/legacy.js` — anything not safely assigned by the existing section markers

## Important

Do not delete `legacy.js` yet. Some functions cross the old section boundaries
through globals. The next step should be a dependency-aware refactor, moving
functions only after the current split version is confirmed working.

## Recommended next extraction

1. `board.js` → `data/units.js` + `game/hex-grid.js` + `ui/map.js`
2. `movement.js` → `movement-rules.js` + `movement-controller.js` + `ui/movement-panel.js`
3. `phases.js` → `phase-state.js` + `initiative.js` + `phase-controller.js`
4. `ai-opponent.js` → eventually remove from core game logic and replace with a
   phase-specific algorithmic opponent module.
5. `legacy.js` → eliminate function-by-function.

The goal is that an LLM working on Movement eventually needs only the movement
files, phase interface, relevant game state, and the movement rules Markdown.
