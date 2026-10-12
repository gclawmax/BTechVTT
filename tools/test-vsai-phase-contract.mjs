// Vs-AI phase-contract audit — attaches to a live match and asserts every
// round's phases behaved as intended. This exists because BTechVTT issue #28
// ("physical attacks never resolve") passed every existing check: the suites
// assert cross-symmetry and log-shape only, never that btech_combat_events
// declarations actually RESOLVE server-side, so both failure variants slipped
// through:
//   variant A (BT-FFBQ): rounds advanced past physical_attack while rows sat
//            status='declared'; result lines were additionally invisible in
//            Vs-AI (loadResolvedPhysicalEvents() early-returns under
//            vsAiMode), so neither UI assertions nor logs could see anything.
//   variant B (BT-MZHP, BT-AZML repros): "AI activation paused after a
//            failed action" wedged physical forever — phase never advanced.
//
// Checks, evaluated per round and overall:
//   C1 authority  — every physical_attack row from a COMPLETED round is
//                   status='resolved' (no stranding when the round advances).
//   C2 liveness   — no "AI activation paused" entry appeared in gameLog.
//   C3 visibility — whenever a round had >=1 real physical attack
//                   (attack_type != pass), the game log contains at least one
//                   matching result line (hit/miss/"no damage"/…) for it.
//   C4 coverage   — across the battle at least one REAL physical exchange
//                   occurred; if none, report UNREPRESENTATIVE (a battle that
//                   never engages cannot prove anything about physical).
//
// Usage (mirrors the other live rigs):
//   node tools/static-test-server.cjs 8791          # repo root, backgrounded
//   (wait until curl byte size matches index.html)
//   node tools/test-vsai-phase-contract.mjs
// Env: SHOT_URL, BT_H2H_HOST/_PASS, BT_VS_AI_TONNAGE, BT_VS_AI_ROUNDS,
//      BT_CONTRACT_REPORT, BT_CONTRACT_REJOIN (set to a game code to audit
//      an existing match instead of creating one).
import { createRequire } from 'node:module';
import { writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('/Users/mattperkins/.hermes/hermes-agent/node_modules/playwright');

const BASE = process.env.SHOT_URL || 'http://127.0.0.1:8791/index.html';
const HOST = { user: process.env.BT_H2H_HOST || 'h2h-regression-host', pass: process.env.BT_H2H_HOST_PASS || 'H2H!Host01' };
const REJOIN_CODE = process.env.BT_CONTRACT_REJOIN || '';
const MAX_ROUNDS = Number(process.env.BT_VS_AI_ROUNDS || 10);
const REPORT_PATH = process.env.BT_CONTRACT_REPORT || path.join(tmpdir(), `vsai-contract-report-${Date.now()}.json`);

const failures = [];
const info = { gameCode: REJOIN_CODE || null, roundsAudited: 0, physicalRounds: 0, unresolvedTotal: 0, invisibleTotal: 0, notes: [] };

function check(name, condition, detail = '') {
  const ok = Boolean(condition);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

// One page-side read of everything the contract needs for rounds < current
// (completed) plus the live round. Runs inside the game page where `db`,
// `currentGameId` and `gameLog` exist.
function auditPage(page) {
  return page.evaluate(async () => {
    if (typeof db === 'undefined' || !currentGameId) return { error: 'no game context' };
    const gs = currentGameState || {};
    const { data: rows, error } = await db.from('btech_combat_events')
      .select('round,phase,sequence,status,attacker_instance_id,target_instance_id,declaration,resolution')
      .eq('game_id', currentGameId).order('round').order('phase').order('sequence');
    if (error) return { error: error.message };
    const logText = JSON.stringify((typeof gameLog !== 'undefined' ? gameLog : []).map(e => e.msg || e.message || ''));
    const mapped = (rows || []).map(r => {
      const t = (r.target_instance_id || '').slice(0, 6);
      const a = (r.attacker_instance_id || '').split('-')[0];
      // A resolved real attack must leave a RESULT-shaped line: attack word
      // (or "Physical Attack") near an outcome verb. Turn bookkeeping that
      // merely mentions the unit is not observability.
      const visible = !t ? true : new RegExp(`(kick|punch|physical attack)[^"]{0,80}\\b(hit|miss|damage|fell|knocked|no effect)\\b[^"]*${t}|${t}[^"]{0,40}(hit|miss|damage|fell|knocked)`, 'i').test(logText);
      return { round: r.round, phase: r.phase, sequence: r.sequence, status: r.status, attacker: r.attacker_instance_id, target: r.target_instance_id, attackType: r.declaration?.attack_type || 'pass', visible };
    });
    // Wedge probe: every live BattleMech has finished its physical act, yet
    // the phase sits in physical_attack — nobody can advance, nothing
    // resolves (the BT-FFBQ/AZML signature).
    return { error: null, round: gs.round, phase: gs.phase, rows: mapped, pausedInLog: /AI activation paused/i.test(logText),
      wedgeAllActed: gs.phase === 'physical_attack' && (mechInstances || []).filter(m => !m.destroyed).length > 0 && (mechInstances || []).every(m => m.destroyed || m.hasPhysicalAttacked) };
  });
}

function evaluateContract(audit) {
  // Rows from any round BELOW the live round are history: they must be resolved.
  const stranded = audit.rows.filter(r => r.status === 'declared' && r.round < audit.round);
  // A physical phase the state has already left must carry no unresolved rows
  // for its own (still-current) round either. And while still inside a
  // physical phase, if every BattleMech has already acted the phase can only
  // be wedged — those unresolved rows are stranding, not in-flight.
  if (audit.phase !== 'physical_attack' || audit.wedgeAllActed) {
    for (const r of audit.rows) if (r.round === audit.round && r.phase === 'physical_attack' && r.status === 'declared') stranded.push(r);
  }
  const realAttacks = audit.rows.filter(r => r.phase === 'physical_attack' && r.attackType !== 'pass');
  const invisible = realAttacks.filter(r => r.status === 'resolved' && r.visible === false);
  return { stranded, realAttacks, invisible };
}

const browser = await chromium.launch({ headless: true, channel: 'chrome', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  if (!REJOIN_CODE) {
    // Attach-and-audit is mode 1. Mode 2 (drive a fresh battle end-to-end and
    // assert every phase contract during play) is the planned soak stage;
    // until it lands, running without BT_CONTRACT_REJOIN is a config error,
    // not a vacuous pass.
    failures.push('BT_CONTRACT_REJOIN=<game-code> required (audit attaches to a live match; battle-driver mode pending)');
    console.log('FAIL  no BT_CONTRACT_REJOIN given — nothing audited');
  }
  // sign in + enter the match
  await page.goto(BASE, { waitUntil: 'networkidle' }).catch(() => {});
  await page.fill('#login-username', HOST.user);
  await page.fill('#login-password', HOST.pass);
  await page.click('#btn-login').catch(() => {});
  await page.waitForSelector('.screen.active:not(#login-screen)', { timeout: 20000 }).catch(() => {});
  if (REJOIN_CODE) {
    await page.waitForFunction(() => document.querySelector('#active-games-list')?.textContent.includes('BT-'), null, { timeout: 15000 }).catch(() => {});
    await page.evaluate(c => { if (typeof handleRejoinGame === 'function') handleRejoinGame(c); }, REJOIN_CODE);
    const inGame = await page.waitForFunction(() => typeof currentGameId !== 'undefined' && Boolean(currentGameId), null, { timeout: 15000 }).catch(() => false);
    if (!inGame) { console.log('FAIL  could not rejoin into ' + REJOIN_CODE); failures.push('could not rejoin'); }
    await page.waitForTimeout(9000); // let loadGameState + subscription settle
  }
  // sample contract every few seconds until round budget or finished
  let last = { round: 0, phase: '' };
  const seenRounds = new Set();
  let paused = false;
  const deadline = Date.now() + (Number(process.env.BT_CONTRACT_SECONDS || 420) * 1000);
  while (Date.now() < deadline) {
    const audit = await auditPage(page).catch(e => ({ error: String(e) }));
    if (audit.error) break;
    const { stranded, realAttacks, invisible: inv } = evaluateContract(audit);
    // Track worst-case observed state rather than per-sample accumulation:
    // a wedged match replays identical violations on every sample tick.
    if (stranded.length > info.unresolvedTotal) {
      info.unresolvedTotal = stranded.length;
      info.notes.push(`R${stranded[0].round} ${stranded[0].phase}: ${stranded.length} declared-row(s) stranded at round ${audit.round}/${audit.phase}`);
    }
    if (inv.length > info.invisibleTotal) { info.invisibleTotal = inv.length; info.notes.push(`${inv.length} resolved physical row(s) with no log trace (worst sample)`); }
    if (audit.pausedInLog) paused = true;
    for (const r of audit.rows) if (r.phase === 'physical_attack' && r.attackType !== 'pass') seenRounds.add(`attack-r${r.round}-${r.sequence}`);
    const key = `${audit.round}/${audit.phase}`;
    if (key !== `${last.round}/${last.phase}`) { info.lastPhase = key; last = { round: audit.round, phase: audit.phase }; }
    const finished = await page.evaluate(async () => {
      if (typeof db === 'undefined' || !currentGameId) return 'no-context';
      const { data } = await db.from('btech_games').select('status').eq('id', currentGameId).maybeSingle();
      return data?.status || 'unknown';
    }).catch(() => 'err');
    if (finished === 'finished' || audit.round > MAX_ROUNDS) break;
    await page.waitForTimeout(4000);
  }
  const physicalSeen = seenRounds.size;
  info.physicalRounds = physicalSeen; info.roundsAudited = last.round;

  check('C2 no AI-activation-pause wedge observed', !paused, paused ? 'gameLog contained "AI activation paused"' : '');
  check('C1 no unresolved physical/pass declarations stranded behind round advance', info.unresolvedTotal === 0, `${info.unresolvedTotal} stranded row(s); ${info.notes.slice(0, 3).join('; ')}`);
  check('C3 every real physical exchange leaves a log-visible result trace', info.invisibleTotal === 0, `${info.invisibleTotal} silent resolved row(s)`);
  check('C4 battle exercised at least one real physical exchange', physicalSeen >= 1, physicalSeen ? `${physicalSeen} real physical actions seen` : 'UNREPRESENTATIVE: no kick/punch occurred — extend rounds or force placement');
} finally {
  await browser.close();
}

const payload = { passed: failures.length === 0, ...info, failures };
await mkdir(path.dirname(REPORT_PATH), { recursive: true }).catch(() => {});
await writeFile(REPORT_PATH, JSON.stringify(payload, null, 2)).catch(() => {});
console.log(`\nReport: ${REPORT_PATH}`);
process.exit(failures.length ? 1 : 0);
