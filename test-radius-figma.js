const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync(__dirname + '/src/radius-figma.js', 'utf8');
const sandbox = { window: undefined, document: undefined, console };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const R = sandbox.RadiusFigma;
if (!R) { console.error('RadiusFigma missing'); process.exit(1); }

let failed = 0;
function eq(name, a, b, eps) {
  const ok = typeof a === 'number' && typeof b === 'number'
    ? Math.abs(a - b) < (eps || 1e-6)
    : JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { failed++; console.error('FAIL', name, a, b); }
}

const z = R.cornerParams(20, 0, 100);
eq('s0.p-is-R', z.p, 20);
eq('s0.arc-is-R', z.arc, 20, 1e-4);

const ios = R.cornerParams(20, 0.6, 100);
eq('ios.p-gt-R', ios.p > 20, true);
eq('ios.arc-lt-R', ios.arc < 20, true);

eq('clamp.half', R.clampRadii(100, 80, [80, 80, 0, 0]), [40, 40, 0, 0]);
eq('clamp.pair', R.clampRadii(100, 200, [60, 60, 0, 0]), [50, 50, 0, 0]);

const d = R.svgPath(200, 200, [24, 24, 24, 24], 0.6);
eq('svg.has-arc', /A /.test(d), true);
eq('svg.closed', /Z$/.test(d.trim()), true);

const flat = R.svgPath(200, 200, [0, 0, 0, 0], 0.6);
eq('flat.no-arc', /A /.test(flat), false);

eq('supports.rect', R.supportsRadius({ type: 'rect' }), true);
eq('supports.line', R.supportsRadius({ type: 'line' }), false);

if (failed) { console.error(failed + ' RADIUS TESTS FAILED'); process.exit(1); }
console.log('ALL RADIUS TESTS PASSED');
