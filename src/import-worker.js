/* import-worker.js — Web Worker for off-main-thread .fig / .pfg import.
 *
 * Runs FigIO.parseFigFile + FigConv.importFig (or Dash.importPfg) off the
 * main thread so the UI stays responsive on large files (50-150 MB).
 *
 * Messages to worker:
 *   { kind:'import', id, format:'fig'|'pfg', bytes:ArrayBuffer, name }
 *   { kind:'cancel', id }
 *
 * Messages from worker:
 *   { kind:'progress', id, phase, pct, msg }
 *   { kind:'done',     id, doc, report }   (doc is a plain JSON-safe object)
 *   { kind:'error',    id, message }
 *
 * Phases (fig): reading → decoding → nodes → images → layout → done
 * Phases (pfg): reading → decoding → done
 *
 * NOTE: We alias self to 'window' inside an eval wrapper so the IIFE-style
 *       modules we reuse (model.js, tokens.js, figconv.js) — which close
 *       with `})(window)` — can load unmodified via importScripts.
 */

// ---- Bootstrap a 'window' alias so IIFEs bind to the worker global scope.
self.window = self;
self.window.crypto = self.crypto; // model.js may need crypto.getRandomValues

importScripts(
  '../assets/figio.js',
  'model.js',
  'tokens.js',
  'figconv.js'
);
// After figio shim in index.html it runs:
//   window.FigIO = window.FigIOBundle && (window.FigIOBundle.default || window.FigIOBundle);
// Replicate that here.
self.FigIO = self.FigIOBundle && (self.FigIOBundle.default || self.FigIOBundle);

// Dash is needed for .pfg import. It's large and pulls most of the app;
// for the worker we only need importPfg/exportPfgBytes. But pulling all
// of Dash (which pulls Renderer/World/etc.) is too heavy for a worker.
// For now we support .fig fully in worker; .pfg is always fast (pure
// JSON inflate) so it's safe to keep on the main thread.

// Tracked job state (one job at a time; cancel sets a flag).
const jobs = new Map(); // id → { cancelled:bool }

function send(msg) { self.postMessage(msg); }

function progress(id, phase, pct, msg) {
  const j = jobs.get(id); if (j && j.cancelled) throw new Error('Cancelled');
  send({ kind:'progress', id, phase, pct, msg });
}

// Run a chunk of work with periodic yield + cancel check. For large
// arrays we invoke progress every YIELD_EVERY items so the UI thread gets
// a steady stream of updates and cancel stays responsive.
const YIELD_EVERY = 200;
function runTracked(id, phase, label, items, fn) {
  progress(id, phase, 0, label);
  const total = items ? items.length : 0;
  if (!total) { fn && fn(); progress(id, phase, 100, label + ' (done)'); return; }
  // Process synchronously but report progress every YIELD_EVERY items.
  // (Workers don't share the event loop with the main thread so we don't
  // yield mid-phase; reporting progress is enough for responsiveness.)
  let i = 0;
  for (const it of items) {
    fn(it, i);
    i++;
    if ((i % YIELD_EVERY) === 0) {
      progress(id, phase, Math.min(99, Math.round(i/total*100)), label + ' (' + i + '/' + total + ')');
    }
  }
  progress(id, phase, 100, label + ' (done)');
}

function importFigJob(id, bytes, name) {
  try {
    progress(id, 'reading', 2, 'Reading ' + name);

    // Ensure we have a Uint8Array view.
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    progress(id, 'decoding', 8, 'Unzipping .fig archive…');

    const parsed = self.FigIO.parseFigFile(u8);
    if (jobs.get(id) && jobs.get(id).cancelled) throw new Error('Cancelled');
    progress(id, 'decoding', 30, 'Decoding fig-kiwi schema…');

    const msg = parsed.binary.message;
    const rawNodes = msg.nodeChanges || [];
    const nodes = rawNodes.map(n => {
      if (!n.guid) n.guid = { sessionID: 0, localID: 0 };
      if (n.phase === undefined) n.phase = 'CREATED';
      return n;
    }).filter(n => n.phase !== 'REMOVED');
    const imgCount = (parsed.images || []).length;
    progress(id, 'nodes', 42, 'Building node tree… (' + nodes.length + ' raw nodes, ' + imgCount + ' images)');

    // ---- Instrument model/tokens to report progress during FigConv.importFig
    const M = self.Model;
    const T = self.Tokens;
    let nodeCount = 0;
    const totalNodeEstimate = nodes.length;
    let lastReportedPct = 42;
    const originalMakeNode = M.makeNode;
    M.makeNode = function() {
      const n = originalMakeNode.apply(this, arguments);
      nodeCount++;
      if ((nodeCount & 0x3F) === 0) { // every 64 nodes
        const p = 42 + Math.floor(Math.min(33, (nodeCount / Math.max(1,totalNodeEstimate)) * 33));
        if (p !== lastReportedPct) {
          lastReportedPct = p;
          const j = jobs.get(id); if (j && j.cancelled) { M.makeNode = originalMakeNode; throw new Error('Cancelled'); }
          send({ kind:'progress', id, phase:'nodes', pct:p, msg:'Converting nodes… (' + nodeCount + '/' + totalNodeEstimate + ')' });
        }
      }
      return n;
    };

    let result;
    try {
      result = self.FigConv.importFig(u8, () => {
        const j = jobs.get(id); if (j && j.cancelled) throw new Error('Cancelled');
      });
    } finally {
      M.makeNode = originalMakeNode;
    }
    if (jobs.get(id) && jobs.get(id).cancelled) throw new Error('Cancelled');

    progress(id, 'images', 78, 'Images decoded (' + (result.report && result.report.images || imgCount) + ')');
    progress(id, 'layout', 88, 'Computing layouts…');

    // Stamp pages (idempotent; FigConv already calls stampPage, but do it
    // again to be safe — cheap).
    for (const p of result.doc.pages) M.stampPage(result.doc, p);

    const r = result.report || {};
    progress(id, 'done', 100, 'Done — ' + (r.nodes||nodeCount) + ' nodes, ' + (r.pages||0) + ' pages, ' + (r.images||0) + ' images');
    send({ kind:'done', id, doc: result.doc, report: result.report, name });
  } catch (err) {
    if (err.message === 'Cancelled') send({ kind:'cancelled', id });
    else send({ kind:'error', id, message: err.message || String(err), stack: err.stack });
  } finally {
    jobs.delete(id);
  }
}

self.addEventListener('message', (e) => {
  const data = e.data;
  if (!data || !data.kind) return;
  if (data.kind === 'cancel') {
    const j = jobs.get(data.id);
    if (j) j.cancelled = true;
    return;
  }
  if (data.kind === 'import') {
    jobs.set(data.id, { cancelled:false, start:Date.now() });
    // Transfer ArrayBuffer to avoid a copy when possible. If structured
    // clone already took it, bytes is a copy; either way fine.
    const bytes = data.bytes;
    if (data.format === 'fig') {
      // Run in a microtask so we can acknowledge immediately.
      Promise.resolve().then(() => importFigJob(data.id, bytes, data.name));
    } else {
      send({ kind:'error', id:data.id, message:'pfg import in worker not yet supported' });
    }
  }
});
