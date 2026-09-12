const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const sql = fs.readFileSync(path.resolve(__dirname, '../SQL/156_custom_mechlab_case.sql'), 'utf8');
assert.match(sql, /WHEN 'case' THEN '\{"name":"CASE","weight":0\.5,"slots":1,"tech":"inner_sphere","label":"CASE"\}'/);
assert.match(sql, /btech_custom_electronic/);
assert.match(sql, /btech_location_has_case/);
console.log('PASS CASE is a legal Inner Sphere custom-design component and remains connected to the authoritative CASE resolver');
