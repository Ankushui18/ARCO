/* frames-figma.js — Frames like Figma Design.
 * https://help.figma.com/hc/en-us/articles/360041539473-Frames-in-Figma-Design
 *
 * Gaps this file closes:
 *   • Click inside a frame with F/A → nested 100×100 (not another top-level)
 *   • Click on the canvas → last top-level size (first is 100×100) — already
 *     in create-designs; nested click is forced back to 100×100 here
 *   • Quick-add + on the sides of a top-level frame (Frame tool). Alt = blank
 *   • Preset dropdown on a selected frame (Phone / Tablet / Desktop / …)
 *   • Constraints actually run on resize (core passed d.start.w, which is
 *     undefined — applyConstraints no-op’d). ⌘/Ctrl ignores them (Figma)
 *   • Resize to fit redraws around children (⌥⇧⌘R). Old version only
 *     changed W/H and left children hanging off the box
 *   • Ungroup a real frame (⇧⌘G), not just empty untitled groups
 *   • ⌘⌫ ungroups a frame (Figma)
 *   • Top-level frames are bold in the File tab
 *   • Lock aspect ratio next to W/H
 *   • Math in X/Y/W/H: 50%  +100  -20  *4  /8
 */
(function (global) {
  'use strict';

  function ready(fn) {
    if (typeof document === 'undefined') return;
    if (document.readyState === 'complete') return fn();
    window.addEventListener('load', fn, { once: true });
  }

  const PRESETS = [
    { group: 'Phone', items: [
      ['iPhone 16', 393, 852], ['iPhone 16 Pro', 402, 874],
      ['iPhone 16 Pro Max', 440, 956], ['Android', 360, 800],
    ]},
    { group: 'Tablet', items: [
      ['iPad', 768, 1024], ['iPad Pro 11"', 834, 1194], ['iPad Pro 12.9"', 1024, 1366],
    ]},
    { group: 'Desktop', items: [
      ['Desktop', 1440, 1024], ['MacBook Air', 1280, 832], ['HD', 1920, 1080],
    ]},
    { group: 'Presentation', items: [
      ['Slide 16:9', 1920, 1080], ['Slide 16:10', 1920, 1200],
    ]},
    { group: 'Watch', items: [
      ['Apple Watch', 198, 242],
    ]},
    { group: 'Social', items: [
      ['Instagram post', 1080, 1080], ['Story', 1080, 1920], ['OG image', 1200, 630],
    ]},
    { group: 'Paper', items: [
      ['A4', 595, 842], ['Letter', 612, 792],
    ]},
  ];

  function evalDim(raw, current) {
    if (raw == null) return current;
    const s = String(raw).trim().replace(/\s+/g, '');
    if (!s) return current;
    if (/^-?\d+(\.\d+)?%$/.test(s)) return current * (parseFloat(s) / 100);
    const m = s.match(/^([+\-*/])(-?\d+(\.\d+)?)(%?)$/);
    if (m) {
      let num = parseFloat(m[2]);
      // Figma: +50% / -50% is relative to current. *50% is 50×, not half.
      if (m[4] === '%' && (m[1] === '+' || m[1] === '-')) num = current * (num / 100);
      if (m[1] === '+') return current + num;
      if (m[1] === '-') return current - num;
      if (m[1] === '*') return current * num;
      if (m[1] === '/') return num ? current / num : current;
    }
    const n = parseFloat(s);
    return isFinite(n) ? n : current;
  }

  function presetName(w, h) {
    const rw = Math.round(w), rh = Math.round(h);
    for (const g of PRESETS) {
      for (const it of g.items) {
        if (it[1] === rw && it[2] === rh) return it[0];
        if (it[1] === rh && it[2] === rw) return it[0] + ' (portrait)';
      }
    }
    return 'Frame';
  }

  function deepestFrameAt(page, wx, wy, skipId) {
    let best = null, bestDepth = -1;
    const visit = (n, depth) => {
      if (!n || n.visible === false || n.id === skipId) return;
      if (n.type === 'frame') {
        const b = n._w || { x: n.x, y: n.y, w: n.w, h: n.h };
        if (wx >= b.x && wy >= b.y && wx <= b.x + b.w && wy <= b.y + b.h) {
          if (depth > bestDepth) { best = n; bestDepth = depth; }
        }
      }
      for (const cid of n.children || []) visit(page.nodes[cid], depth + 1);
    };
    for (const tid of page.tops || []) visit(page.nodes[tid], 0);
    return best;
  }

  global.FramesFigma = { evalDim, presetName, PRESETS, deepestFrameAt };

  ready(function () {
    const App = global.App;
    const M = global.Model;
    const P = global.Panels;
    const W = global.World;
    const L = global.Layout;
    if (!App || !M) return;

    const GAP = 32;
    const PLUS_R = 11;

    function page() { return App.page; }

    function plusMarks() {
      if (App.tool !== 'frame' || !page()) return [];
      const v = App.view;
      const out = [];
      const hover = App.hoverId && page().nodes[App.hoverId];
      const show = (n) => {
        if (!n || n.type !== 'frame' || n.parent || n.visible === false) return;
        const b = n._w || n;
        const sx = b.x * v.zoom + v.ox;
        const sy = b.y * v.zoom + v.oy;
        const sw = b.w * v.zoom, sh = b.h * v.zoom;
        const cy = sy + sh / 2;
        out.push({ n, side: 'left', x: sx - 20, y: cy });
        out.push({ n, side: 'right', x: sx + sw + 20, y: cy });
      };
      if (hover && !hover.parent) show(hover);
      for (const id of App.sel || []) {
        const n = page().nodes[id];
        if (n && n !== hover) show(n);
      }
      return out;
    }

    function hitPlus(e) {
      if (App.tool !== 'frame' || !App.canvas) return null;
      const r = App.canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      for (const p of plusMarks()) {
        if (Math.hypot(mx - p.x, my - p.y) <= PLUS_R + 3) return p;
      }
      return null;
    }

    function quickAdd(src, side, empty) {
      const pg = page();
      if (!src || !pg) return;
      App.history.begin(App.doc);
      let clone;
      if (empty) {
        clone = M.makeNode('frame', { w: src.w, h: src.h, name: 'Frame' });
        clone.fills = (src.fills || []).map((f) => Object.assign({}, f));
        clone.clips = src.clips !== false;
      } else {
        clone = M.deepClone(pg, src, true, pg);
      }
      const shift = (src.w || 0) + GAP;
      if (side === 'right') {
        for (const tid of pg.tops.slice()) {
          const o = pg.nodes[tid];
          if (!o || o.id === src.id) continue;
          if (o.x >= src.x + src.w - 1) o.x += shift;
        }
        clone.x = src.x + src.w + GAP;
        clone.y = src.y;
      } else {
        clone.x = src.x - clone.w - GAP;
        clone.y = src.y;
        for (const tid of pg.tops.slice()) {
          const o = pg.nodes[tid];
          if (!o || o.id === src.id || o.id === clone.id) continue;
          if (o.x + o.w <= src.x + 1) o.x -= shift;
        }
      }
      if (!clone.parent && !pg.nodes[clone.id]) M.attach(App.doc, pg, null, clone);
      else if (!pg.tops.includes(clone.id) && !clone.parent) M.attach(App.doc, pg, null, clone);
      App.history.end(App.doc);
      App.setSel([clone.id]);
      if (P.refreshLayers) P.refreshLayers();
      App.markDirty();
      App.toast(empty ? 'Blank frame' : 'Duplicated frame');
    }

    function nestCreated(created, host, wasClick, sx, sy) {
      if (!created || !host || created.id === host.id) return;
      const pg = page();
      const wx = created.x, wy = created.y, ww = created.w, wh = created.h;
      M.detach(pg, created);
      if (wasClick) {
        const lp = (W && host._wt) ? W.worldToLocal(host, sx, sy) : { x: sx - host.x, y: sy - host.y };
        created.w = 100;
        created.h = 100;
        created.x = (lp ? lp.x : 0) - 50;
        created.y = (lp ? lp.y : 0) - 50;
      } else if (W && host._wt) {
        const a = W.worldToLocal(host, wx, wy);
        const b = W.worldToLocal(host, wx + ww, wy + wh);
        if (a && b) {
          created.x = Math.min(a.x, b.x);
          created.y = Math.min(a.y, b.y);
          created.w = Math.max(1, Math.abs(b.x - a.x));
          created.h = Math.max(1, Math.abs(b.y - a.y));
        }
      } else {
        created.x = wx - host.x;
        created.y = wy - host.y;
      }
      M.attach(App.doc, pg, host.id, created);
    }

    function applyPreset(n, w, h) {
      if (!n) return;
      const ow = n.w, oh = n.h;
      App.history.begin(App.doc);
      n.w = w; n.h = h;
      if (L && L.applyConstraints && !n.al) L.applyConstraints(page(), n, ow, oh);
      App.history.end(App.doc);
      if (P.refreshInspector) P.refreshInspector();
      App.markDirty();
    }

    App.resizeFrameToFit = function () {
      const n = this.sel && this.page && this.page.nodes[this.sel[0]];
      if (!n || n.type !== 'frame') { this.toast('Select a frame'); return; }
      this.history.begin(this.doc);
      if (L && L.resizeToFit) L.resizeToFit(this.page, n);
      this.history.end(this.doc);
      if (P.refreshInspector) P.refreshInspector();
      this.markDirty();
    };

    // ---- resize-to-fit: move origin to the content, then size ----------
    if (L && L.resizeToFit) {
      const _r2f = L.resizeToFit.bind(L);
      L.resizeToFit = function (pg, frame, pad) {
        if (!frame) return null;
        if (frame.al) return _r2f(pg, frame, pad);
        pad = pad || 0;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const cid of frame.children || []) {
          const k = pg.nodes[cid];
          if (!k || k.visible === false) continue;
          x0 = Math.min(x0, k.x);
          y0 = Math.min(y0, k.y);
          x1 = Math.max(x1, k.x + (k.w || 0));
          y1 = Math.max(y1, k.y + (k.h || 0));
        }
        if (!isFinite(x0)) return null;
        const dx = x0 - pad, dy = y0 - pad;
        for (const cid of frame.children || []) {
          const k = pg.nodes[cid];
          if (!k) continue;
          k.x -= dx; k.y -= dy;
        }
        frame.x += dx; frame.y += dy;
        frame.w = Math.max(1, (x1 - x0) + pad * 2);
        frame.h = Math.max(1, (y1 - y0) + pad * 2);
        return { w: frame.w, h: frame.h };
      };
    }

    // ---- ungroup any frame (Figma ⇧⌘G / ⌘⌫) ---------------------------
    const _ungroup = App.ungroup && App.ungroup.bind(App);
    App.ungroup = function () {
      const ids = (this.sel || []).slice();
      const frames = ids.map((id) => this.page.nodes[id]).filter((n) => {
        return n && n.type === 'frame' && !n.isComponent && n.type !== 'instance'
          && !(this.doc.components && this.doc.components[n.id]);
      });
      if (!frames.length) return _ungroup ? _ungroup() : undefined;
      this.history.begin(this.doc);
      const next = [];
      for (const g of frames) {
        const kids = (g.children || []).map((id) => this.page.nodes[id]).filter(Boolean);
        const gp = g.parent || null;
        const gx = g._w ? g._w.x : g.x;
        const gy = g._w ? g._w.y : g.y;
        for (const k of kids) {
          const kx = k._w ? k._w.x : gx + k.x;
          const ky = k._w ? k._w.y : gy + k.y;
          M.detach(this.page, k);
          if (gp) {
            const p = this.page.nodes[gp];
            const px = p && p._w ? p._w.x : (p ? p.x : 0);
            const py = p && p._w ? p._w.y : (p ? p.y : 0);
            k.x = kx - px; k.y = ky - py;
          } else {
            k.x = kx; k.y = ky;
          }
          M.attach(this.doc, this.page, gp, k);
          next.push(k.id);
        }
        M.detach(this.page, g);
      }
      this.history.end(this.doc);
      this.setSel(next);
      if (P.refreshLayers) P.refreshLayers();
      if (P.refreshInspector) P.refreshInspector();
      this.markDirty();
    };

    // ---- create: nest into the frame you clicked -----------------------
    const _onDown = App.onDown && App.onDown.bind(App);
    App.onDown = function (e) {
      const plus = hitPlus(e);
      if (plus && e.button === 0) {
        e.preventDefault();
        quickAdd(plus.n, plus.side, !!(e.altKey));
        return;
      }
      return _onDown ? _onDown(e) : undefined;
    };

    const _onMove = App.onMove && App.onMove.bind(App);
    App.onMove = function (e) {
      const d = this._drag;
      if (d && d.kind === 'resize' && d.node && (d.node.type === 'frame' || d.node.type === 'instance') && !d.node.al && !d._kidSnap) {
        d._kidSnap = (d.node.children || []).map((id) => {
          const k = this.page.nodes[id];
          return k ? { id, x: k.x, y: k.y, w: k.w, h: k.h } : null;
        }).filter(Boolean);
      }
      const out = _onMove ? _onMove(e) : undefined;
      if (d && d.kind === 'resize' && d._kidSnap && L && L.applyConstraints) {
        const ignore = e && (e.metaKey || e.ctrlKey);
        if (!ignore) {
          for (const s of d._kidSnap) {
            const k = this.page.nodes[s.id];
            if (!k) continue;
            k.x = s.x; k.y = s.y; k.w = s.w; k.h = s.h;
          }
          L.applyConstraints(this.page, d.node, d.startW, d.startH);
        } else {
          for (const s of d._kidSnap) {
            const k = this.page.nodes[s.id];
            if (!k) continue;
            k.x = s.x; k.y = s.y; k.w = s.w; k.h = s.h;
          }
        }
      }
      if (this.tool === 'frame' && !this._drag) {
        const next = hitPlus(e);
        const key = next ? next.n.id + next.side : '';
        if (key !== this._plusHover) {
          this._plusHover = key;
          this.canvas && (this.canvas.style.cursor = next ? 'copy' : '');
          this._redrawLight && this._redrawLight();
        }
      }
      return out;
    };

    const _onUp = App.onUp && App.onUp.bind(App);
    App.onUp = function (e) {
      const d = this._drag;
      const created = d && d.kind === 'create' && d.node;
      const wasClick = !!(created && created.w < 8 && created.h < 8);
      const sx = d && d.sx, sy = d && d.sy;
      if (_onUp) _onUp(e);
      if (created && created.type === 'frame' && !created.section && isFinite(sx)) {
        const host = deepestFrameAt(this.page, sx, sy, created.id);
        if (host) nestCreated(created, host, wasClick, sx, sy);
        if (this.markDirty) this.markDirty();
        if (P.refreshLayers) P.refreshLayers();
      }
    };

    // ---- draw + handles ------------------------------------------------
    function drawPluses(ctx) {
      const marks = plusMarks();
      if (!marks.length || !ctx) return;
      const dpr = window.devicePixelRatio || 1;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      for (const p of marks) {
        ctx.beginPath();
        ctx.fillStyle = '#0d99ff';
        ctx.arc(p.x, p.y, PLUS_R, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.moveTo(p.x - 5, p.y); ctx.lineTo(p.x + 5, p.y);
        ctx.moveTo(p.x, p.y - 5); ctx.lineTo(p.x, p.y + 5);
        ctx.stroke();
      }
      ctx.restore();
    }

    const _redraw = App.redraw && App.redraw.bind(App);
    App.redraw = function () {
      if (_redraw) _redraw();
      if (this.ctx) drawPluses(this.ctx);
    };
    const _light = App._redrawLight && App._redrawLight.bind(App);
    if (_light) {
      App._redrawLight = function () {
        _light();
        if (this.ctx) drawPluses(this.ctx);
      };
    }

    // ---- inspector: preset + aspect lock + math ------------------------
    if (P && P.refreshInspector) {
      const _ri = P.refreshInspector.bind(P);
      P.refreshInspector = function () {
        _ri();
        const el = document.getElementById('ed-right');
        if (!el || !App.page || !App.sel || App.sel.length !== 1) return;
        const n = App.page.nodes[App.sel[0]];
        if (!n || n.type !== 'frame') return;

        const host = el.querySelector('.ins-tab-content') || el;
        if (!host.querySelector('[data-act="frame-preset"]')) {
          const sec = document.createElement('section');
          sec.className = 'ins-sec pf-frame-sec';
          let opts = '<option value="">' + presetName(n.w, n.h) + '</option>';
          for (const g of PRESETS) {
            opts += '<optgroup label="' + g.group + '">';
            for (const it of g.items) {
              const sel = Math.round(n.w) === it[1] && Math.round(n.h) === it[2] ? ' selected' : '';
              opts += '<option value="' + it[1] + 'x' + it[2] + '"' + sel + '>' + it[0] + ' · ' + it[1] + ' × ' + it[2] + '</option>';
            }
            opts += '</optgroup>';
          }
          sec.innerHTML =
            '<div class="ins-head"><span>Frame</span></div>' +
            '<div class="ins-row"><label>Size</label><select data-act="frame-preset">' + opts + '</select></div>' +
            '<div class="ins-btnrow">' +
              '<button type="button" class="ed-btn sm" data-act="aspect-lock" title="Lock aspect ratio">' +
                (n.aspectLock ? 'Unlock ratio' : 'Lock ratio') + '</button>' +
              '<button type="button" class="ed-btn sm" data-act="resize-fit-2" title="⌥⇧⌘R">Resize to fit</button>' +
            '</div>';
          const pos = host.querySelector('.ins-sec');
          if (pos) pos.after(sec); else host.insertBefore(sec, host.firstChild);
          sec.querySelector('[data-act="frame-preset"]').addEventListener('change', (ev) => {
            const m = String(ev.target.value).match(/^(\d+)x(\d+)$/);
            if (m) applyPreset(n, +m[1], +m[2]);
          });
          sec.querySelector('[data-act="aspect-lock"]').onclick = () => {
            App.history.begin(App.doc);
            n.aspectLock = !n.aspectLock;
            if (n.aspectLock) n._aspect = n.h ? n.w / n.h : 1;
            App.history.end(App.doc);
            P.refreshInspector();
          };
          sec.querySelector('[data-act="resize-fit-2"]').onclick = () => App.resizeFrameToFit();
        }

        el.querySelectorAll('input[data-xy]').forEach((inp) => {
          if (inp._ffBound) return;
          inp._ffBound = true;
          inp.addEventListener('focus', () => {
            inp.dataset.prev = String(n[inp.dataset.xy]);
          });
          inp.addEventListener('change', () => {
            const cur = App.page.nodes[App.sel[0]];
            if (!cur) return;
            const prev = parseFloat(inp.dataset.prev);
            const next = evalDim(inp.value, isFinite(prev) ? prev : cur[inp.dataset.xy]);
            App.history.begin(App.doc);
            cur[inp.dataset.xy] = next;
            if (cur.aspectLock && cur._aspect) {
              if (inp.dataset.xy === 'w') cur.h = Math.max(1, next / cur._aspect);
              if (inp.dataset.xy === 'h') { cur.w = Math.max(1, next * cur._aspect); cur._aspect = cur.w / cur.h; }
            }
            App.history.end(App.doc);
            inp.value = String(Math.round(next * 100) / 100);
            App.markDirty();
          });
        });
      };
    }

    if (P && P.contextMenu) {
      const _cm = P.contextMenu.bind(P);
      P.contextMenu = function (x, y, ids) {
        _cm(x, y, ids);
        const menu = document.querySelector('.pf-menu');
        if (!menu || !ids || ids.length !== 1) return;
        const n = App.page && App.page.nodes[ids[0]];
        if (!n || n.type !== 'frame') return;
        if (menu.querySelector('[data-c="r2f"]')) return;
        const extra = document.createElement('div');
        extra.innerHTML = '<hr><button data-c="r2f">Resize to fit <span class="kbd">⌥⇧⌘R</span></button><button data-c="unf">Ungroup frame <span class="kbd">⇧⌘G</span></button>';
        menu.appendChild(extra);
        extra.querySelector('[data-c="r2f"]').onclick = () => { menu.remove(); App.resizeFrameToFit(); };
        extra.querySelector('[data-c="unf"]').onclick = () => { menu.remove(); App.ungroup(); };
      };
    }

    // ---- layers: bold top-level frames --------------------------------
    if (P && P.refreshLayers) {
      const _rl = P.refreshLayers.bind(P);
      P.refreshLayers = function () {
        _rl();
        const el = document.getElementById('ed-layers');
        if (!el || !page()) return;
        el.querySelectorAll('.ly-row').forEach((row) => {
          const n = page().nodes[row.dataset.id];
          row.classList.toggle('top-frame', !!(n && n.type === 'frame' && !n.parent));
        });
      };
    }

    const _cmds = App._paletteCommands && App._paletteCommands.bind(App);
    if (_cmds) {
      App._paletteCommands = function () {
        const list = _cmds() || [];
        list.push(
          { label: 'Resize frame to fit', hint: '⌥⇧⌘R', kw: 'frame hug contents shrink wrap', run: () => this.resizeFrameToFit() },
          { label: 'Ungroup frame', hint: '⇧⌘G', kw: 'frame ungroup dissolve', run: () => this.ungroup() }
        );
        return list;
      };
    }

    if (global.Shortcuts && global.Shortcuts.def) {
      global.Shortcuts.def('alt+shift+mod+r', 'Resize frame to fit', 'Editing', (a) => a.resizeFrameToFit());
      global.Shortcuts.def('mod+backspace', 'Ungroup frame', 'Editing', (a) => a.ungroup());
      global.Shortcuts.def('mod+delete', 'Ungroup frame', 'Editing', (a) => a.ungroup());
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
