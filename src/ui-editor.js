/* ui-editor.js — ARCO editor: canvas interactions, tools, zoom, text editing */
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
    // view.cam* are the true camera; view.zoom/ox/oy on App is the live copy.
    // canvasColor: canvas background (like Figma: light/dark/black/custom).
    // pixelPreview: when true, show faint 1px pixel grid at ≥800% zoom.
    view: { zoom: 1, ox: 80, oy: 80, rulers: true, grid: null, gridSize: 10, snap: true, magnet: false, pixelPreview: false, canvasColor: '#383838' },
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
      this._fitAfterLayout();
    },
    _fitAfterLayout() {
      const run = () => {
        if (!this.doc || !this.page || !this.canvas) return;
        try { this.layoutDoc(this.doc, this.page); } catch (e) {}
        const rect = this.canvas.getBoundingClientRect();
        if (!rect.width || !rect.height) { requestAnimationFrame(run); return; }
        this.zoomToFit();
      };
      requestAnimationFrame(() => requestAnimationFrame(run));
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
        // During active text editing, do NOT run a full layout pass — that
        // could re-position the text box (textarea is DOM-sibling of canvas,
        // but relayout + full repaint at the wrong moment can cause the
        // browser to yank focus on some configurations). Just do a light
        // redraw so the canvas catches up visually; full layout runs when
        // endTextEdit commit calls markDirty again.
        if (this._textEdit) {
          try { this._redrawLight(); } catch (e) {}
          return;
        }
        // During an active drag (move/resize/rotate/create/pencil/pen) skip
        // the full layout pass + panel refresh + collab broadcast on every
        // frame — geometry is already being mutated in-place by the drag
        // handlers; run a fast light redraw instead. The full pipeline runs
        // on drag end in onUp.
        const dragging = this._drag && /^(move|resize|rotate|rotate-multi|create|pencil|pen-new|pen-node|pen-handle|marquee)$/.test(this._drag.kind);
        if (dragging) {
          // For drag we still need world geometry up to date because
          // selection/resize/rotate use _wc/_wt. But we do NOT need to
          // re-run the auto-layout engine because:
          //  - move: manual move, no layout ownership
          //  - resize: size changes only; if parent is AL, we promoted the
          //    child to fixed so layout won't move it; applyConstraints
          //    runs on drag end.
          //  - rotate: only rotation changes; layout doesn't care.
          // Recompute world transforms only (cheap).
          const W = global.World;
          if (W && W.computePage) W.computePage(this.page);
          this.redraw();
          if (this.dirty) this.dirty = false;
          return;
        }
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
      const v = this.view;
      R.drawPage(ctx, this.page, this.doc, { zoom: v.zoom, ox: v.ox, oy: v.oy, w: rect.width, h: rect.height, grid: v.grid, pixelPreview: v.pixelPreview, canvasColor: v.canvasColor });
      if (this.hoverId && !this.sel.includes(this.hoverId)) R.drawHover(ctx, this.view, this.page.nodes[this.hoverId]);
      // Always draw proper Figma-style selection chrome (OBB, 4 corners,
      // hover-gated rotate dot, size pill). Dev mode adds distance labels
      // on TOP of it — never replaces it.
      R.drawSelection(ctx, this.view, this.sel, this.page);
      if (this.devMode) R.drawDevMeasure(ctx, this.view, this.page, this.doc, this.sel);
      if (this.marquee) R.drawMarquee(ctx, this.marquee);
      this.drawPenOverlay(ctx);
      R.drawSnapGuides(ctx, this.view, this._snapGuides);
      R.drawRulers(ctx, this.view, rect.width, rect.height);
      this.updateZoomLabel();
    },
    saveNow() {
      if (!this.doc) return;
      global.Dash.saveDoc(this.doc);
    },
    exportBackupFig() {
      this.exportFigAsync(this.doc, this.doc.name || 'arco').then(
        () => this.toast('Backup exported', 2500, 'success'),
        (err) => this.toast('Backup failed: ' + err.message, 6000, 'error')
      );
    },

    // ------------------------------------------------------------- chrome
    buildChrome() {
      document.body.classList.remove('dash-mode');
      const ed = document.getElementById('view-editor');
      const docName = M.esc ? M.esc(this.doc.name) : esc(this.doc.name);
      ed.innerHTML = `
      <div class="ed-top">
        <button id="ed-back" class="ed-iconbtn" title="Back to files">${Ico('back',{size:16})}</button>
        <div class="ed-brand" title="ARCO — local-first design workspace"><span class="ed-brand-mark">P</span><span>ARCO</span></div>
        <div class="ed-filename-wrap">
          <input id="ed-filename" class="ed-filename" value="${docName}" spellcheck="false">
          <span class="ed-pagename" id="ed-pagename" title="Double-click to rename page"></span>
        </div>
        <div class="ed-top-divider"></div>
        <button id="ed-undo" class="ed-iconbtn" title="Undo (⌘Z)">${Ico('undo',{size:16})}</button>
        <button id="ed-redo" class="ed-iconbtn" title="Redo (⇧⌘Z)">${Ico('redo',{size:16})}</button>
        <div class="ed-top-center" id="ed-modes-wrap">
          <div class="seg" id="ed-modes"></div>
        </div>
        <div class="ed-top-right">
          <button id="ed-command" class="ed-command-trigger" title="Quick actions (⌘/)">${Ico('search',{size:13})}<span>Quick actions</span><kbd>⌘ /</kbd></button>
          <button id="ed-view" class="ed-iconbtn" title="View options">${Ico('eye',{size:15})}</button>
          <button id="ed-versions" class="ed-iconbtn" title="Version history">${Ico('history',{size:14})}</button>
          <button id="ed-plugins" class="ed-iconbtn" title="Plugins">${Ico('plugin',{size:14})}</button>
          <button id="ed-focus" class="ed-iconbtn" title="Focus canvas — hide panels (⇧F)">${Ico('zoomfit',{size:14})}</button>
          <button id="ed-dev" class="ed-btn" title="Developer mode (D)">${Ico('code',{size:13})} Dev</button>
          <button id="ed-present" class="ed-btn" title="Present prototype (⇧K)">${Ico('play',{size:13})} Present</button>
          <div class="ed-top-divider"></div>
          <span class="ed-local-state" title="Your working file stays on this device">${Ico('check',{size:11})} Local</span>
          <button id="ed-help" class="ed-iconbtn" title="Help and shortcuts">?</button>
          <button id="ed-share" class="ed-btn ed-btn-primary" title="Save locally in this browser (⌘S)">${Ico('save',{size:13})} Save locally</button>
          <button id="ed-export" class="ed-btn" title="Export (⌘E)">${Ico('download',{size:13})} Export</button>
          <span id="ed-peers" class="ed-peers" title="People in this file"></span>
        </div>
      </div>
      <div class="ed-body">
        <div class="ed-left">
          <div class="ed-left-tabs">
            <button class="ed-ltab active" data-tab="layers" title="File — pages and layers">${Ico('layers',{size:14})}<span>File</span></button>
            <button class="ed-ltab" data-tab="assets" title="Assets">${Ico('component',{size:14})}<span>Assets</span></button>
            <button class="ed-ltab" data-tab="vars" title="Variables">${Ico('tokens',{size:14})}<span>Variables</span></button>
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
            ${Icons.toolBtn('scale','scale','Scale','K')}
            ${Icons.toolBtn('frame','frame','Frame','F')}
            ${Icons.toolBtn('section','section','Section','S')}
            <div class="tb-sep"></div>
            ${Icons.toolBtn('rect','rect','Rectangle','R')}
            ${Icons.toolBtn('ellipse','ellipse','Ellipse','O')}
            ${Icons.toolBtn('polygon','polygon','Polygon','')}
            ${Icons.toolBtn('star','star','Star','')}
            ${Icons.toolBtn('triangle','triangle','Triangle','')}
            ${Icons.toolBtn('line','line','Line','L')}
            ${Icons.toolBtn('arrow','arrow','Arrow','A')}
            <div class="tb-sep"></div>
            ${Icons.toolBtn('pen','pen','Pen','P')}
            ${Icons.toolBtn('pencil','pencil','Pencil','N')}
            <div class="tb-sep"></div>
            ${Icons.toolBtn('text','text','Text','T')}
            ${Icons.toolBtn('hand','hand','Hand','H')}
            ${Icons.toolBtn('comment','comment','Comment','C')}
          </div>
          <div class="ed-zoom" id="ed-zoom">
            <button id="zoom-out" title="Zoom out">${Ico('minus',{size:14})}</button>
            <button id="zoom-pct" title="Zoom to 100%">100%</button>
            <button id="zoom-in" title="Zoom in">${Ico('plus',{size:14})}</button>
            <button id="zoom-fit" title="Zoom to fit">${Ico('zoomfit',{size:14})}</button>
          </div>
          <div class="ed-status" id="ed-status"></div>
        </div>
        <div class="ed-right" id="ed-right"></div>
      </div>`;
      this.canvas = ed.querySelector('#ed-canvas');
      this.ctx = this.canvas.getContext ? this.canvas.getContext('2d', { alpha: false }) : null;
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
        ['layers', 'assets', 'styles', 'pages', 'vars'].forEach(t => {
          const el = ed.querySelector('#ed-' + t);
          if (el) el.style.display = t === tab ? '' : 'none';
        });
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
      ed.querySelector('#ed-command')?.addEventListener('click', () => this.commandPalette());
      ed.querySelector('#ed-view')?.addEventListener?.('click', (e) => { e.stopPropagation(); global.Panels.viewMenu(e.clientX, e.clientY); });
      ed.querySelector('#ed-undo').addEventListener('click', () => this.historyUndo());
      ed.querySelector('#ed-redo').addEventListener('click', () => this.historyRedo());
      ed.querySelector('#ed-share').addEventListener('click', () => { this.saveNow(); this.toast('Saved to this browser', 2000, 'success'); });
      ed.querySelector('#ed-versions')?.addEventListener('click', (e) => { e.stopPropagation(); global.Panels.versionsMenu(e.clientX, e.clientY); });
      ed.querySelector('#ed-plugins')?.addEventListener('click', (e) => { e.stopPropagation(); global.Panels.pluginsModal(); });
      ed.querySelector('#ed-help')?.addEventListener('click', () => this.showWelcome(true));
      ed.querySelector('#ed-present')?.addEventListener('click', () => this.startPresent());
      ed.querySelector('#ed-dev')?.addEventListener('click', () => this.toggleDevMode());
      ed.querySelector('#ed-focus')?.addEventListener('click', () => {
        const focused = ed.classList.toggle('focus-canvas');
        ed.querySelector('#ed-focus').classList.toggle('active', focused);
        ed.querySelector('#ed-focus').title = focused ? 'Show panels' : 'Focus canvas — hide panels';
        requestAnimationFrame(() => { this.resizeCanvas(); this.markDirty(); });
      });
      this.setTool('move');
      // syncViewToggles sets the canvas-wrap background to match canvasColor.
      // Canvas element is added synchronously by buildChrome, so run next frame.
      requestAnimationFrame(() => this.syncViewToggles());
      global.Panels.renderPages();
      global.Panels.refreshLayers();
      global.Panels.refreshInspector();
      this.renderModes();
      this.updateZoomLabel();
      this.renderPagename();
      requestAnimationFrame(() => this.showWelcome(false));
      // double-click page name → rename
      const pn = ed.querySelector('#ed-pagename');
      if (pn) pn.addEventListener('dblclick', async () => {
        const name = await Dialogs.prompt('Rename page', this.page.name);
        if (name && name.trim()) { this.page.name = name.trim(); this.renderPagename(); global.Panels.renderPages(); this.markDirty(); }
      });
    },
    showWelcome(force) {
      const key = 'arco.welcome.v3';
      if (!force && localStorage.getItem(key)) return;
      document.querySelector('.studio-welcome')?.remove();
      const wrap = document.createElement('div');
      wrap.className = 'studio-welcome';
      wrap.innerHTML = `<div class="studio-welcome-card">
        <button class="studio-welcome-x" aria-label="Close">×</button>
        <span class="studio-kicker">LOCAL-FIRST DESIGN</span>
        <h2>Welcome to ARCO</h2>
        <p>Your files stay on this device. Draw, prototype, inspect and export without an account.</p>
        <div class="studio-start-grid">
          <button data-tool="move"><kbd>V</kbd><span><b>Select</b><small>Pick and transform layers</small></span></button>
          <button data-tool="frame"><kbd>F</kbd><span><b>Frame</b><small>Create screens and containers</small></span></button>
          <button data-tool="rect"><kbd>R</kbd><span><b>Shape</b><small>Draw interface elements</small></span></button>
          <button data-tool="text"><kbd>T</kbd><span><b>Text</b><small>Click anywhere and type</small></span></button>
        </div>
        <div class="studio-welcome-foot"><span>Space + drag to pan · ⌘/ for Quick Actions</span><button class="studio-go">Start designing</button></div>
      </div>`;
      document.body.appendChild(wrap);
      const close = () => { localStorage.setItem(key, '1'); wrap.remove(); };
      wrap.querySelector('.studio-welcome-x').onclick = close;
      wrap.querySelector('.studio-go').onclick = close;
      wrap.addEventListener('click', e => { if (e.target === wrap) close(); });
      wrap.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => { this.setTool(b.dataset.tool); close(); });
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
      // Sync canvas background color to the wrapper CSS var so any uncovered
      // area (before first canvas paint, during resizes) matches.
      const wrap = document.querySelector('.ed-canvas-wrap');
      if (wrap && this.view.canvasColor) wrap.style.background = this.view.canvasColor;
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
      if (add) add.addEventListener('click', async () => {
        const name = await Dialogs.prompt('New mode name', 'Mode ' + (doc.vars.modes.length + 1));
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
    _rotateHoverTimer: null,
    setSel(ids) {
      this.sel = ids;
      global.Collab.sendSelection(this.sel);
      global.Panels.refreshInspector();
      // Figma: rotate dot is visible briefly after selecting so users
      // discover it, then fades to hover-only.
      clearTimeout(this._rotateHoverTimer);
      if (ids.length >= 1) {
        this.view._hoverRotate = true;
        this._rotateHoverTimer = setTimeout(() => {
          this.view._hoverRotate = false;
          this.markDirty();
        }, 1500);
      } else {
        this.view._hoverRotate = false;
      }
      this.markDirty();
    },

    // Update rotate hover state based on pointer position (screen px).
    // Returns true when pointer is in the top-edge rotate-hover zone.
    // Figma: rotate handle appears when the cursor is near the TOP edge
    // of the selection (anywhere along that edge, not just the midpoint).
    _updateRotateHover(mx, my) {
      if (this.sel.length < 1) { this.view._hoverRotate = false; return false; }
      // When actively dragging rotate, keep it visible.
      if (this._drag && (this._drag.kind === 'rotate' || this._drag.kind === 'rotate-multi')) {
        this.view._hoverRotate = true; return true;
      }
      const W = global.World;
      let inZone = false;
      if (this.sel.length === 1) {
        const n = this.page.nodes[this.sel[0]];
        if (!n || !n._wc) return false;
        const corners = (W && W.screenCorners)
          ? W.screenCorners(this.view, n)
          : n._wc.map(p => ({ x: p.x*this.view.zoom + this.view.ox, y: p.y*this.view.zoom + this.view.oy }));
        const c0 = corners[0], c1 = corners[1];
        const center = { x: (corners[0].x + corners[2].x) * 0.5, y: (corners[0].y + corners[2].y) * 0.5 };
        // Top edge: from c0 to c1. Compute distance to segment.
        const ex = c1.x - c0.x, ey = c1.y - c0.y;
        const elen2 = ex*ex + ey*ey;
        const elen = Math.sqrt(elen2) || 1;
        // outward normal
        let nx = ey/elen, ny = -ex/elen;
        const mid = { x: (c0.x+c1.x)/2, y: (c0.y+c1.y)/2 };
        if ((mid.x - center.x)*nx + (mid.y - center.y)*ny < 0) { nx=-nx; ny=-ny; }
        // project (mx,my) onto the edge line
        const t = elen2 > 0 ? ((mx - c0.x)*ex + (my - c0.y)*ey) / elen2 : 0;
        const tClamped = Math.max(-0.05, Math.min(1.05, t));
        const px = c0.x + tClamped*ex, py = c0.y + tClamped*ey;
        const distFromSegment = Math.hypot(mx - px, my - py);
        // signed distance outward from edge (negative = outside the shape)
        const signedOut = (mx - mid.x)*nx + (my - mid.y)*ny;
        // Figma: a thin halo just outside the bounds, not a 34px band.
        inZone = signedOut > 0 && signedOut < 16 && distFromSegment < 14;
      } else {
        // multi-select: AABB
        let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
        for (const id of this.sel) {
          const n = this.page.nodes[id]; if(!n||!n._w) continue;
          const b = n._w;
          x0=Math.min(x0,b.x); y0=Math.min(y0,b.y);
          x1=Math.max(x1,b.x+b.w); y1=Math.max(y1,b.y+b.h);
        }
        if (isFinite(x0)) {
          const z = this.view.zoom, ox = this.view.ox, oy = this.view.oy;
          const sx0 = x0*z+ox, sx1 = x1*z+ox;
          const sy0 = y0*z+oy;
          inZone = mx >= sx0 - 8 && mx <= sx1 + 8 && my >= sy0 - 16 && my <= sy0 + 4;
        }
      }
      this.view._hoverRotate = inZone;
      return inZone;
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
          keyup: (e) => {
            // Ignore Space keyup when typing in an input/textarea (otherwise
            // pressing space while editing text briefly toggles hand-tool
            // cursor and pans the canvas when released).
            const t = e.target;
            if (t && /INPUT|TEXTAREA|SELECT/.test(t.tagName || '')) return;
            if (e.code === 'Space') self.space = false;
          },
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
        if (hit && !this.sel.includes(hit.id)) { this.setSel([hit.id]); }
        global.Panels.contextMenu(e.clientX, e.clientY, this.sel.length ? this.sel : [hit && hit.id].filter(Boolean));
      });
      // Drag & drop image import (drop anywhere on canvas → placed at drop point)
      c.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
      c.addEventListener('drop', (e) => {
        const files = e.dataTransfer && e.dataTransfer.files;
        if (!files || !files.length) return;
        e.preventDefault();
        const p = this.toWorld(e);
        for (const f of files) {
          if (f.type && f.type.startsWith('image/')) this.placeImageFile(f, p);
          else if (/\.pfg$/i.test(f.name)) {
            f.arrayBuffer().then(b => this.openFromBytes(b, f.name, 'pfg'));
            break;
          } else if (/\.fig$/i.test(f.name)) {
            if (this.openFromFile) this.openFromFile(f);
            else f.arrayBuffer().then(b => this.openFromBytesAsync(b, f.name, 'fig'));
            break;
          }
        }
      });
    },
    placeImageFile(file, at) {
      const reader = new FileReader();
      reader.onload = () => {
        const src = reader.result;
        const img = new Image();
        img.onload = () => {
          // Default 200px max dimension preserving aspect
          const max = 200;
          let w = img.naturalWidth, h = img.naturalHeight;
          if (w > h) { h = h * (max / w); w = max; }
          else { w = w * (max / h); h = max; }
          this.history.begin(this.doc);
          const n = M.makeNode('rect', {
            x: at.x - w / 2, y: at.y - h / 2, w, h,
            name: file.name.replace(/\.[^.]+$/, '') || 'Image',
            fills: [{ type: 'image', src, scaleMode: 'fill', opacity: 1 }],
            stroke: { color: '#000', width: 0, opacity: 0, align: 'inside', visible: false },
          });
          M.attach(this.doc, this.page, null, n);
          this.history.end(this.doc);
          this.setSel([n.id]);
          this.markDirty();
          this.toast('Placed image: ' + n.name, 2500, 'success');
        };
        img.src = src;
      };
      reader.readAsDataURL(file);
    },
    openFromBytes(bytes, name, kind) {
      try {
        let doc, report = null;
        if (kind === 'pfg') {
          doc = global.Dash.importPfg(bytes);
        } else {
          const res = global.FigConv.importFig(new Uint8Array(bytes));
          doc = res.doc;
          report = res.report;
        }
        if (!doc) throw new Error('Parse failed');
        this._commitImportedDoc(doc, name, report, kind);
      } catch (err) {
        console.error(err);
        this.toast('Failed to open ' + name + ': ' + err.message, 5000, 'error');
      }
    },
    _commitImportedDoc(doc, name, report, kind) {
      if (!doc.id) doc.id = M.uid('doc-');
      doc.name = name.replace(/\.(pfg|fig)$/i, '') || 'Imported';
      for (const p of doc.pages) M.stampPage(doc, p);
      const entry = { id: doc.id, name: doc.name, doc, updatedAt: Date.now() };
      M.store.put(entry);
      this.openFile(doc.id);
      requestAnimationFrame(() => {
        this._fitAfterLayout();
        const page = this.page;
        if (page && page.tops && page.tops.length) {
          const first = page.tops.find(id => page.nodes[id] && page.nodes[id].visible !== false) || page.tops[0];
          if (first) this.setSel([first]);
        }
      });
      if (kind === 'fig' && report) {
        // Collect missing/unavailable fonts.
        const fontSet = new Set();
        for (const p of doc.pages) for (const id in p.nodes) {
          const n = p.nodes[id];
          if (n && n.type === 'text' && n.text && n.text.font) fontSet.add(n.text.font);
        }
        const available = new Set(global.Fonts.SYSTEM_FONTS);
        global.Fonts.GOOGLE_FONTS.forEach(g => available.add(g.name));
        global.Fonts.localFonts().forEach(f => available.add(f));
        const missing = Array.from(fontSet).filter(f => !available.has(f));
        report.missingFonts = missing;
        this._showImportSummary(doc.name, report);
      } else {
        this.toast('Opened ' + doc.name, 2500, 'success');
      }
    },
    _showImportSummary(docName, r) {
      r = r || {};
      let el = document.getElementById('ed-import-summary');
      if (el) el.remove();
      el = document.createElement('div');
      el.id = 'ed-import-summary';
      el.className = 'ed-modal-backdrop';
      const rows = [
        ['Nodes',     r.nodes     || 0],
        ['Pages',     r.pages     || 0],
        ['Tokens',    r.tokens    || 0],
        ['Images',    r.images    || 0],
        ['Components',r.components|| 0],
      ];
      const warnCount = (r.warnings ? r.warnings.length : 0);
      const missFonts = r.missingFonts || [];
      const rowsHtml = rows.map(([k,v]) => `<div class="pf-sum-row"><span>${k}</span><b>${v}</b></div>`).join('');
      const fontsHtml = missFonts.length ?
        `<div class="pf-sum-warn">
          <div class="pf-sum-warn-head">${global.Icons.svg('warn',{size:14})}<span>${missFonts.length} missing font${missFonts.length===1?'':'s'}</span></div>
          <div class="pf-sum-fonts">${missFonts.slice(0,8).map(f=>`<span class="pf-sum-chip" title="${global.Dash.esc(f)}">${global.Dash.esc(f)}</span>`).join('')}${missFonts.length>8?`<span class="pf-sum-more">+${missFonts.length-8} more</span>`:''}</div>
          <button class="pf-sum-btn" id="pf-sum-loadfonts">Try loading from Google Fonts</button>
        </div>` : '';
      const warnHtml = warnCount ?
        `<div class="pf-sum-warn">
          <div class="pf-sum-warn-head">${global.Icons.svg('info',{size:14})}<span>${warnCount} compatibility note${warnCount===1?'':'s'}</span></div>
          <ul class="pf-sum-notes">${(r.warnings||[]).slice(0,6).map(w=>`<li>${global.Dash.esc(String(w))}</li>`).join('')}${warnCount>6?`<li>…and ${warnCount-6} more</li>`:''}</ul>
        </div>` : '';
      el.innerHTML =
        `<div class="ed-import-dialog" style="width:420px">
          <div class="ed-import-title">${global.Icons.svg('check_circle',{size:18})}<span class="ed-import-fname">Imported "${global.Dash.esc(docName)}"</span></div>
          <div class="pf-sum-grid">${rowsHtml}</div>
          ${fontsHtml}
          ${warnHtml}
          <button class="ed-import-cancel" id="pf-sum-close" style="float:none;width:100%;margin-top:8px;background:#0d99ff;color:#fff;border-color:#0d99ff;">Open file</button>
        </div>`;
      const ve = document.getElementById('view-editor') || document.body;
      ve.appendChild(el);
      const close = () => { el.remove(); };
      el.querySelector('#pf-sum-close').addEventListener('click', close);
      el.addEventListener('click', (ev) => { if (ev.target === el) close(); });
      const loadBtn = el.querySelector('#pf-sum-loadfonts');
      if (loadBtn) loadBtn.addEventListener('click', () => {
        loadBtn.disabled = true; loadBtn.textContent = 'Loading…';
        Promise.all(missFonts.map(f => global.Fonts.ensureLoaded(f))).then(() => {
          loadBtn.textContent = 'Done'; this.markDirty();
          setTimeout(close, 600);
        });
      });
    },
    // ---- Async worker-based import (off-main-thread for large files) ----
    _importWorker: null,
    _importJobId: 0,
    supportsImportWorker() {
      return typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && location.protocol !== 'file:';
    },
    async openFromBytesAsync(bytes, name, kind) {
      // Tiering:
      //   <400 KB → main thread (tiny fixtures)
      //   400 KB–150 MB → worker with progress UI + cancel
      //   >150 MB → warn first, then worker
      // A 2 MB .fig is often 20k kiwi nodes. The old 10 MB cutoff left
      // almost every real file on the main thread, which froze the tab.
      const size = bytes && bytes.byteLength != null ? bytes.byteLength : (bytes && bytes.length) || 0;
      const MB = 1024*1024;
      const SMALL = 400 * 1024, WARN = 150*MB;
      if (kind !== 'fig' || size < SMALL || !this.supportsImportWorker()) {
        return this.openFromBytes(bytes, name, kind);
      }
      if (size >= WARN) {
        const mb = Math.round(size/MB);
        const ok = await Dialogs.confirm(
          'This .fig file is ' + mb + ' MB. Importing it may use significant memory and take a while.\n\n' +
          'ARCO will import it in the background with a progress bar. Continue?',
          { okLabel: 'Import' }
        );
        if (!ok) return;
      }
      this._startImportWorker(bytes, name, kind);
    },
    _startImportWorker(bytes, name, kind) {
      // Ensure we have an ArrayBuffer to transfer.
      let ab = bytes;
      if (ab instanceof Uint8Array) ab = ab.buffer.slice(ab.byteOffset, ab.byteOffset + ab.byteLength);
      else if (!(ab instanceof ArrayBuffer)) ab = new Uint8Array(ab).buffer;

      const jobId = ++this._importJobId;
      this._showImportProgress(name, 0, 'Starting worker…');

      let worker;
      try {
        worker = new Worker('src/import-worker.js', { type:'classic' });
      } catch (err) {
        console.warn('Worker spawn failed, falling back to sync import:', err);
        this._hideImportProgress();
        return this.openFromBytes(bytes, name, kind);
      }
      this._importWorker = worker;

      worker.onmessage = (e) => {
        const d = e.data;
        if (!d || d.id !== jobId) return;
        if (d.kind === 'progress') {
          this._showImportProgress(name, d.pct, d.msg, d.phase);
        } else if (d.kind === 'done') {
          worker.terminate();
          this._importWorker = null;
          this._hideImportProgress();
          try {
            this._commitImportedDoc(d.doc, name, d.report, 'fig');
          } catch (err) {
            console.error(err);
            this.toast('Import failed: ' + err.message, 6000, 'error');
          }
        } else if (d.kind === 'cancelled') {
          worker.terminate();
          this._importWorker = null;
          this._hideImportProgress();
          this.toast('Import cancelled', 2500);
        } else if (d.kind === 'error') {
          worker.terminate();
          this._importWorker = null;
          this._hideImportProgress();
          console.error('Import worker error:', d.message, d.stack);
          this.toast('Import failed: ' + d.message, 8000, 'error');
        }
      };
      worker.onerror = (e) => {
        worker.terminate();
        this._importWorker = null;
        this._hideImportProgress();
        this.toast('Import worker crashed — try a smaller file or reload.', 6000, 'error');
      };
      worker.postMessage({ kind:'import', id:jobId, format:kind, bytes:ab, name }, [ab]);
    },
    _cancelImportWorker() {
      if (!this._importWorker) return;
      this._importWorker.postMessage({ kind:'cancel', id:this._importJobId });
    },
    _showProgress(name, pct, msg, kind /* 'import' | 'export' */) {
      let el = document.getElementById('ed-progress');
      if (!el) {
        el = document.createElement('div');
        el.id = 'ed-progress';
        el.className = 'ed-modal-backdrop';
        // Icon placeholder is set each call; cancel handler delegates to
        // whichever worker is currently active.
        el.innerHTML =
          '<div class="ed-import-dialog">' +
            '<div class="ed-import-title">' +
              '<span class="ed-progress-icon"></span>' +
              '<span class="ed-import-fname">Working…</span>' +
            '</div>' +
            '<div class="ed-import-bar"><div class="ed-import-fill"></div></div>' +
            '<div class="ed-import-status">Starting…</div>' +
            '<button class="ed-import-cancel">Cancel</button>' +
          '</div>';
        const ed = document.getElementById('view-editor');
        if (ed) ed.appendChild(el);
        el.querySelector('.ed-import-cancel').addEventListener('click', () => {
          this._cancelImportWorker();
          if (this._exportWorker) this._exportWorker.postMessage({ kind:'cancel', id:this._exportJobId });
        });
      }
      // Icon: import = downward arrow into box, export = upward arrow out.
      const ICON_IMPORT = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>';
      const ICON_EXPORT = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
      el.querySelector('.ed-progress-icon').innerHTML = kind === 'export' ? ICON_EXPORT : ICON_IMPORT;
      el.style.display = 'flex';
      el.querySelector('.ed-import-fname').textContent = name || 'Working…';
      el.querySelector('.ed-import-fill').style.width = Math.max(2, Math.min(100, pct|0)) + '%';
      el.querySelector('.ed-import-status').textContent = msg || '';
    },
    _hideProgress() {
      const el = document.getElementById('ed-progress');
      if (el) el.style.display = 'none';
    },
    _showImportProgress(name, pct, msg, phase) { this._showProgress(name, pct, msg, 'import'); },
    _hideImportProgress() { this._hideProgress(); },
    _showExportProgress(name, pct, msg, phase) { this._showProgress(name, pct, msg, 'export'); },
    _hideExportProgress() { this._hideProgress(); },

    // ---- Async worker-based export (off-main-thread for large docs) ----
    _exportWorker: null,
    _exportJobId: 0,
    exportFigAsync(doc, name, opts) {
      // Tiering: small docs (< 500 nodes, no images) export synchronously.
      let nodeCount = 0;
      for (const p of (doc.pages || [])) nodeCount += Object.keys(p.nodes || {}).length;
      const hasImages = (doc.pages || []).some(p => Object.values(p.nodes||{}).some(n =>
        (n.fills||[]).some(f => f && f.type==='image')));
      const SMALL = nodeCount < 400 && !hasImages;
      if (SMALL || !this.supportsImportWorker()) {
        return this._exportFigSync(doc, name, opts);
      }
      return this._startExportWorker(doc, name, opts);
    },
    _exportFigSync(doc, name, opts) {
      const bytes = global.FigConv.exportFig(doc, opts || {});
      this._downloadBytes(bytes, (name || doc.name || 'arco') + '.fig', 'application/x-figma');
      return Promise.resolve();
    },
    _startExportWorker(doc, name, opts) {
      return new Promise((resolve, reject) => {
        const jobId = ++this._exportJobId;
        const fname = (name || doc.name || 'arco') + '.fig';
        this._showExportProgress(fname, 2, 'Starting export worker…');
        let worker;
        try { worker = new Worker('src/export-worker.js', { type:'classic' }); }
        catch (err) { this._hideExportProgress(); return this._exportFigSync(doc, name, opts); }
        this._exportWorker = worker;
        worker.onmessage = (e) => {
          const d = e.data;
          if (!d || d.id !== jobId) return;
          if (d.kind === 'progress') this._showExportProgress(fname, d.pct, d.msg, d.phase);
          else if (d.kind === 'done') {
            worker.terminate(); this._exportWorker = null; this._hideExportProgress();
            this._downloadBytes(new Uint8Array(d.bytes), d.name, 'application/x-figma');
            resolve();
          } else if (d.kind === 'cancelled') {
            worker.terminate(); this._exportWorker = null; this._hideExportProgress();
            this.toast('Export cancelled', 2500); resolve();
          } else if (d.kind === 'error') {
            worker.terminate(); this._exportWorker = null; this._hideExportProgress();
            this.toast('.fig export failed: ' + d.message, 8000, 'error'); reject(new Error(d.message));
          }
        };
        worker.onerror = () => {
          worker.terminate(); this._exportWorker = null; this._hideExportProgress();
          this.toast('Export worker crashed — retrying on main thread', 5000, 'error');
          try { this._exportFigSync(doc, name, opts); resolve(); } catch (e) { reject(e); }
        };
        // Structured-clone the doc (it's pure JSON).
        worker.postMessage({ kind:'export', id:jobId, format:'fig', doc, name:fname, opts: opts||{} });
      });
    },
    _downloadBytes(bytes, filename, mime) {
      const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      const blob = new Blob([u8], { type: mime || 'application/octet-stream' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 5000);
    },
    resizeCanvas() {
      const c = this.canvas;
      if (!c) return;
      const rect = c.parentElement.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      // Integer CSS size + integer backing store. Fractional width*dpr is
      // why the viewport looked blurry — the browser resampled the bitmap.
      const cssW = Math.max(1, Math.round(rect.width));
      const cssH = Math.max(1, Math.round(rect.height));
      c.width = Math.max(1, Math.round(cssW * dpr));
      c.height = Math.max(1, Math.round(cssH * dpr));
      c.style.width = cssW + 'px';
      c.style.height = cssH + 'px';
      if (this.ctx) {
        // Setting c.width resets the backing store to transparent black. If
        // we don't immediately paint the canvas color, the user sees a 1-frame
        // flash of "empty canvas" before markDirty's rAF runs — that is the
        // infamous zoom/resize flicker. Fill the canvas color right away.
        const ctx = this.ctx;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        if ('imageSmoothingEnabled' in ctx) ctx.imageSmoothingEnabled = true;
        if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
        ctx.fillStyle = (this.view && this.view.canvasColor) || '#383838';
        ctx.fillRect(0, 0, cssW, cssH);
      }
    },
    toWorld(e) {
      const rect = this.canvas.getBoundingClientRect();
      return { x: (e.clientX - rect.left - this.view.ox) / this.view.zoom, y: (e.clientY - rect.top - this.view.oy) / this.view.zoom };
    },
    toScreen(p) { return { x: p.x * this.view.zoom + this.view.ox, y: p.y * this.view.zoom + this.view.oy }; },

    // ------------------------------------------------------------- hit test
    hitTest(p) {
      const page = this.page;
      const W = global.World;
      // Figma: click the section/frame title (just above the box) to select
      // the container itself — required to Shift-select two sections.
      if (page && this.view) {
        const z = this.view.zoom || 1;
        const labelH = 20 / z;
        for (let i = page.tops.length - 1; i >= 0; i--) {
          const t = page.nodes[page.tops[i]];
          if (!t || t.visible === false || t.type !== 'frame') continue;
          const b = t._w || { x: t.x, y: t.y, w: t.w, h: t.h };
          const labelW = Math.max(72 / z, Math.min(b.w, ((t.name || '').length * 7 + 18) / z));
          if (p.x >= b.x && p.x <= b.x + labelW && p.y >= b.y - labelH && p.y < b.y + 1 / z) return t;
        }
      }
      const frameClips = (n) => {
        if (!(n.type === 'frame' && n.clips) || !n._w) return true;
        return p.x >= n._w.x - 1 && p.x <= n._w.x + n._w.w + 1 && p.y >= n._w.y - 1 && p.y <= n._w.y + n._w.h + 1;
      };
      const pointInNode = (n) => {
        if (n.visible === false || !n._wt) return false;
        const lp = W.worldToLocal(n, p.x, p.y);
        if (!lp) return false;
        const { x: lx, y: ly } = lp;
        const w = n.w, h = n.h;
        if (lx < -0.5 || lx > w + 0.5 || ly < -0.5 || ly > h + 0.5) return false;
        if (n.type === 'ellipse') {
          const rx = lx - w/2, ry = ly - h/2;
          return (rx*rx)/((w/2)*(w/2)) + (ry*ry)/((h/2)*(h/2)) <= 1.02;
        }
        if (n.type === 'line') {
          const pad = Math.max(4, (n.stroke && n.stroke.width) || 1) / this.view.zoom;
          return Math.abs(ly - h/2) <= pad && lx >= -pad && lx <= w + pad;
        }
        if (n.type === 'vector') {
          // Vector hit testing using Path2D.isPointInPath (fill) +
          // isPointInStroke (stroke). Falls back to bbox test when
          // Path2D is unavailable or the path is invalid.
          const d = n.path;
          if (d && typeof Path2D !== 'undefined') {
            try {
              const p = new Path2D(d);
              const pw = n.pathW || w, ph = n.pathH || h;
              // Transform local hit point to path-local space (inverse of
              // the scale(w/pw, h/ph) the renderer applies).
              const plx = pw > 0 ? lx * pw / w : lx;
              const ply = ph > 0 ? ly * ph / h : ly;
              const rule = n.windingRule === 'evenodd' ? 'evenodd' : 'nonzero';
              const fill = (n.fills || []).some(f => f && f.visible !== false && f.type !== 'none');
              const hasStroke = n.stroke && n.stroke.visible && n.stroke.width > 0;
              if (fill) {
                // We need a throwaway context for isPointInPath.
                if (!this._hitCtx) this._hitCtx = document.createElement('canvas').getContext('2d');
                this._hitCtx.save();
                if (hasStroke) {
                  this._hitCtx.lineWidth = (n.stroke.width || 1);
                  this._hitCtx.lineCap = n.stroke.cap || 'butt';
                  this._hitCtx.lineJoin = n.stroke.join || 'miter';
                  this._hitCtx.miterLimit = n.stroke.miter || 10;
                }
                const inFill = this._hitCtx.isPointInPath(p, plx, ply, rule);
                const inStroke = hasStroke ? this._hitCtx.isPointInStroke(p, plx, ply) : false;
                this._hitCtx.restore();
                if (inFill || inStroke) return true;
              } else if (hasStroke) {
                if (!this._hitCtx) this._hitCtx = document.createElement('canvas').getContext('2d');
                this._hitCtx.save();
                this._hitCtx.lineWidth = (n.stroke.width || 1);
                this._hitCtx.lineCap = n.stroke.cap || 'butt';
                this._hitCtx.lineJoin = n.stroke.join || 'miter';
                this._hitCtx.miterLimit = n.stroke.miter || 10;
                const inStroke = this._hitCtx.isPointInStroke(p, plx, ply);
                this._hitCtx.restore();
                if (inStroke) return true;
              }
              return false;
            } catch (e) { /* fall through to bbox */ }
          }
          return true;
        }
        return true;
      };
      const visit = (n) => {
        for (let i = n.children.length - 1; i >= 0; i--) {
          const k = page.nodes[n.children[i]];
          if (!k) continue;
          if (!frameClips(n)) continue;
          const r = visit(k);
          if (r) return r;
        }
        return pointInNode(n) ? n : null;
      };
      for (let i = page.tops.length - 1; i >= 0; i--) {
        const t = page.nodes[page.tops[i]];
        if (!t) continue;
        const r = visit(t);
        if (r) return r;
      }
      return null;
    },
    handleAt(e) {
      if (this.sel.length !== 1) return null;
      const n = this.page.nodes[this.sel[0]];
      if (!n || !n._wc) return null;
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const W = global.World;
      // Use world corners projected through the view transform — the SAME
      // geometry drawSelection uses. No parallel math.
      const corners = (W && W.screenCorners)
        ? W.screenCorners(this.view, n)
        : n._wc.map(p => ({ x: p.x*this.view.zoom + this.view.ox, y: p.y*this.view.zoom + this.view.oy }));
      const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
      const c0 = corners[0], c1 = corners[1], c2 = corners[2], c3 = corners[3];
      // 4 CORNER HANDLES ONLY — user requested Figma-style: 4 corners.
      // Edge midpoints are INVISIBLE hit zones (no square painted, but you
      // can still drag-resize near the edge line for one-axis resize).
      const cornerPts = [
        ['nw', c0.x, c0.y], ['ne', c1.x, c1.y],
        ['se', c2.x, c2.y], ['sw', c3.x, c3.y],
      ];
      // Corner handles are 7px white squares — hit radius 9px (Figma-feel:
      // slightly larger than visual, forgiving).
      for (const [name, x, y] of cornerPts) {
        if (Math.abs(mx - x) <= 9 && Math.abs(my - y) <= 9) return { name, node: n, kind: 'resize' };
      }
      // Invisible edge zones for one-axis resize. We check DISTANCE TO EDGE
      // SEGMENT (not just midpoint) so you can n-resize anywhere along the
      // top edge like in Figma.
      const edges = [
        ['n', c0, c1], ['e', c1, c2], ['s', c2, c3], ['w', c3, c0],
      ];
      for (const [name, a, b] of edges) {
        const ex2 = b.x - a.x, ey2 = b.y - a.y;
        const elen2 = ex2*ex2 + ey2*ey2;
        if (elen2 < 1) continue;
        let t = ((mx - a.x)*ex2 + (my - a.y)*ey2) / elen2;
        t = Math.max(0, Math.min(1, t));
        const px = a.x + t*ex2, py = a.y + t*ey2;
        const d = Math.hypot(mx - px, my - py);
        if (d <= 5) return { name, node: n, kind: 'resize' };
      }
      // Rotation is cursor-driven (outside-band, any direction). The
      // RotateInteraction module (rotate-interaction.js) wraps handleAt
      // and onDown/onMove to provide 8-direction rotate cursors and
      // outside-band rotate hits; we intentionally do NOT have a fixed
      // rotate dot here.
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

      const now = Date.now();
      // Reset click stamp if pointer moved far or too long passed.
      if (this._lastClick && (now - this._lastClick.t) > 600) this._lastClick = null;

      if (this.tool === 'comment') {
        Dialogs.prompt('Add a comment:', '').then((text) => {
          if (text) {
            this.history.begin(this.doc);
            global.Eco.Comments.add(this.doc, this.page.id, p.x, p.y, text.trim(), global.Collab.self ? global.Collab.self.name : 'You');
            this.history.end(this.doc);
            this.renderPins();
            this.markDirty();
          }
        });
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
      if (this.tool !== 'move' && this.tool !== 'scale') {
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
          e.preventDefault();
          this.history.begin(this.doc);
          const defaultSize = 16;
          const t = M.makeNode('text', { x: p.x, y: p.y - defaultSize * 0.2, w: 120, h: defaultSize * 1.3 });
          M.attach(this.doc, this.page, null, t);
          this.applyTextResize(t); // Figma: new text hugs its content (auto w+h)
          this.history.end(this.doc);
          this.setSel([t.id]);
          this.setTool('move');
          // Cancel any stale drag from previous interaction so the deferred
          // beginTextEdit doesn't fight canvas pointer logic.
          this._drag = null;
          this._snapGuides = null;
          // Defer beginTextEdit until AFTER the pointerdown/pointerup/click
          // event sequence fully completes. Browsers reject programmatic
          // .focus() calls made from inside a pointer gesture — focus only
          // works once the event loop has gone idle past pointerup.
          requestAnimationFrame(() => setTimeout(() => this.beginTextEdit(t), 16));
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
        this.setSel([n.id]);
        this._drag = { kind: 'create', node: n, sx: p.x, sy: p.y };
        return;
      }

      // move tool
      const h = this.handleAt(e);
      if (h) {
        this.history.begin(this.doc);
        const crect = this.canvas.getBoundingClientRect();
        if (h.kind === 'rotate') {
          const n = h.node;
          // Use WORLD center from n._w (or fallback for nodes without layout)
          const wb = n._w || { x: n.x, y: n.y, w: n.w, h: n.h };
          const cx = wb.x + wb.w/2, cy = wb.y + wb.h/2;
          const start = this.toWorld(e);
          this._drag = { kind: 'rotate', node: n, startRot: n.rotation || 0, cx, cy, sa: Math.atan2(start.y - cy, start.x - cx) };
          n._rotLabel = true;
        } else {
          // Record initial world-corner state so resize works through rotate/flip.
          const n = h.node;
          this._drag = {
            kind: 'resize', name: h.name, node: n,
            startW: n.w, startH: n.h,
            startLocalCx: n.x + n.w/2, startLocalCy: n.y + n.h/2,
            startWt: n._wt ? n._wt.slice() : null,
            sp: { x: e.clientX - crect.left, y: e.clientY - crect.top },
            ox: this.view.ox, oy: this.view.oy,
            scaleMode: this.tool === 'scale',
            scaleSnapshot: this.tool === 'scale' ? this.captureScaleTree(n) : null
          };
        }
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
        const alreadySelected = this.sel.includes(hit.id);
        // Click-click (slower than dblclick, but same intent) → edit text.
        // Fast double-clicks are handled by onDbl() — that's the primary path.
        if (hit.type === 'text' && alreadySelected) {
          const prev = this._lastClick;
          if (prev && prev.id === hit.id && (now - prev.t) < 600) {
            this._lastClick = null;
            this._drag = null;
            e.preventDefault();
            this.setSel([hit.id]);
            // Defer past pointerdown event tail (same rationale as T-tool).
            requestAnimationFrame(() => setTimeout(() => this.beginTextEdit(hit), 20));
            return;
          }
        }
        this._lastClick = { t: now, id: hit.id };
        if (!alreadySelected) this.setSel([hit.id]);
        const page = this.page;
        const starts = this.sel.map(id => { const n = page.nodes[id]; return n ? { id, x: n.x, y: n.y } : null; }).filter(Boolean);
        // Record pending drag; movement threshold in onMove decides if we really drag.
        // This is critical: without a threshold, a sub-pixel jitter during a double-click
        // starts a move drag and eats the second click.
        this._drag = { kind: 'pending-move', starts, sx: p.x, sy: p.y, moved: false, hit };
      } else {
        if (!e.shiftKey) { this.setSel([]); }
        this._drag = { kind: 'pending-marquee', sx: p.x, sy: p.y, base: e.shiftKey ? this.sel.slice() : [] };
      }
    },
    onMove(e) {
      const d = this._drag;
      const c = this.canvas;
      const rect = c.getBoundingClientRect();
      if (c && rect.width && e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom) {
        global.Collab.sendCursor(this.toWorld(e).x, this.toWorld(e).y);
      }
      // Active drag: update cursor to "grabbing" / "crosshair" appropriately
      if (d) {
        // Movement threshold before we commit to a drag (lets clicks/double-clicks fire cleanly)
        const MOVE_THRESH = 3 / this.view.zoom;
        if (d.kind === 'pending-move') {
          const p2 = this.toWorld(e);
          if (Math.hypot(p2.x - d.sx, p2.y - d.sy) > MOVE_THRESH) {
            d.kind = 'move';
            d.moved = true;
            this.history.begin(this.doc);
          } else {
            return;
          }
        } else if (d.kind === 'pending-marquee') {
          const p2 = this.toWorld(e);
          if (Math.hypot(p2.x - d.sx, p2.y - d.sy) > MOVE_THRESH) {
            d.kind = 'marquee';
            this.markDirty();
          } else {
            return;
          }
        }
        if (d.kind === 'pan') c.style.cursor = 'grabbing';
        else if (d.kind === 'rotate' || d.kind === 'rotate-multi') c.style.cursor = 'grabbing';
      }
      // hover cursor + rotate handle hover tracking
      if (!d) {
        if (this.tool === 'pen' && this.pen) { this.pen.cursor = this.toWorld(e); this.markDirty(); }
        // Track whether pointer is in the rotate-hover zone so drawSelection
        // can show/hide the rotate dot + connector.
        const mx = e.clientX - rect.left, my = e.clientY - rect.top;
        const wasHover = this.view._hoverRotate;
        const isHover = this._updateRotateHover(mx, my);
        const h = this.handleAt(e);
        if (h) c.style.cursor = cursorFor(h.name);
        else if (this.tool !== 'move' && this.tool !== 'scale') c.style.cursor = this.tool === 'text' ? 'text' : 'crosshair';
        else if (this.space) c.style.cursor = 'grab';
        else {
          const hit = this.hitTest(this.toWorld(e));
          const nextHover = hit ? hit.id : null;
          if (nextHover !== this.hoverId) { this.hoverId = nextHover; this._redrawLight(); }
          // I-beam cursor over text nodes (Figma muscle memory)
          if (hit && hit.type === 'text') c.style.cursor = 'text';
          else c.style.cursor = hit ? 'default' : 'default';
        }
        // Redraw if rotate hover state changed so the dot appears/disappears
        if (wasHover !== isHover) this.markDirty();
        return;
      }
      if (d.kind === 'pan') {
        this.view.ox = d.ox + (e.clientX - d.sx);
        this.view.oy = d.oy + (e.clientY - d.sy);
        // Pan only moves the camera; no node state changes. A light redraw
        // skips full layout + panels refresh to eliminate flicker.
        this._redrawLight();
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
      } else if (d.kind === 'rotate') {
        const ang = Math.atan2(p.y - d.cy, p.x - d.cx);
        let rot = ang - d.sa + d.startRot;
        if (e.shiftKey) {
          const snap = Math.PI / 12; // 15° increments with Shift (Figma standard)
          rot = Math.round(rot / snap) * snap;
        }
        // Normalize to [-PI, PI]
        while (rot > Math.PI) rot -= Math.PI * 2;
        while (rot < -Math.PI) rot += Math.PI * 2;
        d.node.rotation = rot;
        this.markDirty();
        const deg = M.toFigmaDeg ? M.toFigmaDeg(rot) : Math.round(rot * 180 / Math.PI);
        this.status(` ${deg}°`);
      } else if (d.kind === 'marquee') {
        const x = Math.min(d.sx, p.x), y = Math.min(d.sy, p.y);
        const w = Math.abs(p.x - d.sx), h = Math.abs(p.y - d.sy);
        this.marquee = this.toScreen({ x, y });
        this.marquee.w = w * this.view.zoom; this.marquee.h = h * this.view.zoom;
        // live selection preview
        const ids = marqueeSelect(this.page, { x, y, w, h }, { x: d.sx, y: d.sy });
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
      const p = this.toWorld(e);
      const W = global.World;
      const sw = d.startW, sh = d.startH;
      const movesE = d.name.includes('e'), movesW = d.name.includes('w');
      const movesS = d.name.includes('s'), movesN = d.name.includes('n');
      const isCorner = d.name.length === 2;

      // Snapshot anchor + handle in LOCAL content space on first move.
      // The anchor is the opposite corner/edge-midpoint that stays FIXED
      // in world space for the duration of the drag; this is the only
      // source of truth and works for rotated/flipped nodes too.
      if (!d._snapInitialized) {
        d._snapInitialized = true;
        const hmap = { nw:[0,0], n:[sw/2,0], ne:[sw,0], e:[sw,sh/2], se:[sw,sh], s:[sw/2,sh], sw:[0,sh], w:[0,sh/2] };
        const [hx, hy] = hmap[d.name] || [sw,sh];
        d._hx = hx; d._hy = hy;
        d._ax = sw - hx; d._ay = sh - hy;
        // Anchor's WORLD position at drag start — we will preserve this
        // exactly through every subsequent move so the opposite side
        // never drifts/teleports (this was the old "frame kahan chala
        // ja raha hai" bug — the n.x/n.y adjustment used to be plain
        // subtraction in parent-local space, which is wrong for rotated
        // nodes and has sign errors for left/top handles).
        const wt = n._wt;
        if (wt) {
          d._anchorWorld = W.transformPoint(wt, d._ax, d._ay);
        } else {
          d._anchorWorld = { x: n.x + d._ax, y: n.y + d._ay };
        }
        d._rot = n.rotation || 0;
        d._fh = n.flipH ? -1 : 1;
        d._fv = n.flipV ? -1 : 1;
      }

      // Map world pointer → node-local content coords using inverse of
      // the CURRENT (pre-resize) world transform. This reads the pointer
      // in the node's own rotated coordinate frame.
      let lpx, lpy;
      if (n._wt) {
        const lp = W.worldToLocal(n, p.x, p.y);
        if (!lp) return;
        lpx = lp.x; lpy = lp.y;
      } else { lpx = p.x - n.x; lpy = p.y - n.y; }

      // Compute new w/h from local pointer. Anchor-relative math: the
      // anchor is at (d._ax, d._ay) in local space; the dragged handle is
      // at (d._hx, d._hy). After resize the handle tracks lpx/lpy.
      let newW = sw, newH = sh;
      if (movesE) newW = Math.max(1, lpx);             // E side: local x is new width (anchor at x=0)
      else if (movesW) newW = Math.max(1, d._ax - lpx); // W side: local x negative, width = ax - lpx
      else newW = sw;
      if (movesS) newH = Math.max(1, lpy);              // S side
      else if (movesN) newH = Math.max(1, d._ay - lpy); // N side
      else newH = sh;
      // Guard against NaN/Infinity from a weird pointer event mid-drag.
      if (!isFinite(newW) || newW < 1) newW = sw;
      if (!isFinite(newH) || newH < 1) newH = sh;

      if (d.scaleMode || (isCorner && e.shiftKey)) {
        const ratio = sw / sh;
        if (!isCorner && (movesE || movesW)) newH = newW / ratio;
        else if (!isCorner && (movesN || movesS)) newW = newH * ratio;
        else if (newW / ratio > newH) newH = newW / ratio;
        else newW = newH * ratio;
      }

      // Solve for new n.x, n.y so anchor stays fixed in world space.
      // LocalToParent for anchor (ax,ay) in node-local coords with size (w,h),
      // rotation r, flips (fh,fv) is:
      //   T(x,y)·T(w/2,h/2)·R(r)·S(fh,fv)·T(-w/2,-h/2) · (ax,ay,1)
      // = (x + w/2 + cos(r)*fh*(ax-w/2) - sin(r)*fv*(ay-h/2),
      //    y + h/2 + sin(r)*fh*(ax-w/2) + cos(r)*fv*(ay-h/2))
      // Set this equal to anchorWorld = (awx, awy) and solve for x,y:
      const ax = d._ax, ay = d._ay;
      const rot = d._rot || 0, fh = d._fh || 1, fv = d._fv || 1;
      const cr = Math.cos(rot), sr = Math.sin(rot);
      const lx = (ax - newW/2) * fh;
      const ly = (ay - newH/2) * fv;
      const rx = lx*cr - ly*sr;
      const ry = lx*sr + ly*cr;
      n.x = d._anchorWorld.x - newW/2 - rx;
      n.y = d._anchorWorld.y - newH/2 - ry;
      n.w = newW; n.h = newH;
      if (d.scaleMode && d.scaleSnapshot) {
        const factor = sw ? newW / sw : 1;
        this.applyScaleTree(d.scaleSnapshot, factor);
      }

      // Sizing-mode transitions.
      if (n.type === 'text') {
        if (movesE || movesW) M.textResizeDemote(n, 'h');
        if (movesN || movesS) M.textResizeDemote(n, 'v');
        this.applyTextResize(n);
      }
      if (n.shape) n.path = this._shapePath(n);

      // Auto-layout children: if this node is an AL child (parent is
      // auto-layout), resizing it with the pointer promotes it to fixed
      // sizing on that axis so the layout engine doesn't fight us.
      if (n.parentId) {
        const parent = this.page.nodes[n.parentId];
        if (parent && parent.al) {
          if (parent.al.direction === 'horizontal' || parent.al.wrap) {
            if (movesW || movesE) { n.sizingW = 'fixed'; n.alW = newW; }
            if (movesN || movesS) { n.sizingH = 'fixed'; n.alH = newH; }
          } else {
            if (movesW || movesE) { n.sizingW = 'fixed'; n.alW = newW; }
            if (movesN || movesS) { n.sizingH = 'fixed'; n.alH = newH; }
          }
        }
      }

      this._snapGuides = null;
      this.markDirty();
      this.status('w ' + Math.round(n.w) + '   h ' + Math.round(n.h));
    },    statusPos() {
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
        const bb = n._w || { x: n.x, y: n.y, w: n.w, h: n.h };
        // s.x/s.y are parent-local at drag START; we need the world position at drag start.
        // For simplicity, use the pre-drag world BB from n._w (computed last frame).
        const sx = bb.x, sy = bb.y;
        x0 = Math.min(x0, sx + dx); y0 = Math.min(y0, sy + dy);
        x1 = Math.max(x1, sx + bb.w + dx); y1 = Math.max(y1, sy + bb.h + dy);
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
        const bb = n._w;
        if (bb && n.visible !== false && isFinite(bb.x) && isFinite(bb.w)) {
          xsT.push({ val: bb.x, side: 'left', y0: bb.y, y1: bb.y + bb.h });
          xsT.push({ val: bb.x + bb.w / 2, side: 'cx', y0: bb.y, y1: bb.y + bb.h });
          xsT.push({ val: bb.x + bb.w, side: 'right', y0: bb.y, y1: bb.y + bb.h });
          ysT.push({ val: bb.y, side: 'top', x0: bb.x, x1: bb.x + bb.w });
          ysT.push({ val: bb.y + bb.h / 2, side: 'cy', x0: bb.x, x1: bb.x + bb.w });
          ysT.push({ val: bb.y + bb.h, side: 'bottom', x0: bb.x, x1: bb.x + bb.w });
          // Text baseline snap: add a baseline target for text nodes.
          // Estimate baseline ≈ top + capHeight (≈ 0.72–0.8 of font size when
          // measured from the top of the text box). Figma snaps text
          // baselines to other baselines and to shape tops/centers.
          if (n.type === 'text' && n.text) {
            const fs = n.text.size || 14;
            const lhMul = (typeof n.text.lineHeight === 'number' && n.text.lineHeight > 0) ? n.text.lineHeight : 1.2;
            const lh = fs * lhMul;
            const valign = n.text.valign || 'top';
            const totalH = bb.h;
            let baseY;
            if (valign === 'middle') {
              const lines = Math.max(1, Math.round(totalH / lh));
              const firstBase = bb.y + (totalH - lines * lh) / 2 + lh * 0.82;
              baseY = firstBase;
            } else if (valign === 'bottom') {
              baseY = bb.y + totalH - lh * 0.18;
            } else {
              baseY = bb.y + lh * 0.82;
            }
            ysT.push({ val: baseY, side: 'baseline', x0: bb.x, x1: bb.x + bb.w, baseline: true });
          }
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
      // Determine if the moved selection includes a text node whose
      // baseline should participate in snap matching.
      let hasTextBase = false;
      for (const id of excludeIds) { const n = page.nodes[id]; if (n && n.type === 'text') { hasTextBase = true; break; } }
      // Build moving-box edges; include a baseline edge if any selected
      // text node would contribute one. We approximate the box's own
      // baseline the same way as the targets: top + lh*0.82 for top-aligned.
      const yEdges = [{ val: box.y, side: 'top' }, { val: box.y + box.h / 2, side: 'cy' }, { val: box.y + box.h, side: 'bottom' }];
      if (hasTextBase) {
        // Use a reasonable estimate: 14px * 1.2 * 0.82 from top of box.
        yEdges.push({ val: box.y + 14 * 1.2 * 0.82, side: 'baseline' });
      }
      const xs = pick(
        [{ val: box.x, side: 'left' }, { val: box.x + box.w / 2, side: 'cx' }, { val: box.x + box.w, side: 'right' }],
        xsT, 'x');
      const ys = pick(yEdges, ysT, 'y');
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
      // Clicks that never crossed the movement threshold — just cancel any history.
      if (d.kind === 'pending-move' || d.kind === 'pending-marquee') {
        this.history.cancel();
        if (d.kind === 'pending-move' && d.hit && this.sel.length > 1 && this.sel.includes(d.hit.id)) {
          // Figma: click (no drag) on one item of a multi-select → select only that
          this.setSel([d.hit.id]);
        }
        if (d.kind === 'pending-marquee') {
          // click on empty space with no modifier → clear selection already done in onDown
          this.marquee = null;
          delete this._marqueePreview;
        }
        this.markDirty();
        return;
      }
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
      else if (d.kind === 'rotate') {
        if (d.node) delete d.node._rotLabel;
        this.history.end(this.doc);
      }
      else this.history.cancel();
      this.markDirty();
    },
    onDbl(e) {
      if (this.tool === 'pen' && this.pen) { this.penCommit(true); return; }
      const p = this.toWorld(e);
      const hit = this.hitTest(p);
      // Cancel any in-progress click-drag state the pointerdown handler may
      // have started so the textarea doesn't get killed by an up/move handler.
      this._drag = null;
      this._snapGuides = null;
      this.marquee = null;
      delete this._marqueePreview;
      if (hit && hit.type === 'text') {
        this.setSel([hit.id]);
        this.markDirty();
        // Defer past the entire pointer event sequence (pointerdown → dblclick
        // → pointerup → click). Browsers will refuse programmatic .focus()
        // while a pointer gesture is still being dispatched.
        requestAnimationFrame(() => setTimeout(() => this.beginTextEdit(hit), 20));
      }
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
        const dpr = window.devicePixelRatio || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
        const dpr = window.devicePixelRatio || 1;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    // ------------------------------------------------------------- text editing
    _textEdit: null,
    beginTextEdit(n, opts) {
      // If already editing this exact node, do nothing. If editing a different
      // node, commit the old one first.
      if (this._textEdit) {
        if (this._textEdit.n === n) return;
        this.endTextEdit(true);
      }
      // Cancel any in-progress drag / marquee / pencil state so canvas
      // pointer logic can't steal focus or fight us.
      this._drag = null;
      this._snapGuides = null;
      this.marquee = null;
      if (this._marqueePreview) delete this._marqueePreview;
      // Ensure fresh layout + world geometry so n._w is accurate.
      try { this.layoutDoc(this.doc, this.page); } catch (e) {}
      if (global.World && global.World.computePage) { try { global.World.computePage(this.page); } catch (e) {} }

      const wrap = document.querySelector('.ed-canvas-wrap');
      if (!wrap) { this.toast('Canvas not ready', 1200, 'error'); return; }

      const z = this.view.zoom;
      const t = n.text || (n.text = {});
      const originalContent = t.content || '';
      const originalRuns = Array.isArray(t.runs) ? JSON.parse(JSON.stringify(t.runs)) : null;
      // Build world-space aabb (use _wc if present for rotated correctness, else _w)
      let sx, sy, sw, sh;
      if (n._wc && n._wc.length === 4) {
        let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
        for (const p of n._wc) { x0=Math.min(x0,p.x); y0=Math.min(y0,p.y); x1=Math.max(x1,p.x); y1=Math.max(y1,p.y); }
        sx = x0*z + this.view.ox; sy = y0*z + this.view.oy;
        sw = (x1-x0)*z; sh = (y1-y0)*z;
      } else {
        const wb = n._w || { x:n.x||0, y:n.y||0, w:n.w||24, h:n.h||24 };
        sx = wb.x*z + this.view.ox; sy = wb.y*z + this.view.oy; sw = wb.w*z; sh = wb.h*z;
      }
      sw = Math.max(40, sw); sh = Math.max(20, sh);

      const ta = document.createElement('textarea');
      ta.className = 'text-edit';
      ta.setAttribute('spellcheck','false');
      ta.setAttribute('autocomplete','off');
      ta.setAttribute('autocorrect','off');
      ta.setAttribute('autocapitalize','off');
      ta.setAttribute('data-role','text-edit');
      ta.value = t.content || '';

      const fam = (t.font || 'Inter').replace(/^["']|["']$/g, '');
      const familyCss = `"${fam}", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif`;
      const padH = 4, padV = 2;
      const fs = Math.max(8, Math.round((t.size||16)*z*10)/10);

      ta.style.cssText = [
        `position:absolute`,
        `left:${sx - padH}px`,
        `top:${sy - padV}px`,
        `width:${sw + padH*2}px`,
        `min-width:40px`,
        `height:${sh + padV*2}px`,
        `min-height:20px`,
        `z-index:20`,
        `margin:0`,
        `padding:${padV}px ${padH}px`,
        `border:1.5px solid #0d99ff`,
        `border-radius:2px`,
        `outline:none`,
        `resize:none`,
        `overflow:hidden`,
        `background:rgba(13,153,255,0.08)`,
        `box-shadow:0 0 0 1px rgba(13,153,255,0.35), 0 2px 8px rgba(0,0,0,0.35)`,
        `color:${this._textFillColor(n)}`,
        `font:${t.italic?'italic ':''}${t.weight||400} ${fs}px ${familyCss}`,
        `line-height:${String(t.lineHeight||1.2)}`,
        `letter-spacing:${((t.letterSpacing||0)*z)}px`,
        `text-align:${t.align||'left'}`,
        `text-decoration:${[t.underline?'underline':'',t.strike?'line-through':''].filter(Boolean).join(' ')||'none'}`,
        `white-space:pre-wrap`,
        `word-wrap:break-word`,
        `box-sizing:border-box`,
        `caret-color:#7c5cff`,
        `user-select:text`,
        `-webkit-user-select:text`,
        `tab-size:4`,
      ].join(';');

      wrap.appendChild(ta);
      R.setEditingText(n.id);
      this._redrawLight();

      // Commit logic
      let committed = false;
      const syncRect = () => {
        // Re-run layout+world transforms so box tracks new text size.
        try {
          const mode = (t.resize) || 'fixed';
          if (mode !== 'fixed' && !n.als) this.applyTextResize(n);
        } catch(e){}
        if (global.World && global.World.computePage) { try { global.World.computePage(this.page); } catch(e){} }
        let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
        if (n._wc) for (const p of n._wc) { x0=Math.min(x0,p.x); y0=Math.min(y0,p.y); x1=Math.max(x1,p.x); y1=Math.max(y1,p.y); }
        else { const wb=n._w||{x:n.x,y:n.y,w:n.w,h:n.h}; x0=wb.x; y0=wb.y; x1=wb.x+wb.w; y1=wb.y+wb.h; }
        const nsx = x0*z + this.view.ox, nsy = y0*z + this.view.oy;
        const nsw = Math.max(40,(x1-x0)*z), nsh = Math.max(20,(y1-y0)*z);
        ta.style.left = (nsx-padH)+'px';
        ta.style.top  = (nsy-padV)+'px';
        ta.style.width = (nsw+padH*2)+'px';
        ta.style.height = 'auto';
        ta.style.height = Math.max(nsh+padV*2, ta.scrollHeight+padV*2)+'px';
      };
      const commit = (ok) => {
        if (committed) return;
        committed = true;
        clearInterval(this._textFocusTimer);
        document.removeEventListener('mousedown', onOutside, true);
        // Ensure any in-progress canvas drag / marquee / pencil state
        // from the click that just closed us is cleared so it doesn't
        // continue running over a removed textarea.
        this._drag = null;
        this._snapGuides = null;
        this.marquee = null;
        if (this._marqueePreview) delete this._marqueePreview;
        if (this.pencil) this.pencil = null;
        if (ok) {
          const newVal = ta.value;
          // Restore the pre-edit value before opening the history batch so
          // undo captures the actual original instead of the live draft.
          t.content = originalContent;
          if (originalRuns) t.runs = originalRuns;
          else delete t.runs;
          if (newVal !== originalContent) {
            this.history.begin(this.doc);
            t.content = newVal.length ? newVal : ' ';
            // Inline editing produces one plain-text run. Keeping stale rich
            // runs would make the renderer show the old text after commit.
            delete t.runs;
            try { this.applyTextResize(n); } catch(e){}
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
        if (e.target === ta) return;
        if (ta.contains(e.target)) return;
        // Don't commit when clicking toolbar/menu/popover UI (they call
        // their own actions which may want to interact with the text node).
        // Keep this list in sync with any new popover/modal classes.
        if (e.target.closest && (
          e.target.closest('.ed-top') || e.target.closest('.ed-left') ||
          e.target.closest('.ed-right') || e.target.closest('.ed-toolbar') ||
          e.target.closest('.ed-zoom') || e.target.closest('.pf-menu') ||
          e.target.closest('.pf-palette') || e.target.closest('.pf-font-picker') ||
          e.target.closest('.ed-modal-backdrop') || e.target.closest('.modal-back') ||
          e.target.closest('.pf-modal') || e.target.closest('#arco-toast') ||
          e.target.closest('.pin.open') || e.target.closest('.peer-cursor'))) return;
        commit(true);
      };
      // Register outside-click AFTER pointer events fully finish. We use a
      // requestAnimationFrame + 80ms delay so the click/pointerup/click
      // events that opened us don't immediately close us — those events
      // often still propagate to the document 0-2 frames later.
      const registerOutside = () => document.addEventListener('mousedown', onOutside, true);
      requestAnimationFrame(() => setTimeout(registerOutside, 80));

      ta.addEventListener('input', () => {
        t.content = ta.value;
        syncRect();
        try { this._redrawLight(); } catch(e){}
      });
      // Capture phase keydown/keyup/keypress — this fires BEFORE the
      // window-level capture keydown listener used by present mode,
      // guaranteeing typing never dispatches to App shortcuts / nudge /
      // delete-selection / setTool while editing text.
      const keyP = (ev) => { ev.stopPropagation(); ev.stopImmediatePropagation && ev.stopImmediatePropagation(); };
      ta.addEventListener('keydown', (ev) => {
        keyP(ev);
        if (ev.key === 'Escape') { ev.preventDefault(); commit(false); return; }
        else if (ev.key === 'Enter' && (ev.metaKey||ev.ctrlKey)) { ev.preventDefault(); commit(true); return; }
        else if (ev.key === 'Tab') {
          // Tab inserts a tab character inside the textarea instead of
          // moving focus to the next element. (Shift+Tab still blurs in
          // most browsers — leave that alone for accessibility.)
          ev.preventDefault();
          const s = ta.selectionStart ?? ta.value.length;
          const e = ta.selectionEnd ?? s;
          ta.value = ta.value.slice(0, s) + '\t' + ta.value.slice(e);
          ta.selectionStart = ta.selectionEnd = s + 1;
          // Trigger the input path manually since setting value doesn't.
          t.content = ta.value;
          syncRect();
          try { this._redrawLight(); } catch(ignored){}
          return;
        }
        // Native Ctrl/Cmd+A/C/V/X/Z/Y are handled by the textarea itself;
        // preventDefault is NOT called on them so native behavior works.
        if (ev.metaKey || ev.ctrlKey) {
          const k = ev.key.toLowerCase();
          if (!('aczxyvy'.includes(k))) {
            // Block non-text-editing combos from doing app-level things
            // (e.g. Ctrl+F, Ctrl+G, Ctrl+D etc.) while editing.
            ev.preventDefault();
          }
        }
        // Allow arrow keys to navigate within textarea without nudge
        if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(ev.key)) {
          // native behavior, already prevented propagation above.
        }
      }, true);
      ta.addEventListener('keyup', keyP, true);
      ta.addEventListener('keypress', keyP, true);
      // Composition events (IME / dead keys) must also not bubble up to
      // trigger shortcuts while mid-composition.
      ta.addEventListener('compositionstart', keyP, true);
      ta.addEventListener('compositionupdate', keyP, true);
      ta.addEventListener('compositionend', keyP, true);
      ta.addEventListener('focus', () => {
        // Re-assert focus — some browsers fire focus but then immediately
        // steal it back if a layout pass runs. Set up a repeating keep-alive
        // watchdog that fires every 200ms while the textarea is mounted;
        // cleared on commit / endTextEdit so it does not leak.
        clearInterval(this._textFocusTimer);
        this._textFocusTimer = setInterval(() => {
          if (committed) { clearInterval(this._textFocusTimer); return; }
          if (document.activeElement !== ta) {
            // Only fight for focus if focus landed somewhere we don't
            // want it (body, canvas, null) — let it go to other text
            // inputs in the inspector (color hex, number fields, etc.).
            const ae = document.activeElement;
            if (!ae || ae === document.body || ae === this.canvas) {
              try { ta.focus({preventScroll:true}); } catch(e){}
            }
          }
        }, 200);
      });
      // Prevent mousedown/touchstart/pointerdown on the textarea from
      // reaching the canvas (which would set up a drag or clear selection
      // and could yank focus back to the body). Also intercept focusin
      // dispatched by the browser itself so that any code that tries to
      // move focus away while the editor is open is fought.
      const stopP = (ev) => { ev.stopPropagation(); ev.stopImmediatePropagation && ev.stopImmediatePropagation(); };
      // Input/change/paste/cut events shouldn't propagate to canvas either.
      ta.addEventListener('input', stopP, true);
      ta.addEventListener('paste', stopP, true);
      ta.addEventListener('cut', stopP, true);
      ta.addEventListener('focusin', stopP, true);
      ta.addEventListener('mousedown', stopP, true);
      ta.addEventListener('mouseup', stopP, true);
      ta.addEventListener('click', stopP, true);
      ta.addEventListener('dblclick', stopP, true);
      ta.addEventListener('pointerdown', stopP, true);
      ta.addEventListener('pointerup', stopP, true);
      ta.addEventListener('touchstart', stopP, {passive:true, capture:true});
      ta.addEventListener('touchend', stopP, {passive:true, capture:true});
      ta.addEventListener('contextmenu', stopP, true);
      // Watch for focus leaving the textarea to something that ISN'T the
      // editor chrome (e.g. body / canvas) and bring it back. Inspector
      // inputs are allowed so bold/color/font can be edited while text
      // is open — the 200ms blur handler already defers commit; this
      // watchdog additionally re-focuses if the canvas steals it.
      ta.addEventListener('focusout', () => {
        if (committed) return;
        setTimeout(() => {
          if (committed) return;
          const ae = document.activeElement;
          // If focus landed back on body or the canvas (the two most
          // common "focus was stolen" cases), re-focus the textarea.
          if (!ae || ae === document.body || ae === this.canvas) {
            try { ta.focus({preventScroll:true}); } catch(e){}
          }
        }, 0);
      });
      // Blur should NOT commit immediately — if focus is lost to another
      // element in the toolbar/panels the user is just adjusting settings;
      // commit only on click outside the textarea wrapper.
      ta.addEventListener('blur', () => {
        // Give the browser a tick to settle focus on another element; if
        // focus moved outside the canvas-wrap entirely (e.g., to the URL
        // bar or a devtools panel), commit. Otherwise stay open so that
        // inspector controls can modify the text while the editor is up.
        setTimeout(() => {
          if (committed) return;
          const ae = document.activeElement;
          if (ae && (ae === ta || (wrap && wrap.contains(ae)))) return;
          // Only commit if focus went somewhere we don't control (like
          // the URL bar, or outside the editor chrome).
          if (ae && ae.closest && ae.closest('#view-editor')) return;
          commit(true);
        }, 200);
      });

      this._textEdit = { n, ta, commit };
      this.status('Editing text — Esc to cancel, Ctrl/⌘+Enter to commit');

      // FOCUS: Browsers reject programmatic .focus() calls that happen
      // while a pointer/click gesture is still being dispatched. Defer
      // focus until well after pointerdown/pointerup/click have all
      // finished; retry multiple times in case focus gets stolen by a
      // late rAF redraw or a browser-specific anti-popup timer.
      let focusAttempts = 0;
      const tryFocus = () => {
        if (committed || !this._textEdit || this._textEdit.ta !== ta) return;
        focusAttempts++;
        if (document.activeElement === ta) return;
        try {
          // Blur whatever currently has focus first — some browsers
          // (Safari in particular) refuse to move focus away from the
          // body inside a pointer event unless you explicitly blur it.
          if (document.activeElement && document.activeElement !== document.body && document.activeElement !== ta) {
            try { document.activeElement.blur(); } catch(_){}
          }
          // Ensure textarea is still in DOM before focus
          if (!ta.isConnected && wrap) wrap.appendChild(ta);
          ta.focus({preventScroll:true});
        } catch(e){
          try { ta.focus(); } catch(_){}
        }
        // After focusing, select ALL text so typing replaces. This
        // matches Figma: clicking/double-clicking/Enter on text selects
        // it; the user can click again or use arrow keys to position caret.
        if (document.activeElement === ta) {
          const len = ta.value.length;
          try { ta.setSelectionRange(0, len); } catch(e){}
        }
      };
      // Schedule focus attempts at increasing delays. First waits a full
      // rAF turn after the event unwinds, then retries at 16/50/120/300/600ms
      // to handle various browser timing quirks.
      const runFocusSchedule = () => {
        tryFocus();
        if (!committed && focusAttempts < 15) {
          setTimeout(tryFocus, 16);
          setTimeout(tryFocus, 50);
          setTimeout(tryFocus, 120);
          setTimeout(tryFocus, 300);
          setTimeout(tryFocus, 600);
        }
      };
      requestAnimationFrame(runFocusSchedule);
      // After mounting and first layout, correct the rect and re-focus.
      requestAnimationFrame(() => { if (!committed) syncRect(); tryFocus(); });
    },
    endTextEdit(commit) {
      clearInterval(this._textFocusTimer);
      if (this._textEdit) {
        if (this._textEdit.commit) this._textEdit.commit(commit !== false);
        else {
          const { ta } = this._textEdit;
          if (ta && ta.parentNode) ta.remove();
          R.setEditingText(null);
          this._textEdit = null;
          this.markDirty();
        }
      }
    },
    _textFillColor(n) {
      // Pick a readable color for the in-place editor: prefer the first visible
      // solid fill; default white for the dark canvas.
      if (n.fills && n.fills.length) {
        for (const f of n.fills) {
          if (!f) continue;
          if (f.visible === false) continue;
          if (f.type !== 'solid') continue;
          if (!f.color) continue;
          // Dark text on dark canvas is invisible — force white.
          const m = String(f.color).match(/^#?([0-9a-f]{6})$/i);
          if (m) {
            const r = parseInt(m[1].slice(0,2),16), g = parseInt(m[1].slice(2,4),16), b = parseInt(m[1].slice(4,6),16);
            const lum = (r*299 + g*587 + b*114)/1000;
            if (lum < 60) return '#ffffff';
          }
          return f.color;
        }
      }
      return '#ffffff';
    },

    // ------------------------------------------------------------- wheel / zoom
    // Smooth-zoom accumulator so wheel zoom doesn't jitter (Figma zooms
    // continuously rather than per-event redraw with quantization).
    // Critical: camera-only changes (zoom/pan) draw in the SAME rAF as the
    // state mutation — no second rAF, no re-layout. Otherwise there is a
    // 1-frame gap where zoom has changed but canvas hasn't repainted, which
    // is what users see as "flicker" during zoom.
    _wheelZoomAcc: 0,
    onWheel(e) {
      const rect = this.canvas.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        this._wheelZoomAcc += -e.deltaY;
        if (this._wheelRaf) return;
        this._wheelRaf = requestAnimationFrame(() => {
          const acc = this._wheelZoomAcc;
          this._wheelZoomAcc = 0;
          this._wheelRaf = null;
          const f = Math.exp(acc * 0.0022);
          // Camera move only — mutate view and redraw LIGHTLY in this SAME
          // frame. Do NOT call markDirty (which schedules another rAF + runs
          // full layout) because no node geometry changed.
          this._applyZoomAt(px, py, f);
          this._redrawLight();
          this.updateZoomLabel();
        });
      } else {
        e.preventDefault();
        // Figma: shift+wheel = horizontal scroll; regular = vertical.
        // Direct mutation + light redraw, no layout, no extra rAF.
        this.view.ox -= e.shiftKey ? e.deltaY : e.deltaX;
        this.view.oy -= e.shiftKey ? 0 : e.deltaY;
        this._redrawLight();
      }
    },
    // Camera zoom math only — mutate view.zoom/ox/oy, no redraw, no markDirty.
    _applyZoomAt(px, py, factor) {
      const z0 = this.view.zoom;
      const z1 = Math.max(0.04, Math.min(24, z0 * factor));
      const f = z1 / z0;
      this.view.ox = px - (px - this.view.ox) * f;
      this.view.oy = py - (py - this.view.oy) * f;
      this.view.zoom = z1;
    },
    // Light redraw: skip re-layout & panels refresh. Used during fast
    // continuous interactions (pan/zoom-in-progress) where we don't want
    // the cost of full layout each frame. Selection/hit-test already
    // uses last frame's _wt/_wc which is valid because we're not mutating
    // any node, just changing the camera.
    _redrawLight() {
      const c = this.canvas; if (!c) return;
      const ctx = this.ctx; if (!ctx) return;
      const rect = c.getBoundingClientRect();
      const v = this.view;
      R.drawPage(ctx, this.page, this.doc, { zoom: v.zoom, ox: v.ox, oy: v.oy, w: rect.width, h: rect.height, grid: v.grid, pixelPreview: v.pixelPreview, canvasColor: v.canvasColor });
      R.drawSelection(ctx, this.view, this.sel, this.page);
      if (this.marquee) R.drawMarquee(ctx, this.marquee);
      this.drawPenOverlay(ctx);
      R.drawSnapGuides(ctx, this.view, this._snapGuides);
      R.drawRulers(ctx, this.view, rect.width, rect.height);
      this.updateZoomLabel();
    },
    zoomAt(px, py, factor) {
      this._applyZoomAt(px, py, factor);
      this.markDirty();
    },
    zoomBy(f) {
      const rect = this.canvas.getBoundingClientRect();
      this.zoomAt(rect.width / 2, rect.height / 2, f);
    },
    zoomToFit() {
      if (this.doc && this.page) {
        try { this.layoutDoc(this.doc, this.page); } catch (e) {}
      }
      const b = R.pageBounds(this.page);
      const rect = this.canvas ? this.canvas.getBoundingClientRect() : { width: 0, height: 0 };
      if (!rect.width || !rect.height) { requestAnimationFrame(() => this.zoomToFit()); return; }
      if (!b || !isFinite(b.w) || !isFinite(b.h) || b.w < 1 || b.h < 1) {
        this.view.zoom = 1;
        this.view.ox = rect.width / 2 - 80;
        this.view.oy = rect.height / 2 - 80;
        this.markDirty();
        return;
      }
      const z = Math.min(4, Math.min((rect.width - 96) / Math.max(1, b.w), (rect.height - 96) / Math.max(1, b.h)));
      this.view.zoom = Math.max(0.02, z);
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
      // Switching tools commits any in-progress text edit so focus returns
      // to canvas and no orphan textarea lingers.
      if (this._textEdit) this.endTextEdit(true);
      // leaving the pen/pencil tools: commit in-progress work
      if (this.tool === 'pen') this.penCommit(false, { silent: true });
      if (this.tool === 'pencil' && this.pencil) this.pencilAbort();
      this.tool = t;
      const tb = document.getElementById('ed-toolbar');
      if (tb) tb.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
      if (this.canvas) this.canvas.style.cursor = t === 'move' ? 'default' : t === 'scale' ? 'nwse-resize' : t === 'text' ? 'text' : t === 'hand' ? 'grab' : 'crosshair';
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
      // Modal trap: canvas shortcuts must not fire under a dialog.
      // Dialogs.js handles Escape/Enter itself; we only swallow the rest
      // and, if Escape reached us (focus not in the dialog), click the
      // backdrop — every modal here already closes on backdrop click.
      const modal = Array.from(document.querySelectorAll('.pf-dialog-backdrop, .ed-modal-backdrop, .modal-back'))
        .find((el) => el.style.display !== 'none' && getComputedStyle(el).display !== 'none');
      if (modal) {
        if (e.key === 'Escape') {
          e.preventDefault();
          modal.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
        return;
      }
      if (this._paletteEl) { this.paletteKey(e); return; }
      if (this.doc && document.getElementById('view-editor').style.display !== 'none') {
        if (this.penKey(e)) return;
        // Figma muscle memory: Enter on a single selected text node → edit it.
        if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && this.sel.length === 1) {
          const n = this.page.nodes[this.sel[0]];
          if (n && n.type === 'text') {
            e.preventDefault();
            requestAnimationFrame(() => setTimeout(() => this.beginTextEdit(n), 16));
            return;
          }
        }
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
      if (this.history.undo(this.doc)) { this.setSel([]); }
    },
    historyRedo() {
      if (this.history.redo(this.doc)) { this.setSel([]); }
    },
    selectAll() { this.setSel(this.page.tops.slice()); },
    alignSel(kind) {
      if (!this.sel.length || !global.Arrange) return;
      this.history.begin(this.doc);
      global.Arrange.align(this.page, this.sel, kind);
      this.history.end(this.doc);
      global.Panels.refreshInspector();
      this.markDirty();
    },
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
    resizeBy(dw, dh, e) {
      if (!this.sel.length) return;
      const step = e && e.shiftKey ? 10 : 1;
      this.history.begin(this.doc);
      for (const id of this.sel) {
        const n = this.page.nodes[id];
        if (!n || n.locked) continue;
        if (dw) n.w = Math.max(1, n.w + dw * step);
        if (dh) n.h = Math.max(1, n.h + dh * step);
        if (n.shape) n.path = this._shapePath(n);
        if (n.type === 'text' && M.textResizeDemote) {
          if (dw) M.textResizeDemote(n, 'h');
          if (dh) M.textResizeDemote(n, 'v');
        }
      }
      this.history.end(this.doc);
      global.Panels.refreshInspector();
      this.markDirty();
    },
    captureScaleTree(root) {
      const out = [];
      const visit = (n, isRoot) => {
        out.push({ n, isRoot, x:n.x, y:n.y, w:n.w, h:n.h,
          radius:Array.isArray(n.radius)?n.radius.slice():n.radius,
          stroke:n.stroke ? { width:n.stroke.width||0, dash:(n.stroke.dash||[]).slice() } : null,
          size:n.size, letterSpacing:n.letterSpacing, blur:n.blur,
          shadows:(n.shadows||[]).map(s=>({x:s.x||0,y:s.y||0,blur:s.blur||0,spread:s.spread||0})),
          al:n.al ? JSON.parse(JSON.stringify(n.al)) : null });
        for (const id of n.children || []) { const c=this.page.nodes[id]; if(c) visit(c,false); }
      };
      visit(root,true);
      return out;
    },
    applyScaleTree(snapshot, factor) {
      if (!isFinite(factor) || factor <= 0) return;
      const mul = v => typeof v === 'number' ? v * factor : v;
      for (const s of snapshot) {
        const n=s.n;
        if (!s.isRoot) { n.x=s.x*factor; n.y=s.y*factor; n.w=Math.max(1,s.w*factor); n.h=Math.max(1,s.h*factor); }
        n.radius=Array.isArray(s.radius)?s.radius.map(mul):mul(s.radius);
        if(n.stroke&&s.stroke){ n.stroke.width=mul(s.stroke.width); n.stroke.dash=s.stroke.dash.map(mul); }
        if(typeof s.size==='number') n.size=Math.max(1,mul(s.size));
        if(typeof s.letterSpacing==='number') n.letterSpacing=mul(s.letterSpacing);
        if(typeof s.blur==='number') n.blur=mul(s.blur);
        (n.shadows||[]).forEach((sh,i)=>{const b=s.shadows[i];if(b){sh.x=mul(b.x);sh.y=mul(b.y);sh.blur=mul(b.blur);sh.spread=mul(b.spread);}});
        if(n.al&&s.al){
          n.al=JSON.parse(JSON.stringify(s.al));
          ['gap','gapCross'].forEach(k=>{if(n.al[k]&&typeof n.al[k].n==='number')n.al[k].n*=factor;});
          if(Array.isArray(n.al.pad)) n.al.pad.forEach(p=>{if(p&&typeof p.n==='number')p.n*=factor;});
        }
        if(n.shape) n.path=this._shapePath(n);
      }
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
      this.setSel([]);
      this.setTool('move');
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
        { label: 'Flip horizontal', hint: '⇧H', kw: 'mirror', run: () => A.flipSel('h') },
        { label: 'Flip vertical', hint: '⇧V', kw: 'mirror', run: () => A.flipSel('v') },
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
    commandPalette() { this.palette(); },
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
    paste(inPlace) {
      if (!this.clipboard) return;
      this.history.begin(this.doc);
      const page = this.page;
      const newSel = [];
      for (const t of this.clipboard.trees) {
        // clones registered straight into the live page, then attached
        const c = M.deepClone(page, t, true, page);
        if (!inPlace) { c.x += 20; c.y += 20; }
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
      this.history.end(this.doc);
      this.setSel([]);
    },
    flipSel(axis) {
      const ids = this.sel.filter(id => { const n = this.page.nodes[id]; return n && !n.locked; });
      if (!ids.length) return;
      this.history.begin(this.doc);
      for (const id of ids) {
        const n = this.page.nodes[id];
        if (axis === 'h') n.flipH = !n.flipH;
        else n.flipV = !n.flipV;
      }
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
      const kids = M.kids(page, g).map(k => ({ k, x: (g._w?g._w.x:g.x) + k.x, y: (g._w?g._w.y:g.y) + k.y }));
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
          const cw = Math.max(1, Math.round(r.width)), ch = Math.max(1, Math.round(r.height));
          c.width = cw; c.height = ch;
          c.style.width = cw + 'px'; c.style.height = ch + 'px';
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
        minX = Math.min(minX, c._w.x); minY = Math.min(minY, c._w.y);
        maxX = Math.max(maxX, c._w.x + c._l.w); maxY = Math.max(maxY, c._w.y + c._l.h);
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
      const L = n._w ? { x: n._w.x, y: n._w.y, w: n._w.w, h: n._w.h } : { x: n.x, y: n.y, w: n.w, h: n.h };
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
            ctx.strokeRect(n._w.x - 2 / v.zoom, n._w.y - 2 / v.zoom, n._w.w + 4 / v.zoom, n._w.h + 4 / v.zoom);
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
            if (k._l && k.interactions && k.interactions.length && !nav2 && ox >= k._w.x && ox <= k._w.x + k._w.w && oy >= k._w.y && oy <= k._w.y + k._w.h) nav2 = k;
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
      let el = document.getElementById('arco-toast');
      if (!el) {
        el = document.createElement('div');
        el.id = 'arco-toast';
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
    if (h === 'rotate') return 'grab';
    return { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize' }[h] || 'default';
  }
  function marqueeSelect(page, box) {
    const out = [];
    const visit = (n) => {
      const bb = n._w;
      if (!bb) return;
      const x2 = bb.x + bb.w, y2 = bb.y + bb.h;
      if (x2 >= box.x && bb.x <= box.x + box.w && y2 >= box.y && bb.y <= box.y + box.h) out.push(n.id);
      for (const cid of n.children) { const k = page.nodes[cid]; if (k) visit(k); }
    };
    for (const tid of page.tops) { const t = page.nodes[tid]; if (t) visit(t); }
    return out;
  }

  global.App = App;
})(window);
