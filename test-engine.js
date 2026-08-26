// End-to-end engine smoke test (no browser, no canvas).
// Loads model, layout, world modules against a fake DOM and exercises:
//  - doc creation + frame+rect at top level
//  - auto-layout container with 2 children
//  - rotated top-level frame (45°) and its children
//  - world-transform computation, hit-test via worldToLocal
//  - deep clone, undo/redo, pfg/fig round-trip (basic)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = {
  window: {},
  document: {
    createElement: (tag) => {
      if (tag === 'canvas') {
        return {
          getContext: () => ({
            measureText: (s) => ({ width: (s||'').length * 8 }),
            font: '', fillStyle: '', strokeStyle: '', lineWidth: 1,
            save(){}, restore(){}, translate(){}, rotate(){}, scale(){},
            beginPath(){}, rect(){}, fillRect(){}, strokeRect(){}, fill(){}, stroke(){},
            clip(){}, arc(){}, moveTo(){}, lineTo(){}, closePath(){}, fillText(){},
            setTransform(){}, drawImage(){},
            createLinearGradient:()=>({addColorStop(){}}),
            createRadialGradient:()=>({addColorStop(){}}),
            createPattern:()=>({}),
            setLineDash(){}, ellipse(){}, quadraticCurveTo(){}, bezierCurveTo(){},
          }),
          width: 0, height: 0
        };
      }
      return { style:{}, addEventListener(){} };
    }
  },
  console, navigator: {}, localStorage: { getItem: () => null, setItem: () => {} },
  indexedDB: undefined, setTimeout, clearTimeout, requestAnimationFrame: (f) => f(),
  Image: class { set src(v) {} }, Path2D: null, URL: { createObjectURL(){return ''}, revokeObjectURL(){} },
  Blob: class{}, atob: s => Buffer.from(s,'base64').toString('binary'),
  btoa: s => Buffer.from(s,'binary').toString('base64'),
  TextEncoder, TextDecoder, Uint8Array, DataView, Map, Set, WeakMap,
};
ctx.global = ctx; ctx.self = ctx; ctx.window = ctx;
function run(file) {
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'src', file), 'utf8'), ctx, { filename: file });
}
ctx.window.FigIO = {};
run('icons.js');
run('model.js');
run('layout.js');
run('world.js');
// Minimal Renderer stub for text measurement.
ctx.window.Renderer = {
  measureText(n, boxW) {
    const t = n.text || {};
    const content = t.content || '';
    const size = t.size || 14;
    const lh = (t.lineHeight || 1.2) * size;
    // fake char width
    const lines = (boxW && boxW > 0) ? [content] : content.split('\n');
    const w = Math.max(1, ...lines.map(l => Math.max(1, l.length * size * 0.55)));
    return { w: Math.ceil(w), h: Math.ceil(lines.length * lh), lines, lineH: lh };
  },
};
run('render.js');
const M = ctx.window.Model;
const L = ctx.window.Layout;
const W = ctx.window.World;
const R = ctx.window.Renderer;

function assert(cond, msg) { if (!cond) { console.error('FAIL:', msg); process.exit(1); } else console.log('PASS:', msg); }

// Test 1: Basic layout of a top-level rect
const doc = M.newDoc('T');
const page = doc.pages[0];
const f = M.makeNode('frame', { x: 100, y: 100, w: 300, h: 200 });
f.fills = [];
M.attach(doc, page, null, f);
const r = M.makeNode('rect', { x: 20, y: 30, w: 50, h: 40 });
M.attach(doc, page, f.id, r);
L.layoutPage(page);
assert(f._l.x === 100 && f._l.y === 100 && f._l.w === 300 && f._l.h === 200, 'frame laid out at parent-local x=100 y=100');
assert(r._l.x === 20 && r._l.y === 30 && r._w.x === 120 && r._w.y === 130, 'child _l is parent-local (20,30); _w is world (120,130)');

// Test 2: World transform of unrotated node is identity translate
assert(f._wt && f._wt[4] === f.x && f._wt[5] === f.y, 'frame world translate matches n.x,n.y');

// Test 3: Rotated frame produces correct OBB
f.rotation = Math.PI / 4; // 45°
L.layoutPage(page);
assert(f._w.w > f.w && f._w.h > f.h, 'rotated frame OBB larger than original w/h');
assert(f._wc && f._wc.length === 4, 'frame has 4 world corners');

// Test 4: worldToLocal round-trip
const cx = f._w.x + f._w.w/2, cy = f._w.y + f._w.h/2;
const lp = W.worldToLocal(f, cx, cy);
assert(Math.abs(lp.x - f.w/2) < 1 && Math.abs(lp.y - f.h/2) < 1, 'world center maps to local center');

