/* import-worker.js — long-lived .fig session.
 *
 * Small files: inflate the zip, convert, post one JSON buffer.
 * Large files: keep the File in this worker, inflate only canvas.fig,
 * hold the full document here, and send the current page + images on demand.
 *
 * Main thread must NOT terminate this worker after 'done' when lazy:true.
 */
self.window = self;
self.window.crypto = self.crypto;

importScripts(
  '../assets/figio.js',
  'model.js',
  'tokens.js',
  'figconv.js'
);
self.FigIO = self.FigIOBundle && (self.FigIOBundle.default || self.FigIOBundle);

const jobs = new Map();
const sessions = new Map(); // id → { file, entries, doc, report }

function send(msg, transfer) {
  if (transfer && transfer.length) self.postMessage(msg, transfer);
  else self.postMessage(msg);
}

function progress(id, phase, pct, msg) {
  const j = jobs.get(id);
  if (j && j.cancelled) throw new Error('Cancelled');
  send({ kind: 'progress', id, phase, pct, msg });
}

function u32(u8, o) { return u8[o] | (u8[o + 1] << 8) | (u8[o + 2] << 16) | (u8[o + 3] << 24); }
function u16(u8, o) { return u8[o] | (u8[o + 1] << 8); }

async function inflateRaw(u8) {
  if (typeof DecompressionStream === 'undefined') throw new Error('no DecompressionStream');
  const ds = new DecompressionStream('deflate-raw');
  const ab = await new Response(new Blob([u8]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(ab);
}

async function readSlice(file, start, size) {
  const end = Math.min(file.size, start + size);
  const ab = await file.slice(start, end).arrayBuffer();
  return new Uint8Array(ab);
}

async function readZipIndex(file) {
  const tailN = Math.min(file.size, 262144);
  const tail = await readSlice(file, file.size - tailN, tailN);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) {
    if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Not a zip .fig (no EOCD)');
  const cdSize = u32(tail, eocd + 12);
  const cdOff = u32(tail, eocd + 16);
  const cd = await readSlice(file, cdOff, cdSize + 8);
  const entries = new Map();
  let p = 0;
  while (p + 46 <= cd.length && cd[p] === 0x50 && cd[p + 1] === 0x4b && cd[p + 2] === 0x01 && cd[p + 3] === 0x02) {
    const method = u16(cd, p + 10);
    const csize = u32(cd, p + 20);
    const usize = u32(cd, p + 24);
    const nlen = u16(cd, p + 28);
    const elen = u16(cd, p + 30);
    const clen = u16(cd, p + 32);
    const localOff = u32(cd, p + 42);
    const name = new TextDecoder().decode(cd.subarray(p + 46, p + 46 + nlen));
    entries.set(name, { name, method, csize, usize, localOff });
    p += 46 + nlen + elen + clen;
  }
  return entries;
}

async function readZipEntry(file, ent) {
  const head = await readSlice(file, ent.localOff, 30);
  if (u32(head, 0) !== 0x04034b50) throw new Error('Bad local header for ' + ent.name);
  const nlen = u16(head, 26);
  const elen = u16(head, 28);
  const dataOff = ent.localOff + 30 + nlen + elen;
  const raw = await readSlice(file, dataOff, ent.csize);
  if (ent.method === 0) return raw;
  if (ent.method === 8) return inflateRaw(raw);
  throw new Error('Unsupported zip method ' + ent.method + ' for ' + ent.name);
}

function findEntry(entries, pred) {
  for (const [name, ent] of entries) if (pred(name)) return ent;
  return null;
}

function encodeJson(obj) {
  const json = JSON.stringify(obj);
  return new TextEncoder().encode(json);
}

function pageStub(p, keepNodes) {
  if (keepNodes) return p;
  return { id: p.id, name: p.name, nodes: {}, tops: [], _lazy: true, _count: Object.keys(p.nodes || {}).length };
}

function slimDoc(doc, keepIndex) {
  return {
    id: doc.id,
    name: doc.name,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    vars: doc.vars,
    components: doc.components || {},
    comments: doc.comments || [],
    versions: [],
    styles: doc.styles || { text: {}, paint: {} },
    annotations: [],
    libraries: [],
    pages: (doc.pages || []).map((p, i) => pageStub(p, i === keepIndex)),
  };
}

function hashesOnPage(page) {
  const out = [];
  const seen = new Set();
  if (!page || !page.nodes) return out;
  for (const id of Object.keys(page.nodes)) {
    const n = page.nodes[id];
    for (const f of (n && n.fills) || []) {
      if (f && f.type === 'image' && f.hash && !seen.has(f.hash)) {
        seen.add(f.hash);
        out.push(f.hash);
      }
    }
  }
  return out;
}

async function packImages(sess, hashes, limit) {
  const items = [];
  const transfers = [];
  const max = limit == null ? hashes.length : Math.min(limit, hashes.length);
  for (let i = 0; i < max; i++) {
    const hash = String(hashes[i]);
    const ent = sess.entries && (
      sess.entries.get('images/' + hash) ||
      sess.entries.get(hash) ||
      findEntry(sess.entries, (n) => n.endsWith('/' + hash) || n === hash)
    );
    if (!ent || !sess.file) continue;
    try {
      const bytes = await readZipEntry(sess.file, ent);
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      items.push({ hash, bytes: buf });
      transfers.push(buf);
    } catch (e) {}
  }
  return { items, transfers };
}

async function importFromFile(id, file, name) {
  progress(id, 'reading', 2, 'Reading ' + name);
  let entries = null;
  try {
    entries = await readZipIndex(file);
  } catch (e) {
    progress(id, 'reading', 6, 'Index failed, reading whole file…');
    const ab = await file.arrayBuffer();
    return importFromBytes(id, new Uint8Array(ab), name, null, null);
  }
  const canvasEnt = findEntry(entries, (n) => /canvas(\.fig)?$/i.test(n));
  if (!canvasEnt) throw new Error('No canvas.fig in archive');
  progress(id, 'decoding', 12, 'Inflating canvas (images stay on disk)…');
  const canvas = await readZipEntry(file, canvasEnt);
  const j = jobs.get(id); if (j && j.cancelled) throw new Error('Cancelled');
  progress(id, 'decoding', 28, 'Decoding fig-kiwi…');
  const binary = self.FigIO.parseFigBinary(canvas);
  let meta = null;
  const metaEnt = findEntry(entries, (n) => n.endsWith('meta.json'));
  if (metaEnt) {
    try {
      const mb = await readZipEntry(file, metaEnt);
      meta = JSON.parse(new TextDecoder().decode(mb));
    } catch (e) {}
  }
  const parsed = { binary, meta, thumbnail: null, images: [] };
  // Attach empty image records so hashes still resolve as missing-src.
  progress(id, 'nodes', 40, 'Building node tree…');
  const M = self.Model;
  let nodeCount = 0;
  const orig = M.makeNode;
  M.makeNode = function () {
    const n = orig.apply(this, arguments);
    nodeCount++;
    if ((nodeCount & 0x7F) === 0) {
      send({ kind: 'progress', id, phase: 'nodes', pct: 40 + Math.min(40, Math.round(nodeCount / 500)), msg: 'Converting… ' + nodeCount + ' layers' });
    }
    return n;
  };
  let result;
  try {
    result = self.FigConv.importFig(canvas, null, parsed);
  } finally {
    M.makeNode = orig;
  }
  const lazy = file.size >= 8 * 1024 * 1024 || (result.report && result.report.nodes >= 2500);
  sessions.set(id, { file, entries, doc: result.doc, report: result.report, lazy });
  progress(id, 'images', 86, lazy ? 'Loading visible images…' : 'Packing…');
  return finishSend(id, result, name, lazy);
}

async function importFromBytes(id, u8, name, file, entries) {
  progress(id, 'decoding', 10, 'Unzipping…');
  const parsed = self.FigIO.parseFigFile(u8);
  progress(id, 'nodes', 40, 'Building node tree…');
  const result = self.FigConv.importFig(u8, null, parsed);
  const lazy = u8.byteLength >= 8 * 1024 * 1024 || (result.report && result.report.nodes >= 2500);
  sessions.set(id, { file: file || null, entries: entries || null, doc: result.doc, report: result.report, lazy, parsed });
  return finishSend(id, result, name, lazy);
}

async function finishSend(id, result, name, lazy) {
  const sess = sessions.get(id);
  const keep = lazy ? 0 : 0;
  const payloadDoc = lazy ? slimDoc(result.doc, 0) : result.doc;
  const hashes = lazy
    ? hashesOnPage((result.doc.pages || [])[0])
    : (function () {
        const s = new Set();
        const out = [];
        for (const page of result.doc.pages || []) {
          for (const h of hashesOnPage(page)) if (!s.has(h)) { s.add(h); out.push(h); }
        }
        return out;
      })();
  const imgLimit = lazy ? 24 : 250;
  let imgPack = { items: [], transfers: [] };
  if (sess && sess.file && sess.entries) {
    imgPack = await packImages(sess, hashes, imgLimit);
  } else if (result.imageBytes && result.imageBytes.length) {
    for (const pair of result.imageBytes.slice(0, imgLimit)) {
      const hash = pair[0];
      let bytes = pair[1];
      if (!bytes) continue;
      if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
      const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      imgPack.items.push({ hash: String(hash), bytes: buf });
      imgPack.transfers.push(buf);
    }
  }
  progress(id, 'layout', 94, 'Sending current page…');
  let jsonBuf;
  try {
    jsonBuf = encodeJson({ doc: payloadDoc, report: result.report });
  } catch (e) {
    send({ kind: 'error', id, message: 'File is too large to open: ' + (e.message || e) });
    return;
  }
  const transfers = imgPack.transfers.concat([jsonBuf.buffer]);
  const r = result.report || {};
  progress(id, 'done', 100, 'Ready — ' + (r.nodes || 0) + ' layers, ' + (r.pages || 0) + ' pages');
  send({
    kind: 'done', id, json: jsonBuf.buffer, images: imgPack.items,
    report: result.report, name, lazy: !!lazy,
    pageCount: (result.doc.pages || []).length,
    nodeCount: r.nodes || 0,
  }, transfers);
}

async function onGetPage(id, index) {
  const sess = sessions.get(id);
  if (!sess || !sess.doc) { send({ kind: 'error', id, message: 'Session expired' }); return; }
  const page = sess.doc.pages[index];
  if (!page) { send({ kind: 'error', id, message: 'No such page' }); return; }
  const jsonBuf = encodeJson({ index, page });
  const hashes = hashesOnPage(page);
  const imgPack = (sess.file && sess.entries) ? await packImages(sess, hashes, 24) : { items: [], transfers: [] };
  const transfers = imgPack.transfers.concat([jsonBuf.buffer]);
  send({ kind: 'page', id, index, json: jsonBuf.buffer, images: imgPack.items, hashesLeft: Math.max(0, hashes.length - 24) }, transfers);
}

async function onGetImages(id, hashes) {
  const sess = sessions.get(id);
  if (!sess) return;
  const imgPack = (sess.file && sess.entries)
    ? await packImages(sess, hashes || [], 48)
    : { items: [], transfers: [] };
  send({ kind: 'images', id, images: imgPack.items }, imgPack.transfers);
}

self.addEventListener('message', (e) => {
  const data = e.data;
  if (!data || !data.kind) return;
  if (data.kind === 'cancel') {
    const j = jobs.get(data.id);
    if (j) j.cancelled = true;
    return;
  }
  if (data.kind === 'close') {
    sessions.delete(data.id);
    jobs.delete(data.id);
    return;
  }
  if (data.kind === 'getPage') {
    Promise.resolve().then(() => onGetPage(data.id, data.index)).catch((err) => send({ kind: 'error', id: data.id, message: err.message || String(err) }));
    return;
  }
  if (data.kind === 'getImages') {
    Promise.resolve().then(() => onGetImages(data.id, data.hashes)).catch(() => {});
    return;
  }
  if (data.kind === 'import') {
    jobs.set(data.id, { cancelled: false, start: Date.now() });
    Promise.resolve().then(async () => {
      try {
        if (data.file) {
          await importFromFile(data.id, data.file, data.name);
        } else {
          const bytes = data.bytes instanceof Uint8Array ? data.bytes : new Uint8Array(data.bytes);
          await importFromBytes(data.id, bytes, data.name, null, null);
        }
      } catch (err) {
        if (err.message === 'Cancelled') send({ kind: 'cancelled', id: data.id });
        else send({ kind: 'error', id: data.id, message: err.message || String(err), stack: err.stack });
      } finally {
        jobs.delete(data.id);
      }
    });
  }
});
