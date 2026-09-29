// ── TEAM MODEL ──────────────────────────────────────────
// Canonical seat → team → force resolution for Coop Skirmish 1-a.
//
// The engine runs on two opposing forces keyed '1' (friendly) and '2'
// (opponent): initiative, victory scoring, minefield reveal and objective
// scores are all per-FORCE. Per-seat data (rosters, hangars, deployment
// positions, C3, unit owner) is per-SEAT. The mapping between a seat and its
// force is stored exactly once in state.team_assignments (written by the
// creating client at match creation; the authoritative server reader is
// btech_seat_team in SQL/160).
//
// This module is the SINGLE client-side place that mapping is interpreted.
// No other code may infer a seat's force from seat-number arithmetic — every
// "which side is this seat / unit on" decision goes through here. That is what
// lets two humans share team A (seats 1 & 2 → force '1') while the AI holds
// team B (seat 3 → force '2'), with zero changes to the two-force engine.
//
// team_assignments shape:
//   Coop 1-a : { "A": [1, 2], "B": [3] }
//   Skirmish : { "A": [1], "B": [2] }     (seat 2 may be the AI)
//   Vs AI    : { "A": [1], "B": [2] }
//
// Bump this on every change to team-model.js so browser caches never mask a
// fix (the ?v= query strings in index.html are set from this constant).
const BT_TEAM_MODEL_VERSION = 'coop-1a-2';
//
// Legacy games saved before this field existed have no team_assignments; the
// model then falls back to { seat 1 → A, seat 2 → B }, which is exactly the
// historical seat==force behaviour. This lenient fallback is deliberate and
// scoped to the client: the server helper (btech_seat_team) stays fail-closed
// because it gates new coop validation, RLS and the sealed report, where a
// missing assignment must be an error, not a guess.

const BT_TEAM = Object.freeze({ FRIENDLY: 'A', ENEMY: 'B' });
// Engine force key for each team. Team A is force '1', team B is force '2'.
const BT_TEAM_FORCE = Object.freeze({ A: '1', B: '2' });

function _btNormaliseSeat(value) {
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

// Parse state.team_assignments into a { seat: team } map. Returns null when the
// field is absent, malformed, or a seat appears on both teams, so callers can
// apply the legacy fallback. Never throws on bad input.
function btParseTeamAssignments(state) {
  const ta = state && state.team_assignments;
  if (!ta || typeof ta !== 'object' || Array.isArray(ta)) return null;
  const seatToTeam = {};
  for (const team of [BT_TEAM.FRIENDLY, BT_TEAM.ENEMY]) {
    const seats = ta[team];
    if (!Array.isArray(seats)) return null;
    for (const raw of seats) {
      const seat = _btNormaliseSeat(raw);
      if (seat == null) return null;
      if (Object.prototype.hasOwnProperty.call(seatToTeam, seat)) return null; // ambiguous
      seatToTeam[seat] = team;
    }
  }
  return Object.keys(seatToTeam).length ? seatToTeam : null;
}

// Build a fully-resolved, immutable team model for a parsed game state.
function btBuildTeamModel(state) {
  const explicit = btParseTeamAssignments(state);
  const seatToTeam = explicit || { 1: BT_TEAM.FRIENDLY, 2: BT_TEAM.ENEMY };
  const seats = Object.keys(seatToTeam).map(Number).sort((a, b) => a - b);
  const teamSeats = { [BT_TEAM.FRIENDLY]: [], [BT_TEAM.ENEMY]: [] };
  for (const seat of seats) teamSeats[seatToTeam[seat]].push(seat);

  const teamOfSeat = (seat) => {
    const n = _btNormaliseSeat(seat);
    return n != null ? seatToTeam[n] || null : null;
  };
  const forceOfSeat = (seat) => {
    const t = teamOfSeat(seat);
    return t ? BT_TEAM_FORCE[t] : null;
  };
  const enemyForceOfSeat = (seat) => {
    const t = teamOfSeat(seat);
    return t ? BT_TEAM_FORCE[t === BT_TEAM.FRIENDLY ? BT_TEAM.ENEMY : BT_TEAM.FRIENDLY] : null;
  };
  const isEnemySeat = (a, b) => {
    const ta = teamOfSeat(a), tb = teamOfSeat(b);
    return ta != null && tb != null && ta !== tb;
  };

  return {
    source: explicit ? 'explicit' : 'legacy',
    seatToTeam,
    teamSeats,
    seats,
    teamOfSeat,
    forceOfSeat,
    enemyForceOfSeat,
    isEnemySeat,
    friendlyForce: BT_TEAM_FORCE[BT_TEAM.FRIENDLY], // '1'
    enemyForce: BT_TEAM_FORCE[BT_TEAM.ENEMY]        // '2'
  };
}

// Current match's team model, refreshed whenever game state is loaded/synced.
let currentTeamModel = null;
function refreshCurrentTeamModel(state) {
  currentTeamModel = btBuildTeamModel(state || {});
  return currentTeamModel;
}
// Safe no-op default: with nothing loaded, behaves exactly like the historical
// seat==force model (seat 1 → '1', seat 2 → '2').
function getCurrentTeamModel() {
  return currentTeamModel || btBuildTeamModel({});
}
function btSeatsOfTeam(model, team) {
  return (model && model.teamSeats && model.teamSeats[team]) || [];
}

// A unit's force key ('1' friendly / '2' opponent) from its per-seat owner.
// This is the one place a unit is resolved to a FORCE; elsewhere the engine
// reasons per-SEAT (turns, reactions, C3, spotlight), which is what lets two
// same-force players each control their own units. Unknown seat → null.
function forceOfUnit(mech, model) {
  const m = model || getCurrentTeamModel();
  return mech ? m.forceOfSeat(mech.owner) : null;
}

// Opposing-force test between two units. Replaces the historical
// `a.owner !== b.owner`, which assumes every seat is its own force. In coop
// two same-force seats (1 & 2) are no longer enemies of each other.
function isEnemyUnit(a, b, model) {
  const m = model || getCurrentTeamModel();
  const fa = a ? m.forceOfSeat(a.owner) : null;
  const fb = b ? m.forceOfSeat(b.owner) : null;
  return fa != null && fb != null && fa !== fb;
}

// All seats that belong to a given force key ('1' or '2').
function btSeatsOfForce(model, force) {
  const m = model || getCurrentTeamModel();
  const team = force === '1' ? BT_TEAM.FRIENDLY : force === '2' ? BT_TEAM.ENEMY : null;
  return team ? m.teamSeats[team] : [];
}

// Opposite force key from a unit (from the AI's viewpoint): its own force vs
// the enemy force, resolved through the team model rather than 1↔2 arithmetic.
function forceOpposite(unit, model) {
  const m = model || getCurrentTeamModel();
  const f = unit ? m.forceOfSeat(unit.owner) : null;
  return f === '1' ? '2' : f === '2' ? '1' : null;
}