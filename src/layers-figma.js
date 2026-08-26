/* layers-figma.js — Layers 101 + File tab
 * Figma keeps Pages and Layers in ONE left panel (File tab).
 * Pages on top, layers of the current page underneath.
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
    const P = global.Panels;
    const Ico = global.Icons && global.Icons.svg;
    if (!App || !M || !P || !P.refreshLayers) return;

    function page() { return App.page; }

    function layerIcon(n) {
      if (!n) return 'rect';
      if (n.section) return 'section';
      if (n.isComponent || (App.doc && App.doc.components && App.doc.components[n.id])) return 'component';
      if (n.type === 'instance') return 'instance';
      if (n.al) return n.al.dir === 'h' ? 'wrap_h' : 'frame';
      if (n.type === 'frame' && n.fills && !n.fills.length && n.clips === false) return 'group';
      if (n.type === 'text') return 'text';
      if (n.type === 'vector') {
        if (n.shape === 'star') return 'star';
        if (n.shape === 'polygon') return 'polygon';
        if (n.shape === 'triangle') return 'triangle';
        return 'pen';
      }
      if (n.type === 'line') return n.arrowEnd ? 'arrow' : 'line';
      if (n.type === 'ellipse') return 'ellipse';
      if (n.fills && n.fills.some((f) => f && f.type === 'image')) return 'image';
      if (n.type === 'frame') return 'frame';
      return 'rect';
    }

    function expandAncestors(id) {
      P._collapsed = P._collapsed || {};
      let n = page() && page().nodes[id];
      let changed = false;
      while (n && n.parent) {
        if (P._collapsed[n.parent]) { delete P._collapsed[n.parent]; changed = true; }
        n = page().nodes[n.parent];
      }
      return changed;
    }

    function scrollSelIntoView() {
      const el = document.getElementById('ed-layers');
      if (!el || !App.sel || !App.sel.length) return;
      const last = App.sel[App.sel.length - 1];
      const row = el.querySelector('.ly-row[data-id="' + last + '"]');
      if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
    }

    function startInlineRename(id) {
      const el = document.getElementById('ed-layers');
      const nameEl = el && el.querySelector('.ly-name[data-rename="' + id + '"]');
      const n = page() && page().nodes[id];
      if (!nameEl || !n || nameEl.querySelector('input')) return;
      const input = document.createElement('input');
      input.className = 'ly-rename';
      input.value = n.name || '';
      input.setAttribute('spellcheck', 'false');
      nameEl.textContent = '';
      nameEl.appendChild(input);
      input.focus();
      input.select();
      let done = false;
      const commit = (ok) => {
        if (done) return;
        done = true;
        const next = input.value.trim();
        if (ok && next && next !== n.name) {
          App.history.begin(App.doc);
          n.name = next;
          App.history.end(App.doc);
          App.markDirty();
        }
        P.refreshLayers();
        if (P.refreshInspector) P.refreshInspector();
      };
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); commit(true); }
        if (e.key === 'Escape') { e.preventDefault(); commit(false); }
      });
      input.addEventListener('blur', () => commit(true));
      input.addEventListener('pointerdown', (e) => e.stopPropagation());
    }

    function paintToggle(kind, startId, value) {
      const n = page() && page().nodes[startId];
      if (!n) return;
      App.history.begin(App.doc);
      if (kind === 'eye') n.visible = value;
      else n.locked = value;
      App._lyPaint = { kind, value };
      App.history.end(App.doc);
      P.refreshLayers();
      App.markDirty();
    }

    function focusFileTab() {
      const ed = document.getElementById('view-editor');
      const tab = ed && ed.querySelector('.ed-ltab[data-tab="layers"]');
      if (tab) tab.click();
    }

    function switchPage(i) {
      if (!App.doc || i < 0 || i >= App.doc.pages.length) return;
      App.pageIndex = i;
      App.sel = [];
      if (App.renderPagename) App.renderPagename();
      P.refreshLayers();
      if (P.refreshInspector) P.refreshInspector();
      App.markDirty();
      if (App.zoomToFit) requestAnimationFrame(() => App.zoomToFit());
    }

    function renamePage(i) {
      const pg = App.doc && App.doc.pages[i];
      if (!pg) return;
      const row = document.querySelector('.pf-pg-row[data-i="' + i + '"] .pf-pg-name');
      if (!row || row.querySelector('input')) return;
      const input = document.createElement('input');
      input.className = 'ly-rename';
      input.value = pg.name || '';
      input.setAttribute('spellcheck', 'false');
      row.textContent = '';
      row.appendChild(input);
      input.focus();
      input.select();
      let done = false;
      const commit = (ok) => {
        if (done) return;
        done = true;
        const next = input.value.trim();
        if (ok && next) {
          pg.name = next;
          if (App.renderPagename) App.renderPagename();
          App.markDirty();
        }
        P.refreshLayers();
      };
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); commit(true); }
        if (e.key === 'Escape') { e.preventDefault(); commit(false); }
      });
      input.addEventListener('blur', () => commit(true));
      input.addEventListener('pointerdown', (e) => e.stopPropagation());
    }

    function addPage() {
      if (!App.doc) return;
      App.history.begin(App.doc);
      M.addPage(App.doc, 'Page ' + (App.doc.pages.length + 1));
      App.history.end(App.doc);
      switchPage(App.doc.pages.length - 1);
    }

    function deletePage(i) {
      const doc = App.doc;
      if (!doc || doc.pages.length <= 1) { App.toast('You need at least one page'); return; }
      const name = doc.pages[i] && doc.pages[i].name;
      if (!confirm('Delete page “' + name + '”?')) return;
      App.history.begin(doc);
      doc.pages.splice(i, 1);
      App.history.end(doc);
      if (App.pageIndex >= doc.pages.length) App.pageIndex = doc.pages.length - 1;
      if (App.pageIndex === i && i > 0) App.pageIndex = i - 1;
      if (App.pageIndex >= doc.pages.length) App.pageIndex = doc.pages.length - 1;
      App.sel = [];
      if (App.renderPagename) App.renderPagename();
      P.refreshLayers();
      if (P.refreshInspector) P.refreshInspector();
      App.markDirty();
    }

    function renderFilePages(host) {
      if (!host || !App.doc) return;
      let wrap = host.querySelector('#pf-file-pages');
      if (!wrap) {
        wrap = document.createElement('div');
        wrap.id = 'pf-file-pages';
        wrap.className = 'pf-file-pages';
        const layers = document.getElementById('ed-layers');
        host.insertBefore(wrap, layers || host.firstChild);
      }
      wrap.innerHTML =
        '<div class="pf-file-head">' +
          '<span>' + (Ico ? Ico('pages', { size: 12 }) : '') + ' Pages</span>' +
          '<button type="button" class="mini" data-pg="add" title="Add page">' + (Ico ? Ico('plus', { size: 11 }) : '+') + '</button>' +
        '</div>' +
        App.doc.pages.map((pg, i) =>
          '<div class="pf-pg-row' + (i === App.pageIndex ? ' on' : '') + '" data-i="' + i + '">' +
            (Ico ? Ico('pages', { size: 13 }) : '') +
            '<span class="pf-pg-name">' + M.esc(pg.name) + '</span>' +
            '<button type="button" class="mini pf-pg-del" data-pgdel="' + i + '" title="Delete page">' +
              (Ico ? Ico('trash', { size: 11 }) : '×') +
            '</button>' +
          '</div>'
        ).join('') +
        '<div class="pf-file-head pf-file-layers-head"><span>' + (Ico ? Ico('layers', { size: 12 }) : '') + ' Layers</span></div>';

      wrap.querySelector('[data-pg="add"]').onclick = (e) => { e.stopPropagation(); addPage(); };
      wrap.querySelectorAll('.pf-pg-row').forEach((row) => {
        row.addEventListener('click', (e) => {
          if (e.target.closest('[data-pgdel]')) return;
          switchPage(+row.dataset.i);
        });
        row.addEventListener('dblclick', (e) => {
          if (e.target.closest('[data-pgdel]')) return;
          e.preventDefault();
          renamePage(+row.dataset.i);
        });
      });
      wrap.querySelectorAll('[data-pgdel]').forEach((b) => {
        b.addEventListener('click', (e) => { e.stopPropagation(); deletePage(+b.dataset.pgdel); });
      });

      // Hide the leftover standalone Pages panel if it still exists.
      const orphan = document.getElementById('ed-pages');
      if (orphan) orphan.style.display = 'none';
      document.querySelectorAll('.ed-ltab[data-tab="pages"]').forEach((t) => { t.style.display = 'none'; });
    }

    const _attach = M.attach.bind(M);
    M.attach = function (doc, pg, parentId, n, index) {
      if (index == null && App.sel && App.sel.length === 1 && pg && pg.nodes) {
        const sel = pg.nodes[App.sel[0]];
        const wantParent = parentId || null;
        if (sel && (sel.parent || null) === wantParent) {
          const list = parentId ? (pg.nodes[parentId] && pg.nodes[parentId].children) : pg.tops;
          const i = list ? list.indexOf(sel.id) : -1;
          if (i >= 0) index = i + 1;
        }
      }
      return _attach(doc, pg, parentId, n, index);
    };

    const _setSel = App.setSel.bind(App);
    App.setSel = function (ids) {
      let needRefresh = false;
      for (const id of ids || []) if (expandAncestors(id)) needRefresh = true;
      _setSel(ids);
      if (needRefresh) P.refreshLayers();
      requestAnimationFrame(scrollSelIntoView);
    };

    const _rl = P.refreshLayers.bind(P);
    P.refreshLayers = function () {
      _rl();
      const el = document.getElementById('ed-layers');
      if (!el || !page()) return;

      renderFilePages(el.parentElement);

      el.querySelectorAll('.ly-row').forEach((row) => {
        const id = row.dataset.id;
        const n = page().nodes[id];
        if (!n) return;

        row.classList.toggle('hidden', n.visible === false);
        row.classList.toggle('locked', !!n.locked);
        row.classList.toggle('comp', !!(n.isComponent || (App.doc.components && App.doc.components[n.id])));
        row.classList.toggle('inst', n.type === 'instance');
        row.classList.toggle('section', !!n.section);
        row.classList.toggle('hover', App.hoverId === id);

        const ico = row.querySelector('.ly-ico');
        if (ico && Ico) ico.innerHTML = Ico(layerIcon(n), { size: 13 });

        const name = row.querySelector('.ly-name');
        if (name && !name.querySelector('input') && !name._lyInline) {
          const fresh = name.cloneNode(true);
          fresh._lyInline = true;
          name.replaceWith(fresh);
          fresh.addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
            startInlineRename(id);
          });
        }

        if (row._lyFigma) return;
        row._lyFigma = true;

        row.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (!App.sel.includes(id)) App.setSel([id]);
          if (P.contextMenu) P.contextMenu(e.clientX, e.clientY, App.sel.slice());
        });

        const eye = row.querySelector('[data-eye]');
        const lock = row.querySelector('[data-lock]');
        if (eye) {
          eye.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            const cur = page().nodes[id];
            if (cur) paintToggle('eye', id, cur.visible === false);
          });
        }
        if (lock) {
          lock.addEventListener('pointerdown', (e) => {
            e.stopPropagation();
            const cur = page().nodes[id];
            if (cur) paintToggle('lock', id, !cur.locked);
          });
        }
        row.addEventListener('pointerenter', () => {
          if (!App._lyPaint) return;
          const cur = page().nodes[id];
          if (!cur) return;
          if (App._lyPaint.kind === 'eye') {
            if (cur.visible === App._lyPaint.value) return;
            cur.visible = App._lyPaint.value;
          } else {
            if (cur.locked === App._lyPaint.value) return;
            cur.locked = App._lyPaint.value;
          }
          row.classList.toggle('hidden', cur.visible === false);
          row.classList.toggle('locked', !!cur.locked);
          App.markDirty();
        });
      });

      requestAnimationFrame(scrollSelIntoView);
    };

    // Old Pages tab callers still work — they just refresh the File panel.
    const _rp = P.renderPages && P.renderPages.bind(P);
    P.renderPages = function () {
      const el = document.getElementById('ed-layers');
      if (el) renderFilePages(el.parentElement);
      else if (_rp) _rp();
    };

    window.addEventListener('pointerup', () => { App._lyPaint = null; });

    const _redraw = App.redraw && App.redraw.bind(App);
    if (_redraw) {
      App.redraw = function () {
        _redraw();
        const el = document.getElementById('ed-layers');
        if (!el) return;
        el.querySelectorAll('.ly-row').forEach((row) => {
          row.classList.toggle('hover', App.hoverId === row.dataset.id && !App.sel.includes(row.dataset.id));
        });
      };
    }

    if (global.Shortcuts && global.Shortcuts.def) {
      global.Shortcuts.def('alt+1', 'Show file / layers', 'View', () => focusFileTab());
      global.Shortcuts.def('alt+2', 'Show assets', 'View', () => {
        const t = document.querySelector('.ed-ltab[data-tab="assets"]');
        if (t) t.click();
      });
    }

    const _build = App.buildChrome && App.buildChrome.bind(App);
    if (_build) {
      App.buildChrome = function () {
        _build();
        document.querySelectorAll('.ed-ltab[data-tab="pages"]').forEach((t) => { t.style.display = 'none'; });
        const orphan = document.getElementById('ed-pages');
        if (orphan) orphan.style.display = 'none';
      };
    }

    if (App.doc) P.refreshLayers();
  });
})(window);
