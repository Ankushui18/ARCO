/* import-figma.js — keep .fig import off the UI thread and don't freeze
 * the tab writing IndexedDB the instant the file lands.
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
    if (!App || !M) return;

    const _commit = App._commitImportedDoc && App._commitImportedDoc.bind(App);
    if (_commit) {
      App._commitImportedDoc = function (doc, name, report, kind) {
        const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        _commit(doc, name, report, kind);
        // Huge imports stringify into IDB 500ms later and hitch the tab.
        // Push that write out so the first paint + zoom-to-fit can finish.
        try {
          if (M.store && M.store._flushTimer) {
            clearTimeout(M.store._flushTimer);
            M.store._flushTimer = setTimeout(function () {
              try { M.store.flush(); } catch (e) {}
            }, 8000);
          }
        } catch (e) {}
        if (report) {
          report.ms = Math.round(((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0);
          const skip = report.skipped || {};
          const skipN = Object.keys(skip).reduce(function (a, k) { return a + skip[k]; }, 0);
          if (skipN) {
            report.warnings = report.warnings || [];
            report.warnings.unshift(skipN + ' layers of unsupported type kept as frames (' +
              Object.keys(skip).map(function (k) { return k + '×' + skip[k]; }).join(', ') + ')');
          }
        }
      };
    }

    const _summary = App._showImportSummary && App._showImportSummary.bind(App);
    if (_summary) {
      App._showImportSummary = function (docName, r) {
        r = r || {};
        if (this.doc && this.doc.pages) {
          r.pages = this.doc.pages.length;
          let nodes = 0;
          for (let i = 0; i < this.doc.pages.length; i++) {
            nodes += Object.keys(this.doc.pages[i].nodes || {}).length;
          }
          r.nodes = r.nodes || nodes;
        }
        return _summary(docName, r);
      };
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
