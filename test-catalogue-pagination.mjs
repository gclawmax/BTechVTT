// Confirms that catalogue loading reads every PostgREST page, not only the
// first 1,000 rows (which omitted Clan critical-slot layouts in production).
import fs from 'node:fs';
import vm from 'node:vm';

const pages = [Array.from({ length: 1000 }, (_, index) => ({ index })), Array.from({ length: 55 }, (_, index) => ({ index: index + 1000 }))];
const calls = [];
const sandbox = {
  db: {
    from: () => ({
      select: () => ({
        eq: () => ({
          range: async (from, to) => {
            calls.push({ from, to });
            const page = pages.shift() || [];
            return { data: page, error: null };
          }
        })
      })
    })
  },
  BT_UNIT_CATALOGUE: {}, BT_WEAPONS: {}, BT_CRITICAL_LAYOUTS: {}, databaseSupportedUnitIds: new Set(),
  BT_LOCATION_NAMES: {}, console, Set, Object, Array, Promise
};
vm.createContext(sandbox);
const source = fs.readFileSync('js/game/unit-catalogue.js', 'utf8');
vm.runInContext(source + '\nthis.fetchCatalogueRowsForTest = fetchCatalogueRows;', sandbox);
const rows = await sandbox.fetchCatalogueRowsForTest('btech_catalogue_critical_slots', 'unit_id', 'test');
if (rows.length !== 1055 || calls.length !== 2 || calls[0].from !== 0 || calls[1].from !== 1000) {
  throw new Error(`Pagination failed: rows=${rows.length}, calls=${JSON.stringify(calls)}`);
}
console.log('Catalogue pagination test passed');
