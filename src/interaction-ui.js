/* interaction-ui.js — selection toolbar, palette, menus, guides, keys.
 * Lane: hover/focus · contextual toolbar · smart guides · palette ·
 * context menus · keyboard. Overlay only.
 */
(function (global) {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'complete') return fn();
    window.addEventListener('load', fn, { once: true });
  }

  function ico(name, size) {
    return (global.Icons && global.Icons.svg) ? global.Icons.svg(name, { size: size || 14 }) : '';
  }

  function selNodes() {
    const A = global.App;
    if (!A || !A.page) return [];
    return (A.sel || []).map((id) => A.page.nodes[id]).filter(Boolean);
  }

  function selBox() {
    const A = global.App;
    if (!A || !A.page || !A.view) return null;
    const z = A.view.zoom, ox = A.view.ox, oy = A.view.oy;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of selNodes()) {
      const b = n._w;
      if (!b) continue;
      x0 = Math.min(x0, b.x * z + ox);
      y0 = Math.min(y0, b.y * z + oy);
      x1 = Math.max(x1, (b.x + b.w) * z + ox);
      y1 = Math.max(y1, (b.y + b.h) * z + oy);
    }
    if (!isFinite(x0)) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  function btn(act, title, icon, on) {
    return `<button type="button" class="arco-ib${on ? ' on' : ''}" data-act="${act}" title="${title}">${ico(icon)}</button>`;
  }

  function sep() { return '<i class="arco-sep"></i>'; }

  function buildBarHtml(nodes) {
    if (!nodes.length) return '';
    const A = global.App;
    const multi = nodes.length > 1;
    const n = nodes[0];
    const parts = [];

    if (multi) {
      parts.push(
        btn('al-left', 'Align left  ⌥A', 'align_l'),
        btn('al-hc', 'Align horizontal centers  ⌥H', 'align_hc'),
        btn('al-right', 'Align right  ⌥D', 'align_r'),
        sep(),
        btn('al-top', 'Align top  ⌥W', 'align_t'),
        btn('al-vc', 'Align vertical centers  ⌥V', 'align_vc'),
        btn('al-bottom', 'Align bottom  ⌥S', 'align_b')
      );
      if (nodes.length >= 3) {
        parts.push(sep(), btn('dist-h', 'Distribute horizontal', 'dist_h'), btn('dist-v', 'Distribute vertical', 'dist_v'));
      }
      if (A.tidyUp) parts.push(btn('tidy', 'Tidy up', 'zoomfit'));
      parts.push(sep(), btn('group', 'Group  ⌘G', 'group'), btn('frame', 'Frame selection  ⌥⌘G', 'frame'));
    } else if (n.type === 'text') {
      const t = n.text || {};
      parts.push(
        btn('bold', 'Bold  ⌘B', 'bold', (t.weight || 400) >= 700),
        btn('italic', 'Italic  ⌘I', 'italic', !!t.italic),
        btn('under', 'Underline  ⌘U', 'underline', !!t.underline),
        sep(),
        btn('tal-left', 'Align left', 'align_l', t.align === 'left' || !t.align),
        btn('tal-center', 'Align center', 'align_hc', t.align === 'center'),
        btn('tal-right', 'Align right', 'align_r', t.align === 'right')
      );
    } else if (n.type === 'frame' || n.type === 'instance') {
      parts.push(
        btn('al-add', n.al ? 'Remove auto layout  ⌥⇧A' : 'Add auto layout  ⇧A', 'frame', !!n.al),
        btn('clip', n.clips ? 'Clip content on' : 'Clip content', 'frame_sel', !!n.clips)
      );
    }

    const vecs = nodes.filter((x) => x.type === 'vector' && x.path);
    if (vecs.length >= 2) {
      parts.push(sep(), btn('union', 'Union  ⌘]', 'front'), btn('sub', 'Subtract  ⌘[', 'back'));
    }

    parts.push(sep(), btn('more', 'More', 'more'));
    return parts.join('');
  }

  function runAct(act) {
    const A = global.App;
    const P = global.Panels;
    const nodes = selNodes();
    const n = nodes[0];
    const ids = nodes.map((x) => x.id);
    const commit = (fn) => { A.history.begin(A.doc); fn(); A.history.end(A.doc); A.markDirty(); if (P.refreshInspector) P.refreshInspector(); };

    if (act === 'al-left') return A.alignSel && A.alignSel('left');
    if (act === 'al-hc') return A.alignSel && A.alignSel('hcenter');
    if (act === 'al-right') return A.alignSel && A.alignSel('right');
    if (act === 'al-top') return A.alignSel && A.alignSel('top');
    if (act === 'al-vc') return A.alignSel && A.alignSel('vcenter');
    if (act === 'al-bottom') return A.alignSel && A.alignSel('bottom');
    if (act === 'dist-h' && global.Arrange) return commit(() => global.Arrange.distribute(A.page, ids, 'h'));
    if (act === 'dist-v' && global.Arrange) return commit(() => global.Arrange.distribute(A.page, ids, 'v'));
    if (act === 'tidy') return A.tidyUp && A.tidyUp();
    if (act === 'group') return A.groupSel && A.groupSel();
    if (act === 'frame') return A.frameSelection && A.frameSelection();
    if (act === 'al-add') return n && n.al ? (A.removeAutoLayout && A.removeAutoLayout()) : (A.addAutoLayout && A.addAutoLayout());
    if (act === 'clip' && n) return commit(() => { n.clips = !n.clips; });
    if (act === 'union') return A.booleanSel && A.booleanSel('union');
    if (act === 'sub') return A.booleanSel && A.booleanSel('subtract');
    if (act === 'bold' && n && n.text) return commit(() => { n.text.weight = (n.text.weight || 400) >= 700 ? 400 : 700; });
    if (act === 'italic' && n && n.text) return commit(() => { n.text.italic = !n.text.italic; });
    if (act === 'under' && n && n.text) return commit(() => { n.text.underline = !n.text.underline; });
    if (act === 'tal-left' && n && n.text) return commit(() => { n.text.align = 'left'; });
    if (act === 'tal-center' && n && n.text) return commit(() => { n.text.align = 'center'; });
    if (act === 'tal-right' && n && n.text) return commit(() => { n.text.align = 'right'; });
    if (act === 'more' && P && P.contextMenu) {
      const box = selBox();
      const wrap = document.querySelector('.ed-canvas-wrap');
      const r = wrap ? wrap.getBoundingClientRect() : { left: 0, top: 0 };
      P.contextMenu((box ? r.left + box.x + box.w : 200), (box ? r.top + box.y : 200), ids);
    }
  }

  function ensureBar() {
    const wrap = document.querySelector('.ed-canvas-wrap');
    if (!wrap) return null;
    let bar = document.getElementById('arco-selbar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'arco-selbar';
      bar.className = 'arco-selbar';
      bar.hidden = true;
      wrap.appendChild(bar);
      bar.addEventListener('pointerdown', (e) => e.stopPropagation());
      bar.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]');
        if (!b) return;
        e.preventDefault();
        runAct(b.dataset.act);
        updateBar();
      });
    }
    return bar;
  }

  function updateBar() {
    const A = global.App;
    const bar = ensureBar();
    if (!bar || !A) return;
    const nodes = selNodes();
    const hide = !nodes.length || A._textEdit || A.present || A._crop ||
      (A._drag && /^(move|resize|rotate|create|pan)/.test(A._drag.kind)) ||
      (A.tool !== 'move' && A.tool !== 'scale');
    if (hide) { bar.hidden = true; return; }

    const html = buildBarHtml(nodes);
    if (bar._html !== html) {
      bar.innerHTML = html;
      bar._html = html;
    }

    const box = selBox();
    const wrap = bar.parentElement;
    if (!box || !wrap) { bar.hidden = true; return; }
    bar.hidden = false;
    const bw = bar.offsetWidth || 200;
    const bh = bar.offsetHeight || 36;
    const maxW = wrap.clientWidth;
    let left = Math.round(box.x + box.w / 2 - bw / 2);
    let top = Math.round(box.y - bh - 10);
    if (top < 8) top = Math.round(box.y + box.h + 10);
    left = Math.max(8, Math.min(maxW - bw - 8, left));
    top = Math.max(8, Math.min(wrap.clientHeight - bh - 8, top));
    bar.style.left = left + 'px';
    bar.style.top = top + 'px';
  }

  function remember(label) {
    try {
      const k = 'arco-recent-cmd';
      const list = JSON.parse(localStorage.getItem(k) || '[]').filter((x) => x !== label);
      list.unshift(label);
      localStorage.setItem(k, JSON.stringify(list.slice(0, 6)));
    } catch (e) {}
  }

  function recents() {
    try { return JSON.parse(localStorage.getItem('arco-recent-cmd') || '[]'); } catch (e) { return []; }
  }

  function polishPalette() {
    const A = global.App;
    const el = A && A._paletteEl;
    if (!el) return;
    el.classList.add('arco-pal-back');
    const box = el.querySelector('.pf-palette');
    if (box) box.classList.add('arco-pal');
    const inp = el.querySelector('.pf-palette-in');
    if (inp) {
      inp.placeholder = 'Search commands…';
      inp.setAttribute('aria-label', 'Search commands');
    }
    const ul = el.querySelector('.pf-palette-list');
    if (!ul || ul._arco) return;
    ul._arco = true;
    const recent = recents();
    if (recent.length && A._paletteList) {
      const head = document.createElement('li');
      head.className = 'arco-pal-h';
      head.textContent = 'Recent';
      ul.insertBefore(head, ul.firstChild);
    }
    ul.addEventListener('mousedown', (e) => {
      const li = e.target.closest('li[data-i]');
      if (!li) return;
      const c = A._paletteList && A._paletteList[+li.dataset.i];
      if (c && c.label) remember(c.label);
    });
  }

  function dedupeMenu(menu) {
    if (!menu || menu._arcoDeduped) return;
    menu._arcoDeduped = true;
    menu.classList.add('arco-ctx');
    const seen = new Set();
    menu.querySelectorAll('button').forEach((b) => {
      const raw = (b.textContent || '').replace(/\s+/g, ' ').trim();
      const key = raw.replace(/[⌘⇧⌥⌃⌫▸·].*$/, '').trim().toLowerCase();
      if (!key) return;
      if (seen.has(key)) b.remove();
      else seen.add(key);
    });
    menu.querySelectorAll('hr').forEach((hr) => {
      const next = hr.nextElementSibling;
      if (!next || next.tagName === 'HR' || next.tagName !== 'BUTTON') hr.remove();
    });
  }

  function polishShortcutsModal() {
    const m = document.querySelector('.modal-back');
    if (!m || m._arcoSc) return;
    m._arcoSc = true;
    m.classList.add('arco-sc-back');
    const card = m.querySelector('.modal');
    if (card) card.classList.add('arco-sc');
    const h = m.querySelector('h3');
    if (h && !m.querySelector('.arco-sc-q')) {
      const q = document.createElement('input');
      q.className = 'arco-sc-q';
      q.type = 'search';
      q.placeholder = 'Filter shortcuts…';
      q.setAttribute('aria-label', 'Filter shortcuts');
      h.after(q);
      q.addEventListener('input', () => {
        const v = q.value.toLowerCase().trim();
        m.querySelectorAll('.sc-group').forEach((g) => {
          let any = false;
          g.querySelectorAll('.sc-grid > span').forEach((sp, i, all) => {
            if (i % 2) return;
            const lab = all[i + 1];
            const hit = !v || (sp.textContent + ' ' + (lab ? lab.textContent : '')).toLowerCase().includes(v);
            sp.style.display = hit ? '' : 'none';
            if (lab) lab.style.display = hit ? '' : 'none';
            if (hit) any = true;
          });
          g.style.display = any ? '' : 'none';
        });
      });
      setTimeout(() => q.focus(), 0);
    }
  }

  ready(function () {
    const App = global.App;
    const R = global.Renderer;
    const P = global.Panels;
    if (!App) return;

    document.body.classList.add('arco-ix');

    const _set = App.setSel && App.setSel.bind(App);
    if (_set) {
      App.setSel = function (ids) {
        _set(ids);
        requestAnimationFrame(updateBar);
      };
    }
    const _redraw = App.redraw && App.redraw.bind(App);
    if (_redraw) {
      App.redraw = function () {
        _redraw();
        updateBar();
      };
    }
    const _light = App._redrawLight && App._redrawLight.bind(App);
    if (_light) {
      App._redrawLight = function () {
        _light();
        if (!this._drag) updateBar();
        else {
          const bar = document.getElementById('arco-selbar');
          if (bar) bar.hidden = true;
        }
      };
    }
    const _build = App.buildChrome && App.buildChrome.bind(App);
    if (_build) {
      App.buildChrome = function () {
        _build();
        ensureBar();
        updateBar();
      };
    }

    if (R && R.drawSnapGuides) {
      const _g = R.drawSnapGuides.bind(R);
      R.drawSnapGuides = function (ctx, view, guides) {
        _g(ctx, view, guides);
        if (!guides || !guides.length) return;
        const dpr = window.devicePixelRatio || 1;
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.font = '10px Inter, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const z = view.zoom, ox = view.ox, oy = view.oy;
        for (const g of guides) {
          const a = g.from, b = g.to;
          if (a == null || b == null) continue;
          const mid = (a + b) / 2;
          const px = g.axis === 'x' ? g.at * z + ox : mid * z + ox;
          const py = g.axis === 'y' ? g.at * z + oy : mid * z + oy;
          const label = String(Math.round(Math.abs(b - a)));
          const w = ctx.measureText(label).width + 8;
          ctx.fillStyle = '#f24ce0';
          ctx.beginPath();
          if (ctx.roundRect) ctx.roundRect(px - w / 2, py - 8, w, 16, 3);
          else ctx.rect(px - w / 2, py - 8, w, 16);
          ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.fillText(label, px, py + 0.5);
        }
        ctx.restore();
      };
    }

    const _pal = App.palette && App.palette.bind(App);
    if (_pal) {
      App.palette = function () {
        _pal();
        requestAnimationFrame(polishPalette);
      };
    }
    const _cmds = App._paletteCommands && App._paletteCommands.bind(App);
    if (_cmds) {
      App._paletteCommands = function () {
        const list = _cmds() || [];
        const recent = recents();
        if (!recent.length) return list;
        const byLabel = new Map(list.map((c) => [c.label, c]));
        const top = [];
        for (const name of recent) {
          const c = byLabel.get(name);
          if (c) top.push(c);
        }
        const rest = list.filter((c) => !recent.includes(c.label));
        return top.concat(rest);
      };
    }

    if (P && P.contextMenu) {
      const _cm = P.contextMenu.bind(P);
      P.contextMenu = function (x, y, ids) {
        _cm(x, y, ids);
        const menu = document.querySelector('.pf-menu');
        if (menu) dedupeMenu(menu);
      };
    }

    const _sc = App.showShortcutsModal && App.showShortcutsModal.bind(App);
    if (_sc) {
      App.showShortcutsModal = function () {
        _sc();
        requestAnimationFrame(polishShortcutsModal);
      };
    }

    if (global.Shortcuts && global.Shortcuts.def) {
      const has = global.Shortcuts.table.some((b) => b.keys === 'mod+p');
      if (!has) global.Shortcuts.def('mod+p', 'Quick actions', 'App', (a) => a.palette && a.palette());
    }

    ensureBar();
    updateBar();
    window.addEventListener('resize', updateBar);
  });
})(typeof window !== 'undefined' ? window : globalThis);
