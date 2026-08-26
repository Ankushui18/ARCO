const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync(__dirname + '/src/handles-figma.js', 'utf8');
const sandbox = { window: undefined, document: undefined, console };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const H = sandbox.HandlesFigma;
if (!H) { console.error('HandlesFigma missing'); process.exit(1); }

let failed = 0;
function eq(name, a, b) {
  const ok = typeof a === 'number' && typeof b === 'number'
    ? Math.abs(a - b) < 1e-9
    : JSON.stringify(a) === JSON.stringify(b);
  if (!ok) { failed++; console.error('FAIL', name, a, b); }
}

eq('wrap.pi', H.wrapPi(Math.PI + 0.1), -Math.PI + 0.1);
eq('snap.0', H.snap15(0), 0);
eq('snap.14', H.snap15(14 * Math.PI / 180), 15 * Math.PI / 180);

const p = H.rotatePt(10, 0, 0, 0, Math.PI / 2);
eq('orbit.x', p.x, 0);
eq('orbit.y', p.y, 10);

const page = {
  nodes: {
    a: { _w: { x: 0, y: 0, w: 10, h: 10 } },
    b: { _w: { x: 20, y: 5, w: 10, h: 10 } },
  },
};
eq('union', H.unionWorld(page, ['a', 'b']), { x: 0, y: 0, w: 30, h: 15 });

if (failed) { console.error(failed + ' HANDLE TESTS FAILED'); process.exit(1); }
console.log('ALL HANDLE TESTS PASSED');
