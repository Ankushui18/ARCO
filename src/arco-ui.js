/* arco-ui.js — ARCO chrome from the interface audit.
 * Left tool rail. Menu bar. Inspector folds. Canvas first.
 * Moves existing DOM (keeps inspector listeners). Does not rewrite cores.
 */
(function (global) {
  'use strict';

  function ready(fn) {
    if (typeof document === 'undefined') return;
    if (document.readyState === 'complete') return fn();
    window.addEventListener('load', fn, { once: true });
  }

  const PRIMARY = { move: 1, frame: 1, rect: 1, pen: 1, text: 1, hand: 1 };

  const TYPE_LABEL = {
    frame: 'Frame', instance: 'Instance', text: 'Text', rect: 'Rectangle',
    ellipse: 'Ellipse', line: 'Line', vector: 'Vector', group: 'Group',
  };

  function typeLabel(n) {
    if (!n) return '';
    if (n.section) return 'Section';
    if (n.shape === 'star') return 'Star';
    if (n.shape === 'polygon') return 'Polygon';
    if (n.shape === 'triangle') return 'Triangle';
    return TYPE_LABEL[n.type] || n.type;
  }

  function placeRail() {
    const tb = document.getElementById('ed-toolbar');
    if (!tb) return;
    tb.classList.add('arco-rail');
    tb.querySelectorAll('.tool').forEach((b) => {
      const t = b.dataset.tool;
      b.style.display = PRIMARY[t] ? '' : 'none';
      if (t === 'frame' || t === 'rect' || t === 'pen') b.classList.add('has-fly');
      const key = b.querySelector('.tool-key');
      if (key) key.remove();
    });
    tb.querySelectorAll('.tb-sep, .tool-caret').forEach((s) => { s.style.display = 'none'; });
    requestAnimationFrame(() => {
      const parent = tb.parentElement;
      if (!parent) return;
      const y = Math.round(Math.max(12, (parent.clientHeight - tb.offsetHeight) / 2));
      tb.style.top = y + 'px';
      tb.style.left = '12px';
      tb.style.bottom = 'auto';
      tb.style.transform = 'none';
    });
  }

  function placeFlyouts() {
    document.querySelectorAll('.pf-flyout').forEach((fly) => {
      const tb = document.getElementById('ed-toolbar');
      if (!tb) return;
      const active = tb.querySelector('.tool.active.has-fly') || tb.querySelector('.tool.has-fly');
      const r = (active || tb).getBoundingClientRect();
      fly.classList.add('arco-fly-right');
      fly.classList.remove('pf-fly-up');
      fly.style.left = (r.right + 8) + 'px';
      fly.style.top = Math.max(48, r.top) + 'px';
      fly.style.bottom = 'auto';
    });
  }

  function item(label, hint, fn) {
    return { label, hint, fn };
  }

  function openMenu(anchor, items) {
    document.querySelectorAll('.arco-bar-menu').forEach((m) => m.remove());
    const el = document.createElement('div');
    el.className = 'pf-menu arco-bar-menu';
    el.innerHTML = items.map((it, i) => {
      if (it === '—') return '<hr>';
      return `<button type="button" data-i="${i}">${it.label}${it.hint ? `<span class="kbd">${it.hint}</span>` : ''}</button>`;
    }).join('');
    const r = anchor.getBoundingClientRect();
    el.style.left = r.left + 'px';
    el.style.top = (r.bottom + 4) + 'px';
    document.body.appendChild(el);
    anchor.setAttribute('aria-expanded', 'true');
    el.querySelectorAll('button[data-i]').forEach((b) => {
      b.addEventListener('click', () => {
        const it = items[+b.dataset.i];
        el.remove();
        anchor.setAttribute('aria-expanded', 'false');
        if (it && it.fn) it.fn();
      });
    });
    const close = (e) => {
      if (el.contains(e.target) || anchor.contains(e.target)) return;
      el.remove();
      anchor.setAttribute('aria-expanded', 'false');
      document.removeEventListener('pointerdown', close, true);
    };
    setTimeout(() => document.addEventListener('pointerdown', close, true), 0);
  }

  function buildMenus(ed) {
    const top = ed.querySelector('.ed-top');
    if (!top || top.querySelector('.arco-menus')) return;
    const brand = top.querySelector('.ed-brand');
    if (brand) {
      const name = brand.querySelector('span:last-child');
      if (name) name.textContent = 'ARCO';
      const mark = brand.querySelector('.ed-brand-mark');
      if (mark) mark.textContent = 'A';
    }
    const menus = document.createElement('div');
    menus.className = 'arco-menus';
    const defs = [
      ['File', fileItems],
      ['Edit', editItems],
      ['View', viewItems],
      ['Object', objectItems],
      ['Arrange', arrangeItems],
    ];
    defs.forEach(([label, factory]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'arco-menu-btn';
      b.textContent = label;
      b.setAttribute('aria-expanded', 'false');
      b.addEventListener('click', (e) => {
        e.stopPropagation();
        openMenu(b, factory());
      });
      menus.appendChild(b);
    });
    const fn = top.querySelector('.ed-filename-wrap');
    if (fn) top.insertBefore(menus, fn);
    else top.appendChild(menus);

    const modes = document.createElement('div');
    modes.className = 'arco-modes';
    modes.innerHTML =
      '<button type="button" data-mode="design" class="on">Design</button>' +
      '<button type="button" data-mode="prototype">Prototype</button>';
    const center = top.querySelector('.ed-top-center') || top.querySelector('.ed-top-right');
    if (center) top.insertBefore(modes, center);
    else top.appendChild(modes);
    modes.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      modes.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      const P = global.Panels;
      if (P) {
        P._inspectorTab = b.dataset.mode;
        P.refreshInspector();
      }
    }));
  }

  function fileItems() {
    const A = global.App, P = global.Panels;
    return [
      item('Back to files', '', () => A.goDashboard()),
      '—',
      item('Save', '⌘S', () => { A.saveManual ? A.saveManual() : A.saveNow(); A.toast && A.toast('Saved'); }),
      item('Export…', '⌘E', () => P && P.exportMenu()),
      item('Import .fig', '', () => {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = '.fig,.pfg';
        inp.onchange = () => {
          const f = inp.files && inp.files[0];
          if (!f) return;
          f.arrayBuffer().then((buf) => A.openFromBytesAsync(buf, f.name, /\.pfg$/i.test(f.name) ? 'pfg' : 'fig'));
        };
        inp.click();
      }),
    ];
  }

  function editItems() {
    const A = global.App;
    return [
      item('Undo', '⌘Z', () => A.historyUndo()),
      item('Redo', '⇧⌘Z', () => A.historyRedo()),
      '—',
      item('Cut', '⌘X', () => A.copySel && A.copySel(true)),
      item('Copy', '⌘C', () => A.copySel && A.copySel()),
      item('Paste', '⌘V', () => A.paste && A.paste()),
      item('Duplicate', '⌘D', () => A.duplicateSel && A.duplicateSel()),
      item('Delete', '⌫', () => A.deleteSel && A.deleteSel()),
      '—',
      item('Select all', '⌘A', () => A.selectAll && A.selectAll()),
    ];
  }

  function viewItems() {
    const A = global.App, P = global.Panels;
    const v = A.view || {};
    return [
      item('Zoom to fit', '⇧1', () => A.zoomToFit()),
      item('Zoom to selection', '⇧2', () => A.zoomToSelection && A.zoomToSelection()),
      item('Zoom to 100%', '⇧0', () => A.zoomTo100 && A.zoomTo100()),
      '—',
      item((v.rulers ? '✓  ' : '') + 'Rulers', '⇧R', () => A.toggleView && A.toggleView('rulers')),
      item((v.grid ? '✓  ' : '') + 'Grid', '⇧G', () => A.toggleView && A.toggleView('grid')),
      item((v.snap ? '✓  ' : '') + 'Snap', '', () => A.toggleView && A.toggleView('snap')),
      item('View options…', '', (ev) => P && P.viewMenu()),
      '—',
      item('Present', '⇧K', () => A.startPresent && A.startPresent()),
    ];
  }

  function objectItems() {
    const A = global.App;
    return [
      item('Group', '⌘G', () => A.groupSel && A.groupSel()),
      item('Ungroup', '⇧⌘G', () => A.ungroup && A.ungroup()),
      item('Frame selection', '⌥⌘G', () => A.frameSelection && A.frameSelection()),
      '—',
      item('Flip horizontal', '⇧H', () => A.flipSel && A.flipSel('h')),
      item('Flip vertical', '⇧V', () => A.flipSel && A.flipSel('v')),
      item('Lock / unlock', '⇧⌘L', () => {
        const nodes = (A.sel || []).map((id) => A.page.nodes[id]).filter(Boolean);
        if (!nodes.length) return;
        A.history.begin(A.doc);
        const on = !nodes[0].locked;
        nodes.forEach((n) => { n.locked = on; });
        A.history.end(A.doc);
        A.markDirty();
      }),
      item('Hide / show', '⇧⌘H', () => {
        const nodes = (A.sel || []).map((id) => A.page.nodes[id]).filter(Boolean);
        if (!nodes.length) return;
        A.history.begin(A.doc);
        const hide = nodes[0].visible !== false;
        nodes.forEach((n) => { n.visible = !hide; });
        A.history.end(A.doc);
        A.markDirty();
      }),
    ];
  }

  function arrangeItems() {
    const A = global.App;
    const go = (fn) => () => {
      if (!A.sel.length) return;
      A.history.begin(A.doc);
      fn();
      A.history.end(A.doc);
      A.markDirty();
    };
    const M = global.Model;
    return [
      item('Bring to front', ']', go(() => A.sel.forEach((id) => { const n = A.page.nodes[id]; if (n) M.reorderTo(A.page, n, 'front'); }))),
      item('Bring forward', '⌘]', go(() => A.sel.forEach((id) => { const n = A.page.nodes[id]; if (n) M.reorder(A.page, n, 1); }))),
      item('Send backward', '⌘[', go(() => A.sel.forEach((id) => { const n = A.page.nodes[id]; if (n) M.reorder(A.page, n, -1); }))),
      item('Send to back', '[', go(() => A.sel.forEach((id) => { const n = A.page.nodes[id]; if (n) M.reorderTo(A.page, n, 'back'); }))),
      '—',
      item('Align left', '', () => A.alignSel && A.alignSel('left')),
      item('Align center', '', () => A.alignSel && A.alignSel('hcenter')),
      item('Align right', '', () => A.alignSel && A.alignSel('right')),
      item('Align top', '', () => A.alignSel && A.alignSel('top')),
      item('Align middle', '', () => A.alignSel && A.alignSel('vcenter')),
      item('Align bottom', '', () => A.alignSel && A.alignSel('bottom')),
    ];
  }

  function titleOf(sec) {
    const el = sec.querySelector('.ins-head span, .ins-sec-title, .ins-head');
    return ((el && el.textContent) || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function fold(title, kids) {
    const wrap = document.createElement('section');
    wrap.className = 'arco-fold';
    wrap.innerHTML = `<button type="button" class="arco-fold-h">${title}<i></i></button><div class="arco-fold-b"></div>`;
    const body = wrap.querySelector('.arco-fold-b');
    kids.filter(Boolean).forEach((k) => body.appendChild(k));
    wrap.querySelector('.arco-fold-h').addEventListener('click', () => wrap.classList.toggle('shut'));
    if (!body.children.length) wrap.classList.add('shut');
    return wrap;
  }

  function regroupInspector() {
    const App = global.App;
    const P = global.Panels;
    const el = document.getElementById('ed-right');
    if (!el || !App || !P) return;
    if (el.querySelector('.studio-empty-ins')) return;
    if (P._inspectorTab && P._inspectorTab !== 'design') return;
    const host = el.querySelector('.ins-tab-content') || el;
    if (host.querySelector('.arco-fold')) return;
    const nodes = P.selNodes ? P.selNodes() : [];
    const n = nodes[0];
    if (!n) return;

    const secs = Array.from(host.querySelectorAll(':scope > .ins-sec'));
    const pick = { pos: null, type: null, resize: null, fill: null, stroke: null, fx: [], al: null, item: null, export: null, rest: [] };

    for (const sec of secs) {
      const t = titleOf(sec);
      if (/arrange/.test(t) || sec.querySelector('[data-act="z-front"]')) { sec.remove(); continue; }
      if (sec.querySelector('[data-act="mask-toggle"]')) { sec.remove(); continue; }
      if (sec.classList.contains('pf-scale-sec') && App.tool !== 'scale') { sec.remove(); continue; }
      if (n.type === 'text' && (/^component$/.test(t) || /constraint/.test(t) || /layout grid/.test(t))) { sec.remove(); continue; }
      if (sec.querySelector('[data-xy="x"]') && !pick.pos) pick.pos = sec;
      else if (sec.classList.contains('pf-type') || t === 'typography' || t === 'text') pick.type = sec;
      else if (t === 'resizing') pick.resize = sec;
      else if (/^fills?$/.test(t)) pick.fill = sec;
      else if (t === 'stroke') pick.stroke = sec;
      else if (t === 'effects') pick.fx.push(sec);
      else if (t === 'auto layout') pick.al = sec;
      else if (/layout \(item\)/.test(t)) pick.item = sec;
      else if (sec.classList.contains('pf-export-sec') || t === 'export') pick.export = sec;
      else pick.rest.push(sec);
    }

    const type = document.createElement('div');
    type.className = 'arco-ins-type';
    type.innerHTML = `<span>${typeLabel(n)}</span><small>${nodes.length > 1 ? nodes.length + ' selected' : ''}</small>`;
    host.insertBefore(type, host.firstChild);

    const layoutKids = [pick.al, pick.item, pick.resize].filter(Boolean);
    const appearKids = [pick.fill, pick.stroke].filter(Boolean);
    const fxKids = pick.fx.slice(0, 1);

    const blocks = [];
    if (pick.pos) blocks.push(fold('Position', [pick.pos]));
    if (layoutKids.length) blocks.push(fold('Layout', layoutKids));
    if (pick.type) blocks.push(fold('Typography', [pick.type]));
    if (appearKids.length) blocks.push(fold('Appearance', appearKids));
    if (fxKids.length) blocks.push(fold('Effects', fxKids));
    if (pick.export) blocks.push(fold('Export', [pick.export]));
    pick.rest.forEach((s) => {
      const t = titleOf(s) || 'More';
      if (/align/.test(t)) blocks.unshift(fold('Align', [s]));
      else blocks.push(fold(t.charAt(0).toUpperCase() + t.slice(1), [s]));
    });

    blocks.forEach((b) => host.appendChild(b));
  }

  function apply() {
    const ed = document.getElementById('view-editor');
    if (!ed) return;
    document.body.classList.add('arco');
    ed.classList.add('arco');
    buildMenus(ed);
    placeRail();
  }

  ready(function () {
    const App = global.App;
    const P = global.Panels;
    if (!App) return;

    const _build = App.buildChrome && App.buildChrome.bind(App);
    if (_build) {
      App.buildChrome = function () {
        _build();
        apply();
      };
    }

    if (P && P.refreshInspector) {
      const _ri = P.refreshInspector.bind(P);
      P.refreshInspector = function () {
        _ri();
        try { regroupInspector(); } catch (e) {}
        const modes = document.querySelector('.arco-modes');
        if (modes) {
          const tab = this._inspectorTab || 'design';
          modes.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.mode === tab));
        }
      };
    }

    const obs = new MutationObserver(() => placeFlyouts());
    obs.observe(document.body, { childList: true, subtree: true });

    const _resize = App.resizeCanvas && App.resizeCanvas.bind(App);
    if (_resize) {
      App.resizeCanvas = function () {
        _resize();
        placeRail();
      };
    }

    apply();
    window.addEventListener('resize', () => placeRail());
  });
})(typeof window !== 'undefined' ? window : globalThis);
