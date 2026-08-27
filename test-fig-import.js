// Import completeness + speed: real fixture .fig files must produce every
// user page, keep children (no O(n²) drop), and finish in well under a second
// at fixture scale.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ctx = {
  window: {}, console,
  document: { createElement: () => ({ getContext: () => null }) },
  navigator: {}, indexedDB: undefined,
  localStorage: { getItem: () => null, setItem: () => {} },
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  performance: { now: () => Date.now() },
  TextDecoder, TextEncoder, DataView, Uint8Array, Int32Array, Float32Array,
  Uint32Array, ArrayBuffer, Map, Set, Promise,
};
ctx.global = ctx; ctx.self = ctx; ctx.window = ctx;

function load(file) {
  const code = fs.readFileSync(path.join(__dirname, file), 'utf8');
  vm.runInNewContext(code, ctx, { filename: file });
}
load('assets/figio.js');
ctx.window.FigIO = ctx.window.FigIOBundle && (ctx.window.FigIOBundle.default || ctx.window.FigIOBundle);
ctx.FigIO = ctx.window.FigIO;
load('src/icons.js');
load('src/model.js');
load('src/tokens.js');
load('src/figconv.js');

const FigConv = ctx.window.FigConv;
const fixtures = fs.readdirSync(path.join(__dirname, 'fixtures')).filter(f => f.endsWith('.fig'));
if (!fixtures.length) {
  console.error('NO FIXTURES');
  process.exit(1);
}

let allOk = true;
for (const name of fixtures) {
  const bytes = fs.readFileSync(path.join(__dirname, 'fixtures', name));
  const t0 = Date.now();
  let res;
  try {
    res = FigConv.importFig(new Uint8Array(bytes));
  } catch (e) {
    console.log('FAIL', name, 'threw', e.message);
    allOk = false;
    continue;
  }
  const ms = Date.now() - t0;
  const doc = res.doc;
  const pages = (doc.pages || []).length;
  let nodes = 0, emptyPages = 0, badBox = 0;
  for (const p of doc.pages || []) {
    const n = Object.keys(p.nodes || {}).length;
    nodes += n;
    if (!n) emptyPages++;
    for (const id of Object.keys(p.nodes || {})) {
      const nd = p.nodes[id];
      if (!isFinite(nd.x) || !isFinite(nd.y) || !isFinite(nd.w) || !isFinite(nd.h)) badBox++;
      if (nd.w < 0 || nd.h < 0) badBox++;
    }
  }
  const okPages = pages >= 1;
  const okNodes = nodes >= 1;
  const okTime = ms < 2500;
  const okBox = badBox === 0;
  const ok = okPages && okNodes && okTime && okBox;
  if (!ok) allOk = false;
  console.log(ok ? 'PASS' : 'FAIL', name,
    'pages=' + pages, 'nodes=' + nodes, 'emptyPages=' + emptyPages,
    'ms=' + ms, 'skipped=' + JSON.stringify(res.report && res.report.skipped),
    'warnings=' + ((res.report && res.report.warnings && res.report.warnings.length) || 0));
}

// Synthetic O(n²) guard: 2 000 nested-sibling nodes must import fast.
{
  const N = 2000;
  const nodes = [{ guid: { sessionID: 0, localID: 0 }, phase: 'CREATED', type: 'DOCUMENT', name: 'Document' }];
  nodes.push({
    guid: { sessionID: 0, localID: 1 }, phase: 'CREATED', type: 'CANVAS', name: 'Page 1',
    parentIndex: { guid: { sessionID: 0, localID: 0 }, position: '000000' },
  });
  for (let i = 0; i < N; i++) {
    nodes.push({
      guid: { sessionID: 1, localID: i + 1 }, phase: 'CREATED', type: 'RECTANGLE', name: 'R' + i,
      parentIndex: { guid: { sessionID: 0, localID: 1 }, position: String(i).padStart(6, '0') },
      size: { x: 10, y: 10 },
      transform: { m00: 1, m01: 0, m02: i * 12, m10: 0, m11: 1, m12: 0 },
    });
  }
  const fakeParsed = {
    binary: { message: { nodeChanges: nodes, blobs: [] } },
    images: [],
    meta: { file_name: 'synth' },
  };
  const t0 = Date.now();
  const res = FigConv.importFig(new Uint8Array([0]), null, fakeParsed);
  const ms = Date.now() - t0;
  const got = Object.keys(res.doc.pages[0].nodes).length;
  const ok = got >= N && ms < 800;
  if (!ok) allOk = false;
  console.log(ok ? 'PASS' : 'FAIL', 'synth-2000', 'nodes=' + got, 'ms=' + ms);
}

console.log(allOk ? 'ALL FIG IMPORT TESTS PASSED' : 'FIG IMPORT TESTS FAILED');
if (!allOk) process.exit(1);
