/* text-edit-ui3.js — Figma text-edit contract.
 *
 * Figma: canvas glyphs stay until the overlay is live and the same color.
 * Never hide canvas text unless a visible textarea is actually on that layer.
 * Overlay follows zoom/pan. Exit always paints canvas again.
 */
(function (global) {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'complete') return fn();
    window.addEventListener('load', fn, { once: true });
  }

  function injectCss() {
    if (document.getElementById('pf-text-edit-ui3')) return;
    const s = document.createElement('style');
    s.id = 'pf-text-edit-ui3';
    s.textContent = [
      '.ed-canvas-wrap textarea.text-edit,',
      'textarea.text-edit[data-role="text-edit"]{',
      '  background:transparent!important;',
      '  border:0!important;',
      '  outline:1px solid #0d99ff!important;',
      '  outline-offset:0!important;',
      '  box-shadow:none!important;',
      '  border-radius:0!important;',
      '  resize:none!important;',
      '  overflow:hidden!important;',
      '  padding:0!important;',
      '  margin:0!important;',
      '  white-space:pre-wrap!important;',
      '  word-wrap:break-word!important;',
      '  field-sizing:fixed!important;',
      '  transition:none!important;',
      '  animation:none!important;',
      '  transform:none!important;',
      '  opacity:1!important;',
      '  visibility:visible!important;',
      '}',
      '.ed-canvas-wrap textarea.text-edit::selection,',
      'textarea.text-edit[data-role="text-edit"]::selection{',
      '  background:rgba(13,153,255,.22)!important;',
      '  color:inherit!important;',
      '}',
    ].join('');
    document.head.appendChild(s);
  }

  function fillCss(n) {
    if (n && n.fills) {
      for (const f of n.fills) {
        if (!f || f.visible === false || f.type !== 'solid' || !f.color) continue;
        return f.color;
      }
    }
    return '#111111';
  }

  function overlayLive(n) {
    const App = global.App;
    const ed = App && App._textEdit;
    if (!ed || !ed.ta || !n || ed.n !== n) return false;
    const ta = ed.ta;
    if (!ta.isConnected) return false;
    const st = ta.style;
    if (st.visibility === 'hidden' || st.display === 'none' || st.opacity === '0') return false;
    const w = parseFloat(st.width) || ta.offsetWidth;
    const h = parseFloat(st.height) || ta.offsetHeight;
    return w >= 2 && h >= 2;
  }

  function frameOf(n, view) {
    const z = view.zoom || 1, ox = view.ox || 0, oy = view.oy || 0;
    const b = n._w || { x: n.x || 0, y: n.y || 0, w: n.w || 24, h: n.h || 24 };
    return {
      x: Math.round(b.x * z + ox),
      y: Math.round(b.y * z + oy),
      w: Math.max(8, Math.round(b.w * z)),
      h: Math.max(8, Math.round(b.h * z)),
    };
  }

  function pinOverlay() {
    const App = global.App;
    const TE = global.TextEngine;
    const R = global.Renderer;
    const ed = App && App._textEdit;
    if (!ed || !ed.ta || !ed.n || !App.view) return false;
    const n = ed.n;
    const ta = ed.ta;
    if (!ta.isConnected) {
      if (R && R.setEditingText) R.setEditingText(null);
      return false;
    }
    if (!App.page || !App.page.nodes[n.id]) {
      try { ed.commit && ed.commit(true); } catch (e) {}
      return false;
    }
    const t = n.text || {};
    const z = App.view.zoom || 1;
    const box = frameOf(n, App.view);
    const size = Math.max(1, (t.size || 16) * z);
    const lhW = TE && TE.lineHeightPx
      ? TE.lineHeightPx(t)
      : ((t.size || 16) * (t.lineHeight > 0 ? t.lineHeight : 1.2));
    const color = fillCss(n);
    ta.style.left = box.x + 'px';
    ta.style.top = box.y + 'px';
    ta.style.width = box.w + 'px';
    ta.style.height = Math.max(box.h, Math.ceil(lhW * z)) + 'px';
    ta.style.fontSize = size + 'px';
    ta.style.lineHeight = (lhW * z) + 'px';
    ta.style.letterSpacing = ((t.letterSpacing || 0) * z) + 'px';
    ta.style.color = color;
    ta.style.caretColor = color;
    ta.style.visibility = 'visible';
    ta.style.opacity = '1';
    ta.style.display = 'block';
    ta.style.transition = 'none';
    ta.style.transform = 'none';
    if (R && R.setEditingText) R.setEditingText(n.id);
    return true;
  }

  function sweepOrphans() {
    const App = global.App;
    const live = App && App._textEdit && App._textEdit.ta;
    const all = document.querySelectorAll('textarea.text-edit, textarea[data-role="text-edit"]');
    // beginTextEdit appends the textarea, then redraws BEFORE _textEdit is
    // assigned. Sweeping in that window deletes the editor — double-click
    // looks like a no-op. Keep a single connected overlay in that gap.
    if (!live) {
      if (all.length === 1 && all[0].isConnected) return;
      all.forEach((el) => el.remove());
      if (global.Renderer && global.Renderer.setEditingText) global.Renderer.setEditingText(null);
      return;
    }
    all.forEach((el) => { if (el !== live) el.remove(); });
    if (!live.isConnected) {
      const wrap = document.querySelector('.ed-canvas-wrap');
      if (wrap) wrap.appendChild(live);
    }
  }

  ready(function () {
    const App = global.App;
    const R = global.Renderer;
    const TE = global.TextEngine;
    if (!App || !R) return;
    injectCss();

    let editingId = null;
    const _set = R.setEditingText && R.setEditingText.bind(R);
    R.setEditingText = function (id) {
      editingId = id || null;
      if (_set) _set(id);
    };
    R._editingTextId = function () { return editingId; };

    const _ds = R.drawSelection && R.drawSelection.bind(R);
    if (_ds) {
      R.drawSelection = function (ctx, view, ids, page, moving) {
        if (App._textEdit && overlayLive(App._textEdit.n)) return;
        return _ds(ctx, view, ids, page, moving);
      };
    }

    if (TE && TE.draw) {
      const _draw = TE.draw.bind(TE);
      TE.draw = function (ctx, n, doc, w, h) {
        if (overlayLive(n)) return;
        // Inner TextEngine.draw also skips when _textEdit/editingId is set.
        // If the overlay is not actually visible, paint canvas glyphs.
        const held = App._textEdit;
        const heldId = editingId;
        if (held && held.n === n) {
          App._textEdit = null;
          editingId = null;
          try { return _draw(ctx, n, doc, w, h); }
          finally { App._textEdit = held; editingId = heldId; }
        }
        return _draw(ctx, n, doc, w, h);
      };
    }

    // Figma: double-click a text layer always edits it (deep hit), even if
    // a parent frame is selected. Must be the last onDbl wrapper.
    const _onDbl = App.onDbl && App.onDbl.bind(App);
    App.onDbl = function (e) {
      if (this.tool === 'pen' && this.pen) { this.penCommit(true); return; }
      const p = this.toWorld(e);
      const deep = (this.hitTestDeep || this.hitTest).call(this, p);
      this._drag = null;
      this._snapGuides = null;
      this.marquee = null;
      if (this._marqueePreview) delete this._marqueePreview;
      if (deep && deep.type === 'text') {
        e.preventDefault();
        this.setSel([deep.id]);
        const self = this;
        requestAnimationFrame(function () {
          self.beginTextEdit(deep, { select: 'word', clientX: e.clientX, clientY: e.clientY });
        });
        return;
      }
      if (_onDbl) return _onDbl(e);
    };

    const _begin = App.beginTextEdit && App.beginTextEdit.bind(App);
    if (_begin) {
      App.beginTextEdit = function (n, opts) {
        _begin.call(this, n, opts);
        const ed = this._textEdit;
        if (!ed || !ed.ta || !n) {
          R.setEditingText(null);
          this.redraw && this.redraw();
          return;
        }
        if (!ed.ta.isConnected) {
          const wrap = document.querySelector('.ed-canvas-wrap');
          if (wrap) wrap.appendChild(ed.ta);
        }
        const ta = ed.ta;
        ta.classList.add('text-edit');
        ta.style.transition = 'none';
        ta.style.animation = 'none';
        ta.style.transform = 'none';
        ta.style.boxShadow = 'none';
        ta.style.outline = '1px solid #0d99ff';
        ta.style.padding = '0';
        ta.style.margin = '0';
        ta.style.border = '0';
        ta.style.background = 'transparent';
        ta.style.color = fillCss(n);
        ta.style.caretColor = fillCss(n);
        this.status && this.status('');
        if (!pinOverlay()) {
          R.setEditingText(null);
          this.redraw && this.redraw();
        }
        ed.syncCamera = pinOverlay;
      };
    }

    const _zoom = App._applyZoomAt && App._applyZoomAt.bind(App);
    if (_zoom) {
      App._applyZoomAt = function (px, py, factor) {
        _zoom(px, py, factor);
        pinOverlay();
      };
    }
    const _redraw = App.redraw && App.redraw.bind(App);
    if (_redraw) {
      App.redraw = function () {
        _redraw();
        if (this._textEdit) pinOverlay();
        else sweepOrphans();
      };
    }
    const _light = App._redrawLight && App._redrawLight.bind(App);
    if (_light) {
      App._redrawLight = function () {
        _light();
        if (this._textEdit) pinOverlay();
      };
    }
    const _resize = App.resizeCanvas && App.resizeCanvas.bind(App);
    if (_resize) {
      App.resizeCanvas = function () {
        _resize();
        pinOverlay();
      };
    }
    const _end = App.endTextEdit && App.endTextEdit.bind(App);
    if (_end) {
      App.endTextEdit = function (ok) {
        R.setEditingText(null);
        _end(ok);
        sweepOrphans();
        this.redraw && this.redraw();
      };
    }

    window.addEventListener('resize', pinOverlay);
  });
})(typeof window !== 'undefined' ? window : globalThis);
