# BTechVTT

A BattleTech tabletop simulator built as a browser-based VTT (Virtual Tabletop).

## Architecture

- **Frontend:** Vanilla HTML/CSS/JS — single-page canvas game
- **Backend:** Supabase (PostgreSQL + Auth + Realtime)
- **Design:** Flat-top hex grid, odd-q offset coordinates, canon BattleTech unit data

## Project Roadmap

### Phase 1 — Hex Grid + Unit Placement ✅
- Flat-top hex grid rendering (odd-q offset layout)
- Canon unit data loading (Atlas AS7-D, Hunchback HBK-4G, Locust LCT-1V)
- Unit token placement with facing indicators
- Click-to-inspect unit detail panel
- Hex code labels (standard BT map convention)
- Mobile-responsive layout

### Phase 2 — Movement
- Pathfinding on hex grid
- Walk/run/jump movement ranges
- Facing changes during movement
- Movement preview/highlighting

### Phase 3 — Combat
- To-hit resolution (range, facing, armor location)
- Damage application to armor/structure
- Heat management and heat sink management

### Phase 4 — Multiplayer Sync
- Real-time state synchronization via Supabase Realtime
- Turn management
- Shared battlefield state

### Phase 5 — Full Unit Roster
- Complete BattleTech unit database in Supabase
- Unit creation/editing tools
- Lance organization

### Phase 6 — Supabase Backend
- Auth system
- Database schema for units, battles, player profiles
- API layer for game state

### Phase 7 — Polish & Deployment
- Sound effects and visual polish
- Map editor
- Campaign mode
- Production deployment

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vanilla JS, HTML5 Canvas, CSS Grid |
| Backend | Supabase (PostgreSQL, Auth, Realtime) |
| Hosting | Vercel / Netlify (static frontend) |
| CI | GitHub Actions |

## Getting Started

```bash
# Clone the repo
git clone https://github.com/gclawmax/BTechVTT.git
cd BTechVTT

# Open index.html in a browser
# No build step required — runs directly from source
```

## Automated battle regression

Run the complete browser-based battle suite, including Human-vs-Human and
Vs-AI matches, with one command:

```bash
node tools/run-battle-regression.mjs
```

It uses the existing dedicated regression accounts by default and creates
disposable matches. `BT_BATTLE_SUITE=quick` skips the longer focused rules
battle; `BT_BATTLE_SUITE=list` shows the planned checks without running them.

## Design Notes

- **Hex coordinate system:** Flat-top hexes, odd-q vertical offset layout (matching printed BattleTech maps)
- **Hex codes:** 2-digit column + 2-digit row (e.g., "0304")
- **Facing:** 0–300° in 60° increments, mapped to axial neighbor vectors
- **Unit data:** Hand-entered stat blocks matching canon BattleTech rules
- **Color scheme:** Minimalist "phosphor" aesthetic — light background, dark text, amber accents

## License

Private repository — all rights reserved.

Some supported unit records are derived from MegaMek Data and are separately
provided under CC BY-NC-SA 4.0; see [MegaMek data attribution](docs/MEGAMEK_ATTRIBUTION.md).
