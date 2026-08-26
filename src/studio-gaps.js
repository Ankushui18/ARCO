/* studio-gaps.js — remaining Figma-parity closeouts.
 * Loads last. Wraps App/Panels/Renderer without rewriting the 3k-line cores.
 */
(function (global) {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'complete') return fn();
    window.addEventListener('load', fn, { once: true });
  }

  function persistBlocked() {
    try {
      if (typeof window !== 'undefined' && window.origin === 'null') return true;
      const k = '__pf_probe__';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return false;
    } catch (e) {
      return true;
    }
  }

  ready(function () {
    const App = global.App;
    const M = global.Model;
    const R = global.Renderer;
    const P = global.Panels;
    const Ico = global.Icons && global.Icons.svg;
    if (!App || !M) return;

    const ephemeral = persistBlocked() || (M.store && M.store.ephemeral);

    // =====================================================================
    // 1. Preview / sandbox persist banner (no scary toast spam)
    // =====================================================================
    function showPersistBanner() {
      if (document.getElementById('pf-persist-banner')) return;
      const b = document.createElement('div');
      b.id = 'pf-persist-banner';
      b.innerHTML =
        '<span>This preview cannot keep files after you leave. Export a <b>.fig</b> backup to be safe.</span>' +
        '<button type="button" data-export>Export .fig</button>' +
        '<button type="button" data-x aria-label="Dismiss">×</button>';
      document.body.appendChild(b);
      b.querySelector('[data-export]').onclick = () => {
        try { App.exportBackupFig && App.exportBackupFig(); } catch (e) {}
      };
      b.querySelector('[data-x]').onclick = () => b.remove();
    }
    if (ephemeral) {
      if (M.store) {
        M.store.ephemeral = true;
        M.store._warned = true;
        M.store.backend = M.store.backend || 'memory';
      }
      setTimeout(showPersistBanner, 400);
    }

    // =====================================================================
    // 2. Slim crash journal — never dump the whole document into localStorage
    // =====================================================================
    if (App._startRecoveryJournal) {
      try { App._stopRecoveryJournal && App._stopRecoveryJournal(); } catch (e) {}
    }
    (function slimJournal() {
      const KEY = 'penfig.crash.meta.v2';
      let timer = 0;
      function tick() {
        if (!App.doc) return;
        try {
          let nodes = 0;
          for (const p of App.doc.pages || []) nodes += Object.keys(p.nodes || {}).length;
          localStorage.setItem(KEY, JSON.stringify({
            at: Date.now(),
            id: App.doc.id,
            name: App.doc.name,
            pageIndex: App.pageIndex,
            nodes,
          }));
        } catch (e) { /* ignore */ }
      }
      const _show = App.showEditor && App.showEditor.bind(App);
      if (_show) {
        App.showEditor = function () {
          _show();
          clearInterval(timer);
          timer = setInterval(tick, 30000);
        };
      }
    })();

    // =====================================================================
    // 3. Figma-style grouped toolbar with visible carets
    // =====================================================================
    const GROUPS = {
      move: [
        { tool: 'move', icon: 'move', label: 'Move', key: 'V' },
        { tool: 'scale', icon: 'scale', label: 'Scale', key: 'K' },
      ],
      frame: [
        { tool: 'frame', icon: 'frame', label: 'Frame', key: 'F' },
        { tool: 'section', icon: 'section', label: 'Section', key: 'S' },
      ],
      shape: [
        { tool: 'rect', icon: 'rect', label: 'Rectangle', key: 'R' },
        { tool: 'ellipse', icon: 'ellipse', label: 'Ellipse', key: 'O' },
        { tool: 'line', icon: 'line', label: 'Line', key: 'L' },
        { tool: 'arrow', icon: 'arrow', label: 'Arrow', key: '⇧L' },
        { tool: 'polygon', icon: 'polygon', label: 'Polygon' },
        { tool: 'star', icon: 'star', label: 'Star' },
        { tool: 'triangle', icon: 'triangle', label: 'Triangle' },
      ],
      pen: [
        { tool: 'pen', icon: 'pen', label: 'Pen', key: 'P' },
        { tool: 'pencil', icon: 'pencil', label: 'Pencil', key: 'N' },
      ],
    };
    const TOOL_GROUP = {};
    for (const [g, items] of Object.entries(GROUPS)) {
      for (const it of items) TOOL_GROUP[it.tool] = g;
    }
    App._lastGroupTool = App._lastGroupTool || { move: 'move', frame: 'frame', shape: 'rect', pen: 'pen' };

    function closeFlyouts() {
      document.querySelectorAll('.pf-flyout').forEach((n) => n.remove());
    }

    function openGroupFlyout(groupKey, anchor) {
      closeFlyouts();
      const items = GROUPS[groupKey];
      if (!items || !anchor) return;
      const r = anchor.getBoundingClientRect();
      const fly = document.createElement('div');
      fly.className = 'pf-flyout';
      fly.style.left = (r.right + 8) + 'px';
      fly.style.top = r.top + 'px';
      fly.innerHTML = items.map((it) =>
        `<button type="button" data-tool="${it.tool}">${Ico ? Ico(it.icon, { size: 15 }) : ''}<span>${it.label}</span>${it.key ? `<kbd>${it.key}</kbd>` : ''}</button>`
      ).join('');
      document.body.appendChild(fly);
      fly.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        App.setTool(b.dataset.tool);
        closeFlyouts();
      }));
    }

    function rebuildToolbar() {
      const tb = document.getElementById('ed-toolbar');
      if (!tb || tb._grouped) return;
      tb._grouped = true;
      const last = App._lastGroupTool;
      const btn = (tool, icon, label, key) =>
        (global.Icons && global.Icons.toolBtn)
          ? global.Icons.toolBtn(tool, icon, label, key)
          : `<button class="tool" data-tool="${tool}" title="${label}">${Ico ? Ico(icon, { size: 18 }) : ''}</button>`;
      const group = (key, tool, icon, label, k) =>
        `<div class="tool-group" data-group="${key}">` +
          btn(tool, icon, label, k) +
          `<button type="button" class="tool-caret" data-group="${key}" title="More ${label} tools" aria-label="More ${label} tools"></button>` +
        `</div>`;
      const shape = GROUPS.shape.find((x) => x.tool === last.shape) || GROUPS.shape[0];
      const move = GROUPS.move.find((x) => x.tool === last.move) || GROUPS.move[0];
      const frame = GROUPS.frame.find((x) => x.tool === last.frame) || GROUPS.frame[0];
      const pen = GROUPS.pen.find((x) => x.tool === last.pen) || GROUPS.pen[0];
      tb.innerHTML =
        group('move', move.tool, move.icon, move.label, move.key) +
        group('frame', frame.tool, frame.icon, frame.label, frame.key) +
        group('shape', shape.tool, shape.icon, shape.label, shape.key) +
        group('pen', pen.tool, pen.icon, pen.label, pen.key) +
        '<div class="tb-sep"></div>' +
        btn('text', 'text', 'Text', 'T') +
        btn('image', 'image', 'Place image', '') +
        btn('hand', 'hand', 'Hand', 'H') +
        btn('comment', 'comment', 'Comment', 'C');

      tb.querySelectorAll('.tool').forEach((b) => b.addEventListener('click', (e) => {
        if (b.dataset.tool === 'image') {
          e.preventDefault();
          const inp = document.createElement('input');
          inp.type = 'file'; inp.accept = 'image/*';
          inp.addEventListener('change', () => {
            const f = inp.files && inp.files[0];
            if (!f || !App.placeImageFile) return;
            const cr = App.canvas.getBoundingClientRect();
            App.placeImageFile(f, App.toWorld({ clientX: cr.left + cr.width / 2, clientY: cr.top + cr.height / 2 }));
          });
          inp.click();
          App.setTool('move');
          return;
        }
        App.setTool(b.dataset.tool);
      }));
      tb.querySelectorAll('.tool-caret').forEach((c) => c.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        openGroupFlyout(c.dataset.group, c.closest('.tool-group') || c);
      }));
      tb.querySelectorAll('.tool-group .tool').forEach((b) => {
        b.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          openGroupFlyout(b.closest('.tool-group').dataset.group, b.closest('.tool-group'));
        });
      });
      syncToolbarActive();
    }

    function syncToolbarActive() {
      const tb = document.getElementById('ed-toolbar');
      if (!tb) return;
      const t = App.tool;
      const g = TOOL_GROUP[t];
      if (g) App._lastGroupTool[g] = t;
      tb.querySelectorAll('.tool').forEach((b) => {
        const bt = b.dataset.tool;
        const bg = TOOL_GROUP[bt];
        const on = bt === t || (bg && bg === g && App._lastGroupTool[bg] === bt);
        b.classList.toggle('active', on);
      });
      tb.querySelectorAll('.tool-group').forEach((el) => {
        el.classList.toggle('active', el.dataset.group === g);
        const lastTool = App._lastGroupTool[el.dataset.group];
        const spec = (GROUPS[el.dataset.group] || []).find((x) => x.tool === lastTool);
        const main = el.querySelector('.tool');
        if (spec && main && main.dataset.tool !== spec.tool) {
          main.dataset.tool = spec.tool;
          main.title = spec.label + (spec.key ? ' (' + spec.key + ')' : '');
          main.innerHTML = (Ico ? Ico(spec.icon, { size: 18 }) : '') +
            (spec.key ? `<span class="tool-key">${spec.key.charAt(0)}</span>` : '');
        }
      });
    }

    const _setTool = App.setTool && App.setTool.bind(App);
    App.setTool = function (t) {
      if (TOOL_GROUP[t]) this._lastGroupTool[TOOL_GROUP[t]] = t;
      if (_setTool) _setTool(t);
      syncToolbarActive();
    };

    const _build = App.buildChrome && App.buildChrome.bind(App);
    if (_build) {
      App.buildChrome = function () {
        _build();
        rebuildToolbar();
      };
    }
    rebuildToolbar();
    document.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('.pf-flyout') && !e.target.closest('.tool-caret') && !e.target.closest('.tool-group')) {
        closeFlyouts();
      }
    }, true);

    // =====================================================================
    // 4. Area text: click = point text, drag = fixed-width area text
    // =====================================================================
    const _onDown = App.onDown && App.onDown.bind(App);
    const _onMove = App.onMove && App.onMove.bind(App);
    const _onUp = App.onUp && App.onUp.bind(App);

    App.onDown = function (e) {
      if (this._crop) {
        if (e.button !== 0) return;
        const h = cropHandleAt(e);
        if (h) {
          this._crop.drag = { name: h, start: Object.assign({}, this._crop.rect), sx: e.clientX, sy: e.clientY };
          e.preventDefault();
          return;
        }
        commitCrop(true);
        return;
      }
      if (this.tool === 'text' && e.button === 0 && !this.space) {
        e.preventDefault();
        const p = this.toWorld(e);
        this._drag = { kind: 'pending-text', sx: p.x, sy: p.y };
        return;
      }
      const rh = radiusHandleAt(e);
      if (rh && this.tool === 'move') {
        this.history.begin(this.doc);
        this._drag = { kind: 'radius', node: rh.node, start: rh.node.radius.slice() };
        e.preventDefault();
        return;
      }
      if (_onDown) return _onDown(e);
    };

    App.onMove = function (e) {
      if (this._crop && this._crop.drag) {
        moveCrop(e);
        this.markDirty();
        return;
      }
      if (this._drag && this._drag.kind === 'pending-text') {
        const p = this.toWorld(e);
        const dx = p.x - this._drag.sx, dy = p.y - this._drag.sy;
        if (Math.hypot(dx, dy) > 4 / this.view.zoom) {
          this.history.begin(this.doc);
          const n = M.makeNode('text', {
            x: Math.min(this._drag.sx, p.x),
            y: Math.min(this._drag.sy, p.y),
            w: Math.max(8, Math.abs(dx)),
            h: Math.max(8, Math.abs(dy)),
          });
          n.text.resize = 'fixed';
          n.text.content = '';
          n.fills = [{ type: 'solid', color: '#111111', opacity: 1, token: null }];
          M.attach(this.doc, this.page, null, n);
          this.history.end(this.doc);
          this.setSel([n.id]);
          this._drag = { kind: 'create-text', node: n, sx: this._drag.sx, sy: this._drag.sy };
        }
        return;
      }
      if (this._drag && this._drag.kind === 'create-text') {
        const p = this.toWorld(e);
        const n = this._drag.node;
        n.x = Math.min(this._drag.sx, p.x);
        n.y = Math.min(this._drag.sy, p.y);
        n.w = Math.max(8, Math.abs(p.x - this._drag.sx));
        n.h = Math.max(16, Math.abs(p.y - this._drag.sy));
        this.markDirty();
        return;
      }
      if (this._drag && this._drag.kind === 'radius') {
        const n = this._drag.node;
        const p = this.toWorld(e);
        const v = Math.max(0, Math.min(Math.min(n.w, n.h) / 2, p.x - n.x, p.y - n.y));
        n.radius = [v, v, v, v];
        this.status('Radius ' + Math.round(v));
        this.markDirty();
        return;
      }
      if (_onMove) return _onMove(e);
    };

    App.onUp = function (e) {
      if (this._crop && this._crop.drag) {
        this._crop.drag = null;
        return;
      }
      if (this._drag && this._drag.kind === 'pending-text') {
        const p = this._drag;
        this._drag = null;
        this.history.begin(this.doc);
        const t = M.makeNode('text', { x: p.sx, y: p.sy - 4, w: 120, h: 22 });
        t.fills = [{ type: 'solid', color: '#111111', opacity: 1, token: null }];
        M.attach(this.doc, this.page, null, t);
        this.applyTextResize(t);
        this.history.end(this.doc);
        this.setSel([t.id]);
        this.setTool('move');
        requestAnimationFrame(() => setTimeout(() => this.beginTextEdit(t, { select: 'all' }), 16));
        return;
      }
      if (this._drag && this._drag.kind === 'create-text') {
        const n = this._drag.node;
        this._drag = null;
        this.setTool('move');
        requestAnimationFrame(() => setTimeout(() => this.beginTextEdit(n, { select: 'all' }), 16));
        this.markDirty();
        return;
      }
      if (this._drag && this._drag.kind === 'radius') {
        this.history.end(this.doc);
        this._drag = null;
        if (P && P.refreshInspector) P.refreshInspector();
        this.markDirty();
        return;
      }
      if (_onUp) return _onUp(e);
    };

    // =====================================================================
    // 5. On-canvas image crop (double-click an image)
    // =====================================================================
    function imageFillOf(n) {
      return n && n.fills && n.fills.find((f) => f && f.type === 'image' && f.visible !== false);
    }

    function beginCrop(n) {
      const fill = imageFillOf(n);
      if (!fill) return false;
      const cur = fill.crop && fill.crop.w > 0
        ? { x: fill.crop.x, y: fill.crop.y, w: fill.crop.w, h: fill.crop.h }
        : { x: 0, y: 0, w: 1, h: 1 };
      App._crop = { n, fill, rect: cur, orig: Object.assign({}, cur) };
      App.status('Crop image — drag handles · Enter to apply · Esc to cancel');
      App.markDirty();
      return true;
    }

    function commitCrop(ok) {
      const c = App._crop;
      if (!c) return;
      if (ok) {
        App.history.begin(App.doc);
        c.fill.crop = {
          x: Math.max(0, Math.min(1, c.rect.x)),
          y: Math.max(0, Math.min(1, c.rect.y)),
          w: Math.max(0.02, Math.min(1, c.rect.w)),
          h: Math.max(0.02, Math.min(1, c.rect.h)),
        };
        c.fill.scaleMode = c.fill.scaleMode || 'fill';
        App.history.end(App.doc);
      }
      App._crop = null;
      App.status('');
      App.markDirty();
    }

    function cropScreenBox() {
      const c = App._crop;
      if (!c || !c.n || !c.n._w) return null;
      const b = c.n._w, z = App.view.zoom;
      return {
        x: b.x * z + App.view.ox + c.rect.x * b.w * z,
        y: b.y * z + App.view.oy + c.rect.y * b.h * z,
        w: c.rect.w * b.w * z,
        h: c.rect.h * b.h * z,
      };
    }

    function cropHandleAt(e) {
      const box = cropScreenBox();
      if (!box) return null;
      const rect = App.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const pts = [
        ['nw', box.x, box.y], ['n', box.x + box.w / 2, box.y], ['ne', box.x + box.w, box.y],
        ['e', box.x + box.w, box.y + box.h / 2],
        ['se', box.x + box.w, box.y + box.h], ['s', box.x + box.w / 2, box.y + box.h],
        ['sw', box.x, box.y + box.h], ['w', box.x, box.y + box.h / 2],
      ];
      for (const [name, x, y] of pts) {
        if (Math.abs(mx - x) <= 8 && Math.abs(my - y) <= 8) return name;
      }
      return null;
    }

    function moveCrop(e) {
      const c = App._crop;
      const d = c && c.drag;
      if (!d || !c.n || !c.n._w) return;
      const z = App.view.zoom;
      const bw = c.n._w.w, bh = c.n._w.h;
      const dx = (e.clientX - d.sx) / (z * bw);
      const dy = (e.clientY - d.sy) / (z * bh);
      let { x, y, w, h } = d.start;
      const name = d.name;
      if (name.includes('e')) w = Math.max(0.05, w + dx);
      if (name.includes('s')) h = Math.max(0.05, h + dy);
      if (name.includes('w')) { const nx = Math.max(0, x + dx); w = Math.max(0.05, w - (nx - x)); x = nx; }
      if (name.includes('n')) { const ny = Math.max(0, y + dy); h = Math.max(0.05, h - (ny - y)); y = ny; }
      if (x + w > 1) w = 1 - x;
      if (y + h > 1) h = 1 - y;
      c.rect = { x, y, w, h };
    }

    function drawCropOverlay(ctx) {
      const box = cropScreenBox();
      if (!box || !App.canvas) return;
      const rect = App.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, rect.width, box.y);
      ctx.fillRect(0, box.y, box.x, box.h);
      ctx.fillRect(box.x + box.w, box.y, rect.width - box.x - box.w, box.h);
      ctx.fillRect(0, box.y + box.h, rect.width, rect.height - box.y - box.h);
      ctx.strokeStyle = '#0d99ff';
      ctx.lineWidth = 1;
      ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w - 1, box.h - 1);
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(box.x + box.w / 3, box.y); ctx.lineTo(box.x + box.w / 3, box.y + box.h);
      ctx.moveTo(box.x + 2 * box.w / 3, box.y); ctx.lineTo(box.x + 2 * box.w / 3, box.y + box.h);
      ctx.moveTo(box.x, box.y + box.h / 3); ctx.lineTo(box.x + box.w, box.y + box.h / 3);
      ctx.moveTo(box.x, box.y + 2 * box.h / 3); ctx.lineTo(box.x + box.w, box.y + 2 * box.h / 3);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = '#fff';
      const pts = [
        [box.x, box.y], [box.x + box.w / 2, box.y], [box.x + box.w, box.y],
        [box.x + box.w, box.y + box.h / 2],
        [box.x + box.w, box.y + box.h], [box.x + box.w / 2, box.y + box.h],
        [box.x, box.y + box.h], [box.x, box.y + box.h / 2],
      ];
      for (const [x, y] of pts) {
        ctx.fillRect(x - 3.5, y - 3.5, 7, 7);
        ctx.strokeRect(x - 3.5, y - 3.5, 7, 7);
      }
      ctx.restore();
    }

    const _onDbl = App.onDbl && App.onDbl.bind(App);
    App.onDbl = function (e) {
      if (this.tool === 'pen' && this.pen) { this.penCommit(true); return; }
      const p = this.toWorld(e);
      const hit = this.hitTest(p);
      this._drag = null;
      if (hit && imageFillOf(hit)) {
        this.setSel([hit.id]);
        beginCrop(hit);
        return;
      }
      if (_onDbl) return _onDbl(e);
    };

    // =====================================================================
    // 6. On-canvas corner radius handle
    // =====================================================================
    function radiusHandleAt(e) {
      if (App.sel.length !== 1 || !App.page) return null;
      const n = App.page.nodes[App.sel[0]];
      if (!n || (n.type !== 'rect' && n.type !== 'frame' && n.type !== 'instance')) return null;
      if (!n._w) return null;
      const z = App.view.zoom;
      const r = Math.max(0, n.radius ? n.radius[0] : 0);
      const hx = n._w.x * z + App.view.ox + Math.min(24, 8 + r * z);
      const hy = n._w.y * z + App.view.oy + Math.min(24, 8 + r * z);
      const rect = App.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      if (Math.hypot(mx - hx, my - hy) <= 8) return { node: n, x: hx, y: hy };
      return null;
    }

    function drawRadiusHandle(ctx) {
      if (App._crop || App._textEdit || App.sel.length !== 1) return;
      const n = App.page && App.page.nodes[App.sel[0]];
      if (!n || !n._w || (n.type !== 'rect' && n.type !== 'frame' && n.type !== 'instance')) return;
      const z = App.view.zoom;
      const r = Math.max(0, n.radius ? n.radius[0] : 0);
      const hx = n._w.x * z + App.view.ox + Math.min(24, 8 + r * z);
      const hy = n._w.y * z + App.view.oy + Math.min(24, 8 + r * z);
      const dpr = window.devicePixelRatio || 1;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.beginPath();
      ctx.arc(hx, hy, 4.5, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.strokeStyle = '#0d99ff';
      ctx.lineWidth = 1.4;
      ctx.stroke();
      ctx.restore();
    }

    // =====================================================================
    // 7. Comment threads (reply on existing pin)
    // =====================================================================
    if (global.Eco && global.Eco.Comments) {
      const C = global.Eco.Comments;
      if (!C.reply) {
        C.reply = function (doc, id, text, author) {
          M.ensureDocShape(doc);
          const c = doc.comments.find((x) => x.id === id);
          if (!c) return null;
          c.replies = c.replies || [];
          const r = { id: M.uid('cr-'), text, author: author || 'You', at: Date.now() };
          c.replies.push(r);
          return r;
        };
      }
    }

    const _renderPins = App.renderPins && App.renderPins.bind(App);
    App.renderPins = function () {
      if (_renderPins) _renderPins();
      const wrap = document.getElementById('ed-pins');
      if (!wrap || !this.doc || !global.Eco) return;
      const C = global.Eco.Comments;
      for (const el of this._pinEls || []) {
        if (!el.classList.contains('open')) continue;
        const c = C.listFor(this.doc, this.page.id).find((x) => x.id === el.dataset.cid);
        if (!c) continue;
        const body = el.querySelector('.pin-body');
        if (!body || body.querySelector('.pf-thread')) continue;
        const replies = c.replies || [];
        const thread = document.createElement('div');
        thread.className = 'pf-thread';
        thread.innerHTML =
          replies.map((r) => `<div class="pf-reply"><b>${M.esc(r.author)}</b> ${M.esc(r.text)}</div>`).join('') +
          `<textarea class="pf-reply-ta" rows="2" placeholder="Reply…"></textarea>` +
          `<button type="button" class="ed-btn ed-btn-primary pf-reply-ok">Reply</button>`;
        body.appendChild(thread);
        const ta = thread.querySelector('textarea');
        thread.querySelector('.pf-reply-ok').addEventListener('click', (ev) => {
          ev.stopPropagation();
          const text = ta.value.trim();
          if (!text) return;
          this.history.begin(this.doc);
          C.reply(this.doc, c.id, text, global.Collab.self ? global.Collab.self.name : 'You');
          this.history.end(this.doc);
          this.markDirty();
        });
        ta.addEventListener('keydown', (ev) => ev.stopPropagation());
      }
    };

    // =====================================================================
    // 8. Inspector extras: polygon/star, arrows, ellipse arc, image fill
    // =====================================================================
    if (P && P.refreshInspector) {
      const _ri = P.refreshInspector.bind(P);
      P.refreshInspector = function () {
        _ri();
        const el = document.getElementById('ed-right');
        const nodes = this.selNodes ? this.selNodes() : [];
        if (!el || nodes.length !== 1) return;
        const n = nodes[0];
        const host = el.querySelector('.ins-tab-content') || el;
        if (this._inspectorTab && this._inspectorTab !== 'design') return;

        if (n.shape === 'polygon' || n.shape === 'star' || n.shape === 'triangle') {
          if (!host.querySelector('[data-act="shape-verts"]')) {
            const sec = document.createElement('section');
            sec.className = 'ins-sec';
            sec.innerHTML =
              `<div class="ins-head"><span>Shape</span></div>` +
              `<div class="ins-grid g2"><label>Count</label><input type="number" min="3" max="64" data-act="shape-verts" value="${n.verts || 5}"></div>` +
              (n.shape === 'star'
                ? `<div class="ins-grid g2"><label>Ratio</label><input type="number" min="0.1" max="0.95" step="0.01" data-act="shape-ratio" value="${n.starRatio == null ? 0.382 : n.starRatio}"></div>`
                : '');
            host.insertBefore(sec, host.firstChild.nextSibling);
            const commit = (fn) => { App.history.begin(App.doc); fn(); App.history.end(App.doc); App.markDirty(); };
            sec.querySelector('[data-act="shape-verts"]').addEventListener('input', (ev) => {
              const v = Math.max(3, Math.min(64, +ev.target.value || 5));
              commit(() => { n.verts = v; n.path = App._shapePath(n); });
            });
            const ratio = sec.querySelector('[data-act="shape-ratio"]');
            if (ratio) ratio.addEventListener('input', (ev) => {
              const v = Math.max(0.08, Math.min(0.95, +ev.target.value || 0.382));
              commit(() => { n.starRatio = v; n.path = App._shapePath(n); });
            });
          }
        }

        if (n.type === 'line') {
          if (!host.querySelector('[data-act="arrow-start"]')) {
            const sec = document.createElement('section');
            sec.className = 'ins-sec';
            sec.innerHTML =
              `<div class="ins-head"><span>Line ends</span></div>` +
              `<div class="ins-row"><label>Start</label><label class="chk"><input type="checkbox" data-act="arrow-start" ${n.arrowStart ? 'checked' : ''}> Arrow</label></div>` +
              `<div class="ins-row"><label>End</label><label class="chk"><input type="checkbox" data-act="arrow-end" ${n.arrowEnd ? 'checked' : ''}> Arrow</label></div>`;
            host.appendChild(sec);
            const commit = (fn) => { App.history.begin(App.doc); fn(); App.history.end(App.doc); App.markDirty(); };
            sec.querySelector('[data-act="arrow-start"]').addEventListener('change', (ev) => {
              commit(() => { n.arrowStart = ev.target.checked; });
            });
            sec.querySelector('[data-act="arrow-end"]').addEventListener('change', (ev) => {
              commit(() => { n.arrowEnd = ev.target.checked; });
            });
          }
        }

        if (n.type === 'ellipse') {
          if (!host.querySelector('[data-act="arc-start"]')) {
            const sec = document.createElement('section');
            sec.className = 'ins-sec';
            sec.innerHTML =
              `<div class="ins-head"><span>Arc</span></div>` +
              `<div class="ins-grid g2"><label>Start °</label><input type="number" data-act="arc-start" value="${n.arcStart || 0}"></div>` +
              `<div class="ins-grid g2"><label>Sweep °</label><input type="number" data-act="arc-sweep" value="${n.arcSweep == null ? 360 : n.arcSweep}"></div>` +
              `<div class="ins-grid g2"><label>Inner</label><input type="number" min="0" max="0.95" step="0.01" data-act="arc-inner" value="${n.innerRadius || 0}"></div>` +
              `<div class="ph sm">Sweep 360 = full ellipse. Inner &gt; 0 makes a ring.</div>`;
            host.appendChild(sec);
            const commit = (fn) => { App.history.begin(App.doc); fn(); App.history.end(App.doc); App.markDirty(); };
            sec.querySelector('[data-act="arc-start"]').addEventListener('input', (ev) => {
              commit(() => { n.arcStart = +ev.target.value || 0; });
            });
            sec.querySelector('[data-act="arc-sweep"]').addEventListener('input', (ev) => {
              commit(() => { n.arcSweep = +ev.target.value; if (!isFinite(n.arcSweep)) n.arcSweep = 360; });
            });
            sec.querySelector('[data-act="arc-inner"]').addEventListener('input', (ev) => {
              commit(() => { n.innerRadius = Math.max(0, Math.min(0.95, +ev.target.value || 0)); });
            });
          }
        }

        const img = imageFillOf(n);
        if (img && !host.querySelector('[data-act="img-mode"]')) {
          const sec = document.createElement('section');
          sec.className = 'ins-sec';
          sec.innerHTML =
            `<div class="ins-head"><span>Image</span><button class="mini" data-act="img-crop">Crop</button></div>` +
            `<div class="ins-row"><label>Fit</label><select data-act="img-mode">` +
            `<option value="fill" ${img.scaleMode === 'fill' || !img.scaleMode ? 'selected' : ''}>Fill</option>` +
            `<option value="fit" ${img.scaleMode === 'fit' ? 'selected' : ''}>Fit</option>` +
            `<option value="crop" ${img.scaleMode === 'crop' ? 'selected' : ''}>Crop</option>` +
            `<option value="tile" ${img.scaleMode === 'tile' ? 'selected' : ''}>Tile</option>` +
            `</select></div>`;
          host.appendChild(sec);
          sec.querySelector('[data-act="img-mode"]').addEventListener('change', (ev) => {
            App.history.begin(App.doc);
            img.scaleMode = ev.target.value;
            App.history.end(App.doc);
            App.markDirty();
          });
          sec.querySelector('[data-act="img-crop"]').addEventListener('click', () => beginCrop(n));
        }
      };
    }

    // =====================================================================
    // 9. Shape path uses star ratio
    // =====================================================================
    const _shapePath = App._shapePath && App._shapePath.bind(App);
    App._shapePath = function (n) {
      if (global.Booleans && global.Booleans.shapeD) {
        return global.Booleans.shapeD(
          n.shape === 'star' ? 'star' : 'polygon',
          n.verts,
          n.w,
          n.h,
          n.starRatio
        );
      }
      return _shapePath ? _shapePath(n) : '';
    };

    // =====================================================================
    // 10. Layers: always go through setSel; zoom if off-screen
    // =====================================================================
    if (P && P.refreshLayers) {
      const _rl = P.refreshLayers.bind(P);
      P.refreshLayers = function () {
        _rl();
        const el = document.getElementById('ed-layers');
        if (!el) return;
        el.querySelectorAll('.ly-row').forEach((row) => {
          if (row._pfSel) return;
          row._pfSel = true;
          row.addEventListener('click', (e) => {
            if (e.target.closest('button') || e.target.closest('[data-caret]')) return;
            const id = row.dataset.id;
            if (!id) return;
            if (e.shiftKey) {
              const next = App.sel.slice();
              const i = next.indexOf(id);
              if (i >= 0) next.splice(i, 1); else next.push(id);
              App.setSel(next);
            } else {
              App.setSel([id]);
            }
            const n = App.page && App.page.nodes[id];
            if (n && n._w && App.canvas) {
              const r = App.canvas.getBoundingClientRect();
              const z = App.view.zoom;
              const sx = n._w.x * z + App.view.ox;
              const sy = n._w.y * z + App.view.oy;
              if (sx < 40 || sy < 40 || sx > r.width - 40 || sy > r.height - 40) {
                App.zoomToSelection && App.zoomToSelection();
              }
            }
          }, true);
        });
      };
    }

    // =====================================================================
    // 11. Redraw hooks: crop overlay, radius handle, hide chrome while crop
    // =====================================================================
    const _redraw = App.redraw && App.redraw.bind(App);
    App.redraw = function () {
      if (this._crop && R && R.drawPage) {
        const c = this.canvas, ctx = this.ctx;
        if (!c || !ctx) return;
        const rect = c.getBoundingClientRect();
        const v = this.view;
        R.drawPage(ctx, this.page, this.doc, {
          zoom: v.zoom, ox: v.ox, oy: v.oy, w: rect.width, h: rect.height,
          grid: v.grid, pixelPreview: v.pixelPreview, canvasColor: v.canvasColor,
        });
        drawCropOverlay(ctx);
        R.drawRulers(ctx, this.view, rect.width, rect.height);
        this.updateZoomLabel && this.updateZoomLabel();
        return;
      }
      if (_redraw) _redraw();
      if (this.ctx) drawRadiusHandle(this.ctx);
    };

    // =====================================================================
    // 12. Keyboard: Enter/Esc for crop; keep Enter-to-edit-text
    // =====================================================================
    const _onKey = App.onKey && App.onKey.bind(App);
    App.onKey = function (e) {
      if (this._crop) {
        if (e.key === 'Enter') { e.preventDefault(); commitCrop(true); return; }
        if (e.key === 'Escape') { e.preventDefault(); commitCrop(false); return; }
      }
      if (_onKey) return _onKey(e);
    };

    // =====================================================================
    // 13. Keep "Save locally" label (enhancements overwrites it)
    // =====================================================================
    const _saveNow = App.saveNow && App.saveNow.bind(App);
    App.saveNow = function () {
      if (_saveNow) _saveNow();
      const btn = document.getElementById('ed-share');
      if (btn) {
        btn.innerHTML = (Ico ? Ico('check', { size: 12 }) : '') + ' Saved locally';
        setTimeout(() => {
          if (btn) btn.innerHTML = (Ico ? Ico('save', { size: 13 }) : '') + ' Save locally';
        }, 1800);
      }
    };

    // =====================================================================
    // 14. Alt-hover measurement overlay (Figma-like)
    // =====================================================================
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Alt' && App.doc && App.canvas) App._altMeasure = true;
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Alt') { App._altMeasure = false; App.markDirty && App.markDirty(); }
    });
    const _light = App._redrawLight && App._redrawLight.bind(App);
    if (_light) {
      App._redrawLight = function () {
        if (this._crop) return this.redraw();
        _light();
        if (this._altMeasure && this.sel.length === 1 && this.hoverId && this.hoverId !== this.sel[0] && R.drawDevMeasure) {
          R.drawDevMeasure(this.ctx, this.view, this.page, this.doc, this.sel);
        }
      };
    }
  });
})(window);
