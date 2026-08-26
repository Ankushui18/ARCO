// Headless tests for PixelSnap math (no DOM, no canvas).
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync(__dirname + '/src/pixel-snap.js', 'utf8');
const sandbox = { window: undefined, document: undefined, console };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const P = sandbox.PixelSnap;
if (!P) {
  console.error('PixelSnap not exported');
  process.exit(1);
}

let failed = 0;
function eq(name, a, b) {
  const ok = JSON.stringify(a) === JSON.stringify(b);
  if (!ok) {
    failed++;
    console.error('FAIL', name, 'got', a, 'want', b);
  }
}

eq('px.half-up', P.px(10.5), 11);
eq('px.half-down', P.px(10.4), 10);
eq('px.neg', P.px(-1.6), -2);
eq('px.nan', P.px(NaN), 0);

const n = { x: 10.4, y: 20.6, w: 99.2, h: 40.8 };
P.snapBox(n);
eq('snapBox', { x: n.x, y: n.y, w: n.w, h: n.h }, { x: 10, y: 21, w: 99, h: 41 });

const tiny = { x: 0.2, y: 0.2, w: 0.3, h: 0.3 };
P.snapBox(tiny);
eq('snapBox.min1', { w: tiny.w, h: tiny.h }, { w: 1, h: 1 });

const onlyXY = { x: 3.6, y: 7.1 };
P.snapXY(onlyXY);
eq('snapXY.keeps-no-size', { x: onlyXY.x, y: onlyXY.y, w: onlyXY.w }, { x: 4, y: 7, w: undefined });

eq('create.se', P.snapCreateRect(10.4, 20.4, 50.6, 80.2, false), { x: 10, y: 20, w: 40, h: 60 });
eq('create.nw', P.snapCreateRect(50.2, 80.2, 10.4, 20.4, false), { x: 10, y: 20, w: 40, h: 60 });
eq('create.square', P.snapCreateRect(0, 0, 10.2, 4.2, true), { x: 0, y: 0, w: 10, h: 10 });

eq('fmt.int', P.fmtNum(12), '12');
eq('fmt.frac', P.fmtNum(12.34), '12.34');
eq('fmt.almost', P.fmtNum(12.0000001), '12');

eq('snapOn.default', P.snapOn({ view: {} }), true);
eq('snapOn.off', P.snapOn({ view: { snapPixel: false } }), false);
eq('gridOn.default', P.gridOn({ view: {} }), true);
eq('gridOn.off', P.gridOn({ view: { pixelGrid: false } }), false);

if (failed) {
  console.error(failed + ' PIXEL SNAP TESTS FAILED');
  process.exit(1);
}
console.log('ALL PIXEL SNAP TESTS PASSED');