// Test 5: Auto-layout: h-direction container with two rects
const doc2 = M.newDoc('AL');
const p2 = doc2.pages[0];
const al = M.makeNode('frame', { x:0,y:0,w:0,h:0 });
al.fills = [];
M.makeAutoLayout(al, 'h');
al.al.gap = { n:10 };
M.attach(doc2, p2, null, al);
const a = M.makeNode('rect', { w: 50, h: 50 });
const b = M.makeNode('rect', { w: 70, h: 50 });
M.attach(doc2, p2, al.id, a);
M.attach(doc2, p2, al.id, b);
L.layoutPage(p2);
assert(al._l.w > 0 && al._l.h > 0, 'auto-layout frame measured non-zero');
assert(a._l.x === 0 && b._l.x > a._l.x, 'horizontal layout: first child at 0, second to the right');

// Test 6: undo/redo (note: snapshot/restore replaces pages array; always read via doc.pages[i])
const h = new M.History();
h.begin(doc2);
doc2.pages[0].nodes[a.id].w = 999;
h.end(doc2);
h.undo(doc2);
assert(doc2.pages[0].nodes[a.id].w === 50, 'undo restores size');
h.redo(doc2);
assert(doc2.pages[0].nodes[a.id].w === 999, 'redo re-applies change');

// Test 7: Deep clone preserves rotation
f.rotation = 0.3;
f.flipH = true;
const clone = M.deepClone(page, f, true, page);
assert(clone.rotation === 0.3 && clone.flipH === true, 'deep clone preserves rotation/flip');

// Test 8: Rotated corner hit test via pointInObb
f.rotation = Math.PI/4; f.flipH=false;
L.layoutPage(page);
// Point at center should be inside
const inside = M.pointInObb(f, f._l.x, f._l.y, f._l.w, f._l.h, f._l.x+f._l.w/2, f._l.y+f._l.h/2);
const far = M.pointInObb(f, f._l.x, f._l.y, f._l.w, f._l.h, f._l.x+1000, f._l.y+1000);
assert(inside, 'center point inside rotated obb');
assert(!far, 'far point outside rotated obb');

console.log('\nALL ENGINE SMOKE TESTS PASSED');

// Test 14: Text hug size preserved after layout (don't clobber stored x/y)
(function(){
  const doc = M.newDoc();
  const page = doc.pages[0];
  const t = M.makeNode('text',{x:100,y:100,w:1,h:1,name:'Hello'});
  t.text.content='Good afternoon, Alex'; t.text.size=24; t.text.weight=700;
  t.fills=[{type:'solid',color:'#1e1e1e',opacity:1}];
  t.als={w:'hug',h:'hug',align:'auto'};
  M.attach(doc,page,null,t);
  L.layoutPage(page);
  assert(t.x===100, 'text x preserved at 100 after hug layout, got '+t.x);
  assert(t.y===100, 'text y preserved at 100 after hug layout, got '+t.y);
  assert(t.w>1, 'text hug w measured > 1, got '+t.w);
  assert(t.h>1, 'text hug h measured > 1, got '+t.h);
  assert(t._l.x===100 && t._l.y===100, 'text _l at (100,100), got ('+t._l.x+','+t._l.y+')');
  console.log('PASS:', 'text hug position preserved');
})();

// Test 15: Children of manual frame keep stored x/y
(function(){
  const doc = M.newDoc();
  const page = doc.pages[0];
  const f = M.makeNode('frame',{x:0,y:0,w:400,h:400,name:'Frame'});
  M.attach(doc,page,null,f);
  const c = M.makeNode('rect',{x:50,y:60,w:100,h:40,name:'Child'});
  M.attach(doc,page,f.id,c);
  L.layoutPage(page);
  assert(c.x===50 && c.y===60, 'child of manual frame keeps stored x/y (50,60) got ('+c.x+','+c.y+')');
  assert(c._l.x===50 && c._l.y===60, 'child _l == (50,60)');
console.log('PASS:', 'manual-frame child positions preserved');

// Regression: vertical auto layout distributes logical main/cross axes back
// into physical height/width. A fill-width + hug-height text item must never
// become a narrow, extremely tall box (the 41×220 inline-text bug).
{
  const doc = M.newDoc('vertical layout regression');
  const page = doc.pages[0];
  const card = M.makeNode('frame', { x: 0, y: 0, w: 260, h: 160 });
  M.attach(doc, page, null, card);
  M.makeAutoLayout(card, 'v', page);
  card.al.pad = [{n:20},{n:20},{n:20},{n:20}];
  const title = M.makeNode('text', { w: 220, h: 22 });
  title.text.content = 'Auto layout';
  title.text.size = 17;
  title.als = { w:'fill', h:'hug', grow:0, align:'auto', absolute:false };
  M.attach(doc, page, card.id, title);
  L.layoutPage(page);
  assert(title.w === 220, 'vertical AL fill-width text stays 220px wide, got '+title.w);
  assert(title.h < 60, 'vertical AL hug-height text stays compact, got '+title.h);
}
})();
