/* export-worker.js — Web Worker for off-main-thread .fig export.
 *
 * Messages to worker:
 *   { kind:'export', id, format:'fig', doc, name, opts }
 *   { kind:'cancel', id }
 *
 * Messages from worker:
 *   { kind:'progress', id, phase, pct, msg }
 *   { kind:'done',     id, bytes:ArrayBuffer, name, format }
 *   { kind:'error',    id, message }
 *   { kind:'cancelled',id }
 *
 * Notes:
 * - .pfg export is small (JSON zip) and runs on main thread. We support it
 *   here too for symmetry, but callers may opt to skip the worker for it.
 * - The doc object is transferred via structured clone; we don't mutate it.
 * - The returned bytes are transferred as an ArrayBuffer (zero-copy).
 */

// Bootstrap window alias so IIFEs attach to the worker global.
self.window = self;

importScripts(
  '../assets/figio.js',
  'model.js',
  'tokens.js',
  'figconv.js'
);
self.FigIO = self.FigIOBundle && (self.FigIOBundle.default || self.FigIOBundle);

const jobs = new Map();

function send(msg) { self.postMessage(msg); }

function progress(id, phase, pct, msg) {
  const j = jobs.get(id); if (j && j.cancelled) throw new Error('Cancelled');
  send({ kind:'progress', id, phase, pct, msg });
}

function exportFigJob(id, doc, name, opts) {
  try {
    progress(id, 'prep', 10, 'Preparing document…');

    // FigConv.exportFig is synchronous but fast for modest docs; for large
    // docs we still want it off the main thread so the UI doesn't freeze.
    progress(id, 'encoding', 40, 'Encoding kiwi message…');
    const result = self.FigConv.exportFig(doc, opts || {});
    if (jobs.get(id) && jobs.get(id).cancelled) throw new Error('Cancelled');

    progress(id, 'packaging', 85, 'Packaging archive…');
    // exportFig returns a Uint8Array
    const u8 = result instanceof Uint8Array ? result : new Uint8Array(result);
    // Transfer the underlying buffer (slice to owned region).
    const ab = u8.buffer.slice(u8.byteOffset, u8.byteOffset + u8.byteLength);

    progress(id, 'done', 100, 'Done');
    send({ kind:'done', id, bytes:ab, name: name || (doc.name || 'ARCO') + '.fig', format:'fig' }, [ab]);
  } catch (err) {
    if (err.message === 'Cancelled') { send({ kind:'cancelled', id }); return; }
    send({ kind:'error', id, message: err.message || String(err), stack: err.stack });
  } finally {
    jobs.delete(id);
  }
}

self.addEventListener('message', (e) => {
  const d = e.data;
  if (!d || !d.kind) return;
  if (d.kind === 'cancel') {
    const j = jobs.get(d.id);
    if (j) j.cancelled = true;
    return;
  }
  if (d.kind === 'export') {
    jobs.set(d.id, { cancelled:false });
    if (d.format === 'fig') {
      Promise.resolve().then(() => exportFigJob(d.id, d.doc, d.name, d.opts));
    } else {
      send({ kind:'error', id:d.id, message: 'Unsupported export format in worker: ' + d.format });
    }
  }
});
