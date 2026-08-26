/* pixel-snap.js — Figma Snap to pixel grid
 * https://help.figma.com/hc/en-us/articles/360039956914#Snap_to_settings
 *
 * Snap to pixel grid aligns a layer's X / Y / W / H to whole design
 * pixels when you move, resize, or draw. That is what stops half-pixel
 * edges from looking blurry on export. The pixel grid itself does not
 * need to be visible for snap to work (Figma).
 *
 * Separate from Snap to objects (smart guides).
 *
 *   Shift+'        Pixel grid visibility (shows at ≥ 800%)
 *   Shift+⌘/'      Snap to pixel grid on/off
 *   Alt (hold)     Bypass snap for this drag (same as object snap)
 *
 * Inspector X/Y/W/H show the real value (not a rounded lie).
 * "Snap selection to pixel grid" rounds the current selection in place.
 */
(function (global) {
  'use strict';

  function ready(fn) {
    if (typeof document === 'undefined') return;
    if (document.readyState === 'complete') return fn();
    if (typeof window !== 'undefined') window.addEventListener('load', fn, { once: true });
  }

  function px(v) {
    if (!isFinite(v)) return 0;
    return Math.round(v);
  }

  function snapBox(n) {
    if (!n) return n;
    n.x = px(n.x);
    n.y = px(n.y);
    if (n.w != null) n.w = Math.max(1, px(n.w));
    if (n.h != null) n.h = Math.max(1, px(n.h));
    return n;
  }

  function snapXY(n) {
    if (!n) return n;
    n.x = px(n.x);
    n.y = px(n.y);
    return n;
  }

  function snapCreateRect(sx, sy, px1, py1, square) {
    const x0 = px(sx), y0 = px(sy);
    let w = Math.max(1, px(Math.abs(px1 - sx)));
    let h = Math.max(1, px(Math.abs(py1 - sy)));
    if (square) w = h = Math.max(w, h);
    const x = px1 >= sx ? x0 : x0 - w;
    const y = py1 >= sy ? y0 : y0 - h;
    return { x, y, w, h };
  }

  function fmtNum(v) {
    if (!isFinite(v)) return '0';
    const r = Math.round(v);
    if (Math.abs(v - r) < 1e-6) return String(r);
    return String(Math.round(v * 100) / 100);
  }

  function snapOn(app) {
    return !app || !app.view ? true : app.view.snapPixel !== false;
  }

  function gridOn(app) {
    return !app || !app.view ? true : app.view.pixelGrid !== false;
  }

  function bypass(e) {
    return !!(e && e.altKey);
  }

  function isQuote(e) {
    return e && (e.code === 'Quote' || e.key === "'" || e.key === '"');
  }

  function typingInField(e) {
    const t = e && e.target;
    if (!t) return false;
    if (t.isContentEditable) return true;
    const tag = (t.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select';
  }

  function canvasView(app) {
    const v = app.view || {};
    const c = app.canvas;
    const r = c && c.getBoundingClientRect ? c.getBoundingClientRect() : { width: 0, height: 0 };
    return {
      zoom: v.zoom || 1,
      ox: v.ox || 0,
      oy: v.oy || 0,
      w: r.width,
      h: r.height,
      canvasColor: v.canvasColor || '#383838',
      pixelGrid: v.pixelGrid,
    };
  }

  function drawPixelGrid(ctx, view) {
    if (!ctx || !view) return;
    if (view.pixelGrid === false) return;
    const z = view.zoom || 1;
    if (z < 8 || view.w < 8 || view.h < 8) return;
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    const canvasColor = view.canvasColor || '#383838';
    let isDark = true;
    if (canvasColor.length >= 7 && canvasColor.charAt(0) === '#') {
      const r = parseInt(canvasColor.slice(1, 3), 16);
      const g = parseInt(canvasColor.slice(3, 5), 16);
      const b = parseInt(canvasColor.slice(5, 7), 16);
      isDark = (r + g + b) / 3 < 140;
    }
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.10)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const x0 = Math.floor(-view.ox / z) - 1;
    const y0 = Math.floor(-view.oy / z) - 1;
    const x1 = Math.ceil((view.w - view.ox) / z) + 1;
    const y1 = Math.ceil((view.h - view.oy) / z) + 1;
    // Cap so a huge canvas at 800% cannot stall a frame.
    if ((x1 - x0) + (y1 - y0) > 2400) {
      ctx.restore();
      return;
    }
    for (let i = x0; i <= x1; i++) {
      const sx = Math.round(i * z + view.ox) + 0.5;
      ctx.moveTo(sx, 0);
      ctx.lineTo(sx, view.h);
    }
    for (let j = y0; j <= y1; j++) {
      const sy = Math.round(j * z + view.oy) + 0.5;
      ctx.moveTo(0, sy);
      ctx.lineTo(view.w, sy);
    }
    ctx.stroke();
    ctx.restore();
  }

  function applyDuringDrag(app, e) {
    if (!snapOn(app) || bypass(e)) return;
    const d = app._drag;
    if (!d) return;
    if (d.kind === 'move' && d.starts) {
      for (let i = 0; i < d.starts.length; i++) {
        const s = d.starts[i];
        const n = app.page && app.page.nodes[s.id];
        if (n) snapXY(n);
      }
      if (app.statusPos) app.statusPos();
    } else if (d.kind === 'resize' && d.node) {
      snapBox(d.node);
      if (d.node.shape && app._shapePath) d.node.path = app._shapePath(d.node);
    } else if (d.kind === 'create' && d.node) {
      const n = d.node;
      const p = e && app.toWorld ? app.toWorld(e) : { x: n.x + n.w, y: n.y + n.h };
      const box = snapCreateRect(d.sx, d.sy, p.x, p.y, !!(e && e.shiftKey));
      n.x = box.x;
      n.y = box.y;
      n.w = box.w;
      n.h = box.h;
      if (n.shape && app._shapePath) n.path = app._shapePath(n);
    }
  }

  global.PixelSnap = {
    px, snapBox, snapXY, snapCreateRect, fmtNum, snapOn, gridOn, drawPixelGrid,
  };

  ready(function () {
    const App = global.App;
    const P = global.Panels;
    if (!App) return;

    if (App.view) {
      if (App.view.snapPixel == null) App.view.snapPixel = true;
      if (App.view.pixelGrid == null) App.view.pixelGrid = true;
    }

    let _toggleGuard = 0;
    function guarded(fn) {
      return function () {
        const now = Date.now();
        if (now - _toggleGuard < 40) return;
        _toggleGuard = now;
        return fn.apply(this, arguments);
      };
    }

    App.toggleSnapPixel = guarded(function () {
      this.view.snapPixel = this.view.snapPixel === false;
      const on = this.view.snapPixel !== false;
      if (this.toast) this.toast(on ? 'Snap to pixel grid on' : 'Snap to pixel grid off');
      if (this.syncViewToggles) this.syncViewToggles();
      if (this.markDirty) this.markDirty();
    });

    App.togglePixelGrid = guarded(function () {
      this.view.pixelGrid = this.view.pixelGrid === false;
      const on = this.view.pixelGrid !== false;
      if (this.toast) this.toast(on ? 'Pixel grid on (≥ 800%)' : 'Pixel grid off');
      if (this.markDirty) this.markDirty();
    });

    App.snapSelToPixel = function () {
      const ids = this.sel || [];
      if (!ids.length) {
        if (this.toast) this.toast('Select a layer to snap to the pixel grid');
        return;
      }
      if (this.history) this.history.begin(this.doc);
      let n = 0;
      for (let i = 0; i < ids.length; i++) {
        const node = this.page && this.page.nodes[ids[i]];
        if (!node || node.locked) continue;
        const ox = node.x, oy = node.y, ow = node.w, oh = node.h;
        snapBox(node);
        if (node.x !== ox || node.y !== oy || node.w !== ow || node.h !== oh) n++;
        if (node.shape && this._shapePath) node.path = this._shapePath(node);
      }
      if (this.history) this.history.end(this.doc);
      if (this.markDirty) this.markDirty();
      if (P && P.refreshInspector) P.refreshInspector();
      if (this.toast) this.toast(n ? ('Snapped ' + n + ' layer' + (n === 1 ? '' : 's') + ' to the pixel grid') : 'Already on the pixel grid');
    };

    const _tv = App.toggleView && App.toggleView.bind(App);
    App.toggleView = function (k) {
      if (k === 'snapPixel') return this.toggleSnapPixel();
      if (k === 'pixelGrid') return this.togglePixelGrid();
      return _tv ? _tv(k) : undefined;
    };

    const _onMove = App.onMove && App.onMove.bind(App);
    App.onMove = function (e) {
      const out = _onMove ? _onMove(e) : undefined;
      applyDuringDrag(this, e);
      return out;
    };

    const _onUp = App.onUp && App.onUp.bind(App);
    App.onUp = function (e) {
      const d = this._drag;
      const created = d && d.kind === 'create' && d.node;
      const moved = d && d.kind === 'move';
      const resized = d && d.kind === 'resize' && d.node;
      if (_onUp) _onUp(e);
      if (!snapOn(this) || bypass(e)) return;
      if (created) {
        snapBox(created);
        if (created.shape && this._shapePath) created.path = this._shapePath(created);
        if (this.markDirty) this.markDirty();
      } else if (moved && this.sel) {
        for (let i = 0; i < this.sel.length; i++) {
          const n = this.page && this.page.nodes[this.sel[i]];
          if (n) snapXY(n);
        }
      } else if (resized) {
        snapBox(resized);
        if (resized.shape && this._shapePath) resized.path = this._shapePath(resized);
      }
    };

    const _resizeBy = App.resizeBy && App.resizeBy.bind(App);
    if (_resizeBy) {
      App.resizeBy = function (dw, dh, e) {
        _resizeBy(dw, dh, e);
        if (!snapOn(this) || bypass(e)) return;
        for (let i = 0; i < (this.sel || []).length; i++) {
          const n = this.page && this.page.nodes[this.sel[i]];
          if (n && !n.locked) {
            if (dw) n.w = Math.max(1, px(n.w));
            if (dh) n.h = Math.max(1, px(n.h));
          }
        }
      };
    }

    const _scaleSel = App.scaleSel && App.scaleSel.bind(App);
    if (_scaleSel) {
      App.scaleSel = function (factor, anchor) {
        _scaleSel(factor, anchor);
        if (!snapOn(this)) return;
        for (let i = 0; i < (this.sel || []).length; i++) {
          const n = this.page && this.page.nodes[this.sel[i]];
          if (n && !n.locked) snapBox(n);
        }
      };
    }

    const _redraw = App.redraw && App.redraw.bind(App);
    App.redraw = function () {
      if (_redraw) _redraw();
      if (this.ctx) drawPixelGrid(this.ctx, canvasView(this));
    };

    const _light = App._redrawLight && App._redrawLight.bind(App);
    if (_light) {
      App._redrawLight = function () {
        _light();
        if (this.ctx) drawPixelGrid(this.ctx, canvasView(this));
      };
    }

    if (P && P.viewMenu) {
      const _vm = P.viewMenu.bind(P);
      P.viewMenu = function (x, y) {
        _vm(x, y);
        const menu = document.querySelector('.pf-menu.view-menu');
        if (!menu) return;
        const v = App.view || {};
        const Ico = global.Icons && global.Icons.svg;
        const chk = (on) => (on ? ((Ico && Ico('check', { size: 10 })) || '✓') + ' ' : '');
        const pixel = menu.querySelector('[data-v="pixel"]');
        if (pixel) {
          pixel.innerHTML = chk(v.pixelPreview === true) + 'Pixel preview';
          const title = pixel.previousElementSibling;
          if (title && title.classList && title.classList.contains('pf-title')) {
            title.textContent = 'Pixels';
          }
          const snap = document.createElement('button');
          snap.setAttribute('data-v', 'snapPixel');
          snap.innerHTML = chk(v.snapPixel !== false) + 'Snap to pixel grid <span class="kbd">⇧⌘\'</span>';
          const grid = document.createElement('button');
          grid.setAttribute('data-v', 'pixelGrid');
          grid.innerHTML = chk(v.pixelGrid !== false) + 'Pixel grid <span class="kbd">⇧\'</span>';
          const hint = document.createElement('div');
          hint.className = 'ph sm pf-px-hint';
          hint.textContent = 'Snap rounds X/Y/W/H on move and resize. Grid is visible at 800%+. Hold Alt to bypass.';
          pixel.parentNode.insertBefore(snap, pixel);
          pixel.parentNode.insertBefore(grid, pixel);
          pixel.parentNode.insertBefore(hint, pixel.nextSibling);
          const close = () => menu.remove();
          snap.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            App.toggleSnapPixel();
            close();
          });
          grid.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            App.togglePixelGrid();
            close();
          });
        }
      };
    }

    if (P && P.refreshInspector) {
      const _ri = P.refreshInspector.bind(P);
      P.refreshInspector = function () {
        _ri();
        const el = document.getElementById('ed-right');
        if (!el || !App.page || !App.sel || App.sel.length !== 1) return;
        const n = App.page.nodes[App.sel[0]];
        if (!n) return;
        el.querySelectorAll('input[data-xy]').forEach((inp) => {
          const k = inp.dataset.xy;
          if (n[k] == null || document.activeElement === inp) return;
          inp.value = fmtNum(n[k]);
          inp.step = '1';
        });
      };
    }

    if (P && P.contextMenu) {
      const _cm = P.contextMenu.bind(P);
      P.contextMenu = function (x, y, ids) {
        _cm(x, y, ids);
        const menu = document.querySelector('.pf-menu');
        if (!menu || !ids || !ids.length) return;
        if (menu.querySelector('[data-c="snap-px"]')) return;
        const extra = document.createElement('div');
        extra.innerHTML = '<hr><button data-c="snap-px">Snap to pixel grid</button>';
        menu.appendChild(extra);
        extra.querySelector('[data-c="snap-px"]').onclick = () => {
          menu.remove();
          App.snapSelToPixel();
        };
      };
    }

    const _cmds = App._paletteCommands && App._paletteCommands.bind(App);
    if (_cmds) {
      App._paletteCommands = function () {
        const list = _cmds() || [];
        list.push(
          { label: 'Snap to pixel grid', hint: '⇧⌘\'', kw: 'pixel snap grid whole integer blurry export', run: () => this.toggleSnapPixel() },
          { label: 'Pixel grid', hint: '⇧\'', kw: 'pixel grid overlay 800 zoom view', run: () => this.togglePixelGrid() },
          { label: 'Snap selection to pixel grid', hint: '', kw: 'round integer x y width height', run: () => this.snapSelToPixel() }
        );
        return list;
      };
    }

    if (global.Shortcuts && global.Shortcuts.def) {
      const S = global.Shortcuts;
      S.def("shift+'", 'Toggle pixel grid', 'View', (a) => a.togglePixelGrid());
      S.def('shift+"', 'Toggle pixel grid', 'View', (a) => a.togglePixelGrid());
      S.def("shift+mod+'", 'Snap to pixel grid', 'View', (a) => a.toggleSnapPixel());
      S.def('shift+mod+"', 'Snap to pixel grid', 'View', (a) => a.toggleSnapPixel());
    }

    document.addEventListener('keydown', (e) => {
      if (!isQuote(e) || typingInField(e) || e.repeat) return;
      if (e.shiftKey && (e.metaKey || e.ctrlKey) && !e.altKey) {
        e.preventDefault();
        App.toggleSnapPixel();
      } else if (e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        App.togglePixelGrid();
      }
    }, true);
  });
})(typeof window !== 'undefined' ? window : globalThis);
