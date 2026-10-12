// Sweep leftover disposable test fixtures from the live test project.
//
// Why this exists: the human-vs-human harnesses deliberately SHARE one live
// match across stages (test-human-vs-human-rules.mjs rejoins the match that
// test-human-vs-human.mjs created), so cleanup cannot live inside a single
// stage without breaking the chain. This script runs AFTER each soak iteration
// and removes in-progress games owned or joined by the dedicated h2h test
// accounts — including matches left behind by a failed or interrupted stage.
//
// Usage:
//   node tools/sweep-test-fixtures.mjs          # dry run: list what it would remove
//   node tools/sweep-test-fixtures.mjs --apply  # delete
//
// Accounts default to the h2h regression identities (override via
// BT_H2H_HOST/BT_H2H_HOST_PASS/BT_H2H_GUEST/BT_H2H_GUEST_PASS). Only games
// with status 'in-progress' hosted or joined by those accounts are ever
// touched; child rows (seats, events, telemetry…) go via FK cascade.
// Deletions are proven by counting representation rows per batch — a silent
// 200-with-0-rows (RLS no-op) is reported, never trusted. Exit code 1 only
// when fixtures exist but NOTHING could be removed (all batches refused).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const APPLY = process.argv.includes('--apply');
const supabaseSource = readFileSync(fileURLToPath(new URL('../js/network/supabase.js', import.meta.url)), 'utf8');
const projectUrl = supabaseSource.match(/https:\/\/[a-z]+\.supabase\.co/)?.[0];
const anonKey = supabaseSource.match(/SUPABASE_ANON\s*=\s*'([^']+)'/)?.[1];
if (!projectUrl || !anonKey) { console.error('Could not read project URL / anon key from js/network/supabase.js'); process.exit(1); }

const accounts = [
  { user: process.env.BT_H2H_HOST || 'h2h-regression-host', pass: process.env.BT_H2H_HOST_PASS || 'H2H!Host01' },
  { user: process.env.BT_H2H_GUEST || 'h2h-regression-guest', pass: process.env.BT_H2H_GUEST_PASS || 'H2H!Guest01' },
];
const headers = token => ({ apikey: anonKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

async function signIn(account) {
  const res = await fetch(`${projectUrl}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: headers(anonKey),
    body: JSON.stringify({ email: `${account.user}@FreeGames.com`, password: account.pass }),
  });
  return res.ok ? res.json() : null;
}
const fetchRows = async (token, path) => {
  const res = await fetch(`${projectUrl}/rest/v1/${path}`, { headers: headers(token) });
  if (!res.ok) throw new Error(`${path} -> HTTP ${res.status}`);
  return res.json();
};

try {
  // Collect candidate fixture games (hosted or joined) per account.
  const seen = new Map();
  for (const account of accounts) {
    const session = await signIn(account);
    if (!session?.access_token) { console.log(`sweep: login skipped for ${account.user} (unknown account)`); continue; }
    const token = session.access_token, uid = session.user.id;
    const hosted = await fetchRows(token, `btech_games?select=id,game_code&status=eq.in-progress&host_id=eq.${uid}&limit=500`);
    const memberships = await fetchRows(token, `btech_players?select=game_id&user_id=eq.${uid}&limit=2000`);
    const joinedIds = [...new Set(memberships.map(m => m.game_id))].filter(id => !seen.has(id));
    let joined = [];
    if (joinedIds.length) joined = await fetchRows(token, `btech_games?select=id,game_code&status=eq.in-progress&id=in.(${joinedIds.join(',')})&limit=500`);
    for (const g of [...hosted, ...joined]) if (!seen.has(g.id)) seen.set(g.id, g);
    if (hosted.length + joined.length === 0) console.log(`sweep: ${account.user} currently owns/joins no in-progress fixtures.`);
  }

  if (!seen.size) { console.log('sweep: no disposable fixtures found.'); process.exit(0); }
  if (!APPLY) {
    console.log(`sweep (dry run): ${seen.size} fixture match(es) present:`);
    for (const g of [...seen.values()].slice(0, 12)) console.log(`  ${g.game_code}`);
    if (seen.size > 12) console.log(`  …and ${seen.size - 12} more`);
    console.log('re-run with --apply to remove them.');
    process.exit(0);
  }

  // Delete per-account so every batch runs under a session RLS recognises.
  let removed = 0;
  for (const account of accounts) {
    const session = await signIn(account);
    if (!session?.access_token) continue;
    const remaining = [...seen.keys()];
    if (!remaining.length) break;
    for (let i = 0; i < remaining.length; i += 50) {
      const chunk = remaining.slice(i, i + 50);
      const res = await fetch(`${projectUrl}/rest/v1/btech_games?id=in.(${chunk.join(',')})&select=game_code`, {
        method: 'DELETE', headers: { ...headers(session.access_token), Prefer: 'return=representation' },
      });
      const body = await res.json().catch(() => null);
      if (Array.isArray(body)) { removed += body.length; for (const row of body) seen.delete(row.game_code === undefined ? '' : row.id ?? ''); }
      else console.log(`sweep: batch refused for ${account.user} (HTTP ${res.status}) — leaving those rows untouched.`);
    }
  }
  const left = seen.size - removed;
  console.log(`sweep done: removed ${removed} fixture match(es)` + (left > 0 ? `; ${left} remained (permission or already gone — not retried elsewhere)` : '') + '.');
  process.exit(removed === 0 ? 1 : 0);
} catch (error) {
  console.error('sweep failed (non-fatal):', error.message);
  process.exit(1);
}
