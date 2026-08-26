/* Headless smoke tests for TextEngine layout (no browser). */
const fs = require('fs');
const vm = require('vm');

const calls = { measure: 0 };
const fakeCtx = {
  font: '',
  letterSpacing: '0px',
  fontVariantCaps: 'normal',
  fontKerning: 'normal',
  fillStyle: '#000',
  strokeStyle: '#000',
  lineWidth: 1,
  textBaseline: 'alphabetic',
  textAlign: 'start',
  globalAlpha: 1,
  measureText(s) { calls.measure++; return { width: String(s || '').length * 8 }; },
  fillText() {},
  stroke() {},
  beginPath() {},
  moveTo() {},
  lineTo() {},
  save() {},
  restore() {},
  setLineDash() {},
};
const document = {
  createElement() {
    return { getContext() { return fakeCtx; } };
  },
};
const window = { document };
const ctx = { window, document, global, console };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('src/text-engine.js', 'utf8'), ctx);
const TE = ctx.window.TextEngine;
if (!TE) throw new Error('TextEngine missing');

function node(over) {
  return {
    type: 'text', w: 200, h: 80,
    text: Object.assign({
      content: 'Hello world\nSecond line',
      font: 'Inter', size: 16, weight: 400, lineHeight: 1.2,
      align: 'left', valign: 'top', resize: 'fixed',
    }, over),
  };
}

function assert(cond, msg) { if (!cond) throw new Error(msg); console.log('PASS:', msg); }

const m = TE.measure(node(), 200);
assert(m.w > 0 && m.h > 0, 'measure returns size ' + m.w + 'x' + m.h);
assert(m.lines.length >= 2, 'wraps/splits into lines, got ' + m.lines.length);

const upper = TE.applyCase('Hello World', 'upper');
assert(upper === 'HELLO WORLD', 'uppercase');
assert(TE.applyCase('HELLO WORLD', 'lower') === 'hello world', 'lowercase');
assert(TE.applyCase('hello world', 'title') === 'Hello World', 'title case');

const listed = TE.layout(node({ list: 'bullet', content: 'Cats\nDogs' }), 200);
assert(listed.lines.length === 2 && listed.lines[0].marker === '•', 'bullet markers');
const numbered = TE.layout(node({ list: 'number', content: 'One\nTwo' }), 200);
assert(numbered.lines[0].marker === '1.' && numbered.lines[1].marker === '2.', 'numbered markers');

const trunc = TE.layout(node({
  content: 'A long line that should wrap and then truncate',
  truncate: true, maxLines: 1, resize: 'auto-h',
}), 80);
assert(trunc.lines.length === 1 && /…$/.test(trunc.lines[0].text), 'truncate adds ellipsis');

const t = { content: 'Click here now', links: [] };
TE.setLink(t, 6, 10, 'https://figma.com');
assert(t.links.length === 1 && t.links[0].href === 'https://figma.com', 'setLink stores range');
TE.setLink(t, 6, 10, '');
assert(t.links.length === 0, 'setLink empty removes');

TE.bumpSize({ size: 16 }, 1);
assert(true, 'bumpSize runs');
const w = { weight: 400 }; TE.bumpWeight(w, 1);
assert(w.weight === 500, 'bumpWeight 400 → 500');

console.log('\nALL TEXT ENGINE TESTS PASSED');
