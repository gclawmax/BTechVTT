#!/usr/bin/env node
// Career-3 source acceptance: regional state is persistent, owner-scoped and
// every settlement effect remains idempotent.
import { readFile } from 'node:fs/promises';
const root=new URL('../',import.meta.url);
const [sql,hq,roadmap,design,guide,index]=await Promise.all([
 readFile(new URL('SQL/142_career_3_regional_operations.sql',root),'utf8'),readFile(new URL('js/game/career-hq.js',root),'utf8'),readFile(new URL('docs/DEVELOPMENT_ROADMAP.md',root),'utf8'),readFile(new URL('docs/PERSISTENT_CAMPAIGN_DESIGN.md',root),'utf8'),readFile(new URL('how-to-play.html',root),'utf8'),readFile(new URL('index.html',root),'utf8')
]);
let failures=0;function check(label,condition){console.log(`${condition?'PASS':'FAIL'}  ${label}`);if(!condition)failures++;}
check('five connected curated worlds define supply, markets, maps and travel', ['galatea','outreach','solaris-vii','northwind','twycross','supply_multiplier','market_multiplier','neighbors'].every(x=>sql.includes(x)));
check('company location, campaign time and market epoch are persistent', ['current_world_id','campaign_day','market_epoch'].every(x=>sql.includes(x)));
check('regional records are RLS protected and owner readable only', sql.includes('btech_career_faction_standings ENABLE ROW LEVEL SECURITY') && sql.includes('btech_career_regional_awards ENABLE ROW LEVEL SECURITY') && sql.includes('c.user_id=auth.uid()'));
check('travel is adjacent, charged, timed and unavailable during a contract', sql.includes('btech_career_travel_quote') && sql.includes('btech_career_require_idle(company.id)') && sql.includes("campaign_day=campaign_day+") && sql.includes("credits=credits-"));
check('travel refreshes unsigned markets and contracts without touching signed work', sql.includes("status='expired' WHERE company_id=company.id AND status='available'") && sql.includes('PERFORM btech_career_seed_contracts(company.id)'));
check('local supply authoritatively changes quote components and totals', sql.includes('btech_career_service_quote_without_career3') && sql.includes("'{repair,armor_cost}'") && sql.includes("'{reload,total}'"));
check('local market prices use the pinned world multiplier', sql.includes('world.market_multiplier') && sql.includes("'world_id',world.id"));
check('new contracts carry their world, employer and opposition', ['employer_faction','opposition_faction',"'world_id',world.id"].every(x=>sql.includes(x)));
check('faction settlement is exactly once', sql.includes('btech_career_regional_awards') && sql.includes('ON CONFLICT DO NOTHING') && sql.includes('GET DIAGNOSTICS inserted=ROW_COUNT'));
check('Company HQ renders travel, local supply and faction standing', ['travelCareerCompany','Regional Operations','Local supply','career-faction-list'].every(x=>hq.includes(x)));
check('guidance and roadmap retain Career-3 completion', guide.includes('Regional Operations connects five worlds') && roadmap.includes('Career-3 adds five connected operational') && design.includes('implemented in SQL 142'));
check('the browser includes Career-3 or a later build',['20260908-career3-regions-96','20260908-career4a-arcs-97','20260908-weapon-inventory-98'].some(build=>index.includes(build)));
if(failures){console.error(`Career-3 regional regression failed: ${failures} check(s).`);process.exitCode=1;}else console.log('Career-3 regional regression passed.');
