/* main.js — routing + boot */
(function () {
  'use strict';
  const M = window.Model;

  function route() {
    const h = location.hash || '#/';
    const m = h.match(/^#\/file\/(.+)$/);
    if (m) {
      if (window.App.doc && window.App.doc.id === m[1]) return;
      window.App.openFile(m[1]);
    } else {
      window.App.goDashboard();
    }
  }

  // boot: wait for the durable store (IndexedDB) to load, then seed a starter
  // file on first run and route. All file I/O below this point is safe.
  M.store.init().then(() => {
    if (!M.store.all().length) {
      try {
        const doc = window.Dash.makeStarterDoc();
        window.Dash.saveDoc(doc);
      } catch (e) { console.warn('starter failed', e); }
    }
    route();
  }).catch(e => {
    console.warn('store init failed, continuing in-memory', e);
    window.App.showDashboard();
  });

  window.addEventListener('hashchange', route);
  window.addEventListener('beforeunload', () => window.App.saveNow && window.App.saveNow());
  // best-effort durable flush when the tab goes away
  window.addEventListener('pagehide', () => { try { M.store.flush(); } catch (e) { } });
})();
