/* layout-figma.js — tidy up, smart selection, distribute spacing, hug defaults.
 * https://help.figma.com/hc/en-us/articles/360040450233
 * https://help.figma.com/hc/en-us/articles/360039956914
 */
(function (global) {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'complete') return fn();
    window.addEventListener('load', fn, { once: true });
  }

  const PINK = '#f23e8c';

  function boxOf(n) {
    return n._w || { x: n.x || 0, y: n.y || 0, w: n.w || 1, h: n.h || 1 };
  }

  function median(arr) {
    if (!arr.length) return 0;
    const a = arr.slice().sort((x, y) => x - y);
    const m = Math.floor(a.length / 2);
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  }

  function clusterRows(items, axis) {
    // axis 'y' = rows (group by vertical center), 'x' = columns
    const out = [];
    const sorted = items.slice().sort((a, b) => {
      const ba = boxOf(a.n), bb = boxOf(b.n);
      return axis === 'y' ? (ba.y + ba.h / 2) - (bb.y + bb.h / 2) : (ba.x + ba.w / 2) - (bb.x + bb.w / 2);
    });
    for (const it of sorted) {
      const b = boxOf(it.n);
      const c = axis === 'y' ? b.y + b.h / 2 : b.x + b.w / 2;
      const size = axis === 'y' ? b.h : b.w;
      let row = out.find((r) => Math.abs(r.c - c) < Math.max(10, size * 0.4));
      if (!row) { row = { c, items: [] }; out.push(row); }
      row.items.push(it);
      row.c = row.items.reduce((s, x) => {
        const bb = boxOf(x.n);
        return s + (axis === 'y' ? bb.y + bb.h / 2 : bb.x + bb.w / 2);
      }, 0) / row.items.length;
    }
    return out;
  }

  function applyWorldDelta(n, dx, dy) {
    n.x += dx;
    n.y += dy;
  }

  function tidyLine(items, axis, gap) {
    items = items.slice().sort((a, b) => {
      const ba = boxOf(a.n), bb = boxOf(b.n);
      return axis === 'h' ? ba.x - bb.x : ba.y - bb.y;
    });
    if (items.length < 2) return gap;
    if (gap == null) {
      const gaps = [];
      for (let i = 1; i < items.length; i++) {
        const p = boxOf(items[i - 1].n), q = boxOf(items[i].n);
        gaps.push(axis === 'h' ? q.x - (p.x + p.w) : q.y - (p.y + p.h));
      }
      gap = Math.max(0, Math.round(median(gaps.filter((g) => isFinite(g)))));
    }
    const first = boxOf(items[0].n);
    let cursor = axis === 'h' ? first.x : first.y;
    const align = axis === 'h'
      ? median(items.map((it) => boxOf(it.n).y))
      : median(items.map((it) => boxOf(it.n).x));
    for (const it of items) {
      const b = boxOf(it.n);
      if (axis === 'h') applyWorldDelta(it.n, cursor - b.x, align - b.y);
      else applyWorldDelta(it.n, align - b.x, cursor - b.y);
      cursor += (axis === 'h' ? b.w : b.h) + gap;
    }
    return gap;
  }

  function analyzeSmart(page, ids) {
    const ns = (ids || []).map((id) => page.nodes[id]).filter((n) => n && n.visible !== false);
    if (ns.length < 2) return null;
    const items = ns.map((n) => ({ n, b: boxOf(n) }));
    const rows = clusterRows(items, 'y');
    const cols = clusterRows(items, 'x');
    const eq = (gaps) => {
      if (!gaps.length) return { ok: true, gap: 0 };
      const g0 = gaps[0];
      return { ok: gaps.every((g) => Math.abs(g - g0) <= 1.5), gap: Math.round(median(gaps)) };
    };
    if (rows.length === 1) {
      const line = items.slice().sort((a, b) => a.b.x - b.b.x);
      const gaps = [];
      for (let i = 1; i < line.length; i++) gaps.push(line[i].b.x - (line[i - 1].b.x + line[i - 1].b.w));
      const e = eq(gaps);
      if (!e.ok) return { kind: 'messy', hint: 'h', items };
      return { kind: 'h', gapH: Math.max(0, e.gap), gapV: 0, items: line };
    }
    if (cols.length === 1) {
      const line = items.slice().sort((a, b) => a.b.y - b.b.y);
      const gaps = [];
      for (let i = 1; i < line.length; i++) gaps.push(line[i].b.y - (line[i - 1].b.y + line[i - 1].b.h));
      const e = eq(gaps);
      if (!e.ok) return { kind: 'messy', hint: 'v', items };
      return { kind: 'v', gapH: 0, gapV: Math.max(0, e.gap), items: line };
    }
    // 2D: every row must have equal H gaps, every col equal V gaps
    let gapH = null, gapV = null;
    for (const row of rows) {
      const line = row.items.slice().sort((a, b) => boxOf(a.n).x - boxOf(b.n).x);
      const gaps = [];
      for (let i = 1; i < line.length; i++) {
        const p = boxOf(line[i - 1].n), q = boxOf(line[i].n);
        gaps.push(q.x - (p.x + p.w));
      }
      const e = eq(gaps);
      if (line.length > 1 && !e.ok) return { kind: 'messy', hint: 'grid', items };
      if (line.length > 1) gapH = e.gap;
    }
    for (const col of cols) {
      const line = col.items.slice().sort((a, b) => boxOf(a.n).y - boxOf(b.n).y);
      const gaps = [];
      for (let i = 1; i < line.length; i++) {
        const p = boxOf(line[i - 1].n), q = boxOf(line[i].n);
        gaps.push(q.y - (p.y + p.h));
      }
      const e = eq(gaps);
      if (line.length > 1 && !e.ok) return { kind: 'messy', hint: 'grid', items };
      if (line.length > 1) gapV = e.gap;
    }
    return { kind: 'grid', gapH: Math.max(0, gapH || 0), gapV: Math.max(0, gapV || 0), items, rows, cols };
  }

  ready(function () {
    const App = global.App;
    const M = global.Model;
    const P = global.Panels;
    const A = global.Arrange;
    if (!App || !M) return;

    // Shift+A hug defaults (Figma: new auto layout hugs both axes)
    const _makeAL = M.makeAutoLayout.bind(M);
    M.makeAutoLayout = function (n, dir, page) {
      const al = _makeAL(n, dir, page);
      if (!n.als) n.als = { w: 'hug', h: 'hug', grow: 0, align: 'auto', absolute: false };
      else {
        if (!n.als.w || n.als.w === 'fixed') n.als.w = 'hug';
        if (!n.als.h || n.als.h === 'fixed') n.als.h = 'hug';
      }
      return al;
    };

    App.tidyUp = function () {
      const ids = (this.sel || []).slice();
      if (ids.length < 2) { this.toast('Select 2+ layers to tidy up'); return; }
      this.layoutDoc && this.layoutDoc(this.doc, this.page);
      const items = ids.map((id) => this.page.nodes[id]).filter(Boolean).map((n) => ({ n }));
      const rows = clusterRows(items, 'y');
      const cols = clusterRows(items, 'x');
      this.history.begin(this.doc);
      let info;
      if (rows.length === 1) {
        const gap = tidyLine(items, 'h');
        info = 'Tidy up · row · ' + gap + 'px';
      } else if (cols.length === 1) {
        const gap = tidyLine(items, 'v');
        info = 'Tidy up · column · ' + gap + 'px';
      } else {
        const rowItems = rows.slice().sort((a, b) => a.c - b.c);
        let gapH = 16, gapV = 16;
        const hGaps = [], vGaps = [];
        for (const row of rowItems) {
          const line = row.items.slice().sort((a, b) => boxOf(a.n).x - boxOf(b.n).x);
          for (let i = 1; i < line.length; i++) {
            const p = boxOf(line[i - 1].n), q = boxOf(line[i].n);
            hGaps.push(q.x - (p.x + p.w));
          }
        }
        for (let r = 1; r < rowItems.length; r++) {
          const prev = rowItems[r - 1].items[0], cur = rowItems[r].items[0];
          if (prev && cur) vGaps.push(boxOf(cur.n).y - (boxOf(prev.n).y + boxOf(prev.n).h));
        }
        if (hGaps.length) gapH = Math.max(0, Math.round(median(hGaps)));
        if (vGaps.length) gapV = Math.max(0, Math.round(median(vGaps)));
        const origin = {
          x: Math.min.apply(null, items.map((it) => boxOf(it.n).x)),
          y: Math.min.apply(null, items.map((it) => boxOf(it.n).y)),
        };
        rowItems.forEach((row, ri) => {
          const line = row.items.slice().sort((a, b) => boxOf(a.n).x - boxOf(b.n).x);
          let x = origin.x;
          const y = origin.y + rowItems.slice(0, ri).reduce((s, r0) => {
            const h = Math.max.apply(null, r0.items.map((it) => boxOf(it.n).h));
            return s + h + gapV;
          }, 0);
          for (const it of line) {
            const b = boxOf(it.n);
            applyWorldDelta(it.n, x - b.x, y - b.y);
            x += b.w + gapH;
          }
        });
        info = 'Tidy up · grid · ' + gapH + '×' + gapV;
      }
      this.history.end(this.doc);
      this.markDirty();
      this.toast(info);
    };

    App.setSmartGap = function (axis, gap) {
      const ids = this.sel || [];
      if (ids.length < 2) return;
      gap = Math.max(0, gap);
      this.layoutDoc && this.layoutDoc(this.doc, this.page);
      const items = ids.map((id) => this.page.nodes[id]).filter(Boolean).map((n) => ({ n }));
      this.history.begin(this.doc);
      if (axis === 'h') {
        const rows = clusterRows(items, 'y');
        for (const row of rows) tidyLine(row.items, 'h', gap);
      } else {
        const cols = clusterRows(items, 'x');
        for (const col of cols) tidyLine(col.items, 'v', gap);
      }
      this.history.end(this.doc);
      this.markDirty();
    };

    if (A) {
      A.distributeSpacing = function (page, ids, axis) {
        const ns = (ids || []).map((id) => page.nodes[id]).filter(Boolean);
        if (ns.length < 3) return false;
        const key = axis === 'h' ? 'x' : 'y';
        const size = axis === 'h' ? 'w' : 'h';
        ns.sort((p, q) => boxOf(p)[key] - boxOf(q)[key]);
        const first = boxOf(ns[0]), last = boxOf(ns[ns.length - 1]);
        const span = (last[key] + last[size]) - first[key];
        const total = ns.reduce((s, n) => s + boxOf(n)[size], 0);
        const gap = (span - total) / (ns.length - 1);
        let cursor = first[key];
        ns.forEach((n, i) => {
          const b = boxOf(n);
          const d = cursor - b[key];
          if (axis === 'h') n.x += d; else n.y += d;
          cursor += b[size] + gap;
        });
        return true;
      };
    }

    // ---- canvas: pink smart-selection handles
    function smartHandles(view, smart) {
      if (!smart || smart.kind === 'messy') return [];
      const z = view.zoom, ox = view.ox, oy = view.oy;
      const hs = [];
      const line = (smart.items || []).slice();
      if (smart.kind === 'h' || smart.kind === 'v') {
        for (let i = 1; i < line.length; i++) {
          const a = boxOf(line[i - 1].n), b = boxOf(line[i].n);
          let x, y, axis;
          if (smart.kind === 'h') {
            x = ((a.x + a.w + b.x) / 2) * z + ox;
            y = ((Math.min(a.y, b.y) + Math.max(a.y + a.h, b.y + b.h)) / 2) * z + oy;
            axis = 'h';
          } else {
            x = ((Math.min(a.x, b.x) + Math.max(a.x + a.w, b.x + b.w)) / 2) * z + ox;
            y = ((a.y + a.h + b.y) / 2) * z + oy;
            axis = 'v';
          }
          hs.push({ x, y, axis });
        }
      } else if (smart.kind === 'grid') {
        for (const row of smart.rows || []) {
          const line2 = row.items.slice().sort((p, q) => boxOf(p.n).x - boxOf(q.n).x);
          for (let i = 1; i < line2.length; i++) {
            const a = boxOf(line2[i - 1].n), b = boxOf(line2[i].n);
            hs.push({
              x: ((a.x + a.w + b.x) / 2) * z + ox,
              y: ((Math.min(a.y, b.y) + Math.max(a.y + a.h, b.y + b.h)) / 2) * z + oy,
              axis: 'h',
            });
          }
        }
        for (const col of smart.cols || []) {
          const line2 = col.items.slice().sort((p, q) => boxOf(p.n).y - boxOf(q.n).y);
          for (let i = 1; i < line2.length; i++) {
            const a = boxOf(line2[i - 1].n), b = boxOf(line2[i].n);
            hs.push({
              x: ((Math.min(a.x, b.x) + Math.max(a.x + a.w, b.x + b.w)) / 2) * z + ox,
              y: ((a.y + a.h + b.y) / 2) * z + oy,
              axis: 'v',
            });
          }
        }
      }
      return hs;
    }

    function drawSmart(ctx, view, smart) {
      if (!smart || smart.kind === 'messy') return;
      const dpr = window.devicePixelRatio || 1;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = PINK;
      ctx.strokeStyle = PINK;
      ctx.lineWidth = 1.5;
      for (const it of smart.items || []) {
        const b = boxOf(it.n);
        const cx = (b.x + b.w / 2) * view.zoom + view.ox;
        const cy = (b.y + b.h / 2) * view.zoom + view.oy;
        ctx.beginPath();
        ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.stroke();
      }
      for (const h of smartHandles(view, smart)) {
        ctx.beginPath();
        if (h.axis === 'h') {
          ctx.moveTo(h.x, h.y - 7); ctx.lineTo(h.x, h.y + 7);
        } else {
          ctx.moveTo(h.x - 7, h.y); ctx.lineTo(h.x + 7, h.y);
        }
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(h.x, h.y, 3.5, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    const _redraw = App.redraw && App.redraw.bind(App);
    App.redraw = function () {
      if (_redraw) _redraw();
      if (!this.ctx || !this.page || this.sel.length < 2) return;
      const smart = analyzeSmart(this.page, this.sel);
      this._smart = smart;
      drawSmart(this.ctx, this.view, smart);
    };

    const _onDown = App.onDown && App.onDown.bind(App);
    App.onDown = function (e) {
      if (this.sel.length >= 2 && e.button === 0 && !this.space && this.tool === 'move') {
        const smart = analyzeSmart(this.page, this.sel);
        if (smart && smart.kind !== 'messy') {
          const rect = this.canvas.getBoundingClientRect();
          const mx = e.clientX - rect.left, my = e.clientY - rect.top;
          const hit = smartHandles(this.view, smart).find((h) => Math.hypot(mx - h.x, my - h.y) <= 9);
          if (hit) {
            e.preventDefault();
            this.history.begin(this.doc);
            this._drag = {
              kind: 'smart-gap',
              axis: hit.axis,
              start: hit.axis === 'h' ? (smart.gapH || 0) : (smart.gapV || 0),
              sx: e.clientX, sy: e.clientY,
            };
            return;
          }
        }
      }
      if (_onDown) return _onDown(e);
    };

    const _onMove = App.onMove && App.onMove.bind(App);
    App.onMove = function (e) {
      const d = this._drag;
      if (d && d.kind === 'smart-gap') {
        const z = this.view.zoom || 1;
        const delta = d.axis === 'h' ? (e.clientX - d.sx) / z : (e.clientY - d.sy) / z;
        const gap = Math.max(0, Math.round(d.start + delta));
        // Re-read original positions from history batch? Simpler: tidy from current
        // layout by resetting via a stored snapshot on first move.
        if (!d.snap) {
          d.snap = this.sel.map((id) => {
            const n = this.page.nodes[id];
            return n ? { id, x: n.x, y: n.y } : null;
          }).filter(Boolean);
        }
        for (const s of d.snap) {
          const n = this.page.nodes[s.id];
          if (n) { n.x = s.x; n.y = s.y; }
        }
        this.layoutDoc && this.layoutDoc(this.doc, this.page);
        const items = this.sel.map((id) => this.page.nodes[id]).filter(Boolean).map((n) => ({ n }));
        if (d.axis === 'h') {
          for (const row of clusterRows(items, 'y')) tidyLine(row.items, 'h', gap);
        } else {
          for (const col of clusterRows(items, 'x')) tidyLine(col.items, 'v', gap);
        }
        this.status('Space between  ' + gap);
        this.markDirty();
        return;
      }
      if (_onMove) return _onMove(e);
    };

    const _onUp = App.onUp && App.onUp.bind(App);
    App.onUp = function (e) {
      if (this._drag && this._drag.kind === 'smart-gap') {
        this.history.end(this.doc);
        this._drag = null;
        this.markDirty();
        return;
      }
      if (_onUp) return _onUp(e);
    };

    // Inspector: tidy up + space between + container hug
    if (P && P.refreshInspector) {
      const _ri = P.refreshInspector.bind(P);
      P.refreshInspector = function () {
        _ri();
        if (this._inspectorTab && this._inspectorTab !== 'design') return;
        const el = document.getElementById('ed-right');
        const host = el && (el.querySelector('.ins-tab-content') || el);
        if (!host) return;
        const ids = App.sel || [];
        const nodes = ids.map((id) => App.page && App.page.nodes[id]).filter(Boolean);

        if (nodes.length >= 2 && !host.querySelector('[data-act="tidy"]')) {
          App.layoutDoc && App.layoutDoc(App.doc, App.page);
          const smart = analyzeSmart(App.page, ids);
          const sec = document.createElement('section');
          sec.className = 'ins-sec pf-tidy-sec';
          const messy = !smart || smart.kind === 'messy';
          sec.innerHTML =
            '<div class="ins-head"><span>Layout</span><span class="ins-val">' + nodes.length + ' selected</span></div>' +
            (messy
              ? '<button type="button" class="ed-btn" data-act="tidy">Tidy up</button><div class="ph sm">Equalize spacing so you can drag pink handles on the canvas.</div>'
              : '<div class="ins-grid g2"><label>H gap</label><input type="number" min="0" data-act="gap-h" value="' + (smart.gapH || 0) + '"></div>' +
                '<div class="ins-grid g2"><label>V gap</label><input type="number" min="0" data-act="gap-v" value="' + (smart.gapV || 0) + '"></div>' +
                '<button type="button" class="ed-btn" data-act="tidy">Tidy up</button>') +
            (nodes.length >= 3
              ? '<div class="ins-btnrow"><button type="button" data-act="dist-h">Distribute H</button><button type="button" data-act="dist-v">Distribute V</button></div>'
              : '');
          host.insertBefore(sec, host.firstChild);
          sec.querySelector('[data-act="tidy"]').onclick = () => App.tidyUp();
          const gh = sec.querySelector('[data-act="gap-h"]');
          const gv = sec.querySelector('[data-act="gap-v"]');
          if (gh) gh.addEventListener('change', () => App.setSmartGap('h', +gh.value || 0));
          if (gv) gv.addEventListener('change', () => App.setSmartGap('v', +gv.value || 0));
          const dh = sec.querySelector('[data-act="dist-h"]');
          const dv = sec.querySelector('[data-act="dist-v"]');
          if (dh) dh.onclick = () => {
            App.history.begin(App.doc);
            A.distributeSpacing(App.page, ids, 'h');
            App.history.end(App.doc);
            App.markDirty();
          };
          if (dv) dv.onclick = () => {
            App.history.begin(App.doc);
            A.distributeSpacing(App.page, ids, 'v');
            App.history.end(App.doc);
            App.markDirty();
          };
        }

        const n = nodes[0];
        if (nodes.length === 1 && n && n.al && !host.querySelector('[data-act="al-hug-w"]')) {
          if (!n.als) n.als = { w: 'fixed', h: 'fixed', grow: 0, align: 'auto', absolute: false };
          const sec = document.createElement('section');
          sec.className = 'ins-sec';
          sec.innerHTML =
            '<div class="ins-head"><span>Frame sizing</span></div>' +
            '<div class="ins-grid g2"><label>Width</label><div class="seg ins-seg">' +
              ['hug', 'fixed'].map((v) => '<button type="button" class="seg-btn' + (n.als.w === v ? ' active' : '') + '" data-act="al-hug-w" data-v="' + v + '">' + v + '</button>').join('') +
            '</div></div>' +
            '<div class="ins-grid g2"><label>Height</label><div class="seg ins-seg">' +
              ['hug', 'fixed'].map((v) => '<button type="button" class="seg-btn' + (n.als.h === v ? ' active' : '') + '" data-act="al-hug-h" data-v="' + v + '">' + v + '</button>').join('') +
            '</div></div>' +
            '<div class="ins-grid g2"><label>Min W</label><input type="number" min="0" data-act="minw" value="' + (n.minW || '') + '"></div>' +
            '<div class="ins-grid g2"><label>Min H</label><input type="number" min="0" data-act="minh" value="' + (n.minH || '') + '"></div>';
          const al = host.querySelector('.al-sec');
          if (al) al.after(sec); else host.appendChild(sec);
          sec.querySelectorAll('[data-act="al-hug-w"]').forEach((b) => b.onclick = () => {
            App.history.begin(App.doc);
            n.als.w = b.dataset.v;
            App.history.end(App.doc);
            P.refreshInspector();
            App.markDirty();
          });
          sec.querySelectorAll('[data-act="al-hug-h"]').forEach((b) => b.onclick = () => {
            App.history.begin(App.doc);
            n.als.h = b.dataset.v;
            App.history.end(App.doc);
            P.refreshInspector();
            App.markDirty();
          });
          const mw = sec.querySelector('[data-act="minw"]');
          const mh = sec.querySelector('[data-act="minh"]');
          if (mw) mw.addEventListener('change', () => {
            App.history.begin(App.doc);
            n.minW = +mw.value || 0;
            App.history.end(App.doc);
            App.markDirty();
          });
          if (mh) mh.addEventListener('change', () => {
            App.history.begin(App.doc);
            n.minH = +mh.value || 0;
            App.history.end(App.doc);
            App.markDirty();
          });
        }
      };
    }

    if (P && P.contextMenu) {
      const _cm = P.contextMenu.bind(P);
      P.contextMenu = function (x, y, ids) {
        _cm(x, y, ids);
        const menu = document.querySelector('.pf-menu');
        if (!menu || !ids || ids.length < 2) return;
        const extra = document.createElement('div');
        extra.innerHTML = '<hr><button data-ly="tidy">Tidy up</button>';
        menu.appendChild(extra);
        extra.querySelector('[data-ly="tidy"]').onclick = () => { menu.remove(); App.tidyUp(); };
      };
    }

    if (global.Shortcuts && global.Shortcuts.def) {
      global.Shortcuts.def('ctrl+alt+t', 'Tidy up', 'Editing', (a) => a.tidyUp());
    }
  });
})(window);
