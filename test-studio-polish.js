const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync(__dirname + '/src/studio-polish.js', 'utf8');
const sandbox = { window: undefined, document: undefined, console };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const S = sandbox.StudioPolish;
if (!S) { console.error('StudioPolish missing'); process.exit(1); }

let failed = 0;
function eq(name, a, b) {
  const ok = typeof a === 'number' && typeof b === 'number'
    ? Math.abs(a - b) < 1e-6
    : a === b;
  if (!ok) { failed++; console.error('FAIL', name, a, b); }
}

eq('1x', S.parseScale('1x', 100, 100), 1);
eq('2x', S.parseScale('2x', 100, 100), 2);
eq('200w', S.parseScale('200w', 100, 50), 2);
eq('100h', S.parseScale('100h', 200, 50), 2);
eq('plain', S.parseScale('3', 10, 10), 3);
eq('fmt.1', S.formatScale(1), '1x');
eq('fmt.2', S.formatScale(2), '2x');
eq('fmt.spec', S.formatScale('200w'), '200w');

if (failed) { console.error(failed + ' POLISH TESTS FAILED'); process.exit(1); }
console.log('ALL POLISH TESTS PASSED');
