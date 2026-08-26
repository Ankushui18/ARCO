// Headless tests for FramesFigma helpers.
const fs = require('fs');
const vm = require('vm');
const src = fs.readFileSync(__dirname + '/src/frames-figma.js', 'utf8');
const sandbox = { window: undefined, document: undefined, console };
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const F = sandbox.FramesFigma;
if (!F) {
  console.error('FramesFigma not exported');
  process.exit(1);
}

let failed = 0;
function eq(name, a, b) {
  const ok = Object.is(a, b) || JSON.stringify(a) === JSON.stringify(b);
  if (!ok) {
    failed++;
    console.error('FAIL', name, 'got', a, 'want', b);
  }
}

eq('eval.plain', F.evalDim('240', 100), 240);
eq('eval.pct', F.evalDim('50%', 200), 100);
eq('eval.add', F.evalDim('+40', 100), 140);
eq('eval.sub', F.evalDim('-20', 100), 80);
eq('eval.mul', F.evalDim('*4', 100), 400);
eq('eval.div', F.evalDim('/8', 160), 20);
eq('eval.mul-pct-is-not-half', F.evalDim('*50%', 200), 10000);
eq('eval.add-pct', F.evalDim('+50%', 200), 300);
eq('eval.junk', F.evalDim('nope', 33), 33);
eq('eval.spaces', F.evalDim(' + 12 ', 8), 20);

eq('preset.iphone', F.presetName(393, 852), 'iPhone 16');
eq('preset.custom', F.presetName(111, 222), 'Frame');

const page = {
  tops: ['a', 'b'],
  nodes: {
    a: { id: 'a', type: 'frame', x: 0, y: 0, w: 400, h: 400, children: ['c'], visible: true, _w: { x: 0, y: 0, w: 400, h: 400 } },
    b: { id: 'b', type: 'rect', x: 500, y: 0, w: 40, h: 40, children: [] },
    c: { id: 'c', type: 'frame', x: 20, y: 20, w: 100, h: 100, children: [], visible: true, parent: 'a', _w: { x: 20, y: 20, w: 100, h: 100 } },
  },
};
eq('deep.outside', F.deepestFrameAt(page, 900, 900, null), null);
eq('deep.top', F.deepestFrameAt(page, 10, 10, null).id, 'a');
eq('deep.nested', F.deepestFrameAt(page, 50, 50, null).id, 'c');
eq('deep.skip-self', F.deepestFrameAt(page, 50, 50, 'c').id, 'a');

if (failed) {
  console.error(failed + ' FRAME TESTS FAILED');
  process.exit(1);
}
console.log('ALL FRAME TESTS PASSED');
