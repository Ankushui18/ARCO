/* text-edit-ui3.js — Figma in-place text: one outline, no double paint.
 *
 * Bugs this kills:
 *   • Canvas glyphs still painted under the textarea (double-bold text).
 *   • handles-figma drew a second blue box while the textarea already has one.
 *   • Overlay used unitless line-height so the caret/highlight missed glyphs.
 *   • Word highlight used the browser default (looked like a fill).
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
      '  caret-color:#111!important;',
      '  white-space:pre-wrap!important;',
      '  word-wrap:break-word!important;',
      '  field-sizing:fixed!important;',
      '}',
      '.ed-canvas-wrap textarea.text-edit::selection,',
      'textarea.text-edit[data-role="text-edit"]::selection{',
      '  background:rgba(13,153,255,.22)!important;',
      '  color:inherit!important;',
      '}',
      '.ed-canvas-wrap textarea.text-edit::-moz-selection,',
      'textarea.text-edit[data-role="text-edit"]::-moz-selection{',
      '  background:rgba(13,153,255,.22)!important;',
      '  color:inherit!important;',
      '}',
    ].join('');
    document.head.appendChild(s);
  }

  function frameBox(n, view) {
    const z = view.zoom, ox = view.ox, oy = view.oy;
    const b = n._w || { x: n.x || 0, y: n.y || 0, w: n.w || 24, h: n.h || 24 };
    return {
      x: Math.round(b.x * z + ox),
      y: Math.round(b.y * z + oy),
      w: Math.max(8, Math.round(b.w * z)),
      h: Math.max(8, Math.round(b.h * z)),
    };
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
        if (App._textEdit || editingId) return;
        return _ds(ctx, view, ids, page, moving);
      };
    }

    if (TE && TE.draw) {
      const _draw = TE.draw.bind(TE);
      TE.draw = function (ctx, n, doc, w, h) {
        if (n && (n.id === editingId || (App._textEdit && App._textEdit.n === n))) return;
        return _draw(ctx, n, doc, w, h);
      };
    }

    const _begin = App.beginTextEdit && App.beginTextEdit.bind(App);
    if (!_begin) return;

    App.beginTextEdit = function (n, opts) {
      if (n && n.id) R.setEditingText(n.id);
      _begin.call(this, n, opts);
      const ed = this._textEdit;
      if (!ed || !ed.ta || !n) return;
      const ta = ed.ta;
      const t = n.text || {};
      const z = this.view.zoom || 1;
      const size = Math.max(1, (t.size || 16) * z);
      const lhWorld = TE && TE.lineHeightPx ? TE.lineHeightPx(t) : ((t.size || 16) * (t.lineHeight > 0 ? t.lineHeight : 1.2));
      const lh = Math.max(1, lhWorld * z);
      const box = frameBox(n, this.view);

      ta.classList.add('text-edit');
      ta.style.position = 'absolute';
      ta.style.left = box.x + 'px';
      ta.style.top = box.y + 'px';
      ta.style.width = box.w + 'px';
      ta.style.height = Math.max(box.h, Math.ceil(lh)) + 'px';
      ta.style.fontSize = size + 'px';
      ta.style.lineHeight = lh + 'px';
      ta.style.boxShadow = 'none';
      ta.style.outline = '1px solid #0d99ff';
      ta.style.outlineOffset = '0px';
      ta.style.background = 'transparent';
      ta.style.padding = '0';
      ta.style.margin = '0';
      ta.style.border = '0';
      ta.style.overflow = 'hidden';
      ta.style.resize = 'none';
      if (t.letterSpacing) ta.style.letterSpacing = (t.letterSpacing * z) + 'px';

      const origSync = ed.syncRect;
      const apply = () => {
        const b = frameBox(n, this.view);
        ta.style.left = b.x + 'px';
        ta.style.top = b.y + 'px';
        ta.style.width = b.w + 'px';
        const nextH = Math.max(b.h, Math.ceil(lh));
        ta.style.height = nextH + 'px';
      };
      ed.syncRect = function () {
        if (typeof origSync === 'function') origSync();
        apply();
      };
      apply();
    };
  });
})(typeof window !== 'undefined' ? window : globalThis);
