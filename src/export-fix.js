/* export-fix.js — make Export actually produce a file.
 *
 * Two failures we hit:
 *   1. The popover closer deleted the menu on pointerdown, so the button
 *      `click` never ran (every format looked "dead").
 *   2. Programmatic <a download> is silently ignored inside a sandboxed
 *      preview iframe (no allow-downloads). Need File System Access plus
 *      a visible Save link as fallback.
 */
(function (global) {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'complete') return fn();
    window.addEventListener('load', fn, { once: true });
  }

  function extOf(name) {
    const m = String(name || '').match(/\.([a-z0-9]+)$/i);
    return m ? m[1].toLowerCase() : 'bin';
  }

  function inFrame() {
    try { return window.top !== window.self; } catch (e) { return true; }
  }

  function showSaveSheet(blob, filename) {
    document.querySelectorAll('.pf-save-sheet').forEach((n) => n.remove());
    const url = URL.createObjectURL(blob);
    const sheet = document.createElement('div');
    sheet.className = 'pf-save-sheet';
    const isImg = /^image\//.test(blob.type);
    sheet.innerHTML =
      '<div class="pf-save-card">' +
        '<div class="pf-save-head"><b>Export ready</b><button type="button" data-x aria-label="Close">×</button></div>' +
        '<p>Your browser blocked the automatic download (common in a preview iframe). Save it here:</p>' +
        '<a class="pf-save-btn" download="' + filename.replace(/"/g, '') + '" href="' + url + '" rel="noopener">Save ' + filename.replace(/</g, '') + '</a>' +
        (isImg ? '<img class="pf-save-preview" alt="" src="' + url + '">' : '') +
        '<button type="button" class="pf-save-copy" data-copy>Copy file to clipboard</button>' +
      '</div>';
    document.body.appendChild(sheet);
    const close = () => { sheet.remove(); setTimeout(() => URL.revokeObjectURL(url), 4000); };
    sheet.addEventListener('click', (e) => { if (e.target === sheet || e.target.closest('[data-x]')) close(); });
    const copyBtn = sheet.querySelector('[data-copy]');
    if (copyBtn) copyBtn.onclick = async () => {
      try {
        if (navigator.clipboard && window.ClipboardItem) {
          await navigator.clipboard.write([new ClipboardItem({ [blob.type || 'application/octet-stream']: blob })]);
          copyBtn.textContent = 'Copied';
        } else {
          copyBtn.textContent = 'Clipboard not available';
        }
      } catch (e) {
        copyBtn.textContent = 'Copy failed';
      }
    };
    return sheet;
  }

  async function saveBlob(blob, filename) {
    if (!(blob instanceof Blob)) blob = new Blob([blob]);
    filename = filename || 'export.bin';

    if (typeof window.showSaveFilePicker === 'function') {
      try {
        const ext = '.' + extOf(filename);
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: filename, accept: { [blob.type || 'application/octet-stream']: [ext] } }],
        });
        const w = await handle.createWritable();
        await w.write(blob);
        await w.close();
        return 'picker';
      } catch (e) {
        if (e && e.name === 'AbortError') return 'abort';
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    let clicked = false;
    try { a.click(); clicked = true; } catch (e) { clicked = false; }
    setTimeout(() => { a.remove(); }, 0);

    // Preview iframes swallow <a download>. Always offer a visible Save.
    if (inFrame() || !clicked) {
      showSaveSheet(blob, filename);
      return 'sheet';
    }
    setTimeout(() => URL.revokeObjectURL(url), 8000);
    return 'anchor';
  }

  function downloadBytes(bytes, filename, mime) {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    const blob = new Blob([u8], { type: mime || 'application/octet-stream' });
    return saveBlob(blob, filename);
  }

  global.PenfigSave = { saveBlob, downloadBytes, showSaveSheet };

  ready(function () {
    const App = global.App;
    const P = global.Panels;
    const R = global.Renderer;
    const T = global.Tokens;
    if (!App || !P) return;

    // Keep the source-of-truth closer from eating menu clicks even if an
    // older ui-panels.js is cached.
    const _menu = P._menu && P._menu.bind(P);
    P._menu = function (el) {
      document.querySelectorAll('.pf-menu').forEach((m) => { if (m !== el) m.remove(); });
      if (el && !el.parentNode) document.body.appendChild(el);
      const close = (e) => {
        if (e && el.contains(e.target)) return;
        el.remove();
        document.removeEventListener('pointerdown', close, true);
      };
      setTimeout(() => document.addEventListener('pointerdown', close, true), 0);
      return el;
    };
    if (!_menu) { /* first install */ }

    App._downloadBytes = function (bytes, filename, mime) {
      downloadBytes(bytes, filename, mime).then((how) => {
        if (how === 'abort') return;
        if (how === 'sheet') this.toast('Click Save in the panel to keep the file', 4000);
      }).catch((err) => this.toast('Save failed: ' + err.message, 6000, 'error'));
    };

    if (global.Dash && global.Dash.downloadBytes) {
      global.Dash.downloadBytes = function (bytes, name, mime) {
        downloadBytes(bytes, name, mime);
      };
    }

    function safe(label, fn) {
      return function () {
        try {
          const out = fn();
          if (out && typeof out.then === 'function') {
            out.catch((err) => {
              console.error(err);
              App.toast(label + ' failed: ' + (err && err.message || err), 7000, 'error');
            });
          }
        } catch (err) {
          console.error(err);
          App.toast(label + ' failed: ' + (err && err.message || err), 7000, 'error');
        }
      };
    }

    function exportPng(isSel, scale) {
      const doc = App.doc, page = App.page;
      App.layoutDoc(doc, page);
      const b = isSel ? R.selectionBounds(page, App.sel) : R.pageBounds(page);
      if (!b) { App.toast('Nothing to export'); return; }
      const c = R.renderRegion(page, doc, b, scale, { background: '#ffffff' });
      return new Promise((resolve, reject) => {
        c.toBlob((blob) => {
          if (!blob) return reject(new Error('PNG encode failed'));
          saveBlob(blob, doc.name + (isSel ? '-selection' : '-page') + '@' + scale + 'x.png')
            .then(() => { App.toast('Exported PNG (' + scale + '×)', 2500, 'success'); resolve(); })
            .catch(reject);
        }, 'image/png');
      });
    }

    function exportSvg(isSel) {
      const doc = App.doc, page = App.page;
      App.layoutDoc(doc, page);
      const Svg = global.SvgExport;
      if (!Svg) throw new Error('SVG exporter missing');
      let svg;
      if (isSel) {
        if (!App.sel.length) { App.toast('Select something first'); return; }
        if (App.sel.length === 1) svg = Svg.renderNode(doc, page, page.nodes[App.sel[0]]);
        else {
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          const body = [];
          for (const id of App.sel) {
            const nd = page.nodes[id];
            if (!nd || !nd._w) continue;
            minX = Math.min(minX, nd._w.x); minY = Math.min(minY, nd._w.y);
            maxX = Math.max(maxX, nd._w.x + nd._w.w); maxY = Math.max(maxY, nd._w.y + nd._w.h);
            body.push(Svg.renderNode(doc, page, nd).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, ''));
          }
          if (!isFinite(minX)) { App.toast('Nothing to export'); return; }
          svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.ceil(maxX - minX) + '" height="' + Math.ceil(maxY - minY) + '" viewBox="' + minX + ' ' + minY + ' ' + Math.ceil(maxX - minX) + ' ' + Math.ceil(maxY - minY) + '">\n' + body.join('\n') + '\n</svg>';
        }
        return saveBlob(new Blob([svg], { type: 'image/svg+xml' }), doc.name + '-selection.svg')
          .then(() => App.toast('Exported SVG', 2500, 'success'));
      }
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const tid of page.tops) {
        const nd = page.nodes[tid];
        if (!nd) continue;
        const bb = nd._w;
        if (!bb) continue;
        minX = Math.min(minX, bb.x); minY = Math.min(minY, bb.y);
        maxX = Math.max(maxX, bb.x + bb.w); maxY = Math.max(maxY, bb.y + bb.h);
      }
      if (!isFinite(minX)) { App.toast('Nothing to export'); return; }
      const body = page.tops.map((tid) => {
        const nd = page.nodes[tid];
        return nd ? Svg.renderNode(doc, page, nd).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '') : '';
      }).join('\n');
      svg = '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.ceil(maxX - minX) + '" height="' + Math.ceil(maxY - minY) + '" viewBox="' + minX + ' ' + minY + ' ' + Math.ceil(maxX - minX) + ' ' + Math.ceil(maxY - minY) + '">\n' + body + '\n</svg>';
      return saveBlob(new Blob([svg], { type: 'image/svg+xml' }), doc.name + '-page.svg')
        .then(() => App.toast('Exported SVG', 2500, 'success'));
    }

    function exportPdf(isSel) {
      const doc = App.doc, page = App.page;
      App.layoutDoc(doc, page);
      const Pdf = global.PdfExport;
      if (!Pdf) throw new Error('PDF exporter missing');
      if (isSel && !App.sel.length) { App.toast('Select something first'); return; }
      const res = isSel
        ? (App.sel.length === 1 ? Pdf.renderNode(doc, page, page.nodes[App.sel[0]]) : Pdf._render(page, App.sel.map((id) => page.nodes[id]).filter(Boolean), {}))
        : Pdf.renderPage(doc, page);
      const bytes = Uint8Array.from(res.pdf, (ch) => ch.charCodeAt(0) & 0xff);
      return saveBlob(new Blob([bytes], { type: 'application/pdf' }), doc.name + (isSel ? '-selection' : '-page') + '.pdf')
        .then(() => App.toast('Exported PDF', 2500, 'success'));
    }

    function exportFig() {
      const doc = App.doc;
      App.saveNow();
      App.layoutDoc(doc, App.page);
      let thumb = '';
      try { thumb = global.Dash.thumbDataURL(doc, App.page, 480); } catch (e) {}
      return App.exportFigAsync(doc, doc.name, { thumbnail: thumb }).then(
        () => App.toast('Exported ' + doc.name + '.fig', 4000, 'success'),
        (err) => { throw err; }
      );
    }

    function exportPfg() {
      const doc = App.doc;
      App.saveNow();
      const bytes = global.Dash.exportPfgBytes(doc);
      return saveBlob(new Blob([bytes], { type: 'application/zip' }), doc.name + '.pfg')
        .then(() => App.toast('Exported ' + doc.name + '.pfg', 4000, 'success'));
    }

    const _exportMenu = P.exportMenu.bind(P);
    P.exportMenu = function (x, y) {
      const doc = App.doc;
      if (!doc) { App.toast('Open a file first'); return; }
      const el = document.createElement('div');
      el.className = 'pf-menu';
      const Ico = global.Icons && global.Icons.svg ? global.Icons.svg : function () { return ''; };
      el.innerHTML =
        '<div class="pf-title">Export selection</div>' +
        (App.sel.length
          ? '<button type="button" data-x="sel-png-1">' + Ico('png', { size: 13 }) + ' PNG (1×)</button>' +
            '<button type="button" data-x="sel-png-2">' + Ico('png', { size: 13 }) + ' PNG (2×)</button>' +
            '<button type="button" data-x="sel-svg">' + Ico('svg', { size: 13 }) + ' SVG</button>' +
            '<button type="button" data-x="sel-pdf">' + Ico('pdf', { size: 13 }) + ' PDF</button>'
          : '<div class="ph" style="padding:6px 10px">Select a layer to export a slice, or use page export below.</div>') +
        '<div class="pf-title">Export page</div>' +
        '<button type="button" data-x="page-png-1">' + Ico('png', { size: 13 }) + ' PNG (1×)</button>' +
        '<button type="button" data-x="page-png-2">' + Ico('png', { size: 13 }) + ' PNG (2×)</button>' +
        '<button type="button" data-x="page-svg">' + Ico('svg', { size: 13 }) + ' SVG</button>' +
        '<button type="button" data-x="page-pdf">' + Ico('pdf', { size: 13 }) + ' PDF</button>' +
        '<hr><div class="pf-title">File formats</div>' +
        '<button type="button" data-x="fig">' + Ico('fig', { size: 13 }) + ' Figma file (.fig)</button>' +
        '<button type="button" data-x="pfg">' + Ico('pfg', { size: 13 }) + ' Penfig file (.pfg)</button>' +
        '<hr><div class="pf-title">Design tokens</div>' +
        '<button type="button" data-x="tok-json">' + Ico('code', { size: 12 }) + ' JSON (W3C DTCG)</button>' +
        '<button type="button" data-x="tok-css">' + Ico('css', { size: 12 }) + ' CSS variables</button>';
      if (x == null) {
        const r = document.getElementById('ed-export');
        if (r) { const b = r.getBoundingClientRect(); x = b.right; y = b.bottom + 4; }
        else { x = innerWidth - 80; y = 56; }
      }
      el.style.left = Math.min(x, innerWidth - 260) + 'px';
      el.style.top = Math.min(y, innerHeight - 300) + 'px';
      P._menu(el);

      const run = {
        'sel-png-1': safe('PNG', () => exportPng(true, 1)),
        'sel-png-2': safe('PNG', () => exportPng(true, 2)),
        'page-png-1': safe('PNG', () => exportPng(false, 1)),
        'page-png-2': safe('PNG', () => exportPng(false, 2)),
        'sel-svg': safe('SVG', () => exportSvg(true)),
        'page-svg': safe('SVG', () => exportSvg(false)),
        'sel-pdf': safe('PDF', () => exportPdf(true)),
        'page-pdf': safe('PDF', () => exportPdf(false)),
        fig: safe('.fig', exportFig),
        pfg: safe('.pfg', exportPfg),
        'tok-json': safe('JSON', () => saveBlob(new Blob([JSON.stringify(T.exportW3C(doc), null, 2)], { type: 'application/json' }), doc.name + '-tokens.json')),
        'tok-css': safe('CSS', () => saveBlob(new Blob([T.exportCSS(doc)], { type: 'text/css' }), doc.name + '-tokens.css')),
      };

      // pointerdown + click: pointerdown wins the race against the closer.
      el.querySelectorAll('button[data-x]').forEach((b) => {
        const go = (e) => {
          e.preventDefault();
          e.stopPropagation();
          const key = b.dataset.x;
          el.remove();
          if (run[key]) run[key]();
        };
        b.addEventListener('pointerdown', go);
        b.addEventListener('click', go);
      });
    };

    // Keep the original around for debugging.
    P._exportMenuOrig = _exportMenu;
  });
})(window);
