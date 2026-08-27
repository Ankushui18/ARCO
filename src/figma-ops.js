/* figma-ops.js — Figma select / scale / copy-paste / remaining text-guide.
 * Overlay. Loads last. Do not rewrite ui-editor.js from here.
 *
 * Specs:
 *   help.figma.com — Guide to text
 *   help.figma.com — Select layers and objects
 *   help.figma.com — Scale layers while maintaining proportions
 *   help.figma.com — Copy and paste objects
 */
(function (global) {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'complete') return fn();
    window.addEventListener('load', fn, { once: true });
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function overlaps(bb, box) {
    if (!bb) return false;
    return bb.x + bb.w >= box.x && bb.x <= box.x + box.w &&
           bb.y + bb.h >= box.y && bb.y <= box.y + box.h;
  }

  function viewWorld(App) {
    const r = App.canvas.getBoundingClientRect();
    const z = App.view.zoom || 1;
    return { x: -App.view.ox / z, y: -App.view.oy / z, w: r.width / z, h: r.height / z };
  }

  function inflate(b, f) {
    const extraW = b.w * f, extraH = b.h * f;
    return { x: b.x - extraW / 2, y: b.y - extraH / 2, w: b.w + extraW, h: b.h + extraH };
  }

  function intersects(a, b) {
    return a.x + a.w >= b.x && a.x <= b.x + b.w && a.y + a.h >= b.y && a.y <= b.y + b.h;
  }

  ready(function () {
    const App = global.App;
    const M = global.Model;
    const P = global.Panels;
    const R = global.Renderer;
    const TE = global.TextEngine;
    if (!App || !M) return;

    App._scaleAnchor = App._scaleAnchor || 'center';
    App._dupRepeat = null;

    function page() { return App.page; }

    function ancestorsOf(n) {
      const out = [];
      let cur = n, guard = 0;
      while (cur && guard++ < 80) {
        out.push(cur);
        cur = cur.parent ? page().nodes[cur.parent] : null;
      }
      return out;
    }

    function topOf(n) {
      const a = ancestorsOf(n);
      return a[a.length - 1] || n;
    }

    function skipLocked(n) {
      let cur = n, guard = 0;
      while (cur && cur.locked && guard++ < 80) {
        cur = cur.parent ? page().nodes[cur.parent] : null;
      }
      return cur || null;
    }

    // Figma: click selects the parent; click again (parent selected) drills
    // one level; ⌘/Ctrl-click deep-selects the leaf.
    function resolveClick(deep) {
      if (!deep || deep.visible === false) return null;
      deep = skipLocked(deep);
      if (!deep) return null;
      const chain = ancestorsOf(deep);
      const selId = App.sel.length === 1 ? App.sel[0] : null;
      if (selId) {
        const si = chain.findIndex((n) => n.id === selId);
        if (si > 0) return chain[si - 1];
        if (si === 0) return deep;
      }
      return chain[chain.length - 1] || deep;
    }

    function resolveDrill(deep) {
      if (!deep) return null;
      deep = skipLocked(deep);
      if (!deep) return null;
      const chain = ancestorsOf(deep);
      const selId = App.sel.length === 1 ? App.sel[0] : null;
      if (selId) {
        const si = chain.findIndex((n) => n.id === selId);
        if (si > 0) return chain[si - 1];
        if (si === 0) return deep;
      }
      return chain.length >= 2 ? chain[chain.length - 2] : deep;
    }

    function siblingsOf(n) {
      if (!n) return page().tops.slice();
      if (!n.parent) return page().tops.slice();
      const par = page().nodes[n.parent];
      return (par && par.children) ? par.children.slice() : page().tops.slice();
    }

    function firstChild(n) {
      if (!n || !n.children) return null;
      for (let i = n.children.length - 1; i >= 0; i--) {
        const c = page().nodes[n.children[i]];
        if (c && c.visible !== false && !c.locked) return c;
      }
      for (const id of n.children) {
        const c = page().nodes[id];
        if (c && c.visible !== false) return c;
      }
      return null;
    }

    // ------------------------------------------------------------------ hit / select
    // Keep hitTest deep (leaf). Figma parent-select is applied after click
    // so rotate/hover geometry is unchanged.
    const _hit = App.hitTest && App.hitTest.bind(App);
    App.hitTestDeep = function (p) { return _hit ? _hit(p) : null; };

    const _onDown = App.onDown && App.onDown.bind(App);
    App.onDown = function (e) {
      const deepKey = e.metaKey || e.ctrlKey;
      const prevSel = (this.sel || []).slice();

      // While editing text, a click on another text layer switches editor
      // (Figma: no second double-click required).
      if (this._textEdit && e.button === 0 && !this.space) {
        const p = this.toWorld(e);
        const deep = this.hitTestDeep(p);
        if (deep && deep.type === 'text' && deep !== this._textEdit.n) {
          this.endTextEdit(true);
          this.setSel([deep.id]);
          requestAnimationFrame(() => this.beginTextEdit(deep, { select: 'caret' }));
          e.preventDefault();
          return;
        }
      }

      this._altDupPending = !!(e.altKey && e.button === 0 && (this.tool === 'move' || this.tool === 'scale'));
      const secondClick = this._pfClickAt && (Date.now() - this._pfClickAt) < 400;
      this._pfClickAt = Date.now();
      if (_onDown) _onDown(e);

      // First click selects the parent. The second click of a double-click
      // is left alone so onDbl can drill one level (Figma).
      if (!secondClick && e.button === 0 && !deepKey && !e.shiftKey && this.sel && this.sel.length === 1 && this.tool === 'move') {
        const deep = this.page.nodes[this.sel[0]];
        const saved = this.sel.slice();
        this.sel = prevSel;
        const resolved = resolveClick(deep);
        this.sel = saved;
        if (resolved && resolved.id !== this.sel[0]) this.setSel([resolved.id]);
        if (resolved && resolved.locked) {
          const up = skipLocked(resolved.parent ? this.page.nodes[resolved.parent] : null);
          this.setSel(up ? [up.id] : []);
        }
      }
    };

    const _onMove = App.onMove && App.onMove.bind(App);
    App.onMove = function (e) {
      const d = this._drag;
      if (d && d.kind === 'pending-move' && this._altDupPending && !d._altDuped) {
        const p2 = this.toWorld(e);
        if (Math.hypot(p2.x - d.sx, p2.y - d.sy) > 3 / this.view.zoom) {
          this._altDupPending = false;
          d._altDuped = true;
          const clones = duplicateInPlace(this, 0, 0);
          if (clones.length) {
            d.starts = clones.map((n) => ({ id: n.id, x: n.x, y: n.y }));
            d.hit = clones[0];
            this.setSel(clones.map((n) => n.id));
          }
        }
      }
      if (_onMove) _onMove(e);

      if (this._drag && this._drag.kind === 'marquee') {
        const d2 = this._drag;
        const p2 = this.toWorld(e);
        const box = {
          x: Math.min(d2.sx, p2.x), y: Math.min(d2.sy, p2.y),
          w: Math.abs(p2.x - d2.sx), h: Math.abs(p2.y - d2.sy),
        };
        const ids = marqueeFigma(this.page, box, {
          start: { x: d2.sx, y: d2.sy },
          deep: e.metaKey || e.ctrlKey,
        });
        const next = e.altKey
          ? (d2.base || []).filter((id) => !ids.includes(id))
          : [...new Set([...(d2.base || []), ...ids])];
        this._marqueePreview = next;
        this.sel = next;
      }
    };

    const _onUp = App.onUp && App.onUp.bind(App);
    App.onUp = function (e) {
      const d = this._drag;
      if (d && d.kind === 'move' && d.moved && d.starts && d.starts.length) {
        const n = this.page.nodes[d.starts[0].id];
        if (n) {
          this._dupRepeat = { dx: n.x - d.starts[0].x, dy: n.y - d.starts[0].y };
        }
      }
      this._altDupPending = false;
      if (_onUp) _onUp(e);
    };

    const _onDbl = App.onDbl && App.onDbl.bind(App);
    App.onDbl = function (e) {
      this._forceDeepHit = true;
      const deep = this.hitTestDeep(this.toWorld(e));
      this._forceDeepHit = false;
      this._drag = null;
      if (deep && deep.type === 'text') {
        if (_onDbl) return _onDbl(e);
        return;
      }
      if (deep && deep.fills && deep.fills.some((f) => f && f.type === 'image')) {
        if (_onDbl) return _onDbl(e);
        return;
      }
      if (deep) {
        const next = resolveDrill(deep);
        if (next) {
          this.setSel([next.id]);
          this.markDirty();
          return;
        }
      }
      if (_onDbl) return _onDbl(e);
    };

    function nodeAtPoint(pg, p) {
      for (let i = pg.tops.length - 1; i >= 0; i--) {
        const t = pg.nodes[pg.tops[i]];
        if (t && t._w && p.x >= t._w.x && p.x <= t._w.x + t._w.w && p.y >= t._w.y && p.y <= t._w.y + t._w.h) return t;
      }
      return null;
    }

    function marqueeFigma(pg, box, opts) {
      opts = opts || {};
      const out = [];
      if (opts.deep) {
        const visit = (n) => {
          if (!n || n.visible === false || n.locked) return;
          if (overlaps(n._w, box)) out.push(n.id);
          for (const cid of n.children || []) visit(pg.nodes[cid]);
        };
        for (const tid of pg.tops) visit(pg.nodes[tid]);
        return out;
      }
      const start = opts.start;
      const host = start ? nodeAtPoint(pg, start) : null;
      const pool = (host && host.type === 'frame' && !host.section && host.children && host.children.length)
        ? host.children
        : pg.tops;
      for (const id of pool) {
        const n = pg.nodes[id];
        if (!n || n.visible === false || n.locked) continue;
        if (overlaps(n._w, box)) out.push(n.id);
      }
      return out;
    }

    // Enter = child (or edit text). Shift+Enter = parent.
    // Tab = next sibling. Shift+Tab = previous sibling.
    const _onKey = App.onKey && App.onKey.bind(App);
    App.onKey = function (e) {
      if (this._textEdit || this._crop) return _onKey ? _onKey(e) : undefined;
      const typing = /INPUT|TEXTAREA|SELECT/.test((e.target && e.target.tagName) || '');
      if (typing) return _onKey ? _onKey(e) : undefined;

      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey && this.sel.length === 1) {
        const n = this.page.nodes[this.sel[0]];
        if (e.shiftKey) {
          e.preventDefault();
          if (n && n.parent) this.setSel([n.parent]);
          return;
        }
        if (n && n.type !== 'text') {
          const kid = firstChild(n);
          if (kid) {
            e.preventDefault();
            this.setSel([kid.id]);
            return;
          }
        }
      }
      if (_onKey) return _onKey(e);
    };

    App.cycleSel = function (dir) {
      const cur = this.sel.length === 1 ? this.page.nodes[this.sel[0]] : null;
      const sibs = siblingsOf(cur).filter((id) => {
        const n = this.page.nodes[id];
        return n && n.visible !== false;
      });
      if (!sibs.length) return;
      const i = cur ? sibs.indexOf(cur.id) : -1;
      const j = (i + dir + sibs.length) % sibs.length;
      this.setSel([sibs[j]]);
      this.markDirty();
    };

    App.selectMatching = function () {
      if (this.sel.length !== 1) { this.toast('Select one layer inside a frame'); return; }
      const n = this.page.nodes[this.sel[0]];
      if (!n || !n.parent) { this.toast('Matching layers live inside a frame'); return; }
      const key = (x) => (x.type || '') + '|' + (x.name || '');
      const want = key(n);
      const hits = [];
      for (const tid of this.page.tops) {
        const walk = (node) => {
          if (!node) return;
          if (node.id !== n.id && key(node) === want) hits.push(node.id);
          for (const cid of node.children || []) walk(this.page.nodes[cid]);
        };
        walk(this.page.nodes[tid]);
      }
      if (!hits.length) { this.toast('No matching layers'); return; }
      this.setSel([n.id].concat(hits));
      this.toast(hits.length + 1 + ' matching layers');
    };

    App.invertSel = function () {
      const cur = new Set(this.sel);
      const next = this.page.tops.filter((id) => !cur.has(id));
      this.setSel(next);
    };

    if (global.Shortcuts && global.Shortcuts.def) {
      const def = global.Shortcuts.def;
      def('shift+enter', 'Select parent', 'Editing', (a) => {
        const n = a.sel[0] && a.page.nodes[a.sel[0]];
        if (n && n.parent) a.setSel([n.parent]);
      });
      def('alt+mod+a', 'Select matching layers', 'Editing', (a) => a.selectMatching());
      def('shift+mod+a', 'Invert selection', 'Editing', (a) => a.invertSel());
      def('shift+mod+r', 'Paste to replace', 'Editing', (a) => a.paste('replace'));
      def('shift+mod+c', 'Copy as PNG', 'Editing', (a) => a.copyAsPng());
    }

    // ------------------------------------------------------------------ layers panel
    if (P && P.refreshLayers) {
      const _rl = P.refreshLayers.bind(P);
      P.refreshLayers = function () {
        _rl();
        const el = document.getElementById('ed-layers');
        if (!el) return;
        const order = [];
        el.querySelectorAll('.ly-row').forEach((row) => { if (row.dataset.id) order.push(row.dataset.id); });
        el.querySelectorAll('.ly-row').forEach((row) => {
          if (row._pfRange) return;
          row._pfRange = true;
          row.addEventListener('click', (e) => {
            if (e.target.closest('button') || e.target.closest('[data-caret]')) return;
            const id = row.dataset.id;
            if (e.shiftKey && !e.metaKey && !e.ctrlKey && App.sel.length) {
              e.stopImmediatePropagation();
              const a = order.indexOf(App.sel[App.sel.length - 1]);
              const b = order.indexOf(id);
              if (a >= 0 && b >= 0) {
                const lo = Math.min(a, b), hi = Math.max(a, b);
                App.setSel(order.slice(lo, hi + 1));
              }
            }
          }, true);
        });
        const tabs = document.querySelector('.ed-left-tabs');
        if (tabs && !tabs.querySelector('[data-collapse-all]')) {
          const b = document.createElement('button');
          b.className = 'mini';
          b.dataset.collapseAll = '1';
          b.title = 'Collapse all layers';
          b.textContent = 'Collapse';
          b.style.marginLeft = 'auto';
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            P._collapsed = P._collapsed || {};
            const keep = new Set();
            for (const id of App.sel) {
              let n = App.page.nodes[id];
              while (n && n.parent) { keep.add(n.parent); n = App.page.nodes[n.parent]; }
            }
            for (const id of Object.keys(App.page.nodes)) {
              const n = App.page.nodes[id];
              if (n && n.children && n.children.length && !keep.has(id)) P._collapsed[id] = true;
            }
            P.refreshLayers();
          });
          tabs.appendChild(b);
        }
      };
    }

    // ------------------------------------------------------------------ scale panel + text size
    const _cap = App.captureScaleTree && App.captureScaleTree.bind(App);
    App.captureScaleTree = function (root) {
      const snap = _cap ? _cap(root) : [];
      for (const s of snap) {
        if (s.n && s.n.text) {
          s.textSize = s.n.text.size;
          s.textLs = s.n.text.letterSpacing;
          s.textPara = s.n.text.paragraphSpacing;
        }
      }
      return snap;
    };
    const _apply = App.applyScaleTree && App.applyScaleTree.bind(App);
    App.applyScaleTree = function (snapshot, factor) {
      if (_apply) _apply(snapshot, factor);
      for (const s of snapshot || []) {
        if (!s.n || !s.n.text) continue;
        if (typeof s.textSize === 'number') s.n.text.size = Math.max(1, s.textSize * factor);
        if (typeof s.textLs === 'number') s.n.text.letterSpacing = s.textLs * factor;
        if (typeof s.textPara === 'number') s.n.text.paragraphSpacing = s.textPara * factor;
      }
    };

    App.scaleSel = function (factor, anchor) {
      if (!this.sel.length || !isFinite(factor) || factor <= 0) return;
      anchor = anchor || this._scaleAnchor || 'center';
      this.history.begin(this.doc);
      for (const id of this.sel) {
        const n = this.page.nodes[id];
        if (!n || n.locked) continue;
        const snap = this.captureScaleTree(n);
        const ow = n.w, oh = n.h, ox = n.x, oy = n.y;
        n.w = Math.max(1, ow * factor);
        n.h = Math.max(1, oh * factor);
        const ax = /left/.test(anchor) ? 0 : /right/.test(anchor) ? 1 : 0.5;
        const ay = /top/.test(anchor) ? 0 : /bottom/.test(anchor) ? 1 : 0.5;
        n.x = ox + (ow - n.w) * ax;
        n.y = oy + (oh - n.h) * ay;
        this.applyScaleTree(snap, factor);
      }
      this.history.end(this.doc);
      if (P.refreshInspector) P.refreshInspector();
      this.markDirty();
    };

    if (P && P.refreshInspector) {
      const _ri = P.refreshInspector.bind(P);
      P.refreshInspector = function () {
        _ri();
        if (App.tool !== 'scale') return;
        const el = document.getElementById('ed-right');
        if (!el) return;
        const host = el.querySelector('.ins-tab-content') || el;
        if (host.querySelector('[data-act="scale-mul"]')) return;
        const n = App.sel[0] && App.page.nodes[App.sel[0]];
        const sec = document.createElement('section');
        sec.className = 'ins-sec pf-scale-sec';
        const a = App._scaleAnchor || 'center';
        const cells = ['top-left', 'top', 'top-right', 'left', 'center', 'right', 'bottom-left', 'bottom', 'bottom-right'];
        sec.innerHTML =
          `<div class="ins-head"><span>Scale</span></div>` +
          `<div class="ins-grid g2"><label>Width</label><input type="number" data-act="scale-w" value="${n ? Math.round(n.w) : ''}"></div>` +
          `<div class="ins-grid g2"><label>Height</label><input type="number" data-act="scale-h" value="${n ? Math.round(n.h) : ''}"></div>` +
          `<div class="ins-grid g2"><label>Multiply</label>` +
            `<select data-act="scale-mul">` +
              `<option value="">Custom</option>` +
              [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4].map((v) => `<option value="${v}">${v}×</option>`).join('') +
            `</select></div>` +
          `<div class="pf-type-label">Anchor</div>` +
          `<div class="pf-anchor">${cells.map((c) =>
            `<button type="button" data-anchor="${c}" class="${a === c ? 'on' : ''}" title="${c}"></button>`
          ).join('')}</div>` +
          `<div class="ph sm">K scales font, stroke, radius, and effects. Constraints are ignored.</div>`;
        host.insertBefore(sec, host.firstChild);
        sec.querySelectorAll('[data-anchor]').forEach((b) => b.addEventListener('click', () => {
          App._scaleAnchor = b.dataset.anchor;
          sec.querySelectorAll('[data-anchor]').forEach((x) => x.classList.toggle('on', x === b));
        }));
        const mul = sec.querySelector('[data-act="scale-mul"]');
        mul.addEventListener('change', () => {
          const f = parseFloat(mul.value);
          if (f) App.scaleSel(f, App._scaleAnchor);
        });
        const sw = sec.querySelector('[data-act="scale-w"]');
        const sh = sec.querySelector('[data-act="scale-h"]');
        const applyDim = (axis, v) => {
          if (!n || !isFinite(v) || v <= 0) return;
          const f = axis === 'w' ? v / n.w : v / n.h;
          App.scaleSel(f, App._scaleAnchor);
        };
        sw.addEventListener('change', () => applyDim('w', +sw.value));
        sh.addEventListener('change', () => applyDim('h', +sh.value));
      };
    }

    // ------------------------------------------------------------------ clipboard
    function serializeTrees(trees) {
      return trees.map((t) => {
        const copy = JSON.parse(JSON.stringify(t, (k, v) => (k && k[0] === '_' ? undefined : v)));
        return copy;
      });
    }

    const _copySel = App.copySel && App.copySel.bind(App);
    App.copySel = function (cut) {
      if (_copySel) _copySel(cut);
      if (!this.clipboard || !this.clipboard.trees) return;
      this.clipboard.origin = this.sel.map((id) => {
        const n = this.page && this.page.nodes[id];
        return n ? { x: n.x, y: n.y, w: n.w, h: n.h, parent: n.parent } : null;
      });
      try {
        const payload = { __arco: 'clone-v1', trees: serializeTrees(this.clipboard.trees) };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(JSON.stringify(payload)).catch(() => {});
        }
      } catch (e) {}
    };

    function attachClone(app, src, parentId, x, y) {
      const c = M.deepClone(app.page, src, true, app.page);
      if (x != null) c.x = x;
      if (y != null) c.y = y;
      M.attach(app.doc, app.page, parentId || null, c);
      return c;
    }

    function placeInFrame(frame, src, origin) {
      let x = origin && origin.x != null ? origin.x : src.x;
      let y = origin && origin.y != null ? origin.y : src.y;
      const fw = frame.w || 0, fh = frame.h || 0;
      const w = src.w || 0, h = src.h || 0;
      if (x + w > fw || x < 0) x = Math.max(0, (fw - w) / 2);
      if (y + h > fh || y < 0) y = Math.max(0, (fh - h) / 2);
      return { x, y };
    }

    function ensureClipboard(app, cb) {
      if (app.clipboard && app.clipboard.trees && app.clipboard.trees.length) return cb();
      if (!(navigator.clipboard && navigator.clipboard.readText)) return cb();
      navigator.clipboard.readText().then((txt) => {
        try {
          const data = JSON.parse(txt);
          if (data && data.__arco === 'clone-v1' && Array.isArray(data.trees)) {
            app.clipboard = { trees: data.trees, origin: data.origin || [] };
          }
        } catch (e) {}
        cb();
      }).catch(() => cb());
    }

    function fitViewToNode(app, n) {
      if (!n || !n._w || !app.canvas) return;
      const vw = viewWorld(app);
      const b = n._w;
      const pad = inflate(vw, 0.5);
      if (!intersects(b, pad)) {
        // Far away — keep the user where they are; object was placed in view.
        return;
      }
      if (b.w > vw.w * 0.95 || b.h > vw.h * 0.95) {
        app.zoomToSelection && app.zoomToSelection();
        return;
      }
      if (b.x < vw.x || b.y < vw.y || b.x + b.w > vw.x + vw.w || b.y + b.h > vw.y + vw.h) {
        app.zoomToSelection && app.zoomToSelection();
      }
    }

    App.paste = function (mode) {
      const self = this;
      ensureClipboard(this, function () {
        if (!self.clipboard || !self.clipboard.trees || !self.clipboard.trees.length) {
          self.toast('Clipboard is empty');
          return;
        }
        const trees = self.clipboard.trees;
        const origin = self.clipboard.origin || [];
        const selected = self.sel.map((id) => self.page.nodes[id]).filter(Boolean);
        const clipIds = new Set((self.clipboard.ids || []).concat(trees.map((t) => t.id)));
        const frames = selected.filter((n) => n.type === 'frame' && !clipIds.has(n.id));

        self.history.begin(self.doc);
        const newSel = [];

        if (mode === 'replace' && selected.length) {
          for (const target of selected) {
            const src = trees[0];
            const c = attachClone(self, src, target.parent, target.x, target.y);
            if (target.constraints) c.constraints = Object.assign({}, target.constraints);
            c.w = target.w; c.h = target.h;
            M.detach(self.page, target);
            newSel.push(c.id);
          }
        } else if (mode === 'over' && selected.length) {
          const t = selected[0];
          for (const src of trees) {
            const c = attachClone(self, src, t.parent, t.x, t.y);
            newSel.push(c.id);
          }
        } else if (mode === 'here' && self._pasteHere) {
          const at = self._pasteHere;
          const host = nodeAtPoint(self.page, at);
          const parent = (host && host.type === 'frame' && !host.al) ? host.id : null;
          for (const src of trees) {
            const x = parent ? at.x - (host.x || 0) : at.x;
            const y = parent ? at.y - (host.y || 0) : at.y;
            const c = attachClone(self, src, parent, x, y);
            newSel.push(c.id);
          }
          self._pasteHere = null;
        } else if (frames.length) {
          const vw = viewWorld(self);
          const wide = inflate(vw, 0.5);
          for (let i = 0; i < frames.length; i++) {
            const frame = frames[i];
            const src = trees[i % trees.length];
            const orig = origin[i % trees.length] || { x: src.x, y: src.y };
            const far = frame._w && !intersects(frame._w, wide);
            let pos;
            if (far) {
              pos = { x: (frame.w - (src.w || 0)) / 2, y: (frame.h - (src.h || 0)) / 2 };
            } else {
              pos = placeInFrame(frame, src, orig);
            }
            const c = attachClone(self, src, frame.id, pos.x, pos.y);
            newSel.push(c.id);
          }
        } else {
          const vw = viewWorld(self);
          for (let i = 0; i < trees.length; i++) {
            const src = trees[i];
            const orig = origin[i] || { x: src.x, y: src.y };
            const x = mode === true || mode === 'inplace' ? orig.x : orig.x + 20;
            const y = mode === true || mode === 'inplace' ? orig.y : orig.y + 20;
            const c = attachClone(self, src, null, x, y);
            newSel.push(c.id);
          }
        }

        self.history.end(self.doc);
        self.setSel(newSel);
        if (newSel[0]) fitViewToNode(self, self.page.nodes[newSel[0]]);
        if (P.refreshInspector) P.refreshInspector();
        if (P.refreshLayers) P.refreshLayers();
        self.markDirty();
      });
    };

    function duplicateInPlace(app, dx, dy) {
      if (!app.sel.length) return [];
      app.history.begin(app.doc);
      const clones = [];
      for (const id of app.sel.slice()) {
        const n = app.page.nodes[id];
        if (!n) continue;
        const map = new Map();
        const c = M.deepClone(app.page, n, true, map);
        c._cloneMap = map;
        const live = M.deepClone(app.page, c, true, app.page);
        live.x = n.x + dx;
        live.y = n.y + dy;
        M.attach(app.doc, app.page, n.parent, live);
        clones.push(live);
      }
      app.history.end(app.doc);
      return clones;
    }

    App.duplicateSel = function () {
      if (!this.sel.length) return;
      const nodes = this.sel.map((id) => this.page.nodes[id]).filter(Boolean);
      const allTopFrames = nodes.every((n) => !n.parent && n.type === 'frame');
      let dx = 20, dy = 20;
      if (allTopFrames) {
        dx = Math.max(...nodes.map((n) => n.w)) + 32;
        dy = 0;
      } else if (this._dupRepeat) {
        dx = this._dupRepeat.dx;
        dy = this._dupRepeat.dy;
      } else {
        dx = 0; dy = 0;
      }
      const clones = duplicateInPlace(this, dx, dy);
      if (clones.length) {
        this.setSel(clones.map((n) => n.id));
        this._dupRepeat = { dx, dy };
      }
      if (P.refreshInspector) P.refreshInspector();
      if (P.refreshLayers) P.refreshLayers();
      this.markDirty();
    };

    App.copyAsPng = function () {
      if (!this.sel.length) { this.toast('Select something to copy'); return; }
      this.layoutDoc && this.layoutDoc(this.doc, this.page);
      const b = R && R.selectionBounds ? R.selectionBounds(this.page, this.sel) : null;
      if (!b) return;
      const c = R.renderRegion(this.page, this.doc, b, 2, { background: false });
      c.toBlob((blob) => {
        if (!blob) return;
        if (navigator.clipboard && window.ClipboardItem) {
          navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).then(
            () => this.toast('Copied PNG @2×'),
            () => downloadBlob(blob, (this.doc.name || 'arco') + '.png')
          );
        } else downloadBlob(blob, (this.doc.name || 'arco') + '.png');
      }, 'image/png');
    };

    function downloadBlob(blob, name) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    }

    // ------------------------------------------------------------------ context menu extras
    if (P && P.contextMenu) {
      const _cm = P.contextMenu.bind(P);
      P.contextMenu = function (x, y, ids) {
        if (!ids || !ids.length) {
          canvasMenu(x, y);
          return;
        }
        _cm(x, y, ids);
        const menu = document.querySelector('.pf-menu');
        if (!menu) return;
        const extra = document.createElement('div');
        extra.innerHTML =
          `<hr>` +
          `<button data-pf="replace">Paste to replace <span class="kbd">⇧⌘R</span></button>` +
          `<button data-pf="over">Paste over selection <span class="kbd">⇧⌘V</span></button>` +
          `<button data-pf="png">Copy as PNG <span class="kbd">⇧⌘C</span></button>` +
          `<button data-pf="css">Copy as CSS</button>` +
          `<button data-pf="matching">Select matching layers <span class="kbd">⌥⌘A</span></button>` +
          `<div class="pf-sub">` +
            `<button data-pf="sellayer">Select layer ▸</button>` +
            `<div class="pf-sub-menu" hidden></div>` +
          `</div>` +
          (ids.length === 1 && App.page.nodes[ids[0]] && App.page.nodes[ids[0]].type === 'vector'
            ? `<button data-pf="onpath">Type on path</button>` : '');
        menu.appendChild(extra);
        extra.querySelector('[data-pf="replace"]').onclick = () => { menu.remove(); App.paste('replace'); };
        extra.querySelector('[data-pf="over"]').onclick = () => { menu.remove(); App.paste('over'); };
        extra.querySelector('[data-pf="png"]').onclick = () => { menu.remove(); App.copyAsPng(); };
        extra.querySelector('[data-pf="css"]').onclick = () => {
          menu.remove();
          const n = App.page.nodes[ids[0]];
          if (!n || !global.Eco || !global.Eco.CodeGen) return;
          const css = global.Eco.CodeGen.css(App.doc, App.page, n);
          (navigator.clipboard ? navigator.clipboard.writeText(css) : Promise.reject())
            .then(() => App.toast('CSS copied')).catch(() => App.toast('Copy failed'));
        };
        extra.querySelector('[data-pf="matching"]').onclick = () => { menu.remove(); App.selectMatching(); };
        const onpath = extra.querySelector('[data-pf="onpath"]');
        if (onpath) onpath.onclick = () => { menu.remove(); typeOnPath(App.page.nodes[ids[0]]); };
        const sl = extra.querySelector('[data-pf="sellayer"]');
        const sub = extra.querySelector('.pf-sub-menu');
        sl.addEventListener('mouseenter', () => {
          const p = App.toWorld({ clientX: x, clientY: y });
          App._forceDeepHit = true;
          const deep = App.hitTestDeep(p);
          App._forceDeepHit = false;
          const chain = deep ? ancestorsOf(deep).slice() : [];
          sub.hidden = false;
          sub.innerHTML = chain.map((n) =>
            `<button data-id="${n.id}">${n.locked ? '🔒 ' : ''}${esc(n.name || n.type)}</button>`
          ).join('') || '<div class="ph" style="padding:6px">No layers here</div>';
          sub.querySelectorAll('[data-id]').forEach((b) => b.addEventListener('click', () => {
            menu.remove();
            App.setSel([b.dataset.id]);
          }));
        });
      };
    }

    function canvasMenu(x, y) {
      document.querySelectorAll('.pf-menu').forEach((m) => m.remove());
      const el = document.createElement('div');
      el.className = 'pf-menu';
      el.style.left = Math.min(x, innerWidth - 220) + 'px';
      el.style.top = Math.min(y, innerHeight - 160) + 'px';
      el.innerHTML =
        `<button data-c="paste">Paste</button>` +
        `<button data-c="here">Paste here</button>` +
        `<button data-c="selall">Select all</button>`;
      document.body.appendChild(el);
      const close = () => el.remove();
      el.querySelector('[data-c="paste"]').onclick = () => { close(); App.paste(); };
      el.querySelector('[data-c="here"]').onclick = () => {
        close();
        App._pasteHere = App.toWorld({ clientX: x, clientY: y });
        App.paste('here');
      };
      el.querySelector('[data-c="selall"]').onclick = () => { close(); App.selectAll(); };
      setTimeout(() => document.addEventListener('pointerdown', function bye(e) {
        if (!el.contains(e.target)) { close(); document.removeEventListener('pointerdown', bye, true); }
      }, true), 0);
    }

    // Shift+V was "paste in place"; Figma uses it as paste-over-selection.
    const _pasteShortcut = (global.Shortcuts && global.Shortcuts.table || []).find((b) => b.keys === 'shift+mod+v');
    if (_pasteShortcut) {
      _pasteShortcut.label = 'Paste over selection';
      _pasteShortcut.run = (a) => a.paste('over');
    }

    // ------------------------------------------------------------------ text on a path
    function samplePath(d, n) {
      const pts = [];
      if (!d) return pts;
      const cmds = String(d).match(/[MLHVCSQTAZmlhvcsqtaz][^MLHVCSQTAZmlhvcsqtaz]*/g) || [];
      let x = 0, y = 0, sx = 0, sy = 0;
      const push = (px, py) => pts.push({ x: px, y: py });
      for (const raw of cmds) {
        const t = raw[0];
        const nums = (raw.slice(1).match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) || []).map(Number);
        const rel = t === t.toLowerCase();
        const c = t.toUpperCase();
        if (c === 'M') {
          for (let i = 0; i + 1 < nums.length; i += 2) {
            x = rel ? x + nums[i] : nums[i];
            y = rel ? y + nums[i + 1] : nums[i + 1];
            if (i === 0) { sx = x; sy = y; }
            push(x, y);
          }
        } else if (c === 'L') {
          for (let i = 0; i + 1 < nums.length; i += 2) {
            x = rel ? x + nums[i] : nums[i];
            y = rel ? y + nums[i + 1] : nums[i + 1];
            push(x, y);
          }
        } else if (c === 'H') {
          for (const v of nums) { x = rel ? x + v : v; push(x, y); }
        } else if (c === 'V') {
          for (const v of nums) { y = rel ? y + v : v; push(x, y); }
        } else if (c === 'C') {
          for (let i = 0; i + 5 < nums.length; i += 6) {
            const x1 = rel ? x + nums[i] : nums[i];
            const y1 = rel ? y + nums[i + 1] : nums[i + 1];
            const x2 = rel ? x + nums[i + 2] : nums[i + 2];
            const y2 = rel ? y + nums[i + 3] : nums[i + 3];
            const x3 = rel ? x + nums[i + 4] : nums[i + 4];
            const y3 = rel ? y + nums[i + 5] : nums[i + 5];
            for (let s = 1; s <= 8; s++) {
              const u = s / 8, iu = 1 - u;
              push(
                iu*iu*iu*x + 3*iu*iu*u*x1 + 3*iu*u*u*x2 + u*u*u*x3,
                iu*iu*iu*y + 3*iu*iu*u*y1 + 3*iu*u*u*y2 + u*u*u*y3
              );
            }
            x = x3; y = y3;
          }
        } else if (c === 'Q') {
          for (let i = 0; i + 3 < nums.length; i += 4) {
            const x1 = rel ? x + nums[i] : nums[i];
            const y1 = rel ? y + nums[i + 1] : nums[i + 1];
            const x2 = rel ? x + nums[i + 2] : nums[i + 2];
            const y2 = rel ? y + nums[i + 3] : nums[i + 3];
            for (let s = 1; s <= 6; s++) {
              const u = s / 6, iu = 1 - u;
              push(iu*iu*x + 2*iu*u*x1 + u*u*x2, iu*iu*y + 2*iu*u*y1 + u*u*y2);
            }
            x = x2; y = y2;
          }
        } else if (c === 'Z') {
          push(sx, sy);
          x = sx; y = sy;
        }
      }
      return pts;
    }

    function typeOnPath(vec) {
      if (!vec || !vec.path) return;
      App.history.begin(App.doc);
      const t = M.makeNode('text', { x: vec.x, y: vec.y, w: vec.w, h: vec.h });
      t.text.content = 'Text on a path';
      t.text.resize = 'fixed';
      t.text.pathId = vec.id;
      t.text.pathOffset = 0;
      t.text.pathFlip = false;
      if (vec.fills && vec.fills[0]) t.fills = JSON.parse(JSON.stringify(vec.fills));
      M.attach(App.doc, App.page, vec.parent, t);
      App.history.end(App.doc);
      App.setSel([t.id]);
      requestAnimationFrame(() => setTimeout(() => App.beginTextEdit(t, { select: 'all' }), 16));
      App.toast('Text on path — Type settings → Flip orientation');
    }

    if (TE && TE.draw) {
      const _draw = TE.draw.bind(TE);
      TE.draw = function (ctx, n, doc, w, h) {
        const t = n.text || {};
        if (!t.pathId) return _draw(ctx, n, doc, w, h);
        const vec = App.page && App.page.nodes[t.pathId];
        if (!vec || !vec.path) return _draw(ctx, n, doc, w, h);
        const pts = samplePath(vec.path, n);
        if (pts.length < 2) return _draw(ctx, n, doc, w, h);
        const content = String(t.content || '');
        ctx.save();
        ctx.font = TE.fontSpec(n);
        try { ctx.letterSpacing = (t.letterSpacing || 0) + 'px'; } catch (e) {}
        const fill = n.fills && n.fills[0];
        ctx.fillStyle = (fill && fill.color) || '#111';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        const segs = [];
        let total = 0;
        for (let i = 1; i < pts.length; i++) {
          const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y;
          const len = Math.hypot(dx, dy);
          segs.push({ x0: pts[i - 1].x, y0: pts[i - 1].y, dx, dy, len });
          total += len;
        }
        let dist = (t.pathOffset || 0) * total;
        const flip = !!t.pathFlip;
        for (let i = 0; i < content.length; i++) {
          const ch = content[i];
          const cw = ctx.measureText(ch).width || (t.size || 16) * 0.5;
          dist += cw / 2;
          let acc = 0, seg = segs[0];
          for (const s of segs) {
            if (acc + s.len >= dist) { seg = s; break; }
            acc += s.len;
          }
          const u = seg.len ? (dist - acc) / seg.len : 0;
          const x = seg.x0 + seg.dx * u;
          const y = seg.y0 + seg.dy * u;
          const ang = Math.atan2(seg.dy, seg.dx) + (flip ? Math.PI : 0);
          ctx.save();
          ctx.translate(x + (vec.x - n.x), y + (vec.y - n.y));
          ctx.rotate(ang);
          ctx.fillText(ch, 0, 0);
          ctx.restore();
          dist += cw / 2;
        }
        ctx.restore();
      };
    }

    if (P && P.refreshInspector) {
      const _ri2 = P.refreshInspector.bind(P);
      P.refreshInspector = function () {
        _ri2();
        const n = App.sel.length === 1 && App.page.nodes[App.sel[0]];
        if (!n || !n.text || !n.text.pathId) return;
        const el = document.getElementById('ed-right');
        const host = el && (el.querySelector('.ins-tab-content') || el);
        if (!host || host.querySelector('[data-act="path-flip"]')) return;
        const sec = document.createElement('section');
        sec.className = 'ins-sec';
        sec.innerHTML =
          `<div class="ins-head"><span>Text on path</span></div>` +
          `<div class="ins-row"><label class="chk"><input type="checkbox" data-act="path-flip" ${n.text.pathFlip ? 'checked' : ''}> Flip orientation</label></div>` +
          `<div class="ins-grid g2"><label>Offset</label><input type="number" min="0" max="1" step="0.01" value="${n.text.pathOffset || 0}" data-act="path-off"></div>`;
        host.appendChild(sec);
        sec.querySelector('[data-act="path-flip"]').addEventListener('change', (ev) => {
          App.history.begin(App.doc);
          n.text.pathFlip = ev.target.checked;
          App.history.end(App.doc);
          App.markDirty();
        });
        sec.querySelector('[data-act="path-off"]').addEventListener('input', (ev) => {
          App.history.begin(App.doc);
          n.text.pathOffset = Math.max(0, Math.min(1, +ev.target.value || 0));
          App.history.end(App.doc);
          App.markDirty();
        });
      };
    }
  });
})(window);
