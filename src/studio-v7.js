/* studio-v7.js — Figma-parity closeout for the blank-import bug and chrome.
 * Loads last so it wins over p0-fixes / enhancements monkey-patches.
 */
(function (global) {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'complete') return fn();
    window.addEventListener('load', fn, { once: true });
  }

  ready(function () {
    const App = global.App;
    const M = global.Model;
    const R = global.Renderer;
    if (!App || !M) return;

    // ---- Camera: always layout before fitting ----------------------------
    const _zoomToFit = App.zoomToFit && App.zoomToFit.bind(App);
    App.zoomToFit = function () {
      if (this.doc && this.page) {
        try { this.layoutDoc(this.doc, this.page); } catch (e) {}
      }
      if (_zoomToFit) return _zoomToFit();
    };

    // ---- Paste image from clipboard (Figma ⌘V) ---------------------------
    if (!App._pasteImgBound) {
      App._pasteImgBound = true;
      window.addEventListener('paste', (e) => {
        if (!App.doc || !App.canvas) return;
        const t = e.target;
        if (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName || '')) return;
        const items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        for (const it of items) {
          if (it.type && it.type.startsWith('image/')) {
            e.preventDefault();
            const file = it.getAsFile();
            if (!file || !App.placeImageFile) return;
            const rect = App.canvas.getBoundingClientRect();
            const at = App.toWorld({ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 });
            App.placeImageFile(file, at);
            App.toast('Placed image from clipboard', 2200, 'success');
            return;
          }
        }
      });
    }

    // ---- Drag .fig onto the whole editor (not just the canvas) -----------
    const ed = document.getElementById('view-editor');
    if (ed && !ed._figDrop) {
      ed._figDrop = true;
      ed.addEventListener('dragover', (e) => {
        if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      });
    }

    // ---- First-open hint when an imported page looks empty ---------------
    const _commit = App._commitImportedDoc && App._commitImportedDoc.bind(App);
    if (_commit) {
      App._commitImportedDoc = function (doc, name, report, kind) {
        _commit(doc, name, report, kind);
        setTimeout(() => {
          if (!this.page) return;
          try { this.layoutDoc(this.doc, this.page); } catch (e) {}
          this.zoomToFit();
          const tops = (this.page.tops || []).map(id => this.page.nodes[id]).filter(Boolean);
          if (tops.length && !this.sel.length) this.setSel([tops[0].id]);
          const count = Object.keys(this.page.nodes || {}).length;
          if (count && report && report.nodes) {
            this.status(report.nodes + ' layers imported · ⇧1 to fit');
          }
        }, 80);
      };
    }
  });
})(window);
