#!/usr/bin/env node
// CI check 2: cache-buster drift guard (issue #9). For every changed .js file,
// if any *.html loads it via a versioned <script src="...?v=X"> tag, the same
// commit MUST change X — browsers cache by URL and silently serve stale code.
// Base ref: $CI_BASE_REF (set by workflow) else HEAD~1; skips when unavailable.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const run = cmd => execSync(cmd, { encoding: 'utf8' }).trim();
let base = process.env.CI_BASE_REF;
if (!base) {
  const evBefore = (process.env.CI_PUSH_BEFORE || '').replace(/[^0-9a-f]/g, '');
  base = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(evBefore) ? evBefore : 'HEAD~1';
}
let changed = [];
try { changed = run(`git diff --name-only ${base} HEAD 2>/dev/null`).split('\n').filter(Boolean); }
catch { console.log('cache-buster guard: base ref unavailable, skipping'); process.exit(0); }
const jsChanged = changed.filter(f => f.endsWith('.js'));
if (!jsChanged.length) { console.log('no .js changes; guard passes vacuously'); process.exit(0); }
const violations = [];
for (const html of run('git ls-files "*.html"').split('\n').filter(Boolean)) {
  let headHtml, baseHtml;
  try { headHtml = readFileSync(html, 'utf8'); baseHtml = run(`git show ${base}:${html}`); } catch { continue; }
  for (const jsFile of jsChanged) {
    const esc = jsFile.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const headVer = [...headHtml.matchAll(new RegExp(`${esc}\\?v=([^"'\\s]+)`, 'g'))].map(m => m[1]);
    if (!headVer.length) continue; // unversioned include: convention does not apply
    const baseVer = [...baseHtml.matchAll(new RegExp(`${esc}\\?v=([^"'\\s]+)`, 'g'))].map(m => m[1]);
    for (const v of headVer) if (baseVer.includes(v)) violations.push(`${html}: ${jsFile} changed but ?v=${v} NOT bumped`);
  }
}
if (violations.length) { console.error('CACHE-BUSTER DRIFT (bump ?v= for changed files):'); violations.forEach(v => console.error(' - ' + v)); process.exit(1); }
console.log(`cache-buster guard: ${jsChanged.length} changed js file(s) carry bumped versions`);
