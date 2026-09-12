const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const source = fs.readFileSync(require('node:path').resolve(__dirname, '../js/game/mech-designer.js'), 'utf8');
const sandbox = { console, structuredClone, setTimeout, clearTimeout };
vm.createContext(sandbox);
vm.runInContext(`${source}\nthis.newCustomDesignForTest = newCustomDesign; this.calculateCustomDesignForTest = calculateCustomDesign;`, sandbox);

const design = sandbox.newCustomDesignForTest();
assert.equal(sandbox.calculateCustomDesignForTest(design).valid, true);
design.weapons.push({ key: 'ac5', location: 'ra' });
assert.match(sandbox.calculateCustomDesignForTest(design).errors.join(' '), /needs ammunition/);
design.ammo.push({ type: 'ac5', location: 'rt', bins: 1 });
assert.equal(sandbox.calculateCustomDesignForTest(design).valid, true);
design.electronics.push({ key: 'case', location: 'rt' });
assert.equal(sandbox.calculateCustomDesignForTest(design).valid, true);
assert.equal(sandbox.calculateCustomDesignForTest(design).weights.electronics, .5);
design.armor.head = 10;
assert.match(sandbox.calculateCustomDesignForTest(design).errors.join(' '), /Head armour cannot exceed 9/);
console.log('PASS MechLab validates legal construction, ammunition, and armour limits before save');
