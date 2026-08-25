/* ui-editor.js — Penfig editor: canvas interactions, tools, zoom, text editing */
(function (global) {
  'use strict';
  const M = global.Model;
  const R = global.Renderer;
  const T = global.Tokens;
  const Icons = global.Icons;
  const Ico = Icons.svg;
  const esc = global.Dash.esc;
  function parseSvg(name, size) {
    const t = document.createElement('template');
    t.innerHTML = Ico(name, { size });
    return t.content.firstChild;
  }

  const App = {
    doc: null, pageIndex: 0,
    sel: [],
    tool: 'move',
    // rulers/grid/snap are session view state (not document state): they
    // persist across files in a session but never into the saved doc.
    view: { zoom: 1, ox: 80, oy: 80, rulers: true, grid: null, gridSize: 10, snap: true, magnet: false },
    marquee: null,
    space: false,
    history: new M.History(),
    clipboard: null,
    dirty: false,
    devMode: false,
    present: null,        // { canvasA, canvasB, front, page, node, overlay }
    pen: null,            // pen state: { kind:'draw'|'edit', nodes, closed, sel, node?, subpaths?, subIdx?, cursor? }
    pencil: null,         // { pts: [world points] }
    _snapGuides: null,    // live smart-guide lines while dragging: [{axis, at, from, to}] (world)
    propClip: null,       // copy/paste-properties payload
    _paletteEl: null,
    _pinEls: [],
    _peerEls: new Map(),
    _rafPending: false,
    _saveTimer: 0,
    canvas: null, ctx: null,

    // ------------------------------------------------------------- routing
    get page() { return this.doc ? this.doc.pages[this.pageIndex] : null; },

    openFile(id) {
      const entry = M.store.get(id);
      if (!entry) { this.goDashboard(); return; }
      this.doc = M.ensureDocShape(entry.doc);
      for (const p of this.doc.pages) M.stampPage(this.doc, p);
      this.pageIndex = 0;
      this.sel = [];
      this.history.clear();
      this.showEditor();
      location.hash = '#/file/' + id;
      this.joinCollab();
      this.markDirty();
      this.zoomToFit();
    },
    goDashboard() {
      this.saveNow();
      global.Collab.leave();
      this.doc = null;
      this.showDashboard();
      location.hash = '#/';
    },
    joinCollab() {
      const C = global.Collab;
      if (!C.join(this.doc.id)) return;
      C.onPeersChange = (peers) => this.renderPeers();
      C.onCursor = () => this.renderPeers();
      this.renderPeers();
    },
    showDashboard() {
      document.getElementById('view-editor').style.display = 'none';
      const d = document.getElementById('view-dashboard');
      d.style.display = 'flex';
      document.body.classList.add('dash-mode');
      global.Dash.D.render();
    },
    showEditor() {
      document.getElementById('view-dashboard').style.display = 'none';
      const ed = document.getElementById('view-editor');
      ed.style.display = 'flex';
      this.buildChrome();
      requestAnimationFrame(() => { this.resizeCanvas(); this.markDirty(); });
    },

    // ------------------------------------------------------------- layout + paint
    layoutDoc(doc, page) {
      if (!page) page = doc.pages[0];
      T.bake(doc, page, doc.vars.defaultMode);
      global.Layout.layoutPage(page);
    },
    markDirty() {
      this.dirty = true;
      clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(() => this.saveNow(), 900);
      if (this._rafPending) return;
      this._rafPending = true;
      requestAnimationFrame(() => {
        this._rafPending = false;
        if (!this.doc || document.getElementById('view-editor').style.display === 'none') return;
        this.layoutDoc(this.doc, this.page);
        this.redraw();
        this.renderPins();
        this.renderPeers();
        if (this.present) this.renderPresentFrame();
        global.Panels.refreshLayers();
        global.Collab.broadcastDoc(this.doc, this.sel);
        if (this.dirty) { this.dirty = false; }
      });
    },
    redraw() {
      const c = this.canvas;
      if (!c) return;
      const ctx = this.ctx;
      if (!ctx) return;
      const rect = c.getBoundingClientRect();
      R.drawPage(ctx, this.page, this.doc, { zoom: this.view.zoom, ox: this.view.ox, oy: this.view.oy, w: rect.width, h: rect.height, grid: this.view.grid });
      if (this.devMode) R.drawDevMeasure(ctx, this.view, this.page, this.doc, this.sel);
      else R.drawSelection(ctx, this.view, this.sel, this.page);
      if (this.marquee) R.drawMarquee(ctx, this.marquee);
      this.drawEmptyState(ctx);
      this.drawPenOverlay(ctx);
      R.drawSnapGuides(ctx, this.view, this._snapGuides);
      R.drawRulers(ctx, this.view, rect.width, rect.height);
      this.updateZoomLabel();
    },
    saveNow() {
      if (!this.doc) return;
      global.Dash.saveDoc(this.doc);
      // specific + actionable + non-destructive error model (spec §33):
      // the document stays open and usable; the user can back it up as .fig.
      if (global.Model.store.quotaError) {
        const A = this;
        this.toast('Couldn\'t save this project. Your document is still open.', 12000, [
          { label: 'Export backup (.fig)', fn: () => { try { A.exportBackupFig(); A.toast('Backup exported'); } catch (err) { A.toast('Backup failed: ' + err.message); } } },
          { label: 'Try again', fn: () => { A.saveNow(); } },
        ]);
      }
    },
    exportBackupFig() {
      const bytes = global.FigConv.exportFig(this.doc);
      const blob = new Blob([bytes], { type: 'application/octet-stream' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (this.doc.name || 'penfig') + '.fig';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    },

    // ------------------------------------------------------------- chrome
    buildChrome() {
      document.body.classList.remove('dash-mode');
      const ed = document.getElementById('view-editor');
      const docName = M.esc ? M.esc(this.doc.name) : esc(this.doc.name);
      ed.innerHTML = `
      <div class="ed-top">
        <button id="ed-back" class="ed-iconbtn" title="Back to files (Esc)">${Ico('chevron_l',{size:16})}</button>
        <div class="ed-filename-wrap">
          <input id="ed-filename" class="ed-filename" value="${docName}" spellcheck="false">
          <span class="ed-pagename" id="ed-pagename" title="Double-click to rename page"></span>
        </div>
        <div class="ed-top-divider"></div>
        <button id="ed-undo" class="ed-iconbtn" title="Undo (⌘Z)">${Ico('undo',{size:16})}</button>
        <button id="ed-redo" class="ed-iconbtn" title="Redo (⇧⌘Z)">${Ico('redo',{size:16})}</button>
        <div class="ed-top-divider"></div>
        <div class="ed-top-mid" id="ed-modes-wrap">
          <div class="seg" id="ed-modes"></div>
        </div>
        <div class="ed-top-right">
          <button id="ed-rulers" class="ed-iconbtn" title="Toggle rulers" aria-label="Rulers">${Ico('ruler',{size:16})}</button>
          <button id="ed-grid" class="ed-iconbtn" title="Toggle grid" aria-label="Grid">${Ico('grid',{size:14})}</button>
          <button id="ed-snap" class="ed-iconbtn" title="Toggle snap to objects" aria-label="Snap">${Ico('magnet',{size:16})}</button>
          <div class="ed-top-divider"></div>
          <button id="ed-present" class="ed-btn" title="Present prototype (⇧K)">${Ico('play',{size:12})} Present</button>
          <button id="ed-devmode" class="ed-btn" title="Dev mode (D) — inspect + code">${Ico('dev',{size:14})} Inspect</button>
          <button id="ed-versions" class="ed-btn" title="Version history (⌘K)">${Ico('history',{size:14})}</button>
          <button id="ed-plugins" class="ed-btn" title="Plugins">${Ico('plugin',{size:14})}</button>
          <button id="ed-share" class="ed-btn" title="Share / save">${Ico('save',{size:13})} Save</button>
          <div class="ed-top-divider"></div>
          <span id="ed-peers" class="ed-peers" title="People in this file"></span>
          <button id="ed-export" class="ed-btn active" title="Export (⌘E)">${Ico('download',{size:13})} Export</button>
        </div>
      </div>
      <div class="ed-body">
        <div class="ed-left">
          <div class="ed-left-tabs">
            <button class="ed-ltab active" data-tab="layers" title="Layers">${Ico('layers',{size:13})}<span>Layers</span></button>
            <button class="ed-ltab" data-tab="assets" title="Assets">${Ico('component',{size:14})}<span>Assets</span></button>
            <button class="ed-ltab" data-tab="styles" title="Styles">${Ico('styles',{size:14})}<span>Styles</span></button>
            <button class="ed-ltab" data-tab="pages" title="Pages">${Ico('pages',{size:13})}<span>Pages</span></button>
            <button class="ed-ltab" data-tab="vars" title="Variables / tokens">${Ico('tokens',{size:13})}<span>Tokens</span></button>
          </div>
          <div class="ed-left-content">
            <div id="ed-layers" class="ed-panel-body"></div>
            <div id="ed-assets" class="ed-panel-body" style="display:none"></div>
            <div id="ed-styles" class="ed-panel-body" style="display:none"></div>
            <div id="ed-pages" class="ed-panel-body" style="display:none"></div>
            <div id="ed-vars" class="ed-panel-body" style="display:none"></div>
          </div>
        </div>
        <div class="ed-canvas-wrap" id="ed-canvas-wrap">
          <canvas id="ed-canvas"></canvas>
          <div class="ed-pins" id="ed-pins"></div>
          <div class="ed-toolbar" id="ed-toolbar">
            ${Icons.toolBtn('move','move','Move','V')}
            ${Icons.toolBtn('frame','frame','Frame','F')}
            ${Icons.toolBtn('section','section','Section','S')}
            <div class="tb-sep"></div>
            ${Icons.toolBtn('rect','rect','Rectangle','R')}
            ${Icons.toolBtn('ellipse','ellipse','Ellipse','O')}
            ${Icons.toolBtn('line','line','Line','L')}
            ${Icons.toolBtn('arrow','arrow','Arrow','A')}
            <div class="tb-sep"></div>
            ${Icons.toolBtn('pen','pen','Pen (vector)','P')}
            ${Icons.toolBtn('pencil','pencil','Pencil','N')}
            ${Icons.toolBtn('polygon','polygon','Polygon')}
            ${Icons.toolBtn('star','star','Star')}
            ${Icons.toolBtn('triangle','triangle','Triangle')}
            <div class="tb-sep"></div>
            ${Icons.toolBtn('text','text','Text','T')}
            ${Icons.toolBtn('comment','comment','Comment','C')}
            <div class="tb-sep"></div>
            ${Icons.toolBtn('hand','hand','Hand / pan','H')}
          </div>
          <div class="ed-zoom" id="ed-zoom">
            <button id="zoom-out" title="Zoom out">${Ico('minus',{size:14})}</button>
            <button id="zoom-pct" title="Zoom to 100%">100%</button>
            <button id="zoom-in" title="Zoom in">${Ico('plus',{size:14})}</button>
            <button id="zoom-fit" title="Zoom to fit (⇧1)">${Ico('zoomfit',{size:14})}</button>
          </div>
          <div class="ed-status" id="ed-status"></div>
        </div>
        <div class="ed-right" id="ed-right"></div>
      </div>`;
      this.canvas = ed.querySelector('#ed-canvas');
      this.ctx = this.canvas.getContext ? this.canvas.getContext('2d') : null;
      this.bindCanvas();
      const self = this;
      ed.querySelector('#ed-back').addEventListener('click', () => self.goDashboard());
      const fn = ed.querySelector('#ed-filename');
      fn.value = this.doc.name;
      fn.addEventListener('change', () => { this.doc.name = fn.value.trim() || 'Untitled'; this.saveNow(); });
      ed.querySelectorAll('.ed-ltab').forEach(b => b.addEventListener('click', () => {
        ed.querySelectorAll('.ed-ltab').forEach(x => x.classList.remove('active'));
        b.classList.add('active');
        const tab = b.dataset.tab;
        ['layers', 'assets', 'styles', 'pages', 'vars'].forEach(t => ed.querySelector('#ed-' + t).style.display = t === tab ? '' : 'none');
        if (tab === 'layers') global.Panels.refreshLayers();
        if (tab === 'assets') global.Panels.renderAssets();
        if (tab === 'styles') global.Panels.renderStyles();
        if (tab === 'pages') global.Panels.renderPages();
        if (tab === 'vars') global.Panels.renderVars();
      }));
      ed.querySelector('#ed-toolbar').querySelectorAll('.tool').forEach(b => b.addEventListener('click', () => this.setTool(b.dataset.tool)));
      ed.querySelector('#zoom-in').addEventListener('click', () => this.zoomBy(1.2));
      ed.querySelector('#zoom-out').addEventListener('click', () => this.zoomBy(1 / 1.2));
      ed.querySelector('#zoom-pct').addEventListener('click', () => { const c = centerOf(this.canvas); this.zoomAt(c.x, c.y, 1 / this.view.zoom); });
      ed.querySelector('#zoom-fit').addEventListener('click', () => this.zoomToFit());
      ed.querySelector('#ed-export').addEventListener('click', (e) => { e.stopPropagation(); global.Panels.exportMenu(e.clientX, e.clientY); });
      ed.querySelector('#ed-present').addEventListener('click', () => this.startPresent());
      ed.querySelector('#ed-devmode').addEventListener('click', () => this.toggleDevMode());
      ed.querySelector('#ed-view')?.addEventListener?.('click', (e) => { e.stopPropagation(); global.Panels.viewMenu(e.clientX, e.clientY); });
      ed.querySelector('#ed-undo').addEventListener('click', () => this.historyUndo());
      ed.querySelector('#ed-redo').addEventListener('click', () => this.historyRedo());
      ed.querySelector('#ed-rulers').addEventListener('click', () => { this.view.rulers = !this.view.rulers; this.syncViewToggles(); this.markDirty(); });
      ed.querySelector('#ed-grid').addEventListener('click', () => { this.view.grid = this.view.grid ? null : (this.view.gridSize || 10); this.syncViewToggles(); this.markDirty(); });
      ed.querySelector('#ed-snap').addEventListener('click', () => { this.view.snap = !this.view.snap; this.syncViewToggles(); this.markDirty(); });
      ed.querySelector('#ed-share').addEventListener('click', () => { this.saveNow(); this.toast('Saved to this browser', 2000, 'success'); });
      ed.querySelector('#ed-versions').addEventListener('click', (e) => { e.stopPropagation(); global.Panels.versionsMenu(e.clientX, e.clientY); });
      ed.querySelector('#ed-plugins').addEventListener('click', (e) => { e.stopPropagation(); global.Panels.pluginsModal(); });
      this.setTool('move');
      this.syncViewToggles();
      global.Panels.renderPages();
      global.Panels.refreshLayers();
      global.Panels.refreshInspector();
      this.renderModes();
      this.updateZoomLabel();
      this.renderPagename();
      // double-click page name → rename
      const pn = ed.querySelector('#ed-pagename');
      if (pn) pn.addEventListener('dblclick', () => {
        const name = prompt('Rename page', this.page.name);
        if (name && name.trim()) { this.page.name = name.trim(); this.renderPagename(); global.Panels.renderPages(); this.markDirty(); }
      });
    },
    renderPagename() {
      const el = document.getElementById('ed-pagename');
      if (!el || !this.page) return;
      el.innerHTML = `${Ico('chevron_r',{size:10})} ${esc(this.page.name)}`;
    },
    syncViewToggles() {
      const on = (id, on) => { const b = document.getElementById(id); if (b) b.classList.toggle('active', !!on); };
      on('ed-rulers', this.view.rulers);
      on('ed-grid', !!this.view.grid);
      on('ed-snap', this.view.snap);
    },
    renderModes() {
      const el = document.getElementById('ed-modes');
      if (!el) return;
      const doc = this.doc;
      const modeIcon = (name) => {
        const n = name.toLowerCase();
        if (n.includes('dark') || n.includes('night')) return Ico('moon',{size:11});
        return Ico('sun',{size:11});
      };
      el.innerHTML = doc.vars.modes.map(m =>
        `<button class="seg-btn ${m.id === doc.vars.defaultMode ? 'active' : ''}" data-m="${m.id}">${modeIcon(m.name)}${esc(m.name)}</button>`).join('') +
        `<button class="seg-btn" id="mode-add" title="Add mode">${Ico('plus',{size:11})}</button>`;
      el.querySelectorAll('.seg-btn[data-m]').forEach(b => b.addEventListener('click', () => {
        this.history.begin(this.doc);
        doc.vars.defaultMode = b.dataset.m;
        this.history.end(this.doc);
        this.renderModes();
        this.markDirty();
        global.Panels.refreshInspector();
      }));
      const add = el.querySelector('#mode-add');
      if (add) add.addEventListener('click', () => {
        const name = prompt('New mode name', 'Mode ' + (doc.vars.modes.length + 1));
        if (!name) return;
        this.history.begin(this.doc);
        T.addMode(doc, name);
        this.history.end(this.doc);
        this.renderModes();
        this.markDirty();
      });
    },
    updateZoomLabel() {
      const el = document.getElementById('zoom-pct');
      if (el) el.textContent = Math.round(this.view.zoom * 100) + '%';
    },
    status(msg) {
      const el = document.getElementById('ed-status');
      if (el) { el.textContent = msg || ''; }
    },

    // ------------------------------------------------------------- selection
    setSel(ids) {
      this.sel = ids;
      global.Collab.sendSelection(this.sel);
      global.Panels.refreshInspector();
      this.markDirty();
    },

    // ------------------------------------------------------------- canvas binding
    bindCanvas() {
      const c = this.canvas;
      const self = this;
      // Window-level listeners are bound ONCE. buildChrome re-runs on every
      // file open, and re-adding them made each pointer/key event fire once
      // per previously opened file: the stale runs recompute a drag from the
      // nodes' CURRENT positions and clobber state the first run set (this is
      // what silently undid smart-guide snapping; caught by the P0 acceptance
      // matrix). Canvas-level listeners stay per-element.
      if (!this._winHandlers) {
        this._winHandlers = {
          move: (e) => self.onMove(e),
          up: (e) => self.onUp(e),
          keydown: (e) => self.onKey(e),
          keyup: (e) => { if (e.code === 'Space') self.space = false; },
        };
        window.addEventListener('pointermove', this._winHandlers.move);
        window.addEventListener('pointerup', this._winHandlers.up);
        window.addEventListener('keydown', this._winHandlers.keydown);
        window.addEventListener('keyup', this._winHandlers.keyup);
      }
      new ResizeObserver(() => { self.resizeCanvas(); self.markDirty(); }).observe(c.parentElement);

      c.addEventListener('pointerdown', (e) => self.onDown(e));
      c.addEventListener('dblclick', (e) => self.onDbl(e));
      c.addEventListener('wheel', (e) => { e.preventDefault(); self.onWheel(e); }, { passive: false });
      c.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const p = this.toWorld(e);
        const hit = this.hitTest(p);
        if (hit && !this.sel.includes(hit.id)) { this.sel = [hit.id]; this.markDirty(); }
        global.Panels.contextMenu(e.clientX, e.clientY, this.sel.length ? this.sel : [hit && hit.id].filter(Boolean));
      });
    },
    resizeCanvas() {
      const c = this.canvas;
      if (!c) return;
      const rect = c.parentElement.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      c.width = Math.max(1, rect.width * dpr);
      c.height = Math.max(1, rect.height * dpr);
      c.style.width = rect.width + 'px';
      c.style.height = rect.height + 'px';
      if (this.ctx) this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    },
    toWorld(e) {
      const rect = this.canvas.getBoundingClientRect();
      return { x: (e.clientX - rect.left - this.view.ox) / this.view.zoom, y: (e.clientY - rect.top - this.view.oy) / this.view.zoom };
    },
    toScreen(p) { return { x: p.x * this.view.zoom + this.view.ox, y: p.y * this.view.zoom + this.view.oy }; },

    // ------------------------------------------------------------- hit test
    hitTest(p) {
      const page = this.page;
      const inRect = (n) => {
        const L = n._l;
        if (!L || n.visible === false) return false;
        const x0 = L.x, y0 = L.y;
        if (n.type === 'ellipse') {
          const dx = (p.x - (x0 + L.w / 2)) / (L.w / 2), dy = (p.y - (y0 + L.h / 2)) / (L.h / 2);
          return dx * dx + dy * dy <= 1;
        }
        if (n.type === 'line') {
          const pad = Math.max(4, n.stroke.width) / this.view.zoom;
          return p.x >= x0 - pad && p.x <= x0 + L.w + pad && p.y >= y0 - pad && p.y <= y0 + L.h + pad;
        }
        return p.x >= x0 && p.x <= x0 + L.w && p.y >= y0 && p.y <= y0 + L.h;
      };
      const visit = (n) => {
        // children first (topmost = last child)
        for (let i = n.children.length - 1; i >= 0; i--) {
          const k = page.nodes[n.children[i]];
          if (!k) continue;
          if (n.type === 'frame' && n.clips) {
            const L = n._l;
            if (p.x < L.x || p.x > L.x + L.w || p.y < L.y || p.y > L.y + L.h) continue;
          }
          const r = visit(k);
          if (r) return r;
        }
        return inRect(n) ? n : null;
      };
      for (let i = page.tops.length - 1; i >= 0; i--) {
        const t = page.tops[i] ? page.nodes[page.tops[i]] : null;
        if (!t) continue;
        const r = visit(t);
        if (r) return r;
      }
      return null;
    },
    handleAt(e) {
      if (this.sel.length !== 1) return null;
      const n = this.page.nodes[this.sel[0]];
      if (!n || !n._l) return null;
      const s = this.toScreen({ x: n._l.x, y: n._l.y });
      const w = n._l.w * this.view.zoom, h = n._l.h * this.view.zoom;
      const pts = [
        ['nw', s.x, s.y], ['n', s.x + w / 2, s.y], ['ne', s.x + w, s.y],
        ['e', s.x + w, s.y + h / 2], ['se', s.x + w, s.y + h],
        ['s', s.x + w / 2, s.y + h], ['sw', s.x, s.y + h], ['w', s.x, s.y + h / 2],
      ];
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      for (const [name, x, y] of pts) {
        if (Math.abs(mx - x) <= 6 && Math.abs(my - y) <= 6) return { name, node: n };
      }
      return null;
    },

    // ------------------------------------------------------------- pointer ops
    _drag: null,
    onDown(e) {
      this._snapGuides = null; // guides only exist mid-drag
      if (e.button === 1 || (e.button === 0 && this.space)) {
        this._drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: this.view.ox, oy: this.view.oy };
        e.preventDefault();
        return;
      }
      if (e.button !== 0) return;
      const p = this.toWorld(e);
      const self = this;

      if (this.tool === 'comment') {
        const text = prompt('Add a comment:', '');
        if (text) {
          this.history.begin(this.doc);
          global.Eco.Comments.add(this.doc, this.page.id, p.x, p.y, text.trim(), global.Collab.self ? global.Collab.self.name : 'You');
          this.history.end(this.doc);
          this.renderPins();
          this.markDirty();
        }
        return;
      }
      if (this.tool === 'hand') {
        this._drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, ox: this.view.ox, oy: this.view.oy };
        return;
      }
      if (this.tool === 'pen') { this.penDown(p, e); return; }
      if (this.tool === 'pencil') {
        this.pencil = { pts: [p] };
        this._drag = { kind: 'pencil' };
        return;
      }
      if (this.tool !== 'move') {
        // create shapes
        const spec =
          this.tool === 'frame' ? { type: 'frame' } :
          this.tool === 'section' ? { type: 'frame', section: true } :
          this.tool === 'rect' ? { type: 'rect' } :
          this.tool === 'ellipse' ? { type: 'ellipse' } :
          this.tool === 'line' ? { type: 'line' } :
          this.tool === 'arrow' ? { type: 'line', arrowEnd: true } :
          this.tool === 'polygon' ? { type: 'vector', shape: 'polygon', verts: 6 } :
          this.tool === 'star' ? { type: 'vector', shape: 'star', verts: 5 } :
          this.tool === 'triangle' ? { type: 'vector', shape: 'triangle', verts: 3 } : null;
        if (this.tool === 'text') {
          this.history.begin(this.doc);
          const t = M.makeNode('text', { x: p.x, y: p.y - 12, w: 120, h: 24 });
          M.attach(this.doc, this.page, null, t);
          this.applyTextResize(t); // Figma: new text hugs its content (auto w+h)
          this.history.end(this.doc);
          this.sel = [t.id];
          this.setTool('move');
          this.markDirty();
          this.beginTextEdit(t);
          return;
        }
        if (!spec) return;
        this.history.begin(this.doc);
        const n = M.makeNode(spec.type, { x: p.x, y: p.y, w: 1, h: 1 });
        if (spec.section) n.section = true;
        if (spec.arrowEnd) { n.arrowEnd = true; n.stroke = n.stroke || { color: '#111111', width: 2, opacity: 1, align: 'center' }; }
        if (spec.shape) {
          n.shape = spec.shape; n.verts = spec.verts;
          n.name = spec.shape === 'polygon' ? 'Polygon' : spec.shape === 'star' ? 'Star' : 'Triangle';
          n.fills = [{ type: 'solid', color: '#d9d9d9', opacity: 1, token: null }];
          n.windingRule = 'evenodd';
          n.path = this._shapePath(n);
        }
        M.attach(this.doc, this.page, null, n);
        this.history.end(this.doc);
        this.sel = [n.id];
        this._drag = { kind: 'create', node: n, sx: p.x, sy: p.y };
        this.markDirty();
        return;
      }

      // move tool
      const h = this.handleAt(e);
      if (h) {
        this.history.begin(this.doc);
        // sp = the START POINTER in canvas space (doResize computes total
        // delta against it), ox/oy = view snapshot at drag start so a
        // mid-drag pan divides out. (Earlier versions passed the node origin
        // as sp, which double-counted the handle offset, and omitted ox/oy
        // entirely, producing NaN — both caught by the P0 acceptance matrix.)
        const crect = this.canvas.getBoundingClientRect();
        this._drag = { kind: 'resize', name: h.name, node: h.node, start: { x: h.node.x, y: h.node.y, w: h.node.w, h: h.node.h }, sp: { x: e.clientX - crect.left, y: e.clientY - crect.top }, ox: this.view.ox, oy: this.view.oy };
        return;
      }
      const hit = this.hitTest(p);
      if (hit) {
        if (hit.locked) { this.setSel([hit.id]); return; }
        if (e.shiftKey) {
          const i = this.sel.indexOf(hit.id);
          if (i >= 0) this.sel.splice(i, 1); else this.sel.push(hit.id);
          this.setSel(this.sel.slice());
          return;
        }
        if (!this.sel.includes(hit.id)) this.setSel([hit.id]);
        const page = this.page;
        const starts = this.sel.map(id => { const n = page.nodes[id]; return n ? { id, x: n.x, y: n.y } : null; }).filter(Boolean);
        this._drag = { kind: 'move', starts, sx: p.x, sy: p.y, moved: false };
      } else {
        if (!e.shiftKey) this.sel = [];
        this._drag = { kind: 'marquee', sx: p.x, sy: p.y, base: e.shiftKey ? this.sel.slice() : [] };
        this.markDirty();
      }
    },
    onMove(e) {
      const d = this._drag;
      const c = this.canvas;
      const rect = c.getBoundingClientRect();
      if (c && rect.width && e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
        global.Collab.sendCursor(this.toWorld(e).x, this.toWorld(e).y);
      }
      // hover cursor
      if (!d) {
        if (this.tool === 'pen' && this.pen) { this.pen.cursor = this.toWorld(e); this.markDirty(); }
        const h = this.handleAt(e);
        if (h) c.style.cursor = cursorFor(h.name);
        else if (this.tool !== 'move') c.style.cursor = this.tool === 'text' ? 'text' : 'crosshair';
        else if (this.space) c.style.cursor = 'grab';
        else c.style.cursor = this.hitTest(this.toWorld(e)) ? 'default' : 'default';
        return;
      }
      if (d.kind === 'pan') {
        this.view.ox = d.ox + (e.clientX - d.sx);
        this.view.oy = d.oy + (e.clientY - d.sy);
        this.markDirty();
        return;
      }
      const p = this.toWorld(e);
      if (d.kind === 'create') {
        const n = d.node;
        n.x = Math.min(d.sx, p.x); n.y = Math.min(d.sy, p.y);
        n.w = Math.max(1, Math.abs(p.x - d.sx)); n.h = Math.max(1, Math.abs(p.y - d.sy));
        if (e.shiftKey) { n.w = n.h = Math.max(n.w, n.h); }
        if (n.shape) n.path = this._shapePath(n); // keep regular-shape path in sync
        this.markDirty();
      } else if (d.kind === 'move') {
        const dx = p.x - d.sx, dy = p.y - d.sy;
        if (Math.abs(dx) + Math.abs(dy) > 0.5) d.moved = true;
        let sdx = dx, sdy = dy;
        if (this.snapEnabled(e)) {
          const box = this._selBoxAt(d.starts, dx, dy);
          const r = this._snapBox(box, d.starts.map(s => s.id));
          if (r) { sdx = dx + r.dx; sdy = dy + r.dy; this._snapGuides = r.guides; }
          else this._snapGuides = null;
        } else this._snapGuides = null;
        for (const s of d.starts) {
          const n = this.page.nodes[s.id];
          if (!n) continue;
          n.x = s.x + sdx; n.y = s.y + sdy;
        }
        this.markDirty();
        this.statusPos();
      } else if (d.kind === 'resize') {
        this.doResize(d, e);
      } else if (d.kind === 'marquee') {
        const x = Math.min(d.sx, p.x), y = Math.min(d.sy, p.y);
        const w = Math.abs(p.x - d.sx), h = Math.abs(p.y - d.sy);
        this.marquee = this.toScreen({ x, y });
        this.marquee.w = w * this.view.zoom; this.marquee.h = h * this.view.zoom;
        // live selection preview
        const ids = marqueeSelect(this.page, { x, y, w, h });
        this._marqueePreview = e.altKey ? d.base.filter(id => !ids.includes(id)) : (d.base ? [...new Set([...d.base, ...ids])] : ids);
        this.sel = this._marqueePreview;
        this.markDirty();
      } else if (d.kind === 'pen-new' || d.kind === 'pen-node' || d.kind === 'pen-handle') {
        this.penDragMove(d, p);
      } else if (d.kind === 'pencil') {
        const last = this.pencil.pts[this.pencil.pts.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) > 1.2 / this.view.zoom) {
          this.pencil.pts.push(p);
          this.markDirty();
        }
      }
    },
    doResize(d, e) {
      const n = d.node;
      const z = this.view.zoom;
      const dx = (e.movementX) / z, dy = (e.movementY) / z;
      // accumulate from start
      const totalDx = (this.toWorld(e).x) - (d.sp.x / z + (this.view.ox - d.ox) / z);
      const totalDy = (this.toWorld(e).y) - (d.sp.y / z + (this.view.oy - d.oy) / z);
      let { x, y, w, h } = d.start;
      if (d.name.includes('e')) w = Math.max(4, d.start.w + totalDx);
      if (d.name.includes('s')) h = Math.max(4, d.start.h + totalDy);
      if (d.name.includes('w')) w = Math.max(4, d.start.w - totalDx);
      if (d.name.includes('n')) h = Math.max(4, d.start.h - totalDy);
      // Smart-guide snapping (same engine as move): only the moving edge of
      // the box plus its center line may snap — the fixed edge stays put.
      if (this.snapEnabled(e)) {
        const allow = {
          x: d.name.includes('e') ? ['right', 'cx'] : d.name.includes('w') ? ['left', 'cx'] : [],
          y: d.name.includes('s') ? ['bottom', 'cy'] : d.name.includes('n') ? ['top', 'cy'] : [],
        };
        const r = this._snapBox({ x, y, w, h }, [n.id], allow);
        if (r) {
          if (r.xs) {
            if (r.xs.side === 'right') w = Math.max(4, w + r.dx);
            else if (r.xs.side === 'left') w = Math.max(4, d.start.x + d.start.w - r.xs.val);
            else { const west = d.start.x, east = d.start.x + d.start.w; w = Math.max(4, d.name.includes('e') ? 2 * (r.xs.val - west) : 2 * (east - r.xs.val)); }
          }
          if (r.ys) {
            if (r.ys.side === 'bottom') h = Math.max(4, h + r.dy);
            else if (r.ys.side === 'top') h = Math.max(4, d.start.y + d.start.h - r.ys.val);
            else { const north = d.start.y, south = d.start.y + d.start.h; h = Math.max(4, d.name.includes('s') ? 2 * (r.ys.val - north) : 2 * (south - r.ys.val)); }
          }
          this._snapGuides = r.guides;
        } else this._snapGuides = null;
      }
      // west/north handles derive their origin from the new size — do it
      // AFTER snapping so a snapped left/top edge survives.
      if (d.name.includes('w')) x = d.start.x + d.start.w - w;
      if (d.name.includes('n')) y = d.start.y + d.start.h - h;
      if (e.shiftKey && d.name.length === 2) {
        const s = d.start.w / d.start.h;
        if (Math.abs(w / h - s) > 0.01) { h = w / s; }
      }
      if (n.type === 'text') {
        // Figma muscle memory: dragging a handle on a hugging axis fixes it
        if (d.name.includes('e') || d.name.includes('w')) M.textResizeDemote(n, 'h');
        if (d.name.includes('n') || d.name.includes('s')) M.textResizeDemote(n, 'v');
      }
      n.x = x; n.y = y; n.w = w; n.h = h;
      if (n.shape) n.path = this._shapePath(n); // regular shapes re-fit their bbox
      if (n.type === 'text') this.applyTextResize(n);
      this.markDirty();
      this.statusPos();
    },
    statusPos() {
      if (this.sel.length === 1) {
        const n = this.page.nodes[this.sel[0]];
        if (n) this.status(`x ${Math.round(n.x)}   y ${Math.round(n.y)}   w ${Math.round(n.w)}   h ${Math.round(n.h)}`);
      }
    },

    // =====================================================================
    // Rulers / line grid / smart guides + snapping (P0 UX closeout)
    //
    // While a move or resize drag is active, the moving box's edges and
    // center lines are compared against every other visible node's edges
    // and center lines (plus the page origin) on the same axis. A match
    // within `SNAP_TOL` screen px pulls the box to the exact alignment and
    // the match is drawn as a magenta smart-guide line (Figma behavior).
    // Alt bypasses snapping; in magnet mode snapping only happens while
    // Shift is held (Figma "Magnet mode").
    // =====================================================================
    SNAP_TOL: 6, // screen px
    snapEnabled(e) {
      if (!this.view || !this.view.snap) return false;
      if (e && e.altKey) return false;
      if (this.view.magnet && !(e && e.shiftKey)) return false;
      return true;
    },
    // Union bbox of a (tentatively) moved selection in world space.
    _selBoxAt(starts, dx, dy) {
      const page = this.page;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const s of starts) {
        const n = page.nodes[s.id];
        if (!n) continue;
        const L = n._l || { x: n.x, y: n.y, w: n.w, h: n.h };
        x0 = Math.min(x0, L.x + dx); y0 = Math.min(y0, L.y + dy);
        x1 = Math.max(x1, L.x + L.w + dx); y1 = Math.max(y1, L.y + L.h + dy);
      }
      if (!isFinite(x0)) return null;
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    },
    // Best alignment of `box` against the page's snap targets.
    // allow: {x: ['right','cx'] | [], y: [...]} — restrict which of the
    // box's own edges may snap (resize passes only its moving edge).
    // Returns {dx, dy, xs, ys, guides} or null. xs/ys: {side, val, dx}.
    _snapBox(box, excludeIds, allow) {
      if (!box) return null;
      const page = this.page;
      const tol = this.SNAP_TOL / this.view.zoom;
      const excl = new Set(excludeIds);
      const sub = (n) => { for (const cid of n.children) { const k = page.nodes[cid]; if (k) { excl.add(k.id); sub(k); } } };
      for (const id of excludeIds) { const n = page.nodes[id]; if (n) sub(n); }
      // page origin (0,0) is a snap anchor, Figma-style
      const xsT = [{ val: 0, side: 'left', y0: null, y1: null }];
      const ysT = [{ val: 0, side: 'top', x0: null, x1: null }];
      const visit = (n) => {
        if (excl.has(n.id)) return;
        const L = n._l;
        if (L && n.visible !== false && isFinite(L.x) && isFinite(L.w)) {
          xsT.push({ val: L.x, side: 'left', y0: L.y, y1: L.y + L.h });
          xsT.push({ val: L.x + L.w / 2, side: 'cx', y0: L.y, y1: L.y + L.h });
          xsT.push({ val: L.x + L.w, side: 'right', y0: L.y, y1: L.y + L.h });
          ysT.push({ val: L.y, side: 'top', x0: L.x, x1: L.x + L.w });
          ysT.push({ val: L.y + L.h / 2, side: 'cy', x0: L.x, x1: L.x + L.w });
          ysT.push({ val: L.y + L.h, side: 'bottom', x0: L.x, x1: L.x + L.w });
        }
        for (const cid of n.children) { const k = page.nodes[cid]; if (k) visit(k); }
      };
      for (const tid of page.tops) { const t = page.nodes[tid]; if (t) visit(t); }
      const rank = (s) => (s === 'cx' || s === 'cy') ? 0 : 1; // center wins ties
      const pick = (boxEdges, targets, axis) => {
        const sides = allow ? allow[axis] : null;
        let best = null;
        for (const be of boxEdges) {
          if (sides && !sides.includes(be.side)) continue;
          for (const t of targets) {
            const dist = Math.abs(t.val - be.val);
            if (dist > tol) continue;
            const score = dist + (rank(be.side) === 0 ? -1e-9 : 0);
            if (!best || score < best.score - 1e-12) best = { score, delta: t.val - be.val, side: be.side, val: t.val, t };
          }
        }
        return best;
      };
      const xs = pick(
        [{ val: box.x, side: 'left' }, { val: box.x + box.w / 2, side: 'cx' }, { val: box.x + box.w, side: 'right' }],
        xsT, 'x');
      const ys = pick(
        [{ val: box.y, side: 'top' }, { val: box.y + box.h / 2, side: 'cy' }, { val: box.y + box.h, side: 'bottom' }],
        ysT, 'y');
      if (!xs && !ys) return null;
      const guides = [];
      if (xs) {
        const from = xs.t.y0 == null ? box.y - 8 : Math.min(box.y, xs.t.y0) - 8;
        const to = xs.t.y0 == null ? box.y + box.h + 8 : Math.max(box.y + box.h, xs.t.y1) + 8;
        guides.push({ axis: 'x', at: xs.val, from, to });
      }
      if (ys) {
        const from = ys.t.x0 == null ? box.x - 8 : Math.min(box.x, ys.t.x0) - 8;
        const to = ys.t.x0 == null ? box.x + box.w + 8 : Math.max(box.x + box.w, ys.t.x1) + 8;
        guides.push({ axis: 'y', at: ys.val, from, to });
      }
      // NOTE: pick() is axis-agnostic, so the match carries `delta` — mapping
      // it to dx/dy happens exactly here (a previous version named it `dx`
      // for both axes, which made every vertical snap produce NaN).
      return { dx: xs ? xs.delta : 0, dy: ys ? ys.delta : 0, xs, ys, guides };
    },
    // View ▾ menu / command palette: rulers, line grid, snap, magnet mode.
    toggleView(k) {
      const v = this.view;
      if (k === 'rulers') v.rulers = !v.rulers;
      else if (k === 'snap') v.snap = !v.snap;
      else if (k === 'magnet') v.magnet = !v.magnet;
      else if (k === 'grid') v.grid = v.grid ? null : (v.gridSize || 10);
      this.markDirty();
    },
    onUp(e) {
      const d = this._drag;
      this._drag = null;
      this._snapGuides = null; // guides only exist mid-drag
      if (!d) return;
      if (d.kind === 'create') {
        const n = d.node;
        if (n.w < 3 && n.h < 3) { n.w = n.type === 'line' ? 100 : 100; n.h = n.type === 'line' ? 1 : 100; n.x -= n.w / 2; n.y -= n.h / 2; }
        if (n.shape) n.path = this._shapePath(n);
        this.setTool('move');
        this.markDirty();
        return;
      }
      if (d.kind === 'marquee') {
        this.marquee = null;
        delete this._marqueePreview;
        global.Panels.refreshInspector();
        this.markDirty();
        return;
      }
      if (d.kind === 'pencil') { this.pencilCommit(); return; }
      if (d.kind === 'pen-new' || d.kind === 'pen-node' || d.kind === 'pen-handle') { this.markDirty(); return; }
      if (d.kind === 'move' && d.moved) this.history.end(this.doc);
      else if (d.kind === 'resize') {
        // Figma constraints: manual-layout frames reposition children on resize
        const node = d.node;
        if ((node.type === 'frame' || node.type === 'instance') && !node.al) {
          global.Layout.applyConstraints(App.page, node, d.start.w, d.start.h);
        }
        this.history.end(this.doc);
      }
      else this.history.cancel();
      this.markDirty();
    },
    onDbl(e) {
      if (this.tool === 'pen' && this.pen) { this.penCommit(true); return; }
      const p = this.toWorld(e);
      const hit = this.hitTest(p);
      if (hit && hit.type === 'text') { this.setSel([hit.id]); this.beginTextEdit(hit); }
      else if (hit && hit.type === 'frame') { /* zoom into frame */ const b = hit._l; this.zoomToRect(b); }
    },

    // =====================================================================
    // Pen tool + node editor (spec §6)
    // =====================================================================
    _penTol() { return 8 / this.view.zoom; },
    _penNodes() {
      if (!this.pen) return null;
      return this.pen.kind === 'edit' ? this.pen.subpaths[this.pen.subIdx].nodes : this.pen.nodes;
    },
    _penClosed() {
      if (!this.pen) return false;
      return this.pen.kind === 'edit' ? this.pen.subpaths[this.pen.subIdx].closed : this.pen.closed;
    },
    penDown(p, e) {
      const P = global.Pen;
      const tol = this._penTol();
      if (!this.pen) {
        // fresh pen: clicking a vector → node-edit mode; empty space → new path
        const hit = this.hitTest(p);
        if (hit && hit.type === 'vector' && hit.path && !e.shiftKey) {
          this.history.begin(this.doc);
          const dn = P.dToNodes(hit.path);
          this.pen = { kind: 'edit', node: hit, subpaths: dn.subpaths.length ? dn.subpaths : [{ nodes: [], closed: false }], subIdx: 0, sel: -1, cursor: p };
          global.Panels.refreshInspector();
          this.status('Editing path nodes — Esc to finish, Enter/dbl-click to close, ⌫ to remove a node');
          return;
        }
        this.pen = { kind: 'draw', nodes: [], closed: false, sel: -1, cursor: p };
      } else if (this.pen.kind === 'edit' && this.pen.node) {
        // still editing: a click on a different vector switches the target
        const hit2 = this.hitTest(p);
        if (hit2 && hit2.type === 'vector' && hit2.id !== this.pen.node.id && hit2.path) {
          const dn = P.dToNodes(hit2.path);
          this.pen.node = hit2;
          this.pen.subpaths = dn.subpaths.length ? dn.subpaths : [{ nodes: [], closed: false }];
          this.pen.subIdx = 0; this.pen.sel = -1; this.pen.cursor = p;
          global.Panels.refreshInspector();
          return;
        }
      }
      const nodes = this._penNodes();
      if (!nodes) return;
      // edit mode: the target's subpath nodes live in the vector's LOCAL
      // space, so hit-test the cursor in local coords too
      if (this.pen.kind === 'edit') { const n0 = this.pen.node; p = { x: p.x - n0.x, y: p.y - n0.y }; }
      // 1) handle of the selected node
      if (this.pen.sel >= 0 && nodes[this.pen.sel]) {
        const h = P.handleAt(nodes, p, tol);
        if (h) { this._drag = { kind: 'pen-handle', i: h.i, side: h.side }; return; }
      }
      // 2) existing node
      const ni = P.nodeAt(nodes, p, tol);
      if (ni >= 0) {
        if (ni === 0 && nodes.length >= 2) { this.penCommit(true); return; } // click first point = close
        this.pen.sel = ni;
        this._drag = { kind: 'pen-node', i: ni, ox: p.x - nodes[ni].x, oy: p.y - nodes[ni].y };
        global.Panels.refreshInspector();
        this.markDirty();
        return;
      }
      // 3) segment → insert a node on it
      const sp = P.segPointAt(nodes, p, this._penClosed());
      if (sp && sp.dist <= tol) {
        const at = sp.i === -1 ? nodes.length - 1 : sp.i + 1;
        P.insertAt(nodes, at, sp.point);
        this.pen.sel = at;
        this._drag = { kind: 'pen-node', i: at, ox: 0, oy: 0 };
        global.Panels.refreshInspector();
        this.markDirty();
        return;
      }
      // 4) start a new point (corner; drag → smooth with mirrored handles)
      if (this.pen.kind === 'edit') { this.status('Editing another subpath? Click a point on this path — Esc to finish'); this.pen.cursor = p; this.markDirty(); return; }
      const n = P.cornerNode(p.x, p.y);
      nodes.push(n);
      this.pen.sel = nodes.length - 1;
      this._drag = { kind: 'pen-new', i: nodes.length - 1, moved: false };
      this.pen.cursor = p;
      global.Panels.refreshInspector();
      this.markDirty();
    },
    penDragMove(d, p) {
      const P = global.Pen;
      const nodes = this._penNodes();
      if (!nodes || !nodes[d.i]) return;
      // node ops run in the nodes' own space (local for edit mode); the
      // cursor always stays in world space for the overlay
      let lp = p;
      if (this.pen.kind === 'edit' && this.pen.node) { const n0 = this.pen.node; lp = { x: p.x - n0.x, y: p.y - n0.y }; }
      if (d.kind === 'pen-new') {
        const n = nodes[d.i];
        const dx = lp.x - n.x, dy = lp.y - n.y;
        if (Math.hypot(dx, dy) > 2 / this.view.zoom) {
          n.type = 'smooth';
          n.htx = dx; n.hty = dy;     // incoming handle follows the drag
          n.hsx = -dx; n.hsy = -dy;   // mirrored outgoing
        } else if (n.type === 'smooth') {
          n.type = 'corner'; n.hsx = n.hsy = n.htx = n.hty = null;
        }
      } else if (d.kind === 'pen-node') {
        const n = nodes[d.i];
        n.x = lp.x - d.ox; n.y = lp.y - d.oy;
      } else if (d.kind === 'pen-handle') {
        const n = nodes[d.i];
        if (d.side === 'out') { n.type = 'smooth'; n.hsx = lp.x - n.x; n.hsy = lp.y - n.y; }
        else { n.type = 'smooth'; n.htx = lp.x - n.x; n.hty = lp.y - n.y; }
      }
      this.pen.cursor = p;
      this.markDirty();
    },
    penCommit(closed, opts = {}) {
      const P = global.Pen;
      if (!this.pen) return;
      const st = this.pen;
      this.pen = null;
      const finishHistory = () => { this.history.end(this.doc); };
      if (st.kind === 'edit') {
        if (st.node && this.page.nodes[st.node.id]) {
          if (closed && st.subpaths.length === 1) st.subpaths[0].closed = true;
          // subpath nodes are LOCAL to st.node.x/y — compute the new local
          // bbox, renormalize the nodes, and re-anchor the world origin
          // (old origin + new local min), never the raw local min.
          const X = st.node.x, Y = st.node.y;
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          for (const sp of st.subpaths) for (const n of sp.nodes) {
            x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x); y1 = Math.max(y1, n.y);
            if (P.hasOut(n)) { x0 = Math.min(x0, n.x + n.hsx); y0 = Math.min(y0, n.y + n.hsy); x1 = Math.max(x1, n.x + n.hsx); y1 = Math.max(y1, n.y + n.hsy); }
            if (P.hasIn(n)) { x0 = Math.min(x0, n.x + n.htx); y0 = Math.min(y0, n.y + n.hty); x1 = Math.max(x1, n.x + n.htx); y1 = Math.max(y1, n.y + n.hty); }
          }
          if (isFinite(x0)) {
            let dl = '';
            for (const sp of st.subpaths) {
              if (!sp.nodes.length) continue;
              for (const n of sp.nodes) { n.x -= x0; n.y -= y0; }
              dl += (dl ? ' ' : '') + P.nodesToD(sp.nodes, sp.closed);
            }
            st.node.path = dl;
            st.node.x = X + x0; st.node.y = Y + y0;
            st.node.w = Math.max(0.01, x1 - x0); st.node.h = Math.max(0.01, y1 - y0);
          }
        }
        finishHistory();
        if (!opts.silent) this.setTool('move');
        this.sel = st.node && this.page.nodes[st.node.id] ? [st.node.id] : this.sel;
        global.Panels.refreshInspector();
        this.markDirty();
        return;
      }
      // kind: draw
      const nodes = st.nodes;
      if (nodes.length < 2) {
        if (!opts.silent) this.status('Pen: click for the first point, then click again');
        return;
      }
      const fields = P.subpathToNodeFields({ nodes, closed: !!closed });
      this.history.begin(this.doc);
      const n = M.makeNode('vector', Object.assign({ name: 'Vector', fills: [{ type: 'solid', color: '#111111', opacity: 1, token: null }] }, fields));
      M.attach(this.doc, this.page, null, n);
      finishHistory();
      this.sel = [n.id];
      this.status(closed ? 'Path closed' : 'Path open — P to keep drawing, Esc to leave the pen');
      global.Panels.refreshInspector();
      this.markDirty();
    },
    penEscape() {
      const P = global.Pen;
      if (!this.pen) return false;
      const st = this.pen;
      if (st.kind === 'draw') {
        if (st.nodes.length >= 2) { this.penCommit(false); }
        else { this.pen = null; this.status(''); }
      } else {
        this.penCommit(false);
      }
      return true;
    },
    penKey(e) {
      const P = global.Pen;
      if (!this.pen) return false;
      const st = this.pen;
      if (e.key === 'Enter') { e.preventDefault(); this.penCommit(true); return true; }
      if (e.key === 'Escape') { e.preventDefault(); this.penEscape(); return true; }
      if (e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
        const nodes = this._penNodes();
        if (!nodes) return true;
        if (st.sel >= 0 && nodes[st.sel]) {
          if (P.removeAt(nodes, st.sel, this._penClosed())) st.sel = -1;
          this.markDirty();
        } else if (st.kind === 'draw' && nodes.length) {
          nodes.pop(); st.sel = -1; this.markDirty();
        }
        return true;
      }
      return false;
    },
    // pencil (freehand, spec §6): capture → RDP simplify → smoothed vector
    pencilAbort() { this.pencil = null; this.markDirty(); },
    pencilCommit() {
      const P = global.Pen;
      const pts = this.pencil ? this.pencil.pts : [];
      this.pencil = null;
      if (pts.length < 2) { this.markDirty(); return; }
      const simp = P.rdp(pts, 1.0 / this.view.zoom);
      if (simp.length < 2) { this.markDirty(); return; }
      const nodes = simp.map(pt => P.cornerNode(pt.x, pt.y));
      const bb = P.bboxOf(nodes);
      const local = nodes.map(n => ({ x: n.x - bb.x, y: n.y - bb.y }));
      this.history.begin(this.doc);
      const n = M.makeNode('vector', { x: bb.x, y: bb.y, w: Math.max(1, bb.w), h: Math.max(1, bb.h), name: 'Pencil' });
      n.path = P.smoothD(local);
      n.fills = [];
      n.stroke = { color: '#111111', width: 2, opacity: 1, align: 'center' };
      M.attach(this.doc, this.page, null, n);
      this.history.end(this.doc);
      this.sel = [n.id];
      global.Panels.refreshInspector();
      this.markDirty();
    },
    drawPenOverlay(ctx) {
      const P = global.Pen;
      if (this.pen && this._penNodes() && this._penNodes().length) {
        ctx.save();
        ctx.translate(this.view.ox, this.view.oy);
        ctx.scale(this.view.zoom, this.view.zoom);
        const z = this.view.zoom;
      const n0 = this.pen.kind === 'edit' ? this.pen.node : null;
      if (n0) ctx.translate(n0.x, n0.y); // edit mode: subpath nodes are local to the vector
      const nodes = this._penNodes();
      const closed = this._penClosed();
      // in-progress path
      const d = P.nodesToD(nodes, closed);
      if (d) {
        try {
          const path = new Path2D(d);
          ctx.setLineDash([4 / z, 3 / z]);
          ctx.strokeStyle = '#0d99ff';
          ctx.lineWidth = 1.2 / z;
          ctx.stroke(path);
          ctx.setLineDash([]);
        } catch (e) { }
      }
      // rubber band: from the last placed (or selected) node to the cursor
      // (the cursor is stored in world space; convert for edit mode)
      const cur = this.pen.cursor ? (n0 ? { x: this.pen.cursor.x - n0.x, y: this.pen.cursor.y - n0.y } : this.pen.cursor) : null;
        if (cur) {
          const src = this.pen.sel >= 0 && nodes[this.pen.sel] ? nodes[this.pen.sel] : nodes[nodes.length - 1];
          ctx.beginPath();
          ctx.moveTo(src.x, src.y);
          ctx.lineTo(cur.x, cur.y);
          ctx.strokeStyle = 'rgba(13,153,255,0.55)';
          ctx.lineWidth = 1 / z;
          ctx.stroke();
        }
        // handles + nodes
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i];
          if (P.hasOut(n)) {
            ctx.beginPath(); ctx.moveTo(n.x, n.y); ctx.lineTo(n.x + n.hsx, n.y + n.hsy);
            ctx.strokeStyle = '#0d99ff'; ctx.lineWidth = 1 / z; ctx.stroke();
            ctx.beginPath(); ctx.arc(n.x + n.hsx, n.y + n.hsy, 3.5 / z, 0, Math.PI * 2);
            ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke();
          }
          if (P.hasIn(n)) {
            ctx.beginPath(); ctx.moveTo(n.x, n.y); ctx.lineTo(n.x + n.htx, n.y + n.hty);
            ctx.strokeStyle = '#0d99ff'; ctx.lineWidth = 1 / z; ctx.stroke();
            ctx.beginPath(); ctx.arc(n.x + n.htx, n.y + n.hty, 3.5 / z, 0, Math.PI * 2);
            ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke();
          }
        }
        for (let i = 0; i < nodes.length; i++) {
          const n = nodes[i];
          const sel = this.pen.sel === i;
          const s = (sel ? 5 : 3.5) / z;
          ctx.fillStyle = sel ? '#0d99ff' : '#fff';
          ctx.strokeStyle = '#0d99ff';
          ctx.lineWidth = 1.2 / z;
          ctx.fillRect(n.x - s, n.y - s, s * 2, s * 2);
          ctx.strokeRect(n.x - s, n.y - s, s * 2, s * 2);
        }
        ctx.restore();
      }
      // pencil stroke preview
      if (this.pencil && this.pencil.pts.length > 1) {
        ctx.save();
        ctx.translate(this.view.ox, this.view.oy);
        ctx.scale(this.view.zoom, this.view.zoom);
        const z = this.view.zoom;
        ctx.beginPath();
        this.pencil.pts.forEach((pt, i) => i ? ctx.lineTo(pt.x, pt.y) : ctx.moveTo(pt.x, pt.y));
        ctx.strokeStyle = '#111111';
        ctx.lineWidth = 2 / z;
        ctx.stroke();
        ctx.restore();
      }
    },
    drawEmptyState(ctx) {
      if (!this.page) return;
      let count = 0;
      const visit = (id) => { const n = this.page.nodes[id]; if (!n) return; if (n.visible !== false) count++; for (const c of n.children) visit(c); };
      for (const t of this.page.tops) visit(t);
      if (count || this.pen || this.pencil) return;
      const rect = this.canvas.getBoundingClientRect();
      const cx = rect.width / 2, cy = rect.height / 2;
      ctx.save();
      ctx.fillStyle = 'rgba(120,120,130,0.55)';
      ctx.textAlign = 'center';
      ctx.font = '600 20px Inter, "Helvetica Neue", Arial, sans-serif';
      ctx.fillText('Start designing', cx, cy - 24);
      ctx.font = '13px Inter, "Helvetica Neue", Arial, sans-serif';
      ctx.fillStyle = 'rgba(120,120,130,0.45)';
      ctx.fillText('F  Frame      R  Rectangle      T  Text      P  Pen      N  Pencil', cx, cy + 6);
      ctx.fillText('Or import a Figma file (⌘S saves; ⌘/ runs a command)', cx, cy + 26);
      ctx.restore();
    },

    // ------------------------------------------------------------- text editing
    _textEdit: null,
    beginTextEdit(n) {
      this.endTextEdit();
      const wrap = document.querySelector('.ed-canvas-wrap');
      const ta = document.createElement('textarea');
      ta.className = 'text-edit';
      ta.value = n.text.content;
      const s = this.toScreen({ x: n._l ? n._l.x : n.x, y: n._l ? n._l.y : n.y });
      const L = n._l || { x: n.x, y: n.y, w: n.w, h: n.h };
      Object.assign(ta.style, {
        left: s.x + 'px', top: s.y + 'px',
        width: Math.max(60, L.w * this.view.zoom) + 'px',
        height: Math.max(28, L.h * this.view.zoom) + 'px',
        fontSize: n.text.size * this.view.zoom + 'px',
        fontWeight: n.text.weight,
        fontStyle: n.text.italic ? 'italic' : 'normal',
        lineHeight: String(n.text.lineHeight || 1.2),
        textAlign: n.text.align,
        color: (n.fills[0] && n.fills[0].color) || '#1e1e1e',
      });
      wrap.appendChild(ta);
      try { ta.focus(); } catch (e) { }
      if (ta.select) ta.select();
      this._textEdit = { n, ta };
      const commit = (ok) => {
        if (ok && this._textEdit) {
          this.history.begin(this.doc);
          n.text.content = ta.value || ' ';
          this.applyTextResize(n); // re-fit per auto-resize mode
          this.history.end(this.doc);
        }
        this.endTextEdit();
        this.markDirty();
      };
      ta.addEventListener('blur', () => commit(true));
      ta.addEventListener('keydown', (ev) => {
        ev.stopPropagation();
        if (ev.key === 'Escape') { ev.preventDefault(); commit(false); }
        if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); commit(true); }
      });
    },
    endTextEdit() {
      if (this._textEdit) { this._textEdit.ta.remove(); this._textEdit = null; }
    },

    // ------------------------------------------------------------- wheel / zoom
    onWheel(e) {
      const rect = this.canvas.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      if (e.ctrlKey || e.metaKey) {
        const f = Math.exp(-e.deltaY * 0.0022);
        this.zoomAt(px, py, f);
      } else {
        this.view.ox -= e.shiftKey ? e.deltaY : e.deltaX;
        this.view.oy -= e.shiftKey ? 0 : e.deltaY;
        this.markDirty();
      }
    },
    zoomAt(px, py, factor) {
      const z0 = this.view.zoom;
      const z1 = Math.max(0.04, Math.min(24, z0 * factor));
      const f = z1 / z0;
      this.view.ox = px - (px - this.view.ox) * f;
      this.view.oy = py - (py - this.view.oy) * f;
      this.view.zoom = z1;
      this.markDirty();
    },
    zoomBy(f) {
      const rect = this.canvas.getBoundingClientRect();
      this.zoomAt(rect.width / 2, rect.height / 2, f);
    },
    zoomToFit() {
      const b = R.pageBounds(this.page);
      const rect = this.canvas.getBoundingClientRect();
      const z = Math.min(3, Math.min((rect.width - 80) / Math.max(1, b.w), (rect.height - 80) / Math.max(1, b.h)));
      this.view.zoom = Math.max(0.04, z);
      this.view.ox = (rect.width - b.w * this.view.zoom) / 2 - b.x * this.view.zoom;
      this.view.oy = (rect.height - b.h * this.view.zoom) / 2 - b.y * this.view.zoom;
      this.markDirty();
    },
    zoomToRect(b) {
      const rect = this.canvas.getBoundingClientRect();
      const z = Math.min(4, Math.min((rect.width - 80) / Math.max(1, b.w), (rect.height - 80) / Math.max(1, b.h)));
      this.view.zoom = z;
      this.view.ox = (rect.width - b.w * z) / 2 - b.x * z;
      this.view.oy = (rect.height - b.h * z) / 2 - b.y * z;
      this.markDirty();
    },

    // ------------------------------------------------------------- tools
    setTool(t) {
      if (this.tool === t) { this._penCleanup(); return; } // re-pressing a tool button resets its state
      // leaving the pen/pencil tools: commit in-progress work
      if (this.tool === 'pen') this.penCommit(false, { silent: true });
      if (this.tool === 'pencil' && this.pencil) this.pencilAbort();
      this.tool = t;
      const tb = document.getElementById('ed-toolbar');
      if (tb) tb.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
      if (this.canvas) this.canvas.style.cursor = t === 'move' ? 'default' : t === 'text' ? 'text' : t === 'hand' ? 'grab' : 'crosshair';
      global.Panels.refreshInspector();
      this.markDirty();
    },
    // clear transient pen state (called on file switch / tool reset)
    _penCleanup() {
      if (this.tool === 'pen') this.penCommit(false, { silent: true });
      this.pen = null; this.pencil = null;
    },

    // ------------------------------------------------------------- keyboard
    // Dispatch is driven by the central shortcut registry (spec §5,
    // src/shortcuts.js): one table powers dispatch, the shortcuts modal, and
    // conflict detection. The pen state machine gets priority (spec §6).
    onKey(e) {
      const typing = /INPUT|TEXTAREA|SELECT/.test((e.target.tagName || ''));
      if (typing) {
        if (e.key === 'Escape') e.target.blur();
        return;
      }
      if (this._paletteEl) { this.paletteKey(e); return; }
      if (this.doc && document.getElementById('view-editor').style.display !== 'none') {
        if (this.penKey(e)) return;
        const b = global.Shortcuts.dispatch(e, this);
        if (b && b.keys !== 'space') e.preventDefault();
      } else if (e.key === 'Escape') {
        this.goDashboard();
      }
    },
    // ---- registry action wrappers (keep the exact behavior of the old
    // inline bindings; preventDefault lives here, not in the table)
    spaceDown(e) {
      if (!this.space) { this.space = true; if (this.canvas) this.canvas.style.cursor = 'grab'; }
      if (e) e.preventDefault();
    },
    historyUndo() {
      if (this.history.undo(this.doc)) { this.sel = []; this.markDirty(); global.Panels.refreshInspector(); }
    },
    historyRedo() {
      if (this.history.redo(this.doc)) { this.sel = []; this.markDirty(); }
    },
    selectAll() { this.setSel(this.page.tops.slice()); },
    nudge(dx, dy, e) {
      if (!this.sel.length) return;
      const step = e && e.shiftKey ? 10 : 1;
      this.history.begin(this.doc);
      for (const id of this.sel) {
        const n = this.page.nodes[id];
        if (!n) continue;
        n.x += dx * step; n.y += dy * step;
      }
      this.history.end(this.doc);
      this.markDirty();
    },
    zoomTo100() { const r = this.canvas.getBoundingClientRect(); this.zoomAt(r.width / 2, r.height / 2, 1 / this.view.zoom); },
    zoomToSelection() {
      if (!this.sel.length) { this.toast('Nothing selected to zoom to'); return; }
      const b = R.selectionBounds(this.page, this.sel);
      if (b) this.zoomToRect(b);
    },
    openExport() { global.Panels.exportMenu(null, null); },
    openVersions() { global.Panels.versionsMenu(null, null); },
    showShortcutsModal() { global.Panels.shortcutsModal(); },
    // Figma does the same: ⌘/ toggles mask when the selection is maskable,
    // otherwise it opens the quick-actions (command) palette.
    maskOrPalette() {
      const selNodes = this.sel.map(id => this.page.nodes[id]).filter(Boolean);
      const maskable = selNodes.filter(n => n.type !== 'text' && n.type !== 'group' && !n.isComponent);
      if (selNodes.length && maskable.length === selNodes.length) this.toggleMask();
      else this.palette();
    },
    escapeAction() {
      if (this._paletteEl) { this.paletteClose(); return; }
      if (this.pen) { this.penEscape(); return; }
      this.endTextEdit();
      this.sel = [];
      this.setTool('move');
      global.Panels.refreshInspector();
      this.markDirty();
    },
    cycleSel(dir) {
      const tops = this.page.tops.filter(id => this.page.nodes[id]);
      if (!tops.length) return;
      const i = this.sel.length === 1 ? tops.indexOf(this.sel[0]) : -1;
      this.setSel([tops[(i + dir + tops.length) % tops.length]]);
      this.markDirty();
    },

    // ------------------------------------------------------------- command palette (⌘/)
    _paletteCommands() {
      const A = this;
      return [
        { label: 'Frame', hint: 'F', kw: 'create new canvas', run: () => A.setTool('frame') },
        { label: 'Section', hint: 'S', kw: 'create group section', run: () => A.setTool('section') },
        { label: 'Rectangle', hint: 'R', kw: 'create shape box', run: () => A.setTool('rect') },
        { label: 'Ellipse', hint: 'O', kw: 'create shape circle', run: () => A.setTool('ellipse') },
        { label: 'Line', hint: 'L', kw: 'create', run: () => A.setTool('line') },
        { label: 'Arrow', hint: 'A', kw: 'create', run: () => A.setTool('arrow') },
        { label: 'Pen', hint: 'P', kw: 'vector bezier path draw', run: () => A.setTool('pen') },
        { label: 'Pencil', hint: 'N', kw: 'freehand draw sketch', run: () => A.setTool('pencil') },
        { label: 'Polygon', hint: '', kw: 'create shape hexagon regular sides', run: () => A.setTool('polygon') },
        { label: 'Star', hint: '', kw: 'create shape points burst', run: () => A.setTool('star') },
        { label: 'Triangle', hint: '', kw: 'create shape 3 sides', run: () => A.setTool('triangle') },
        { label: 'Text', hint: 'T', kw: 'create typography label', run: () => A.setTool('text') },
        { label: 'Zoom to fit', hint: '⇧1', kw: 'view 0', run: () => A.zoomToFit() },
        { label: 'Zoom to selection', hint: '⇧2', kw: 'view', run: () => A.zoomToSelection() },
        { label: 'Zoom to 100%', hint: '1', kw: 'view', run: () => A.zoomTo100() },
        { label: 'Toggle Dev Mode', hint: 'D', kw: 'inspect code', run: () => A.toggleDevMode() },
        { label: 'Present', hint: '⇧K', kw: 'prototype preview play', run: () => A.startPresent() },
        { label: 'Export…', hint: '⌘E', kw: 'png svg pdf fig', run: () => A.openExport() },
        { label: 'Save', hint: '⌘S', kw: '', run: () => { A.saveNow(); A.toast('Saved'); } },
        { label: 'Undo', hint: '⌘Z', kw: 'back', run: () => A.historyUndo() },
        { label: 'Redo', hint: '⇧⌘Z', kw: 'forward', run: () => A.historyRedo() },
        { label: 'Select all', hint: '⌘A', kw: '', run: () => A.selectAll() },
        { label: 'Group selection', hint: '⌘G', kw: '', run: () => A.groupSel() },
        { label: 'Ungroup selection', hint: '⇧⌘G', kw: '', run: () => A.ungroup() },
        { label: 'Duplicate selection', hint: '⌘D', kw: 'copy', run: () => A.duplicateSel() },
        { label: 'Union (selection)', hint: '⌘]', kw: 'boolean vector combine merge', run: () => A.booleanSel('union') },
        { label: 'Subtract (selection)', hint: '⌘[', kw: 'boolean vector cut remove', run: () => A.booleanSel('subtract') },
        { label: 'Intersect (selection)', hint: '⌘\\', kw: 'boolean vector overlap common', run: () => A.booleanSel('intersect') },
        { label: 'Exclude (selection)', hint: '⇧⌘\\', kw: 'boolean vector symmetric difference', run: () => A.booleanSel('exclude') },
        { label: 'Flatten (selection)', hint: '⇧⌘F', kw: 'vector merge single path', run: () => A.flattenSel() },
        { label: 'Outline stroke (selection)', hint: '', kw: 'vector stroke to fill convert', run: () => A.outlineStrokeSel() },
        { label: 'Make component (selection)', hint: '', kw: 'component create', run: () => {
          const n = A.sel.length === 1 ? A.page.nodes[A.sel[0]] : null;
          if (n && n.type === 'frame') { A.history.begin(A.doc); global.Components.makeComponent(A.doc, A.page, n.id, n.name); A.history.end(A.doc); A.markDirty(); A.toast('Component created'); }
          else A.toast('Select a single frame to make a component');
        } },
        { label: 'Add auto layout (selection)', hint: '', kw: 'layout', run: () => {
          const n = A.sel.length === 1 ? A.page.nodes[A.sel[0]] : null;
          if (n && n.type === 'frame') {
            if (n.al) { A.history.begin(A.doc); M.removeAutoLayout(n, A.page); A.history.end(A.doc); }
            else { A.history.begin(A.doc); M.makeAutoLayout(n, 'v', A.page); A.history.end(A.doc); }
            A.markDirty();
          } else A.toast('Select a single frame for auto layout');
        } },
        { label: 'Create variable', hint: '', kw: 'token mode', run: () => {
          const ed = document.getElementById('view-editor');
          if (ed) ed.querySelector('[data-tab="vars"]').click();
        } },
        { label: 'Versions', hint: '⌘K', kw: 'history', run: () => A.openVersions() },
        { label: 'Show rulers', hint: '', kw: 'view top left scale measurements px', run: () => A.toggleView('rulers') },
        { label: 'Show grid', hint: '', kw: 'view background lines spacing 10 20 50', run: () => A.toggleView('grid') },
        { label: 'Snap on / off', hint: '', kw: 'view smart guides alignment magnet objects', run: () => A.toggleView('snap') },
        { label: 'Magnet mode', hint: '', kw: 'view snap shift hold only', run: () => A.toggleView('magnet') },
        { label: 'Shortcuts reference', hint: '?', kw: 'keys help', run: () => A.showShortcutsModal() },
        { label: 'Deselect', hint: 'Esc', kw: '', run: () => { A.sel = []; A.markDirty(); } },
      ];
    },
    palette() {
      if (this._paletteEl) { this.paletteClose(); return; }
      const el = document.createElement('div');
      el.className = 'pf-palette-back';
      el.innerHTML = '<div class="pf-palette"><input type="text" class="pf-palette-in" placeholder="Type a command…  (↑↓ to navigate, ⏎ to run, Esc to close)"><ul class="pf-palette-list"></ul></div>';
      document.body.appendChild(el);
      this._paletteEl = el;
      this._paletteQ = '';
      this._paletteIdx = 0;
      const inp = el.querySelector('input');
      const render = () => {
        const q = this._paletteQ.trim().toLowerCase();
        const all = this._paletteCommands();
        const scored = all.map(c => {
          const hay = (c.label + ' ' + (c.kw || '')).toLowerCase();
          if (!q) return { c, s: 0 };
          if (c.label.toLowerCase().startsWith(q)) return { c, s: 1 };
          if (hay.includes(q)) return { c, s: 2 };
          // subsequence match (fuzzy)
          let i = 0;
          for (const ch of hay) if (ch === q[i]) i++;
          if (i >= q.length) return { c, s: 3 };
          return null;
        }).filter(Boolean).sort((a, b) => a.s - b.s || a.c.label.localeCompare(b.c.label));
        const top = scored.slice(0, 9);
        this._paletteList = top.map(t => t.c);
        this._paletteIdx = Math.min(this._paletteIdx, Math.max(0, top.length - 1));
        el.querySelector('ul').innerHTML = top.map((t, i) =>
          `<li class="${i === this._paletteIdx ? 'active' : ''}" data-i="${i}">${M.esc ? M.esc(t.c.label) : t.c.label}${t.c.hint ? `<span class="pf-pal-hint">${t.c.hint}</span>` : ''}</li>`).join('') || '<li class="none">No matching commands</li>';
        el.querySelectorAll('li[data-i]').forEach(li => {
          li.addEventListener('mousedown', (ev) => { ev.preventDefault(); const c = this._paletteList[+li.dataset.i]; this.paletteClose(); c.run(); });
          li.addEventListener('mousemove', () => {
            this._paletteIdx = +li.dataset.i;
            el.querySelectorAll('li[data-i]').forEach(x => x.classList.toggle('active', +x.dataset.i === this._paletteIdx));
          });
        });
      };
      inp.addEventListener('input', () => { this._paletteQ = inp.value; this._paletteIdx = 0; render(); });
      render();
      setTimeout(() => inp.focus(), 0);
    },
    paletteKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); this.paletteClose(); return; }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = (this._paletteList || []).length;
        this._paletteIdx = e.key === 'ArrowDown' ? Math.min(n - 1, this._paletteIdx + 1) : Math.max(0, this._paletteIdx - 1);
        if (this._paletteEl) this._paletteEl.querySelectorAll('li[data-i]').forEach(x => x.classList.toggle('active', +x.dataset.i === this._paletteIdx));
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const c = (this._paletteList || [])[this._paletteIdx];
        this.paletteClose();
        if (c) c.run();
      }
    },
    paletteClose() {
      if (this._paletteEl) { this._paletteEl.remove(); this._paletteEl = null; }
    },

    // ---- text auto-resize (Figma's 4 modes) ----
    // measure via the renderer when a canvas context exists; headless
    // environments (null 2d context) fall back to leaving the size alone.
    applyTextResize(n) {
      const meas = (nn, boxW) => {
        try {
          return global.Renderer ? global.Renderer.measureText(nn, boxW) : { w: nn.w, h: nn.h };
        } catch (e) { return { w: nn.w, h: nn.h }; }
      };
      M.applyTextResize(n, meas);
    },
    setTextBoxResize(n, mode) {
      this.history.begin(this.doc);
      n.text.resize = mode;
      M.applyTextResize(n, (nn, boxW) => {
        try { return global.Renderer.measureText(nn, boxW); } catch (e) { return { w: nn.w, h: nn.h }; }
      });
      this.history.end(this.doc);
      this.markDirty();
    },

    // =====================================================================
    // Vector booleans / flatten / outline stroke (spec §7–8)
    // Real geometry via the Booleans engine (src/boolean.js): paths are
    // flattened to polylines, split at every intersection, region parity
    // keeps true boundary edges — not a visual/raster hack.
    // =====================================================================
    _shapePath(n) {
      return global.Booleans.shapeD(n.shape === 'star' ? 'star' : 'polygon', n.verts, n.w, n.h);
    },
    _selVectors() {
      const out = [];
      if (!this.page) return out;
      for (const id of this.sel) {
        const n = this.page.nodes[id];
        if (n && n.type === 'vector' && n.path) out.push(n);
      }
      return out;
    },
    booleanSel(op) {
      const names = { union: 'Union', subtract: 'Subtract', intersect: 'Intersect', exclude: 'Exclude' };
      const nodes = this._selVectors();
      if (nodes.length < 2) {
        this.toast(op === 'subtract'
          ? 'Subtract: select 2+ vectors (first selected = front, minus the rest)'
          : 'Boolean: select 2+ vector shapes first');
        return;
      }
      this.history.begin(this.doc);
      const items = nodes.map(n => ({ d: n.path, rule: n.windingRule || 'evenodd', x: n.x, y: n.y }));
      const world = global.Booleans.combine(op, items);
      if (!world) { this.history.cancel(); this.toast('Boolean result is empty'); return; }
      const bb = global.FigIO.pathBBox(world);
      const src = nodes[0];
      const n = M.makeNode('vector', { x: bb.x, y: bb.y, w: bb.w, h: bb.h, name: names[op] });
      n.path = global.Booleans.translateD(world, -bb.x, -bb.y);
      n.windingRule = 'evenodd';
      if (src.fills && src.fills.length) n.fills = JSON.parse(JSON.stringify(src.fills));
      if (src.stroke) n.stroke = JSON.parse(JSON.stringify(src.stroke));
      for (const k of nodes) M.detach(this.page, k);
      M.attach(this.doc, this.page, null, n);
      this.history.end(this.doc);
      this.sel = [n.id];
      this.markDirty();
      this.toast(names[op] + ' — ' + Math.round(bb.w) + '×' + Math.round(bb.h));
    },
    flattenSel() {
      const nodes = this._selVectors();
      if (!nodes.length) { this.toast('Flatten: select 1+ vector shapes first'); return; }
      this.history.begin(this.doc);
      const items = nodes.map(n => ({ d: n.path, x: n.x, y: n.y }));
      const world = global.Booleans.flatten(items);
      const bb = global.FigIO.pathBBox(world);
      const src = nodes[0];
      const n = M.makeNode('vector', { x: bb.x, y: bb.y, w: bb.w, h: bb.h, name: 'Flattened' });
      n.path = global.Booleans.translateD(world, -bb.x, -bb.y);
      n.windingRule = 'evenodd';
      if (src.fills && src.fills.length) n.fills = JSON.parse(JSON.stringify(src.fills));
      if (src.stroke) n.stroke = JSON.parse(JSON.stringify(src.stroke));
      for (const k of nodes) M.detach(this.page, k);
      M.attach(this.doc, this.page, null, n);
      this.history.end(this.doc);
      this.sel = [n.id];
      this.markDirty();
      this.toast('Flattened ' + nodes.length + (nodes.length > 1 ? ' shapes' : ' shape'));
    },
    outlineStrokeSel() {
      const nodes = this._selVectors();
      if (!nodes.length) { this.toast('Outline stroke: select 1+ vector shapes first'); return; }
      const usable = nodes.filter(n => n.stroke && n.stroke.width > 0 && n.stroke.visible !== false);
      if (!usable.length) { this.toast('Outline stroke: selection has no visible stroke'); return; }
      this.history.begin(this.doc);
      const ids = [];
      for (const src of usable) {
        const world = global.Booleans.outlineStroke(src.path, src.stroke.width, src.stroke.align || 'inside');
        if (!world) continue; // no closed subpaths (or zero stroke) — nothing to outline
        const bb = global.FigIO.pathBBox(world);
        const n = M.makeNode('vector', { x: bb.x, y: bb.y, w: bb.w, h: bb.h, name: (src.name || 'Outline') + ' outline' });
        n.path = global.Booleans.translateD(world, -bb.x, -bb.y);
        n.windingRule = 'evenodd';
        n.fills = [{ type: 'solid', color: src.stroke.color || '#000000', opacity: src.stroke.opacity != null ? src.stroke.opacity : 1, token: null }];
        n.stroke = null; // the stroke became the fill
        M.detach(this.page, src);
        M.attach(this.doc, this.page, null, n);
        ids.push(n.id);
      }
      this.history.end(this.doc);
      if (!ids.length) { this.toast('Outline stroke: nothing outlined (open subpaths have no fill to outline)'); return; }
      this.sel = ids;
      this.markDirty();
      this.toast('Outlined ' + ids.length + (ids.length > 1 ? ' shapes' : ' shape'));
    },

    // ------------------------------------------------------------- clipboard / ops
    copySel(cut) {
      if (!this.sel.length) return;
      const page = this.page;
      const nodes = this.sel.map(id => page.nodes[id]).filter(Boolean);
      // include subtrees, keep relative geometry
      const ids = new Set();
      const collect = (n) => { ids.add(n.id); for (const cid of n.children) { const c = page.nodes[cid]; if (c) collect(c); } };
      nodes.forEach(collect);
      const data = {
        ids: this.sel.slice(),
        // each clone is self-contained: _cloneMap holds its whole subtree
        trees: nodes.map(n => {
          const map = new Map();
          const c = M.deepClone(page, n, true, map);
          c._cloneMap = map;
          return c;
        }),
        cut,
      };
      this.clipboard = data;
      if (cut) this.deleteSel();
    },
    paste() {
      if (!this.clipboard) return;
      this.history.begin(this.doc);
      const page = this.page;
      const newSel = [];
      for (const t of this.clipboard.trees) {
        // clones registered straight into the live page, then attached
        const c = M.deepClone(page, t, true, page);
        c.x += 20; c.y += 20;
        M.attach(this.doc, page, null, c);
        newSel.push(c.id);
      }
      this.sel = newSel;
      this.history.end(this.doc);
      global.Panels.refreshInspector();
      this.markDirty();
    },
    duplicateSel() {
      if (!this.sel.length) return;
      const orig = this.clipboard;
      this.copySel(false);
      this.paste();
      this.clipboard = orig || this.clipboard;
    },
    deleteSel() {
      const ids = this.sel.filter(id => { const n = this.page.nodes[id]; return n && !n.locked; });
      if (!ids.length) return;
      this.history.begin(this.doc);
      for (const id of ids) M.detach(this.page, this.page.nodes[id]);
      this.sel = [];
      this.history.end(this.doc);
      global.Panels.refreshInspector();
      this.markDirty();
    },
    groupSel() {
      if (this.sel.length < 2) return;
      const page = this.page;
      const nodes = this.sel.map(id => page.nodes[id]).filter(Boolean);
      // plain min/max accumulation — the previous reduce seeded x=Infinity,
      // which made the group's w/h Infinity (→ null in JSON snapshots →
      // broken .fig export after an undo; caught by the P0 acceptance matrix).
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const n of nodes) {
        const L = n._l || { x: n.x, y: n.y, w: n.w, h: n.h };
        minX = Math.min(minX, L.x); minY = Math.min(minY, L.y);
        maxX = Math.max(maxX, L.x + L.w); maxY = Math.max(maxY, L.y + L.h);
      }
      const b = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
      this.history.begin(this.doc);
      const g = M.makeNode('frame', { w: b.w, h: b.h, x: b.x, y: b.y, name: 'Group' });
      g.fills = []; g.clips = false;
      M.attach(this.doc, page, null, g);
      for (const n of nodes) {
        const oldParent = n.parent;
        // remove from old list
        M.detach(page, n);
        n.x = n.x - b.x; n.y = n.y - b.y;
        M.attach(this.doc, page, g.id, n);
      }
      this.sel = [g.id];
      this.history.end(this.doc);
      global.Panels.refreshInspector();
      this.markDirty();
    },
    ungroup() {
      if (this.sel.length !== 1) return;
      const g = this.page.nodes[this.sel[0]];
      if (!g || g.type !== 'frame' || g.al || g.fills.length || g.shadows.length) return;
      const page = this.page;
      this.history.begin(this.doc);
      const kids = M.kids(page, g).map(k => ({ k, x: g._l.x + k.x, y: g._l.y + k.y }));
      const gp = g.parent;
      for (const { k, x, y } of kids) {
        M.detach(page, k);
        k.x = x; k.y = y;
        M.attach(this.doc, page, gp, k);
      }
      M.detach(page, g);
      this.sel = kids.map(({ k }) => k.id);
      this.history.end(this.doc);
      global.Panels.refreshInspector();
      this.markDirty();
    },

    // ------------------------------------------------------------- dev mode
    toggleDevMode() {
      this.devMode = !this.devMode;
      const btn = document.getElementById('ed-devmode');
      if (btn) btn.classList.toggle('active', this.devMode);
      const tb = document.getElementById('ed-toolbar');
      if (tb) tb.style.display = this.devMode ? 'none' : '';
      global.Panels.refreshInspector();
      this.markDirty();
    },

    // ------------------------------------------------------------- mask
    toggleMask() {
      if (this.sel.length !== 1) return;
      const n = this.page.nodes[this.sel[0]];
      if (!n) return;
      this.history.begin(this.doc);
      n.mask = !n.mask;
      this.history.end(this.doc);
      this.toast(n.mask ? 'Use as mask (⌘/)' : 'Mask removed');
      this.markDirty();
    },

    // ------------------------------------------------------------- comments
    renderPins() {
      const wrap = document.getElementById('ed-pins');
      if (!wrap || !this.doc) return;
      const C = global.Eco.Comments;
      const list = C.listFor(this.doc, this.page.id).filter(c => !c.resolved);
      const wanted = new Set(list.map(c => c.id));
      for (const el of this._pinEls) if (!wanted.has(el.dataset.cid)) el.remove();
      this._pinEls = this._pinEls.filter(el => wanted.has(el.dataset.cid));
      const selfColor = global.Collab.self ? global.Collab.self.color : '#0d99ff';
      for (const c of list) {
        let el = this._pinEls.find(x => x.dataset.cid === c.id);
        if (!el) {
          el = document.createElement('div');
          el.className = 'pin';
          el.dataset.cid = c.id;
          el.innerHTML = `<div class="pin-head"></div><div class="pin-body"></div>`;
          el.addEventListener('click', (e) => {
            e.stopPropagation();
            this._pinPopover = this._pinPopover && this._pinPopover.el === el ? null : { el, c };
            this.renderPins();
          });
          wrap.appendChild(el);
          this._pinEls.push(el);
        }
        const s = this.toScreen({ x: c.x, y: c.y });
        el.style.left = s.x + 'px';
        el.style.top = s.y + 'px';
        const mine = c.author === (global.Collab.self ? global.Collab.self.name : 'You');
        el.querySelector('.pin-head').style.background = mine ? selfColor : '#8a8a8a';
        el.querySelector('.pin-body').textContent = c.text.length > 40 ? c.text.slice(0, 40) + '…' : c.text;
        const open = this._pinPopover && this._pinPopover.el === el;
        el.classList.toggle('open', !!open);
        if (open) {
          el.querySelector('.pin-body').innerHTML =
            `<b>${global.Dash.esc(c.author)}</b> · ${new Date(c.at).toLocaleTimeString()}<br>${global.Dash.esc(c.text)}<br>` +
            `<span class="pin-actions"><button data-act="resolve">Resolve</button><button data-act="del">Delete</button></span>`;
          el.querySelector('[data-act="resolve"]').addEventListener('click', (e) => {
            e.stopPropagation();
            this.history.begin(this.doc);
            C.resolve(this.doc, c.id, true);
            this.history.end(this.doc);
            this._pinPopover = null;
            this.markDirty();
          });
          el.querySelector('[data-act="del"]').addEventListener('click', (e) => {
            e.stopPropagation();
            this.history.begin(this.doc);
            C.remove(this.doc, c.id);
            this.history.end(this.doc);
            this._pinPopover = null;
            this.markDirty();
          });
        }
      }
    },

    // ------------------------------------------------------------- peers (collab)
    renderPeers() {
      const C = global.Collab;
      const peers = [...C.peers.values()];
      const av = document.getElementById('ed-peers');
      if (av) av.innerHTML = peers.map(p => `<span class="peer-dot" style="background:${p.color}" title="${global.Dash.esc(p.name)}">${p.name.slice(-1).toUpperCase()}</span>`).join('') + (peers.length ? `<span class="peer-count">${peers.length + 1}</span>` : '');
      const wrap = document.querySelector('.ed-canvas-wrap');
      if (!wrap) return;
      const wanted = new Set(peers.map(p => p.id));
      for (const [pid, el] of this._peerEls) if (!wanted.has(pid)) { el.remove(); this._peerEls.delete(pid); }
      for (const p of peers) {
        if (!p.cursor) continue;
        let el = this._peerEls.get(p.id);
        if (!el) {
          el = document.createElement('div');
          el.className = 'peer-cursor';
          el.innerHTML = `<svg width="14" height="16" viewBox="0 0 14 16"><path d="M0 0 L14 10 L7.5 10.5 L4.5 16 Z" fill="${p.color}"/></svg><span class="peer-name">${global.Dash.esc(p.name)}</span>`;
          el.querySelector('.peer-name').style.background = p.color;
          wrap.appendChild(el);
          this._peerEls.set(p.id, el);
        }
        const s = this.toScreen(p.cursor);
        el.style.transform = `translate(${s.x}px, ${s.y}px)`;
      }
    },

    // ------------------------------------------------------------- present mode
    startPresent(nodeId) {
      if (!this.doc) return;
      this.endPresent(true);
      const E = global.Eco.Proto;
      const screens = E.screens(this.doc, this.page);
      const start = nodeId ? this.page.nodes[nodeId] : (screens[0] || null);
      if (!start) { this.toast('Add a frame to present'); return; }
      const overlay = document.createElement('div');
      overlay.className = 'present-overlay';
      overlay.innerHTML = `
        <div class="present-bar">
          <span class="present-screen"></span>
          <span class="present-hint">Click a <b>blue-outlined</b> node to navigate · Esc to exit</span>
          <button class="ed-iconbtn present-exit" id="present-exit-btn" title="Exit present (Esc)">${Ico('close',{size:12})} Exit</button>
        </div>
        <div class="present-stage">
          <canvas class="present-canvas front"></canvas>
          <canvas class="present-canvas back"></canvas>
        </div>`;
      document.body.appendChild(overlay);
      const stage = overlay.querySelector('.present-stage');
      const cA = overlay.querySelector('.front'), cB = overlay.querySelector('.back');
      const size = () => {
        const r = stage.getBoundingClientRect();
        for (const c of [cA, cB]) {
          c.width = Math.max(1, r.width); c.height = Math.max(1, r.height);
          c.style.width = r.width + 'px'; c.style.height = r.height + 'px';
        }
      };
      size();
      this.present = {
        overlay, cA, cB,
        ctxA: cA.getContext('2d'), ctxB: cB.getContext('2d'),
        front: 'A',
        page: this.page,
        node: start,
        view: { zoom: 1, ox: 0, oy: 0 },
      };
      overlay.querySelector('.present-exit').addEventListener('click', () => this.endPresent());
      const onClick = (e) => this.presentClick(e);
      overlay.addEventListener('click', onClick);
      const onKey = (e) => {
        if (e.key === 'Escape') {
          const P = this.present;
          if (P && P.overlayOf) { // first Esc closes the overlay, second exits present
            P.overlayOf = null; P.overlayView = null;
            this.renderPresentFrame();
            P.overlay.querySelector('.present-screen').textContent = P.node.name;
            return;
          }
          this.endPresent();
        }
      };
      window.addEventListener('keydown', onKey, true);
      this._presentCleanup = () => { overlay.remove(); window.removeEventListener('keydown', onKey, true); };
      this.renderPresentFrame();
      this.toast('Presenting — ' + start.name);
    },
    endPresent(silent) {
      if (this._presentCleanup) { this._presentCleanup(); this._presentCleanup = null; }
      this.present = null;
      if (!silent) this.markDirty();
    },
    _presentViewFor(page, node) {
      // fit the subtree into the canvas
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      M.forEachNode(page, node, (c) => {
        if (!c._l || c.visible === false) return;
        minX = Math.min(minX, c._l.x); minY = Math.min(minY, c._l.y);
        maxX = Math.max(maxX, c._l.x + c._l.w); maxY = Math.max(maxY, c._l.y + c._l.h);
      });
      if (!isFinite(minX)) { minX = node.x; minY = node.y; maxX = node.x + node.w; maxY = node.y + node.h; }
      const c = this.present.front === 'A' ? this.present.cA : this.present.cB;
      const W = c.width, H = c.height;
      const z = Math.min(8, Math.min((W - 80) / Math.max(1, maxX - minX), (H - 80) / Math.max(1, maxY - minY)));
      const zoom = Math.max(0.02, z);
      return { zoom, ox: (W - (maxX - minX) * zoom) / 2 - minX * zoom, oy: (H - (maxY - minY) * zoom) / 2 - minY * zoom };
    },
    // view that centers one node (used by the "scroll to" transition)
    _viewCentering(dest) {
      const P = this.present;
      const c = P.front === 'A' ? P.cB : P.cA;
      const n = dest.node;
      const L = n._l ? { x: n._l.x, y: n._l.y, w: n._l.w, h: n._l.h } : { x: n.x, y: n.y, w: n.w, h: n.h };
      const W = c.width, H = c.height;
      const zoom = Math.max(0.02, Math.min(8, Math.min((W - 60) / Math.max(1, L.w), (H - 60) / Math.max(1, L.h))));
      return { zoom, ox: (W - L.w * zoom) / 2 - L.x * zoom, oy: (H - L.h * zoom) / 2 - L.y * zoom };
    },
    renderPresentFrame(target, viewOverride) {
      const P = this.present;
      if (!P) return;
      if (!P.ctxA || !P.ctxB) return; // canvas 2D unavailable (headless) — state still set
      const doc = this.doc, page = P.page;
      // layout the subtree (virtual page over the live node map)
      const vpage = { nodes: page.nodes, tops: [P.node.id] };
      T.bake(doc, vpage, doc.vars.defaultMode);
      global.Layout.layoutPage(vpage);
      const v = viewOverride || this._presentViewFor(page, P.node);
      P.view = v;
      const draw = (ctx, c) => {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, c.width, c.height);
        ctx.setTransform(v.zoom, 0, 0, v.zoom, v.ox, v.oy);
        ctx.save();
        ctx.fillStyle = '#101014';
        ctx.restore();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#101014';
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.setTransform(v.zoom, 0, 0, v.zoom, v.ox, v.oy);
        R.drawNode(ctx, page, P.node, doc);
        // highlight interactive nodes (Figma-style blue outline)
        const E = global.Eco.Proto;
        const hl = (n) => {
          if (n.interactions && n.interactions.length && n._l) {
            ctx.save();
            ctx.strokeStyle = '#0d99ff';
            ctx.lineWidth = 2 / v.zoom;
            ctx.setLineDash([6 / v.zoom, 4 / v.zoom]);
            ctx.strokeRect(n._l.x - 2 / v.zoom, n._l.y - 2 / v.zoom, n._l.w + 4 / v.zoom, n._l.h + 4 / v.zoom);
            ctx.restore();
          }
          for (const cid of n.children) { const k = page.nodes[cid]; if (k) hl(k); }
        };
        hl(P.node);
        // overlay: dim scrim + the destination node floating centered on top
        if (P.overlayOf) {
          const ov = P.overlayOf;
          const ovvpage = { nodes: ov.page.nodes, tops: [ov.node.id] };
          T.bake(doc, ovvpage, doc.vars.defaultMode);
          global.Layout.layoutPage(ovvpage);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
          ctx.fillStyle = 'rgba(9,9,11,0.55)';
          ctx.fillRect(0, 0, c.width, c.height);
          let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
          M.forEachNode(ov.page, ov.node, (nn) => {
            if (!nn._l || nn.visible === false) return;
            mnx = Math.min(mnx, nn._l.x); mny = Math.min(mny, nn._l.y);
            mxx = Math.max(mxx, nn._l.x + nn._l.w); mxy = Math.max(mxy, nn._l.y + nn._l.h);
          });
          if (!isFinite(mnx)) { mnx = ov.node.x; mny = ov.node.y; mxx = mnx + ov.node.w; mxy = mny + ov.node.h; }
          const z2 = Math.max(0.02, Math.min(8, Math.min((c.width * 0.7) / Math.max(1, mxx - mnx), (c.height * 0.7) / Math.max(1, mxy - mny))));
          P.overlayView = { zoom: z2, ox: (c.width - (mxx - mnx) * z2) / 2 - mnx * z2, oy: (c.height - (mxy - mny) * z2) / 2 - mny * z2 };
          ctx.setTransform(z2, 0, 0, z2, P.overlayView.ox, P.overlayView.oy);
          R.drawNode(ctx, ov.page, ov.node, doc);
          ctx.setTransform(1, 0, 0, 1, 0, 0);
        }
      };
      const wantA = target === 'back' ? (P.front !== 'A') : (P.front === 'A');
      if (wantA) { draw(P.ctxA, P.cA); P.cB.classList.remove('show-anim'); }
      else { draw(P.ctxB, P.cB); P.cA.classList.remove('show-anim'); }
      P.overlay.querySelector('.present-screen').textContent = P.node.name + (P.overlayOf ? '  ·  overlay: ' + P.overlayOf.node.name : '');
    },
    presentClick(e) {
      const P = this.present;
      if (!P) return;
      if (e.target.closest('.present-bar')) return;
      const c = P.front === 'A' ? P.cA : P.cB;
      const rect = c.getBoundingClientRect();
      const swapBack = () => {
        const back = P.front === 'A' ? { c: P.cB, name: 'B' } : { c: P.cA, name: 'A' };
        const frontEl = P.front === 'A' ? P.cA : P.cB;
        back.c.style.transition = 'none'; back.c.style.opacity = '1'; back.c.style.transform = '';
        frontEl.style.transition = 'none'; frontEl.style.opacity = '0';
        P.front = back.name;
        setTimeout(() => { if (!this.present) return; const f = this.present.front === 'A' ? this.present.cA : this.present.cB; f.style.opacity = '1'; f.style.transform = ''; f.style.transition = ''; }, 0);
        return back;
      };
      // ── overlay mode: interact with the floating overlay; outside click closes it
      if (P.overlayOf) {
        const ov = P.overlayOf, ovv = P.overlayView || { zoom: 1, ox: 0, oy: 0 };
        const ox = (e.clientX - rect.left - ovv.ox) / ovv.zoom;
        const oy = (e.clientY - rect.top - ovv.oy) / ovv.zoom;
        let nav2 = null;
        const visit2 = (n) => {
          if (!n._l || n.visible === false) return;
          const L = n._l;
          for (let i = n.children.length - 1; i >= 0; i--) {
            const k = ov.page.nodes[n.children[i]];
            if (!k) continue;
            if (k._l && k.interactions && k.interactions.length && !nav2 && ox >= k._l.x && ox <= k._l.x + k._l.w && oy >= k._l.y && oy <= k._l.y + k._l.h) nav2 = k;
            visit2(k);
          }
          if (!nav2 && ox >= L.x && ox <= L.x + L.w && oy >= L.y && oy <= L.y + L.h) nav2 = n;
        };
        visit2(ov.node);
        const dest2 = nav2 ? global.Eco.Proto.destination(this.doc, nav2) : null;
        if (dest2) {
          P.overlayOf = { page: dest2.page, node: dest2.node };
          this.renderPresentFrame('back');
          swapBack();
          P.overlay.querySelector('.present-screen').textContent = P.node.name + '  ·  overlay: ' + dest2.node.name;
          return;
        }
        P.overlayOf = null; P.overlayView = null;
        this.renderPresentFrame();
        P.overlay.querySelector('.present-screen').textContent = P.node.name;
        return;
      }
      const wx = (e.clientX - rect.left - P.view.ox) / P.view.zoom;
      const wy = (e.clientY - rect.top - P.view.oy) / P.view.zoom;
      const page = P.page;
      // hit test within the presented subtree; prefer interactive nodes
      let target = null, interactive = null;
      const visit = (n) => {
        if (!n._l || n.visible === false) return;
        const L = n._l;
        const inside = wx >= L.x && wx <= L.x + L.w && wy >= L.y && wy <= L.y + L.h;
        for (let i = n.children.length - 1; i >= 0; i--) {
          const k = page.nodes[n.children[i]];
          if (!k) continue;
          if (k._l && k.interactions && k.interactions.length && !interactive) {
            const KL = k._l;
            if (wx >= KL.x && wx <= KL.x + KL.w && wy >= KL.y && wy <= KL.y + KL.h) interactive = k;
          }
          visit(k);
        }
        if (inside) target = n;
      };
      visit(P.node);
      const nav = interactive || target;
      const dest = nav ? global.Eco.Proto.destination(this.doc, nav) : null;
      if (!dest) return;
      const anim = (nav.interactions && nav.interactions[0] && nav.interactions[0].anim) || 'none';
      const back = P.front === 'A' ? { ctx: P.ctxB, c: P.cB, name: 'B' } : { ctx: P.ctxA, c: P.cA, name: 'A' };
      const oldPage = P.page, oldNode = P.node;
      P.page = dest.page;
      P.node = dest.node;
      const viewOverride = anim === 'scroll' ? this._viewCentering(dest) : null;
      this.renderPresentFrame('back', viewOverride); // draw the new screen onto `back`
      const frontEl = P.front === 'A' ? P.cA : P.cB;
      if (anim === 'fade') {
        back.c.style.transition = 'none'; back.c.style.opacity = '0';
        requestAnimationFrame(() => { back.c.style.transition = 'opacity 0.3s'; back.c.style.opacity = '1'; frontEl.style.transition = 'opacity 0.3s'; frontEl.style.opacity = '0'; });
      } else if (anim === 'slide') {
        back.c.style.transition = 'none'; back.c.style.opacity = '0'; back.c.style.transform = 'translateX(48px)';
        requestAnimationFrame(() => {
          back.c.style.transition = 'opacity 0.35s, transform 0.35s'; back.c.style.opacity = '1'; back.c.style.transform = 'translateX(0)';
          frontEl.style.transition = 'opacity 0.35s'; frontEl.style.opacity = '0';
        });
      } else {
        back.c.style.transition = ''; back.c.style.opacity = '1'; back.c.style.transform = '';
        frontEl.style.transition = 'none'; frontEl.style.opacity = '0';
      }
      P.front = back.name;
      setTimeout(() => {
        if (!this.present) return;
        const f = this.present.front === 'A' ? this.present.cA : this.present.cB;
        f.style.opacity = '1'; f.style.transform = ''; f.style.transition = '';
      }, anim === 'none' ? 0 : 400);
    },

    // ------------------------------------------------------------- toast
    toast(msg, ms, actionsOrKind) {
      let el = document.getElementById('penfig-toast');
      if (!el) {
        el = document.createElement('div');
        el.id = 'penfig-toast';
        document.body.appendChild(el);
      }
      el.className = '';
      el.innerHTML = '';
      // 3rd arg may be actions[] or a kind string ('success'/'error')
      let actions = [];
      let kind = '';
      if (Array.isArray(actionsOrKind)) actions = actionsOrKind;
      else if (typeof actionsOrKind === 'string') kind = actionsOrKind;
      if (kind) el.classList.add(kind);
      const iconMap = { success: 'check', error: 'warn' };
      if (iconMap[kind]) el.appendChild(parseSvg(iconMap[kind], 14));
      const span = document.createElement('span');
      span.textContent = msg;
      el.appendChild(span);
      if (actions.length) {
        const wrap = document.createElement('span');
        wrap.className = 'toast-actions';
        for (const a of actions) {
          const b = document.createElement('button');
          b.textContent = a.label;
          b.addEventListener('click', () => { el.classList.remove('show'); clearTimeout(el._t); a.fn(); });
          wrap.appendChild(b);
        }
        el.appendChild(wrap);
      }
      requestAnimationFrame(() => el.classList.add('show'));
      clearTimeout(el._t);
      el._t = setTimeout(() => el.classList.remove('show'), ms || 3500);
    },
  };

  function centerOf(c) { const r = c.getBoundingClientRect(); return { x: r.width / 2, y: r.height / 2 }; }
  function cursorFor(h) {
    return { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' }[h] || 'default';
  }
  function marqueeSelect(page, box) {
    const out = [];
    const visit = (n) => {
      const L = n._l;
      if (!L) return;
      const x2 = L.x + L.w, y2 = L.y + L.h;
      if (x2 >= box.x && L.x <= box.x + box.w && y2 >= box.y && L.y <= box.y + box.h) out.push(n.id);
      for (const cid of n.children) { const k = page.nodes[cid]; if (k) visit(k); }
    };
    for (const tid of page.tops) { const t = page.nodes[tid]; if (t) visit(t); }
    return out;
  }

  global.App = App;
})(window);
