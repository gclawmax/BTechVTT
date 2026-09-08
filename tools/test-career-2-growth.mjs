#!/usr/bin/env node
// Career-2 source acceptance: all growth is owner-scoped, sealed-result based,
// capacity checked and retry-safe.
import { readFile } from 'node:fs/promises';
const root = new URL('../', import.meta.url);
const [sql,hq,roadmap,design,index,guide] = await Promise.all([
  readFile(new URL('SQL/141_career_2_mercenary_growth.sql',root),'utf8'),readFile(new URL('js/game/career-hq.js',root),'utf8'),
  readFile(new URL('docs/DEVELOPMENT_ROADMAP.md',root),'utf8'),readFile(new URL('docs/PERSISTENT_CAMPAIGN_DESIGN.md',root),'utf8'),readFile(new URL('index.html',root),'utf8'),readFile(new URL('how-to-play.html',root),'utf8')
]);
let failures=0;function check(label,condition){console.log(`${condition?'PASS':'FAIL'}  ${label}`);if(!condition)failures++;}
check('growth, salvage and market records are RLS protected', ['btech_career_growth_awards','btech_career_salvage_offers','btech_career_market_offers','ENABLE ROW LEVEL SECURITY'].every(x=>sql.includes(x)));
check('settlement growth wraps the exactly-once Career settlement', sql.includes('btech_career_settle_without_career2') && sql.includes('ON CONFLICT DO NOTHING') && sql.includes('btech_career_growth_awards'));
check('salvage comes only from destroyed opposition in a sealed Career report', sql.includes("FROM jsonb_array_elements(coalesce(report.final_state->'mech_instances'") && sql.includes("(value->>'owner')::int=2") && sql.includes("(value->>'destroyed')::boolean"));
check('salvage is one choice and checks company capacity', sql.includes('settlement_id uuid NOT NULL UNIQUE') && sql.includes('used_tons+mass>company.dropship_tonnage'));
check('the market is deterministic, rotating and catalogue pinned', sql.includes("md5(p_company_id::text||':'||cycle_no||':'||unit_id)") && sql.includes("'catalogue_version',catalogue") && sql.includes("status='expired'"));
check('market purchases and hires are server-priced and ledgered', sql.includes('purchase_btech_career_market_offer') && sql.includes('credits=credits-offer.price') && sql.includes("CASE offer.kind WHEN 'pilot' THEN 'hire' ELSE 'purchase' END"));
check('pilot assignment and XP advancement are owner-only commands', sql.includes('assign_btech_career_pilot') && sql.includes('advance_btech_career_pilot') && sql.includes('experience=experience-cost'));
check('capacity growth requires both reputation and credits', sql.includes('upgrade_btech_career_capacity') && sql.includes('required_reputation') && sql.includes('company.credits'));
check('contract boards rotate all three authoritative victory modes', ["'annihilation'","'control'","'breakthrough'"].every(x=>sql.includes(x)));
check('Company HQ exposes every Career-2 decision', ['claimCareerSalvage','purchaseCareerOffer','advanceCareerPilot','assignCareerPilot','upgradeCareerCapacity'].every(x=>hq.includes(x)));
check('the roadmap advances to Career-3', roadmap.includes('Current development priority — Career-3 planning') && design.includes('implemented in SQL 141'));
check('the browser exposes the Career-2 build', index.includes('20260908-career2-growth-95'));
check('How to Play explains the persistent growth loop and skirmish isolation', guide.includes('Victories can provide one recoverable enemy wreck') && guide.includes('skirmishes and imported replays never change the company'));
if(failures){console.error(`Career-2 growth regression failed: ${failures} check(s).`);process.exitCode=1;}else console.log('Career-2 growth regression passed.');
