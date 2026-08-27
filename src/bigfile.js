/* bigfile.js — 500 MB .fig files stay in a worker. The tab only holds
 * the current page and images that are actually on screen.
 *
 * File size is not the same as smoothness. A 500 MB file that is mostly
 * images can pan if we don't inflate them. A 20 MB file of 80 000 vectors
 * on one page will still hitch. This architecture removes the *file-size*
 * freeze (double ArrayBuffer + data-URLs + full-doc clone + IDB).
 */
(function (global) {
  'use strict';

  const HEAVY_NODES = 2500;
  const WARN_BYTES = 8 * 1024 * 1024;

  function ready(fn) {
    if (document.readyState === 'complete') return fn();
    window.addEventListener('load', fn, { once: true });
  }

  function nodeCount(doc) {
    let n = 0;
    if (!doc || !doc.pages) return 0;
    for (let i = 0; i < doc.pages.length; i++) n += Object.keys(doc.pages[i].nodes || {}).length;
    return n;
  }

  function armHeavy(doc, bytesLen) {
    const App = global.App;
    if (!App) return false;
    const n = nodeCount(doc);
    App._nodeCount = n;
    App._heavy = n >= HEAVY_NODES || (bytesLen || 0) >= WARN_BYTES || !!App._figLazy;
    return App._heavy;
  }

  function attachBlobs(doc, imageBytes) {
    if (!doc || !imageBytes || !imageBytes.length) return 0;
    doc._imageUrls = doc._imageUrls || {};
    let n = 0;
    for (let i = 0; i < imageBytes.length; i++) {
      const pair = imageBytes[i];
      const hash = Array.isArray(pair) ? pair[0] : pair.hash;
      let bytes = Array.isArray(pair) ? pair[1] : pair.bytes;
      if (!hash || !bytes) continue;
      if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
      try {
        const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
        doc._imageUrls[hash] = url;
        doc._imageUrls[String(hash).toLowerCase()] = url;
        n++;
      } catch (e) {}
    }
    rebindFills(doc);
    return n;
  }

  function rebindFills(doc) {
    const urls = doc && doc._imageUrls;
    if (!urls) return;
    for (let p = 0; p < (doc.pages || []).length; p++) {
      const nodes = doc.pages[p].nodes || {};
      for (const id of Object.keys(nodes)) {
        const fills = nodes[id] && nodes[id].fills;
        if (!fills) continue;
        for (let f = 0; f < fills.length; f++) {
          const fill = fills[f];
          if (!fill || fill.type !== 'image' || fill.src || !fill.hash) continue;
          fill.src = urls[fill.hash] || urls[String(fill.hash).toLowerCase()] || null;
        }
      }
    }
  }

  function collapseAll(page) {
    const P = global.Panels;
    if (!P || !page) return;
    P._collapsed = P._collapsed || {};
    for (const id of Object.keys(page.nodes || {})) {
      const n = page.nodes[id];
      if (n && n.children && n.children.length) P._collapsed[id] = true;
    }
  }

  function decodeMsg(buf) {
    const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    return JSON.parse(new TextDecoder().decode(u8));
  }

  function imgPairs(images) {
    return (images || []).map(function (im) {
      return [im.hash, im.bytes instanceof Uint8Array ? im.bytes : new Uint8Array(im.bytes)];
    });
  }

  ready(function () {
    const App = global.App;
    const R = global.Renderer;
    const P = global.Panels;
    const C = global.Collab;
    const M = global.Model;
    const Dash = global.Dash;
    if (!App) return;

    // ---- LOD + viewport cull ------------------------------------------
    if (R && R.drawNode && R.drawPage) {
      const _dn = R.drawNode.bind(R);
      R.drawNode = function (ctx, page, n, doc) {
        const view = ctx._view;
        const b = n && n._w;
        if (view && b && isFinite(b.x) && isFinite(b.w)) {
          const z = view.zoom || 1, ox = view.ox || 0, oy = view.oy || 0;
          const sx = b.x * z + ox, sy = b.y * z + oy;
          const sw = b.w * z, sh = b.h * z;
          if (sx + sw < -200 || sy + sh < -200 || sx > (view.w || 0) + 200 || sy > (view.h || 0) + 200) return;
          const area = sw * sh;
          if (area < 2) return;
          const kids = n.children && n.children.length;
          if (kids && (n.type === 'frame' || n.type === 'instance') && (z < 0.18 || area < 40)) {
            const col = (n.fills && n.fills[0] && n.fills[0].type === 'solid' && n.fills[0].color) || 'rgba(255,255,255,0.14)';
            ctx.save();
            ctx.fillStyle = col;
            ctx.globalAlpha = 0.95;
            ctx.fillRect(n.x || 0, n.y || 0, Math.max(1, n.w || 1), Math.max(1, n.h || 1));
            ctx.restore();
            return;
          }
        }
        return _dn(ctx, page, n, doc);
      };
      const _dp = R.drawPage.bind(R);
      R.drawPage = function (ctx, page, doc, view) {
        ctx._view = view;
        try { return _dp(ctx, page, doc, view); }
        finally { ctx._view = null; }
      };
    }

    if (P && P.refreshLayers) {
      const _rl = P.refreshLayers.bind(P);
      P.refreshLayers = function () {
        if (App._heavy && App.page) collapseAll(App.page);
        return _rl();
      };
    }

    if (C) {
      if (C.broadcastDoc) {
        const _bc = C.broadcastDoc.bind(C);
        C.broadcastDoc = function (doc, sel) {
          if (App._heavy) return;
          return _bc(doc, sel);
        };
      }
      if (C.join) {
        const _join = C.join.bind(C);
        C.join = function (docId) {
          if (App._heavy) return false;
          return _join(docId);
        };
      }
    }

    const _save = App.saveNow && App.saveNow.bind(App);
    if (_save) {
      App.saveNow = function () {
        if (this._heavy && !this._saveForced) return;
        return _save();
      };
    }

    if (App.history) {
      const h = App.history;
      const _begin = h.begin.bind(h);
      const _end = h.end.bind(h);
      h.begin = function (doc) {
        if (App._heavy) { this._batch = null; return; }
        return _begin(doc);
      };
      h.end = function (doc) {
        if (App._heavy) { this._batch = null; return; }
        return _end(doc);
      };
    }

    const _setSel = App.setSel && App.setSel.bind(App);
    if (_setSel) {
      App.setSel = function (ids) {
        if (this._heavy) {
          this.sel = ids || [];
          if (P && P.refreshInspector) P.refreshInspector();
          if (this._redrawLight) this._redrawLight();
          return;
        }
        return _setSel(ids);
      };
    }

    function closeFigSession() {
      if (App._figWorker) {
        try { App._figWorker.postMessage({ kind: 'close', id: App._figJobId }); } catch (e) {}
        try { App._figWorker.terminate(); } catch (e) {}
      }
      App._figWorker = null;
      App._figJobId = 0;
      App._figLazy = false;
    }

    function requestImages(hashes) {
      const w = App._figWorker;
      if (!w || !hashes || !hashes.length) return;
      w.postMessage({ kind: 'getImages', id: App._figJobId, hashes: hashes.slice(0, 48) });
    }

    function missingHashes(page) {
      const out = [];
      if (!page || !page.nodes) return out;
      for (const id of Object.keys(page.nodes)) {
        const n = page.nodes[id];
        for (const f of (n && n.fills) || []) {
          if (f && f.type === 'image' && f.hash && !f.src) out.push(f.hash);
        }
      }
      return out;
    }

    App.ensureFigPage = function (index) {
      const doc = this.doc;
      if (!doc || !doc.pages || !doc.pages[index]) return;
      const page = doc.pages[index];
      if (!page._lazy) {
        const miss = missingHashes(page);
        if (miss.length) requestImages(miss);
        return;
      }
      if (!this._figWorker || !this._figLazy) return;
      if (this._figPageLoading === index) return;
      this._figPageLoading = index;
      this._showImportProgress && this._showImportProgress(doc.name, 40, 'Loading page “' + (page.name || index) + '”…');
      this._figWorker.postMessage({ kind: 'getPage', id: this._figJobId, index: index });
    };

    // Intercept pageIndex writes so switching pages pulls from the worker.
    {
      let idx = App.pageIndex || 0;
      try {
        Object.defineProperty(App, 'pageIndex', {
          configurable: true,
          get: function () { return idx; },
          set: function (v) {
            idx = v | 0;
            if (this._figLazy) this.ensureFigPage(idx);
          },
        });
      } catch (e) {}
    }

    App.openFromFile = async function (file) {
      if (!file) return;
      const name = file.name || 'file';
      if (/\.pfg$/i.test(name)) {
        const ab = await file.arrayBuffer();
        return this.openFromBytes(new Uint8Array(ab), name, 'pfg');
      }
      const size = file.size || 0;
      if (size >= WARN_BYTES && global.Dialogs) {
        const mb = Math.round(size / (1024 * 1024));
        const ok = await Dialogs.confirm(
          'This .fig is ' + mb + ' MB.\n\nPenfig will keep the file in a background worker, open the first page only, and load images as they appear on screen. Undo and auto-save stay off so the tab does not freeze.\n\nA page with tens of thousands of vectors can still hitch — file size is not the same as layer count.',
          { okLabel: 'Import', title: 'Large file' }
        );
        if (!ok) return;
      }
      this._startImportWorker(file, name, 'fig');
    };

    const _openBytes = App.openFromBytes && App.openFromBytes.bind(App);
    if (_openBytes) {
      App.openFromBytes = function (bytes, name, kind) {
        if (kind === 'fig' && global.FigConv) {
          try {
            const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
            const res = global.FigConv.importFig(u8);
            attachBlobs(res.doc, res.imageBytes);
            armHeavy(res.doc, u8.byteLength);
            this._commitImportedDoc(res.doc, name, res.report, kind);
            return;
          } catch (err) {
            console.error(err);
            this.toast('Failed to open ' + name + ': ' + err.message, 5000, 'error');
            return;
          }
        }
        return _openBytes(bytes, name, kind);
      };
    }

    const _start = App._startImportWorker && App._startImportWorker.bind(App);
    App._startImportWorker = function (bytesOrFile, name, kind) {
      closeFigSession();
      const isFile = (typeof Blob !== 'undefined') && bytesOrFile && typeof bytesOrFile.slice === 'function' && bytesOrFile.size != null && !bytesOrFile.byteLength;
      const size = isFile ? bytesOrFile.size : (bytesOrFile && (bytesOrFile.byteLength || bytesOrFile.length)) || 0;

      const jobId = ++this._importJobId;
      this._figJobId = jobId;
      this._showImportProgress(name, 0, 'Starting worker…');

      let worker;
      try {
        worker = new Worker('src/import-worker.js', { type: 'classic' });
      } catch (err) {
        this._hideImportProgress();
        if (isFile) return bytesOrFile.arrayBuffer().then((ab) => this.openFromBytes(ab, name, kind));
        return this.openFromBytes(bytesOrFile, name, kind);
      }
      this._importWorker = worker;
      this._figWorker = worker;
      const self = this;

      worker.onmessage = function (e) {
        const d = e.data;
        if (!d || d.id !== jobId) return;
        if (d.kind === 'progress') {
          self._showImportProgress(name, d.pct, d.msg, d.phase);
          return;
        }
        if (d.kind === 'images') {
          if (self.doc) {
            attachBlobs(self.doc, imgPairs(d.images));
            self._redrawLight && self._redrawLight();
          }
          return;
        }
        if (d.kind === 'page') {
          self._hideImportProgress && self._hideImportProgress();
          self._figPageLoading = -1;
          try {
            const parsed = decodeMsg(d.json);
            if (self.doc && self.doc.pages[parsed.index]) {
              self.doc.pages[parsed.index] = parsed.page;
              attachBlobs(self.doc, imgPairs(d.images));
              collapseAll(parsed.page);
              try { self.layoutDoc(self.doc, parsed.page); } catch (err) {}
              self.sel = [];
              if (P) { P.refreshLayers(); P.refreshInspector(); }
              self.zoomToFit && self.zoomToFit();
              const miss = missingHashes(parsed.page);
              if (miss.length) requestImages(miss);
            }
          } catch (err) {
            self.toast('Could not load page: ' + err.message, 5000, 'error');
          }
          return;
        }
        if (d.kind === 'done') {
          self._hideImportProgress();
          try {
            const parsed = d.doc ? { doc: d.doc, report: d.report } : decodeMsg(d.json);
            const doc = parsed.doc;
            const report = parsed.report || d.report;
            attachBlobs(doc, imgPairs(d.images));
            self._figLazy = !!d.lazy;
            armHeavy(doc, size);
            if (d.lazy) {
              // Keep worker alive as the document store.
              self._importWorker = worker;
            } else {
              worker.terminate();
              self._importWorker = null;
              self._figWorker = null;
            }
            self._commitImportedDoc(doc, name, report, 'fig');
            const miss = missingHashes(self.page);
            if (miss.length) requestImages(miss);
          } catch (err) {
            console.error(err);
            self.toast('Import failed: ' + err.message, 6000, 'error');
            worker.terminate();
            self._figWorker = null;
          }
          return;
        }
        if (d.kind === 'cancelled') {
          self._hideImportProgress();
          self.toast('Import cancelled', 2500);
          worker.terminate();
          self._figWorker = null;
          return;
        }
        if (d.kind === 'error') {
          self._hideImportProgress();
          console.error('Import worker error:', d.message, d.stack);
          self.toast('Import failed: ' + d.message, 8000, 'error');
          worker.terminate();
          self._figWorker = null;
        }
      };
      worker.onerror = function () {
        self._hideImportProgress();
        self.toast('Import worker crashed — try a smaller file or reload.', 6000, 'error');
        try { worker.terminate(); } catch (e) {}
        self._figWorker = null;
      };

      if (isFile) {
        worker.postMessage({ kind: 'import', id: jobId, format: kind, file: bytesOrFile, name: name });
      } else {
        let ab = bytesOrFile;
        if (ab instanceof Uint8Array) ab = ab.buffer.slice(ab.byteOffset, ab.byteOffset + ab.byteLength);
        else if (!(ab instanceof ArrayBuffer)) ab = new Uint8Array(ab).buffer;
        worker.postMessage({ kind: 'import', id: jobId, format: kind, bytes: ab, name: name }, [ab]);
      }
    };

    const _async = App.openFromBytesAsync && App.openFromBytesAsync.bind(App);
    App.openFromBytesAsync = async function (bytes, name, kind) {
      if (kind === 'fig' && bytes && typeof bytes.slice === 'function' && bytes.size != null && !bytes.byteLength) {
        return this.openFromFile(bytes);
      }
      const size = bytes && (bytes.byteLength != null ? bytes.byteLength : bytes.length) || 0;
      if (kind === 'fig' && size >= WARN_BYTES && global.Dialogs) {
        const mb = Math.round(size / (1024 * 1024));
        const ok = await Dialogs.confirm(
          'This .fig is ' + mb + ' MB. Import runs in a worker. Only the current page and visible images load into this tab.\n\nUndo and auto-save stay off.',
          { okLabel: 'Import', title: 'Large file' }
        );
        if (!ok) return;
      }
      if (kind === 'fig') return this._startImportWorker(bytes, name, kind);
      return _async.call(this, bytes, name, kind);
    };

    const _commit = App._commitImportedDoc && App._commitImportedDoc.bind(App);
    if (_commit) {
      App._commitImportedDoc = function (doc, name, report, kind) {
        armHeavy(doc);
        if (this._heavy && doc && doc.pages && doc.pages[0]) collapseAll(doc.pages[0]);
        const _put = M && M.store && M.store.put;
        if (this._heavy && _put) {
          M.store.put = function (entry) {
            const i = this._list.findIndex(function (f) { return f.id === entry.id; });
            if (i >= 0) this._list[i] = entry; else this._list.push(entry);
            return entry;
          };
        }
        try { _commit(doc, name, report, kind); }
        finally { if (_put) M.store.put = _put; }
        if (this._heavy) {
          this.sel = [];
          const n = this._nodeCount || 0;
          this.toast('Opened ' + n + ' layers on this page. Auto-save off — export .fig to keep a copy.', 5000);
        }
      };
    }

    // Dashboard / drop / inspector import: pass the File, don't arrayBuffer 500 MB on this thread.
    if (Dash && Dash.D && Dash.D.importFile) {
      Dash.D.importFile = async function (file) {
        if (!file) return;
        const A = global.App;
        if (/\.pfg$/i.test(file.name)) {
          const ab = await file.arrayBuffer();
          A.openFromBytes(new Uint8Array(ab), file.name, 'pfg');
        } else {
          A.openFromFile(file);
        }
      };
    }

    const _goDash = App.goDashboard && App.goDashboard.bind(App);
    if (_goDash) {
      App.goDashboard = function () {
        closeFigSession();
        return _goDash();
      };
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
