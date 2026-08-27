/* handles-figma.js — selection handles + rotation like Figma.
 * https://help.figma.com/hc/en-us/articles/360039956914
 * https://help.figma.com/hc/en-us/articles/360041539473
 *
 * Figma:
 *   • 8 white handles (4 corners + 4 edge mids)
 *   • Hover just outside a corner → rotate cursor; drag; Shift = 15°
 *   • +CCW / −CW, wrap at ±180° (already in toFigmaDeg)
 *   • Rotate around selection center (or a custom origin, ⌥R)
 *   • Multi-select rotate orbits positions around that center
 *   • Alt = resize from center · Shift = keep ratio · Ctrl = ignore lock
 *   • Space (hold) while resizing = move the layer
 *   • Multi-select corner = scale the whole selection
 *   • No handles while editing text
 */
(function (global) {
  'use strict';

  function ready(fn) {
    if (typeof document === 'undefined') return;
    if (document.readyState === 'complete') return fn();
    window.addEventListener('load', fn, { once: true });
  }

  function rotatePt(px, py, cx, cy, da) {
    const dx = px - cx, dy = py - cy;
    const c = Math.cos(da), s = Math.sin(da);
    return { x: cx + dx * c - dy * s, y: cy + dx * s + dy * c };
  }

  function wrapPi(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
  }

  function snap15(rad) {
    const step = Math.PI / 12;
    return Math.round(rad / step) * step;
  }

  function unionWorld(page, ids) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of ids) {
      const n = page.nodes[id];
      if (!n || !n._w) continue;
      const b = n._w;
      x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
    }
    if (!isFinite(x0)) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  global.HandlesFigma = { rotatePt, wrapPi, snap15, unionWorld };

  ready(function () {
    const App = global.App;
    const R = global.Renderer;
    const M = global.Model;
    const W = global.World;
    if (!App || !R) return;

    let editingId = null;
    const _setEd = R.setEditingText && R.setEditingText.bind(R);
    R.setEditingText = function (id) {
      editingId = id || null;
      if (_setEd) _setEd(id);
    };

    function selCenterWorld() {
      if (App._rotOrigin) return { x: App._rotOrigin.x, y: App._rotOrigin.y };
      if (App.sel.length === 1) {
        const n = App.page.nodes[App.sel[0]];
        if (n && W && W.worldCenter) return W.worldCenter(n);
        if (n && n._w) return { x: n._w.x + n._w.w / 2, y: n._w.y + n._w.h / 2 };
      }
      const u = unionWorld(App.page, App.sel);
      return u ? { x: u.x + u.w / 2, y: u.y + u.h / 2 } : { x: 0, y: 0 };
    }

    function snapStarts() {
      return (App.sel || []).map((id) => {
        const n = App.page.nodes[id];
        if (!n) return null;
        const c = (W && W.worldCenter) ? W.worldCenter(n)
          : (n._w ? { x: n._w.x + n._w.w / 2, y: n._w.y + n._w.h / 2 } : { x: n.x + n.w / 2, y: n.y + n.h / 2 });
        return { id, x: n.x, y: n.y, w: n.w, h: n.h, r: n.rotation || 0, cx: c.x, cy: c.y };
      }).filter(Boolean);
    }

    function applyOrbit(d, e) {
      const p = App.toWorld(e);
      let da = Math.atan2(p.y - d.center.y, p.x - d.center.x) - d.sa;
      if (e.shiftKey) da = snap15(da);
      for (const s of d.starts) {
        const n = App.page.nodes[s.id];
        if (!n) continue;
        n.rotation = wrapPi(s.r + da);
        const np = rotatePt(s.cx, s.cy, d.center.x, d.center.y, da);
        n.x = s.x + (np.x - s.cx);
        n.y = s.y + (np.y - s.cy);
      }
      App.markDirty();
      const deg = M.toFigmaDeg ? M.toFigmaDeg(da) : Math.round(da * 180 / Math.PI);
      App.status(deg + '°');
      App._rotLabelDeg = deg;
    }

    App.toggleRotOrigin = function () {
      if (!this.sel.length) { this.toast('Select a layer'); return; }
      if (this._rotOriginOn) {
        this._rotOriginOn = false;
        this._rotOrigin = null;
        this.toast('Rotation origin: center');
      } else {
        this._rotOriginOn = true;
        this._rotOrigin = selCenterWorld();
        this.toast('Drag the target to set the rotation origin');
      }
      this.markDirty();
    };

    // ---- draw: 8 handles, origin, hide while editing -------------------
    function paintSquare(ctx, x, y, hs) {
      ctx.beginPath();
      ctx.rect(x - hs / 2 + 0.5, y - hs / 2 + 0.5, hs, hs);
      ctx.fill(); ctx.stroke();
    }

    const _ds = R.drawSelection.bind(R);
    R.drawSelection = function (ctx, view, ids, page, moving) {
      if (editingId && ids && ids.length === 1 && ids[0] === editingId) {
        const n = page.nodes[editingId];
        const corners = W && W.screenCorners ? W.screenCorners(view, n) : null;
        if (!corners) return;
        const dpr = window.devicePixelRatio || 1;
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.strokeStyle = '#0d99ff';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(corners[0].x, corners[0].y);
        for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
        return;
      }
      _ds(ctx, view, ids, page, moving);
      if (!ids || !ids.length) return;
      const dpr = window.devicePixelRatio || 1;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = '#0d99ff';
      ctx.lineWidth = 1;

      if (ids.length === 1) {
        const n = page.nodes[ids[0]];
        const corners = n && W && W.screenCorners ? W.screenCorners(view, n) : null;
        if (corners) {
          const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
          for (const p of [mid(corners[0], corners[1]), mid(corners[1], corners[2]), mid(corners[2], corners[3]), mid(corners[3], corners[0])]) {
            paintSquare(ctx, p.x, p.y, 5);
          }
        }
      } else {
        const z = view.zoom, ox = view.ox, oy = view.oy;
        const u = unionWorld(page, ids);
        if (u) {
          const pts = [
            [u.x + u.w / 2, u.y], [u.x + u.w, u.y + u.h / 2],
            [u.x + u.w / 2, u.y + u.h], [u.x, u.y + u.h / 2],
          ];
          for (const [wx, wy] of pts) paintSquare(ctx, wx * z + ox, wy * z + oy, 5);
        }
      }

      if (App._rotOriginOn && App._rotOrigin) {
        const z = view.zoom;
        const sx = App._rotOrigin.x * z + view.ox;
        const sy = App._rotOrigin.y * z + view.oy;
        ctx.beginPath();
        ctx.arc(sx, sy, 7, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.strokeStyle = '#0d99ff';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(sx - 10, sy); ctx.lineTo(sx + 10, sy);
        ctx.moveTo(sx, sy - 10); ctx.lineTo(sx, sy + 10);
        ctx.stroke();
      }

      if (App._drag && (App._drag.kind === 'rotate' || App._drag.kind === 'rotate-multi') && App._rotLabelDeg != null) {
        const c = selCenterWorld();
        const z = view.zoom;
        const lx = c.x * z + view.ox, ly = c.y * z + view.oy - 22;
        const at = App._rotLabelDeg + '°';
        ctx.font = '11px Inter, sans-serif';
        const aw = ctx.measureText(at).width;
        ctx.fillStyle = '#1e1e1e';
        ctx.beginPath();
        ctx.roundRect ? ctx.roundRect(lx - aw / 2 - 6, ly - 10, aw + 12, 18, 3) : ctx.rect(lx - aw / 2 - 6, ly - 10, aw + 12, 18);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(at, lx, ly - 1);
      }
      ctx.restore();
    };

    // ---- resize modifiers ---------------------------------------------
    const _doResize = App.doResize && App.doResize.bind(App);
    if (_doResize) {
      App.doResize = function (d, e) {
        const n = d.node;
        if (!n) return _doResize(d, e);
        const p = this.toWorld(e);
        if (this.space) {
          if (d._lastP) {
            const dx = p.x - d._lastP.x, dy = p.y - d._lastP.y;
            n.x += dx; n.y += dy;
            if (d._anchorWorld) { d._anchorWorld.x += dx; d._anchorWorld.y += dy; }
            if (d.startLocalCx != null) { d.startLocalCx += dx; d.startLocalCy += dy; }
          }
          d._lastP = p;
          this.markDirty();
          this.statusPos && this.statusPos();
          return;
        }
        d._lastP = p;
        _doResize(d, e);

        const lock = !!n.aspectLock;
        const ctrl = !!(e.ctrlKey || e.metaKey);
        const wantProp = lock ? !ctrl : !!e.shiftKey;
        const name = d.name || '';
        const isCorner = name.length === 2;
        if (wantProp && d.startW && d.startH) {
          const ratio = d.startW / d.startH;
          if (!isCorner || (lock && !e.shiftKey)) {
            if (name.includes('e') || name.includes('w')) n.h = Math.max(1, n.w / ratio);
            else if (name.includes('n') || name.includes('s')) n.w = Math.max(1, n.h * ratio);
            else {
              if (n.w / ratio > n.h) n.h = n.w / ratio;
              else n.w = n.h * ratio;
            }
          }
        }
        if (e.altKey && d.startLocalCx != null) {
          const grewW = n.w - d.startW;
          const grewH = n.h - d.startH;
          n.w = Math.max(1, d.startW + 2 * grewW);
          n.h = Math.max(1, d.startH + 2 * grewH);
          n.x = d.startLocalCx - n.w / 2;
          n.y = d.startLocalCy - n.h / 2;
        } else if (d._anchorWorld && d._snapInitialized) {
          const ax = d._ax, ay = d._ay;
          const rot = d._rot || 0, fh = d._fh || 1, fv = d._fv || 1;
          const cr = Math.cos(rot), sr = Math.sin(rot);
          const lx = (ax - n.w / 2) * fh;
          const ly = (ay - n.h / 2) * fv;
          n.x = d._anchorWorld.x - n.w / 2 - (lx * cr - ly * sr);
          n.y = d._anchorWorld.y - n.h / 2 - (lx * sr + ly * cr);
        }
        if (n.shape && this._shapePath) n.path = this._shapePath(n);
        this.statusPos && this.statusPos();
      };
    }

    // ---- pointer: origin drag, multi-scale, orbit rotate --------------
    function hitOrigin(e) {
      if (!App._rotOriginOn || !App._rotOrigin || !App.canvas) return false;
      const r = App.canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const z = App.view.zoom;
      const sx = App._rotOrigin.x * z + App.view.ox;
      const sy = App._rotOrigin.y * z + App.view.oy;
      return Math.hypot(mx - sx, my - sy) <= 12;
    }

    function cornerName(mx, my, box, z, ox, oy) {
      const pts = [
        ['nw', box.x, box.y], ['n', box.x + box.w / 2, box.y],
        ['ne', box.x + box.w, box.y], ['e', box.x + box.w, box.y + box.h / 2],
        ['se', box.x + box.w, box.y + box.h], ['s', box.x + box.w / 2, box.y + box.h],
        ['sw', box.x, box.y + box.h], ['w', box.x, box.y + box.h / 2],
      ];
      for (const [name, wx, wy] of pts) {
        if (Math.hypot(mx - (wx * z + ox), my - (wy * z + oy)) <= 9) return name;
      }
      return null;
    }

    const _onDown = App.onDown && App.onDown.bind(App);
    App.onDown = function (e) {
      if (e.button === 0 && this.tool === 'move' && hitOrigin(e)) {
        this._drag = { kind: 'rot-origin', sx: e.clientX, sy: e.clientY };
        e.preventDefault();
        return;
      }
      if (e.button === 0 && this.tool === 'move' && this.sel.length > 1) {
        const u = unionWorld(this.page, this.sel);
        if (u) {
          const rect = this.canvas.getBoundingClientRect();
          const name = cornerName(e.clientX - rect.left, e.clientY - rect.top, u, this.view.zoom, this.view.ox, this.view.oy);
          if (name && name.length === 2) {
            this.history.begin(this.doc);
            this._drag = {
              kind: 'scale-multi',
              name,
              box: u,
              starts: snapStarts(),
              sx: e.clientX, sy: e.clientY,
            };
            e.preventDefault();
            return;
          }
        }
      }
      return _onDown ? _onDown(e) : undefined;
    };

    const _onMove = App.onMove && App.onMove.bind(App);
    App.onMove = function (e) {
      const d = this._drag;
      if (d && d.kind === 'rot-origin') {
        const p = this.toWorld(e);
        this._rotOrigin = { x: p.x, y: p.y };
        this.markDirty();
        return;
      }
      if (d && (d.kind === 'rotate-multi' || (d.kind === 'rotate' && this._rotOriginOn && this._rotOrigin))) {
        if (!d._orbitReady) {
          d.center = (this._rotOriginOn && this._rotOrigin) ? this._rotOrigin : (d.center || selCenterWorld());
          d.starts = snapStarts();
          if (d.kind === 'rotate' && d.node) d.starts = d.starts.filter((s) => s.id === d.node.id);
          d._orbitReady = true;
        }
        applyOrbit(d, e);
        return;
      }
      if (d && d.kind === 'scale-multi') {
        const p = this.toWorld(e);
        const box = d.box;
        const name = d.name;
        let ax = box.x, ay = box.y;
        if (name.includes('w')) ax = box.x + box.w;
        if (name.includes('n')) ay = box.y + box.h;
        if (name.includes('e')) ax = box.x;
        if (name.includes('s')) ay = box.y;
        if (e.altKey) { ax = box.x + box.w / 2; ay = box.y + box.h / 2; }
        let fx = 1, fy = 1;
        if (name.includes('e')) fx = (p.x - ax) / (box.w || 1);
        if (name.includes('w')) fx = (ax - p.x) / (box.w || 1);
        if (name.includes('s')) fy = (p.y - ay) / (box.h || 1);
        if (name.includes('n')) fy = (ay - p.y) / (box.h || 1);
        if (e.shiftKey) {
          const f = Math.abs(fx) > Math.abs(fy) ? fx : fy;
          fx = fy = f;
        }
        fx = isFinite(fx) && Math.abs(fx) > 0.02 ? fx : 0.02;
        fy = isFinite(fy) && Math.abs(fy) > 0.02 ? fy : 0.02;
        for (const s of d.starts) {
          const n = this.page.nodes[s.id];
          if (!n) continue;
          n.x = ax + (s.x - ax) * fx;
          n.y = ay + (s.y - ay) * fy;
          n.w = Math.max(1, s.w * Math.abs(fx));
          n.h = Math.max(1, s.h * Math.abs(fy));
        }
        this.markDirty();
        this.status(Math.round(Math.abs(fx) * 100) + '% × ' + Math.round(Math.abs(fy) * 100) + '%');
        return;
      }
      return _cursorTail.call(this, e, _onMove ? _onMove(e) : undefined);
    };
    // Cursor-hover tail (was a separate outer App.onMove wrapper in this
    // file — merged so this file only reassigns App.onMove once). Runs
    // after the base handler on every move; the drag-kind branches above
    // already `return` before reaching here, matching the old behavior
    // where their active _drag made the outer wrapper's `!this._drag`
    // guards fail.
    function _cursorTail(e, out) {
      if (!this._drag && this.tool === 'move' && this.sel.length === 1 && this.canvas) {
        const h = this.handleAt(e);
        if (h && h.cursor) this.canvas.style.cursor = h.cursor;
      }
      if (!this._drag && this.tool === 'move' && this._rotOriginOn && hitOrigin(e) && this.canvas) {
        this.canvas.style.cursor = 'move';
      }
      return out;
    }

    const _onUp = App.onUp && App.onUp.bind(App);
    App.onUp = function (e) {
      const d = this._drag;
      if (d && (d.kind === 'rot-origin' || d.kind === 'scale-multi')) {
        if (d.kind === 'scale-multi') this.history.end(this.doc);
        this._drag = null;
        this._rotLabelDeg = null;
        this.markDirty();
        return;
      }
      if (d && (d.kind === 'rotate' || d.kind === 'rotate-multi')) this._rotLabelDeg = null;
      if (_onUp) _onUp(e);
    };

    // ---- rotated resize cursors (nearest CSS) -------------------------
    function edgeCursor(corners, name) {
      const i = { n: 0, e: 1, s: 2, w: 3 }[name];
      if (i == null || !corners) return { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' }[name];
      const a = corners[i], b = corners[(i + 1) % 4];
      let ang = Math.atan2(b.y - a.y, b.x - a.x); // edge tangent
      ang = ((ang % Math.PI) + Math.PI) % Math.PI; // 0..PI
      // cursor is perpendicular to the edge
      const perp = (ang + Math.PI / 2) % Math.PI;
      if (perp < Math.PI / 8 || perp > 7 * Math.PI / 8) return 'ew-resize';
      if (perp < 3 * Math.PI / 8) return 'nwse-resize';
      if (perp < 5 * Math.PI / 8) return 'ns-resize';
      if (perp < 7 * Math.PI / 8) return 'nesw-resize';
      return 'ew-resize';
    }

    const _handleAt = App.handleAt && App.handleAt.bind(App);
    App.handleAt = function (e) {
      const h = _handleAt ? _handleAt(e) : null;
      if (h && h.kind === 'resize' && this.sel.length === 1) {
        const n = this.page.nodes[this.sel[0]];
        const corners = n && W && W.screenCorners ? W.screenCorners(this.view, n) : null;
        if (corners && h.name && h.name.length === 1) {
          h.cursor = edgeCursor(corners, h.name);
        }
      }
      return h;
    };

    if (global.Shortcuts && global.Shortcuts.def) {
      global.Shortcuts.def('alt+r', 'Rotation origin', 'Transform', (a) => a.toggleRotOrigin());
    }

    const _cmds = App._paletteCommands && App._paletteCommands.bind(App);
    if (_cmds) {
      App._paletteCommands = function () {
        const list = _cmds() || [];
        list.push({ label: 'Rotation origin', hint: '⌥R', kw: 'rotate pivot origin center target', run: () => this.toggleRotOrigin() });
        return list;
      };
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
