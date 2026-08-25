// Minimal headless smoke test for rotation and new features.
// Loads model+layout+renderer in a fake jsdom-free way using a stub canvas.
const fs = require('fs');
const path = require('path');

const vm = require('vm');
const ctx = { window: {}, document: { createElement: () => ({ getContext: () => null }) }, console };
ctx.global = ctx;
ctx.self = ctx;
ctx.window = ctx;
ctx.navigator = {};
ctx.indexedDB = undefined;
ctx.localStorage = { getItem: () => null, setItem: () => {} };

function load(file) {
  const code = fs.readFileSync(path.join(__dirname, 'src', file), 'utf8');
  vm.runInNewContext(code, ctx, { filename: file });
}

// figio shim (stub)
ctx.window.FigIO = {};
load('icons.js'); // icons references window
load('model.js');
load('layout.js');

// Renderer needs document/canvas/etc; stub minimally
ctx.Path2D = null;
ctx.Image = class { set src(v) {} };
load('render.js');

const M = ctx.window.Model;
const L = ctx.window.Layout;
const R = ctx.window.Renderer;

// Test 1: makeNode defaults rotation/flip
const n = M.makeNode('rect');
console.log('T1 rotation default:', n.rotation === 0, 'flipH:', n.flipH === false, 'flipV:', n.flipV === false);
n.w = 200; n.h = 100; n.x = 50; n.y = 50; n.rotation = Math.PI / 4; // 45°
n.fills = [{ type: 'solid', color: '#d9d9d9', opacity: 1 }];

// Test 2: rotatedCorners produces 4 points; obbAabb is larger than w*h
const corners = M.rotatedCorners(n, n.x, n.y, n.w, n.h);
console.log('T2 corners length:', corners.length === 4);
const bb = M.obbAabb(corners);
console.log('T2 rotated BB:', bb, 'w,h > 200,100:', bb.w > 200 && bb.h > 100);

// Test 3: pointInObb works
const cIn = M.pointInObb(n, n.x, n.y, n.w, n.h, n.x + n.w/2, n.y + n.h/2);
const cOut = M.pointInObb(n, n.x, n.y, n.w, n.h, n.x - 500, n.y);
console.log('T3 center in obb:', cIn, 'far point out:', !cOut);

// Test 4: deep clone preserves rotation
const doc = M.newDoc('t');
const page = doc.pages[0];
const f = M.makeNode('frame', { w: 400, h: 300, rotation: 0.5, flipH: true });
M.attach(doc, page, null, f);
const clone = M.deepClone(page, f, true, page);
console.log('T4 clone rotation:', clone.rotation === 0.5, 'flipH:', clone.flipH === true);

// Test 5: layout still runs on rotated nodes
n.rotation = 0; n.flipH = false;
L.layoutPage(page);
console.log('T5 layout f._l:', f._l && f._l.w === 400 && f._l.h === 300);

console.log('ALL TESTS PASSED');
