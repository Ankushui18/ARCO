/* text-edit-figma.js — Figma-accurate in-place text editing.
 *
 * Double-click a text layer → transparent overlay, 1px blue outline,
 * caret/word under the click, no handles, no purple wash, real fill color.
 */
(function (global) {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'complete') return fn();
    window.addEventListener('load', fn, { once: true });
  }

  function isWordChar(ch) {
    return !!ch && /[A-Za-z0-9_\u00C0-\u024F\u0900-\u097F'’-]/.test(ch);
  }

  function wordRange(text, index) {
    const s = String(text || '');
    let i = Math.max(0, Math.min(s.length, index | 0));
    if (!s.length) return { start: 0, end: 0 };
    if (!isWordChar(s[i]) && i > 0 && isWordChar(s[i - 1])) i--;
    if (!isWordChar(s[i])) return { start: i, end: i };
    let a = i, b = i + 1;
    while (a > 0 && isWordChar(s[a - 1])) a--;
    while (b < s.length && isWordChar(s[b])) b++;
    return { start: a, end: b };
  }

  function fillColor(n) {
    if (n && n.fills) {
      for (const f of n.fills) {
        if (!f || f.visible === false || f.type !== 'solid' || !f.color) continue;
        return f.color;
      }
    }
    return '#111111';
  }

  function boxOf(n, view) {
    const z = view.zoom, ox = view.ox, oy = view.oy;
    if (n._wc && n._wc.length === 4) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of n._wc) {
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
      }
      return { x: x0 * z + ox, y: y0 * z + oy, w: (x1 - x0) * z, h: (y1 - y0) * z };
    }
    const b = n._w || { x: n.x || 0, y: n.y || 0, w: n.w || 24, h: n.h || 24 };
    return { x: b.x * z + ox, y: b.y * z + oy, w: b.w * z, h: b.h * z };
  }

  function indexFromPoint(n, localX, localY) {
    const R = global.Renderer;
    const t = n.text || {};
    const size = t.size || 16;
    const lhMul = (typeof t.lineHeight === 'number' && t.lineHeight > 0) ? t.lineHeight : 1.2;
    const lineH = size * lhMul;
    let lines, lineH2 = lineH;
    try {
      const m = R && R.textLines ? R.textLines(n, n.w) : null;
      if (m) { lines = m.lines; lineH2 = m.lineH || lineH; }
    } catch (e) {}
    if (!lines) lines = String(t.content || '').split('\n');
    const li = Math.max(0, Math.min(lines.length - 1, Math.floor(Math.max(0, localY) / lineH2)));
    const line = lines[li] || '';
    let prefix = 0;
    for (let i = 0; i < li; i++) prefix += (lines[i] || '').length + 1;
    const ctx = document.createElement('canvas').getContext('2d');
    if (R && R.fontSpec) ctx.font = R.fontSpec(n);
    else ctx.font = `${t.italic ? 'italic ' : ''}${t.weight || 400} ${size}px ${(t.font || 'Inter')}, sans-serif`;
    const align = t.align || 'left';
    const lineW = ctx.measureText(line).width;
    let x0 = 0;
    if (align === 'center') x0 = ((n.w || 0) - lineW) / 2;
    else if (align === 'right') x0 = (n.w || 0) - lineW;
    const target = localX - x0;
    if (target <= 0) return prefix;
    let lo = 0, hi = line.length, best = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const w = ctx.measureText(line.slice(0, mid)).width;
      if (w <= target) { best = mid; lo = mid + 1; }
      else hi = mid - 1;
    }
    if (best < line.length) {
      const a = ctx.measureText(line.slice(0, best)).width;
      const b = ctx.measureText(line.slice(0, best + 1)).width;
      if (target - a > b - target) best++;
    }
    return prefix + best;
  }

  ready(function () {
    const App = global.App;
    const M = global.Model;
    const R = global.Renderer;
    if (!App || !M || !R) return;

    App._textFillColor = function (n) { return fillColor(n); };

    const _redraw = App.redraw && App.redraw.bind(App);
    if (_redraw) {
      App.redraw = function () {
        const editing = !!this._textEdit;
        if (!editing) return _redraw();
        const c = this.canvas, ctx = this.ctx;
        if (!c || !ctx) return;
        const rect = c.getBoundingClientRect();
        const v = this.view;
        R.drawPage(ctx, this.page, this.doc, {
          zoom: v.zoom, ox: v.ox, oy: v.oy, w: rect.width, h: rect.height,
          grid: v.grid, pixelPreview: v.pixelPreview, canvasColor: v.canvasColor,
        });
        this.drawPenOverlay && this.drawPenOverlay(ctx);
        R.drawRulers(ctx, this.view, rect.width, rect.height);
        this.updateZoomLabel && this.updateZoomLabel();
      };
    }
    const _light = App._redrawLight && App._redrawLight.bind(App);
    if (_light) {
      App._redrawLight = function () {
        if (this._textEdit) return this.redraw();
        return _light();
      };
    }

    App.beginTextEdit = function (n, opts) {
      opts = opts || {};
      if (!n || n.type !== 'text') return;
      if (this._textEdit) {
        if (this._textEdit.n === n) return;
        this.endTextEdit(true);
      }
      this._drag = null;
      this._snapGuides = null;
      this.marquee = null;
      if (this._marqueePreview) delete this._marqueePreview;

      try { this.layoutDoc(this.doc, this.page); } catch (e) {}
      if (global.World && global.World.computePage) {
        try { global.World.computePage(this.page); } catch (e) {}
      }

      const wrap = document.querySelector('.ed-canvas-wrap');
      if (!wrap) return;

      const t = n.text || (n.text = {});
      const originalContent = t.content || '';
      const originalRuns = Array.isArray(t.runs) ? JSON.parse(JSON.stringify(t.runs)) : null;
      const z = this.view.zoom;
      const box = boxOf(n, this.view);

      const ta = document.createElement('textarea');
      ta.className = 'text-edit';
      ta.setAttribute('spellcheck', 'false');
      ta.setAttribute('autocomplete', 'off');
      ta.setAttribute('autocorrect', 'off');
      ta.setAttribute('autocapitalize', 'off');
      ta.setAttribute('data-role', 'text-edit');
      ta.value = t.content || '';

      const fam = (t.font || 'Inter').replace(/^["']|["']$/g, '');
      const familyCss = `"${fam}", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif`;
      const fs = Math.max(1, (t.size || 16) * z);
      const lhMul = (typeof t.lineHeight === 'number' && t.lineHeight > 0) ? t.lineHeight : 1.2;
      const color = fillColor(n);

      const applyBox = (b) => {
        ta.style.left = b.x + 'px';
        ta.style.top = b.y + 'px';
        ta.style.width = Math.max(8, b.w) + 'px';
        ta.style.height = Math.max(fs * lhMul, b.h) + 'px';
      };

      ta.style.cssText = [
        'position:absolute',
        'z-index:30',
        'margin:0',
        'padding:0',
        'border:0',
        'outline:none',
        'resize:none',
        'overflow:hidden',
        'background:transparent',
        'box-shadow:0 0 0 1px #0d99ff',
        'border-radius:0',
        'color:' + color,
        `font:${t.italic ? 'italic ' : ''}${t.weight || 400} ${fs}px ${familyCss}`,
        'line-height:' + lhMul,
        'letter-spacing:' + ((t.letterSpacing || 0) * z) + 'px',
        'text-align:' + (t.align || 'left'),
        'text-decoration:' + ([t.underline ? 'underline' : '', t.strike ? 'line-through' : ''].filter(Boolean).join(' ') || 'none'),
        'white-space:pre-wrap',
        'word-wrap:break-word',
        'box-sizing:border-box',
        'caret-color:' + color,
        'user-select:text',
        '-webkit-user-select:text',
        'tab-size:4',
        'field-sizing:fixed',
      ].join(';');
      applyBox(box);

      wrap.appendChild(ta);
      R.setEditingText(n.id);
      this.redraw();

      let committed = false;
      const syncRect = () => {
        try {
          const mode = t.resize || 'fixed';
          if (mode !== 'fixed' && !n.als) this.applyTextResize(n);
        } catch (e) {}
        if (global.World && global.World.computePage) {
          try { global.World.computePage(this.page); } catch (e) {}
        }
        applyBox(boxOf(n, this.view));
        if ((t.resize || 'fixed') !== 'fixed' || (n.als && (n.als.w === 'hug' || n.als.h === 'hug'))) {
          ta.style.height = 'auto';
          const next = Math.max(boxOf(n, this.view).h, ta.scrollHeight);
          ta.style.height = next + 'px';
        }
      };

      const commit = (ok) => {
        if (committed) return;
        committed = true;
        clearInterval(this._textFocusTimer);
        document.removeEventListener('mousedown', onOutside, true);
        this._drag = null;
        this._snapGuides = null;
        this.marquee = null;
        if (this._marqueePreview) delete this._marqueePreview;
        if (ok) {
          const newVal = ta.value;
          t.content = originalContent;
          if (originalRuns) t.runs = originalRuns;
          else delete t.runs;
          if (newVal !== originalContent) {
            this.history.begin(this.doc);
            t.content = newVal.length ? newVal : ' ';
            delete t.runs;
            try { this.applyTextResize(n); } catch (e) {}
            this.history.end(this.doc);
          }
        } else {
          t.content = originalContent;
          if (originalRuns) t.runs = originalRuns;
          else delete t.runs;
        }
        R.setEditingText(null);
        this._textEdit = null;
        if (ta.parentNode) ta.remove();
        this.status('');
        this.markDirty();
      };

      const onOutside = (e) => {
        if (e.target === ta || ta.contains(e.target)) return;
        if (e.target.closest && (
          e.target.closest('.ed-top') || e.target.closest('.ed-left') ||
          e.target.closest('.ed-right') || e.target.closest('.ed-toolbar') ||
          e.target.closest('.ed-zoom') || e.target.closest('.pf-menu') ||
          e.target.closest('.pf-palette') || e.target.closest('.pf-font-picker') ||
          e.target.closest('.ed-modal-backdrop') || e.target.closest('.modal-back') ||
          e.target.closest('.pf-modal') || e.target.closest('#penfig-toast')
        )) return;
        commit(true);
      };
      requestAnimationFrame(() => setTimeout(() => document.addEventListener('mousedown', onOutside, true), 60));

      ta.addEventListener('input', () => {
        t.content = ta.value;
        syncRect();
        try { this.redraw(); } catch (e) {}
      });

      const stopKeys = (ev) => {
        ev.stopPropagation();
        if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
      };
      ta.addEventListener('keydown', (ev) => {
        stopKeys(ev);
        if (ev.key === 'Escape') { ev.preventDefault(); commit(false); return; }
        if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); commit(true); return; }
        if (ev.key === 'Tab') {
          if (global.TextEngine) return; // list indent / outdent handled by text-figma.js
          ev.preventDefault();
          const s = ta.selectionStart ?? ta.value.length;
          const e2 = ta.selectionEnd ?? s;
          ta.value = ta.value.slice(0, s) + '\t' + ta.value.slice(e2);
          ta.selectionStart = ta.selectionEnd = s + 1;
          t.content = ta.value;
          syncRect();
          try { this.redraw(); } catch (e) {}
        }
        if ((ev.metaKey || ev.ctrlKey) && !'aczxyvbiu78<>.,'.includes((ev.key || '').toLowerCase())) {
          ev.preventDefault();
        }
      }, true);
      ta.addEventListener('keyup', stopKeys, true);
      ta.addEventListener('keypress', stopKeys, true);
      ta.addEventListener('compositionstart', stopKeys, true);
      ta.addEventListener('compositionupdate', stopKeys, true);
      ta.addEventListener('compositionend', stopKeys, true);

      const stopP = (ev) => { ev.stopPropagation(); if (ev.stopImmediatePropagation) ev.stopImmediatePropagation(); };
      ['input', 'paste', 'cut', 'focusin', 'mousedown', 'mouseup', 'click', 'dblclick', 'pointerdown', 'pointerup', 'contextmenu']
        .forEach((ev) => ta.addEventListener(ev, stopP, true));
      ta.addEventListener('touchstart', stopP, { passive: true, capture: true });
      ta.addEventListener('touchend', stopP, { passive: true, capture: true });

      const applySelection = () => {
        const mode = opts.select || 'word';
        const len = ta.value.length;
        try {
          if (mode === 'all') {
            ta.setSelectionRange(0, len);
          } else if (mode === 'caret') {
            const idx = opts.index != null ? opts.index : len;
            ta.setSelectionRange(idx, idx);
          } else {
            const idx = opts.index != null ? opts.index : 0;
            const wr = wordRange(ta.value, idx);
            if (wr.start === wr.end) ta.setSelectionRange(idx, idx);
            else ta.setSelectionRange(wr.start, wr.end);
          }
        } catch (e) {}
      };

      this._textEdit = { n, ta, commit };
      this.status('Editing text — Esc to cancel');

      const focusOnce = () => {
        if (committed || !this._textEdit || this._textEdit.ta !== ta) return;
        try { ta.focus({ preventScroll: true }); } catch (e) { try { ta.focus(); } catch (_) {} }
        if (document.activeElement === ta) applySelection();
      };
      requestAnimationFrame(() => {
        focusOnce();
        syncRect();
        if (opts.clientX != null && opts.index == null) {
          const b = boxOf(n, this.view);
          opts.index = indexFromPoint(n, (opts.clientX - b.x) / z, (opts.clientY - b.y) / z);
        }
        focusOnce();
      });
      setTimeout(focusOnce, 30);

      clearInterval(this._textFocusTimer);
      this._textFocusTimer = setInterval(() => {
        if (committed) { clearInterval(this._textFocusTimer); return; }
        const ae = document.activeElement;
        if (!ae || ae === document.body || ae === this.canvas) {
          try { ta.focus({ preventScroll: true }); } catch (e) {}
        }
      }, 240);
    };

    const _onDbl = App.onDbl && App.onDbl.bind(App);
    App.onDbl = function (e) {
      if (this.tool === 'pen' && this.pen) { this.penCommit(true); return; }
      const p = this.toWorld(e);
      const hit = this.hitTest(p);
      this._drag = null;
      this._snapGuides = null;
      this.marquee = null;
      delete this._marqueePreview;
      if (hit && hit.type === 'text') {
        this.setSel([hit.id]);
        const b = boxOf(hit, this.view);
        const z = this.view.zoom;
        const idx = indexFromPoint(hit, (e.clientX - (this.canvas.getBoundingClientRect().left) - b.x) / z,
          (e.clientY - (this.canvas.getBoundingClientRect().top) - b.y) / z);
        requestAnimationFrame(() => this.beginTextEdit(hit, {
          select: 'word',
          index: idx,
          clientX: e.clientX,
          clientY: e.clientY,
        }));
        return;
      }
      if (_onDbl) _onDbl(e);
    };

    const _onKey = App.onKey && App.onKey.bind(App);
    App.onKey = function (e) {
      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey &&
          !/INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '') &&
          this.sel.length === 1) {
        const n = this.page && this.page.nodes[this.sel[0]];
        if (n && n.type === 'text') {
          e.preventDefault();
          requestAnimationFrame(() => this.beginTextEdit(n, { select: 'all' }));
          return;
        }
      }
      if (_onKey) return _onKey(e);
    };
  });
})(window);
