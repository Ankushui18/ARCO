/* Real product-document .fig round-trip. This catches exports that preserve
 * the layer tree but arrive in Figma as a blank frame. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = {
  window: {}, console,
  document: { createElement: () => ({ getContext: () => ({ measureText: (s) => ({ width: String(s || '').length * 8 }) }) }) },
  navigator: {}, indexedDB: undefined,
  localStorage: { getItem: () => null, setItem: () => {} },
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  performance: { now: () => Date.now() },
  TextDecoder, TextEncoder, DataView, Uint8Array, Int32Array, Float32Array,
  Uint32Array, ArrayBuffer, Map, Set, WeakMap, Promise,
  setTimeout, clearTimeout, requestAnimationFrame: (fn) => fn(),
};
ctx.global = ctx; ctx.self = ctx; ctx.window = ctx;
function load(file) {
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), ctx, { filename: file });
}

load('assets/figio.js');
ctx.FigIO = ctx.FigIOBundle && (ctx.FigIOBundle.default || ctx.FigIOBundle);
load('src/icons.js');
load('src/model.js');
load('src/tokens.js');
load('src/layout.js');
load('src/world.js');
ctx.Renderer = {
  measureText(n, boxW) {
    const t = n.text || {}, size = t.size || 14;
    const w = boxW > 0 ? boxW : Math.max(1, String(t.content || '').length * size * .54);
    return { w: Math.ceil(w), h: Math.ceil(size * (t.lineHeight || 1.2)), lines: [String(t.content || '')], lineH: size * (t.lineHeight || 1.2) };
  },
};
load('src/figconv.js');
load('src/ui-dashboard.js');

const doc = ctx.Dash.makeStarterDoc();
for (const page of doc.pages) ctx.Layout.layoutPage(page);
const bytes = ctx.FigConv.exportFig(doc);
if (process.env.WRITE_FIG_FIXTURE === '1') {
  fs.writeFileSync(path.join(__dirname, 'fixtures', 'arco-starter-export-fixed.fig'), Buffer.from(bytes));
}
const parsed = ctx.FigIO.parseFigFile(bytes);
const changes = parsed.binary.message.nodeChanges;
const names = new Map(changes.map((n) => [n.name, n]));
if (process.env.DIAG_FIG === '1') {
  for (const name of ['Landing hero', 'Nav bar', 'Hero', 'Headline']) {
    const n = names.get(name);
    console.log(name, JSON.stringify(n, null, 2));
  }
  const real = ctx.FigIO.parseFigFile(new Uint8Array(fs.readFileSync(path.join(__dirname, 'fixtures', 'circle.fig'))));
  const realFrame = real.binary.message.nodeChanges.find((n) => n.type === 'FRAME');
  console.log('REAL FIGMA FRAME', JSON.stringify(realFrame, null, 2));
}

const landing = names.get('Landing hero');
if (landing.stackPrimarySizing !== 'FIXED' || landing.stackCounterSizing !== 'FIXED') {
  throw new Error('Fixed Auto Layout frame exported as Hug sizing');
}
for (const name of ['Landing hero', 'Nav bar', 'Hero', 'Headline', 'Hero art', 'Card row (wrap)']) {
  const n = names.get(name);
  if (!n) throw new Error(`Export dropped ${name}`);
  if (n.visible === false || n.opacity === 0) throw new Error(`${name} exported invisible`);
  if (!n.size || !(n.size.x > 0) || !(n.size.y > 0)) throw new Error(`${name} exported with zero size`);
  if (!n.transform || !Number.isFinite(n.transform.m02) || !Number.isFinite(n.transform.m12)) throw new Error(`${name} exported with invalid transform`);
  if (n.fillPaints && n.fillPaints.length && ['FRAME', 'RECTANGLE', 'ELLIPSE'].includes(n.type)) {
    if (!n.fillGeometry || !n.fillGeometry.length || n.fillGeometry[0].commandsBlob == null) {
      throw new Error(`${name} has paint but no Figma fillGeometry`);
    }
  }
}

if (!(parsed.binary.message.blobs || []).length) throw new Error('Export contains no editable geometry blobs');

const imported = ctx.FigConv.importFig(bytes).doc;
const importedNodes = Object.values(imported.pages[0].nodes);
for (const name of ['Nav bar', 'Headline', 'Hero art']) {
  const n = importedNodes.find((x) => x.name === name);
  if (!n || !(n.w > 0) || !(n.h > 0) || n.visible === false || n.opacity === 0) {
    throw new Error(`${name} failed editable round-trip`);
  }
}

console.log('PASS: starter .fig keeps visible geometry, paint and hierarchy');
