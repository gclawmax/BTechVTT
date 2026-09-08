#!/usr/bin/env node
// Career-4a source acceptance: origin packages are immutable and arc progress
// can only advance once from a sealed Career settlement.
import { readFile } from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const [sql,hq,avatar,index,roadmap,design,guide]=await Promise.all([
 readFile(new URL('SQL/143_career_4a_origins_and_campaign_arcs.sql',root),'utf8'),readFile(new URL('js/game/career-hq.js',root),'utf8'),readFile(new URL('js/game/career-avatar.js',root),'utf8'),readFile(new URL('index.html',root),'utf8'),readFile(new URL('docs/DEVELOPMENT_ROADMAP.md',root),'utf8'),readFile(new URL('docs/PERSISTENT_CAMPAIGN_DESIGN.md',root),'utf8'),readFile(new URL('how-to-play.html',root),'utf8')
]);
let failures=0;function check(label,condition){console.log(`${condition?'PASS':'FAIL'}  ${label}`);if(!condition)failures++;}
check('company origins are backfilled, constrained and immutable after founding',sql.includes("origin IN('Independent','Inner Sphere','Clan')")&&sql.includes('A Career company origin is fixed after founding')&&avatar.includes('origin.disabled = Boolean(avatar)'));
check('three origin arcs contain exactly three operations',sql.includes('jsonb_array_length(steps)=3')&&['mercenary-ascendant','border-guard','trial-by-fire'].every(x=>sql.includes(x)));
check('arc state and awards are RLS protected',sql.includes('btech_career_company_arcs ENABLE ROW LEVEL SECURITY')&&sql.includes('btech_career_arc_awards ENABLE ROW LEVEL SECURITY'));
check('new origins choose their appropriate starting worlds',sql.includes("WHEN 'Clan' THEN 'twycross'")&&sql.includes("WHEN 'Inner Sphere' THEN 'northwind'")&&sql.includes("ELSE 'galatea'"));
check('Clan origin installs both supported Puma starter records',sql.includes("'adder-prime'")&&sql.includes("'puma-adder-a'")&&sql.includes('btech_career_fresh_condition'));
check('regular contracts remain alongside one featured arc operation',sql.includes("'arc_featured',arc.status='active'")&&sql.includes('Veteran Objective Raid'));
check('arc advancement requires the matching signed step and a victory',sql.includes("arc_featured')::boolean")&&sql.includes('winner=1')&&sql.includes("company_arc.current_step=(contract.terms->>'arc_step')::int"));
check('arc settlement is exactly once and truthful on retry',sql.includes('btech_career_arc_awards')&&sql.includes('ON CONFLICT DO NOTHING')&&sql.includes('GET DIAGNOSTICS inserted=ROW_COUNT')&&sql.includes('award.settlement_id IS NOT NULL'));
check('a won or failed campaign operation immediately offers the appropriate next attempt',sql.includes("contract.terms||jsonb_build_object('arc_step',company_arc.current_step")&&sql.includes("company_arc.status='active'"));
check('origin preview and Company HQ explain the selected arc',avatar.includes('Trial by Fire arc')&&hq.includes('campaignArc')&&hq.includes('Campaign operation:'));
check('guidance documents the permanent origin choice',guide.includes('permanently chooses an Independent, Inner Sphere, or Clan origin'));
check('roadmap separates consensual PvP as Career-4b',roadmap.includes('Current development priority — Career-4b PvP tender design')&&design.includes('Career-4b — consensual PvP tenders'));
check('the browser exposes the Career-4a build',index.includes('20260908-career4a-arcs-97'));
if(failures){console.error(`Career-4a origin/arc regression failed: ${failures} check(s).`);process.exitCode=1;}else console.log('Career-4a origin/arc regression passed.');
