// Regression test: figconv.js's applyFigTransform() / figTransformFor() must
// round-trip position, rotation, and flip losslessly. A prior version of
// applyFigTransform had a sign error that left rotation intact but made the
// imported x/y drift for any rotated node — silent, no test caught it. See
// figconv.js for the derivation this is checking.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = {
  window: {}, console,
  document: { createElement: () => ({ getContext: () => null }) },
  navigator: {}, indexedDB: undefined,
  localStorage: { getItem: () => null, setItem: () => {} },
};
ctx.global = ctx; ctx.self = ctx; ctx.window = ctx;
ctx.window.FigIO = {};

function load(file) {
  const code = fs.readFileSync(path.join(__dirname, 'src', file), 'utf8');
  vm.runInNewContext(code, ctx, { filename: file });
}
load('icons.js');
load('model.js');
load('tokens.js');
load('figconv.js');

const FigConv = ctx.window.FigConv;

function roundtrip(orig) {
  const tr = FigConv.figTransformFor(orig);
  const out = { w: orig.w, h: orig.h };
  FigConv.applyFigTransform(out, tr);
  return out;
}

const cases = [
  { name: 'identity',        node: { x: 100, y: 50,  w: 200, h: 80,  rotation: 0 } },
  { name: '30deg',           node: { x: 100, y: 50,  w: 200, h: 80,  rotation: Math.PI / 6 } },
  { name: '-45deg',          node: { x: 100, y: 50,  w: 200, h: 80,  rotation: -Math.PI / 4 } },
  { name: '90deg square',    node: { x: 0,   y: 0,   w: 150, h: 150, rotation: Math.PI / 2 } },
  { name: '60deg + flipH',   node: { x: 20,  y: 20,  w: 100, h: 60,  rotation: Math.PI / 3, flipH: true } },
  { name: 'flipH only',      node: { x: 20,  y: 20,  w: 100, h: 60,  rotation: 0, flipH: true } },
  { name: 'near-180deg neg', node: { x: -40, y: 300, w: 50,  h: 300, rotation: 2.9 } },
];

let allOk = true;
for (const { name, node } of cases) {
  const r = roundtrip(node);
  const okX = Math.abs(r.x - node.x) < 1e-3;
  const okY = Math.abs(r.y - node.y) < 1e-3;
  const okRot = Math.abs((r.rotation || 0) - (node.rotation || 0)) < 1e-3;
  const okFlip = !!r.flipH === !!node.flipH;
  const ok = okX && okY && okRot && okFlip;
  if (!ok) allOk = false;
  console.log(ok ? 'PASS' : 'FAIL', name,
    '- x:', node.x, '->', r.x, '| y:', node.y, '->', r.y,
    '| rot:', node.rotation, '->', r.rotation, '| flipH:', !!node.flipH, '->', !!r.flipH);
}
console.log(allOk ? 'ALL FIG TRANSFORM ROUNDTRIP TESTS PASSED' : 'FIG TRANSFORM ROUNDTRIP TESTS FAILED');
if (!allOk) process.exit(1);
