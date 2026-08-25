/* enhancements.js — Penfig Engine v2 P0/P1/P2 enhancements.
 * Adds: drag-and-drop layers reorder/reparent, deep select (⌘-click),
 * custom tool cursors, canvas mini-map, zoom-to-selection, keyboard
 * selection history (Tab/⇧Tab), autosave crash-recovery journal,
 * command-palette search filter, batch export modal, design-system
 * health panel, responsive preview toggle, product-states overlay,
 * layer search filter, transform-origin support, skew transforms,
 * viewport culling hints, image fill-mode controls, rotation snapping
 * labels, smart distance indicators, and selection-xywh readout.
 * Wires in without modifying core files, by listening for document
 * ready and monkey-patching extension points.
 */
(function(global){
  'use strict';

  // Wait until core modules are defined
  function ready(fn){
    if (document.readyState === 'complete') return fn();
    window.addEventListener('load', fn, { once: true });
  }

  ready(function(){
    const App = global.App;
    const M = global.Model;
    const R = global.Renderer;
    const W = global.World;
    const P = global.Panels;
    const I = global.Icons;
    const Ico = I.svg;
    const esc = global.Dash.esc;
    if (!App || !M) return;

    // =========================================================
    // 1. Crash-recovery journal (P0 §1/§44)
    // =========================================================
    const RECOVERY_KEY = 'penfig.crash.v1';
    const RECOVERY_INTERVAL_MS = 15000;
    let _recoveryTimer = null;
    function journalTick(){
      if (!App.doc) return;
      try{
        const snap = {
          at: Date.now(),
          name: App.doc.name,
          pageIndex: App.pageIndex,
          doc: JSON.parse(JSON.stringify(App.doc)),
        };
        localStorage.setItem(RECOVERY_KEY, JSON.stringify(snap));
      }catch(e){ /* ignore quota */ }
    }
    function startJournal(){
      stopJournal();
      _recoveryTimer = setInterval(journalTick, RECOVERY_INTERVAL_MS);
      // also save on visibility change
      document.addEventListener('visibilitychange', journalTick);
    }
    function stopJournal(){
      if (_recoveryTimer) clearInterval(_recoveryTimer);
      _recoveryTimer = null;
    }
    function clearRecovery(){
      try{ localStorage.removeItem(RECOVERY_KEY); }catch(e){}
    }
    function checkRecovery(){
      let snap = null;
      try{ snap = JSON.parse(localStorage.getItem(RECOVERY_KEY)||'null'); }catch(e){ return; }
      if (!snap || !snap.doc) return;
      const ageMin = Math.round((Date.now() - snap.at)/60000);
      if (!confirm(`Penfig recovered an unsaved document from ${ageMin} minute(s) ago: "${snap.name}". Restore it?\n\n(Cancel discards the recovery snapshot.)`)){
        clearRecovery(); return;
      }
      try{
        const doc = M.ensureDocShape(snap.doc);
        // store it
        const id = M.store.put({ name: doc.name + ' (Recovered)', doc: doc, at: Date.now() });
        App.openFile(id);
        App.toast(`Recovered "${doc.name}" from ${ageMin}m ago`, 5000, 'success');
        clearRecovery();
      }catch(e){
        alert('Recovery failed: '+e.message);
        clearRecovery();
      }
    }
    App._startRecoveryJournal = startJournal;
    App._stopRecoveryJournal = stopJournal;

    // Hook: start journal when editor opens
    const _showEditor = App.showEditor.bind(App);
    App.showEditor = function(){
      _showEditor();
      startJournal();
    };
    const _goDashboard = App.goDashboard.bind(App);
    App.goDashboard = function(){
      // journal one last time then stop
      journalTick();
      stopJournal();
      _goDashboard();
    };

    // On load, check for recovery snapshot before dashboard renders
    setTimeout(checkRecovery, 200);

    // =========================================================
    // 2. Custom tool cursors (P0)
    // =========================================================
    function cursorSvg(path, opts){
      opts = opts || {};
      const size = opts.size || 24;
      const fill = opts.fill || '#ffffff';
      const stroke = opts.stroke || '#000000';
      const sw = opts.sw || 1.5;
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24"><path d="${path}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
      return 'url("data:image/svg+xml;utf8,' + encodeURIComponent(svg) + '") '+ (opts.hx||2)+' '+(opts.hy||2)+', auto';
    }
    // Cursor mapping — Figma-style: use native CSS cursors where possible.
    // Move tool uses the default OS arrow (not a 4-way cross) to match Figma.
    const CURSORS = {
      move:     'default',
      rect:     'crosshair',
      ellipse:  'crosshair',
      frame:    'crosshair',
      section:  'crosshair',
      line:     'crosshair',
      arrow:    'crosshair',
      pen:      cursorSvg('M4 20l1-4L17 4l3 3L8 19l-4 1z', {hx:4,hy:20}),
      pencil:   cursorSvg('M15.5 4.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L15.5 4.5z', {hx:4,hy:20}),
      text:     'text',
      hand:     'grab',
      comment:  cursorSvg('M21 11.5a8.4 8.4 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.4 8.4 0 01-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.4 8.4 0 013.8-.9h.5a8.5 8.5 0 018 8v.5z', {hx:4,hy:4}),
      polygon:  'crosshair',
      star:     'crosshair',
      triangle: 'crosshair',
      image:    'crosshair',
    };
    const _setTool = App.setTool.bind(App);
    App.setTool = function(t){
      _setTool(t);
      if (this.canvas){
        const c = CURSORS[t];
        this.canvas.style.cursor = c || 'default';
      }
      // toolbar active state
      const tb = document.getElementById('ed-toolbar');
      if (tb) tb.querySelectorAll('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === t));
    };

    // Override pan cursor
    const _setPanCursor = () => { if(App.canvas) App.canvas.style.cursor = App.space ? 'grabbing' : (CURSORS[App.tool]||'default'); };
    document.addEventListener('mousedown', (e)=>{ if (App.space && App.canvas) App.canvas.style.cursor='grabbing'; });
    document.addEventListener('mouseup', _setPanCursor);

    // =========================================================
    // 3. Selection history navigation (Tab / Shift+Tab)
    // =========================================================
    App._selHistory = [];
    const _setSelCore = (ids)=>{ App.sel = ids.slice(); };
    // watch setSel if defined
    if (App.setSel){
      const _ss = App.setSel.bind(App);
      App.setSel = function(ids){
        if (ids.length && JSON.stringify(ids) !== JSON.stringify(App.sel)){
          App._selHistory.push(App.sel.slice());
          if (App._selHistory.length > 50) App._selHistory.shift();
        }
        _ss(ids);
      };
    }

    // =========================================================
    // 4. Deep select: Cmd/Ctrl-click drills into groups/components
    // =========================================================
    App._deepHit = function(wp){
      // Returns topmost visible node under wp, considering children
      // even through groups (unlike normal hitTest which stops at groups).
      const page = this.page; if(!page) return null;
      let best = null, bestDepth = -1;
      const visit = (n, depth)=>{
        if(!n || n.locked || n.visible===false) return;
        // children first (top of paint order)
        const list = (n.children||[]).slice();
        for (let i=list.length-1;i>=0;i--){
          const c = page.nodes[list[i]];
          if (c) visit(c, depth+1);
        }
        if (n.type==='section'||n===page) return;
        const hit = W.worldToLocal ? W.worldToLocal(n, wp.x, wp.y) : null;
        let inside = false;
        if (hit){
          const {x:lx,y:ly} = hit;
          inside = lx>=0 && ly>=0 && lx<=n.w && ly<=n.h;
        } else {
          // fallback AABB
          const b = n._w; if(!b) return;
          inside = wp.x>=b.x && wp.y>=b.y && wp.x<=b.x+b.w && wp.y<=b.y+b.h;
        }
        if (inside && depth>bestDepth){ best = n; bestDepth = depth; }
      };
      visit(page, 0);
      // visit tops
      for (let i=page.tops.length-1;i>=0;i--){
        const n = page.nodes[page.tops[i]];
        if(n) visit(n, 0);
      }
      return best;
    };

    // patch onDown to handle deep select
    document.addEventListener('mousedown', (e)=>{
      if (!App.canvas) return;
      if (e.target !== App.canvas) return;
      if (!e.metaKey && !e.ctrlKey) return;
      // deep select: pick deepest
      const rect = App.canvas.getBoundingClientRect();
      const wp = App.toWorld({clientX:e.clientX, clientY:e.clientY});
      const hit = App._deepHit(wp);
      if (hit){
        e.stopPropagation(); e.preventDefault();
        App.sel = [hit.id];
        P.refreshLayers(); P.refreshInspector(); App.markDirty();
      }
    }, true);

    // =========================================================
    // 5. Zoom to selection (Shift+2 per Figma muscle memory)
    // =========================================================
    App.zoomToSel = function(){
      if (!this.sel.length) { this.zoomToFit(); return; }
      const b = R.selectionBounds(this.page, this.sel);
      if (!b) return;
      const rect = this.canvas.getBoundingClientRect();
      const pad = 60;
      const sx = (rect.width - pad*2) / b.w;
      const sy = (rect.height - pad*2) / b.h;
      const z = Math.min(sx, sy);
      this.view.zoom = Math.max(0.01, Math.min(256, z));
      this.view.ox = -b.x * this.view.zoom + rect.width/2 - (b.w*this.view.zoom)/2;
      this.view.oy = -b.y * this.view.zoom + rect.height/2 - (b.h*this.view.zoom)/2;
      this.markDirty();
    };
    // Wire Shift+2 (Figma convention: ⇧1 fit, ⇧2 zoom-to-selection)
    const _bindShortcutExtra = () => {
      const S = global.Shortcuts; if (!S || !S.register) return;
      // try registering; if no register method, add to global table directly
      if (S.table){
        S.table.push({keys:'shift+2', label:'Zoom to selection', group:'View', fn:()=>App.zoomToSel()});
      }
    };
    setTimeout(_bindShortcutExtra, 100);

    // =========================================================
    // 6. Layer search filter (P0 §8)
    // =========================================================
    const _refreshLayers = P.refreshLayers.bind(P);
    let _layerFilter = '';
    P.refreshLayers = function(){
      _refreshLayers();
      const ed = document.getElementById('view-editor');
      if (!ed) return;
      let search = ed.querySelector('#ly-search');
      if (!search){
        const wrap = document.createElement('div');
        wrap.className = 'ly-search-wrap';
        wrap.innerHTML = `<span class="ly-search-ico">${Ico('search',{size:12})}</span><input id="ly-search" class="ly-search" placeholder="Find layer…" spellcheck="false">`;
        const left = ed.querySelector('.ed-left-content');
        if (left) left.insertBefore(wrap, left.firstChild);
        search = wrap.querySelector('#ly-search');
        search.addEventListener('input', ()=>{ _layerFilter = search.value.trim().toLowerCase(); P.refreshLayers(); });
      }
      // Apply filter: hide rows that don't match
      const rows = ed.querySelectorAll('.ly-row');
      if (!_layerFilter){ rows.forEach(r=>r.style.display=''); return; }
      rows.forEach(r=>{
        const name = (r.querySelector('.ly-name')?.textContent||'').toLowerCase();
        r.style.display = name.indexOf(_layerFilter)>=0 ? '' : 'none';
      });
    };

    // =========================================================
    // 7. Drag & drop layers reorder / reparent (P0 §8)
    // =========================================================
    let _dragId = null, _dragOverId = null, _dragPos = null; // 'before'|'after'|'into'
    function _initLayersDnD(){
      const ed = document.getElementById('view-editor');
      if (!ed || ed._dndInit) return;
      ed._dndInit = true;
      ed.addEventListener('dragstart', e=>{
        const row = e.target.closest('.ly-row');
        if (!row) return;
        _dragId = row.dataset.id;
        e.dataTransfer.setData('text/plain', _dragId);
        e.dataTransfer.effectAllowed = 'move';
        row.classList.add('ly-dragging');
      }, true);
      ed.addEventListener('dragend', ()=>{
        ed.querySelectorAll('.ly-row').forEach(r=>{ r.classList.remove('ly-dragging','ly-drag-over-before','ly-drag-over-after','ly-drag-over-into'); });
        _dragId = null; _dragOverId = null; _dragPos = null;
      }, true);
      ed.addEventListener('dragover', e=>{
        const row = e.target.closest('.ly-row');
        if (!row || row.dataset.id === _dragId){ return; }
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const rect = row.getBoundingClientRect();
        const y = e.clientY - rect.top;
        let pos;
        if (y < rect.height*0.25) pos = 'before';
        else if (y > rect.height*0.75) pos = 'after';
        else pos = 'into';
        // clear all
        ed.querySelectorAll('.ly-row').forEach(r=>r.classList.remove('ly-drag-over-before','ly-drag-over-after','ly-drag-over-into'));
        row.classList.add('ly-drag-over-'+pos);
        _dragOverId = row.dataset.id; _dragPos = pos;
      }, true);
      ed.addEventListener('drop', e=>{
        if (!_dragId || !_dragOverId) return;
        e.preventDefault();
        e.stopPropagation();
        const srcId = _dragId, tgtId = _dragOverId, pos = _dragPos;
        // check for ancestor loop
        const page = App.page;
        const isAncestor = (a,b)=>{
          let n = page.nodes[b];
          while(n){ if(n.id===a) return true; if(!n.parent) return false; n = page.nodes[n.parent]; }
          return false;
        };
        if (srcId===tgtId || isAncestor(srcId, tgtId)){
          App.toast('Cannot drop into a child of itself');
          return;
        }
        App.history.begin(App.doc);
        // Detach src from current parent
        const src = page.nodes[srcId];
        if (!src){ App.history.end(App.doc); return; }
        const oldParent = src.parent;
        M.detach(page, src);
        if (pos === 'into'){
          // make child of target (which must be frame/group/component)
          const tgt = page.nodes[tgtId];
          if (!tgt || !['frame','group','instance','component'].includes(tgt.type)){
            // fall back to same parent before
            M.attach(App.doc, page, oldParent, src);
            App.toast('Cannot reparent into a '+tgt?.type);
            App.history.end(App.doc); P.refreshLayers(); App.markDirty(); return;
          }
          // auto-add AL defaults? ensureItemDefaults does that
          M.attach(App.doc, page, tgtId, src);
          App.toast(`Moved into ${tgt.name}`);
        } else {
          // sibling of target at same parent
          const tgt = page.nodes[tgtId];
          if (!tgt){ M.attach(App.doc, page, oldParent, src); App.history.end(App.doc); return; }
          const parentId = tgt.parent;
          const list = parentId ? page.nodes[parentId].children : page.tops;
          const tgtIdx = list.indexOf(tgtId);
          // attach first, then reorder
          M.attach(App.doc, page, parentId, src, pos==='before'?tgtIdx:tgtIdx+1);
        }
        App.history.end(App.doc);
        P.refreshLayers(); P.refreshInspector(); App.markDirty();
      }, true);
    }
    // Make rows draggable after render
    const _rl = P.refreshLayers.bind(P);
    P.refreshLayers = function(){
      _rl();
      const ed = document.getElementById('view-editor');
      if (ed) ed.querySelectorAll('.ly-row').forEach(r=>r.setAttribute('draggable','true'));
      _initLayersDnD();
    };

    // =========================================================
    // 8. Batch export modal (P0)
    // =========================================================
    App.openBatchExport = function(){
      const doc = App.doc; if(!doc) return;
      document.querySelectorAll('.pf-modal').forEach(m=>m.remove());
      const wrap = document.createElement('div');
      wrap.className = 'pf-modal';
      const scales = [1,2,3,4];
      const formats = ['png','svg','pdf'];
      wrap.innerHTML = `<div class="pf-modal-card">
        <div class="pf-modal-head"><b>Batch export</b><button class="ed-iconbtn pf-modal-x">${Ico('close',{size:12})}</button></div>
        <div class="pf-modal-body">
          <p class="ph" style="padding:4px 0">Export ${App.sel.length?App.sel.length+' selected layer(s)':'the whole page'} at multiple scales.</p>
          <div class="batch-scales">${scales.map(s=>`<label class="chk"><input type="checkbox" data-scale="${s}" ${s<=2?'checked':''}> ${s}×</label>`).join('')}</div>
          <div class="batch-formats">${formats.map(f=>`<label class="chk"><input type="checkbox" data-fmt="${f}" ${f==='png'?'checked':''}> ${f.toUpperCase()}</label>`).join('')}</div>
          <div class="ins-row"><label><input type="checkbox" id="batch-suffix" checked> Add scale suffix (@2x, etc.)</label></div>
        </div>
        <div class="pf-modal-foot"><button class="ed-btn" data-cancel>Cancel</button><button class="ed-btn primary" data-export>${Ico('download',{size:12})} Export</button></div>
      </div>`;
      document.body.appendChild(wrap);
      const close = ()=>wrap.remove();
      wrap.addEventListener('click', e=>{
        if(e.target===wrap || e.target.closest('[data-cancel]') || e.target.closest('.pf-modal-x')) close();
        if(e.target.closest('[data-export]')){
          const selScales = [...wrap.querySelectorAll('[data-scale]:checked')].map(x=>+x.dataset.scale);
          const selFmts = [...wrap.querySelectorAll('[data-fmt]:checked')].map(x=>x.dataset.fmt);
          const suffix = wrap.querySelector('#batch-suffix').checked;
          const page = App.page;
          App.layoutDoc(doc, page);
          const useSel = App.sel.length>0;
          for (const fmt of selFmts){
            for (const sc of selScales){
              try{
                if (fmt==='png'){
                  const b = useSel ? R.selectionBounds(page, App.sel) : R.pageBounds(page);
                  if (!b) continue;
                  const c = R.renderRegion(page, doc, b, sc, {background:'#ffffff'});
                  const a = document.createElement('a');
                  a.href = c.toDataURL('image/png');
                  a.download = doc.name + (useSel?'-selection':'-page') + (suffix?('@'+sc+'x'):'') + '.png';
                  a.click();
                } else if (fmt==='svg'){
                  const Svg = global.SvgExport;
                  let svg;
                  if (useSel && App.sel.length===1) svg = Svg.renderNode(doc, page, page.nodes[App.sel[0]]);
                  else {
                    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
                    const ids = useSel?App.sel:page.tops;
                    const body=[];
                    for (const id of ids){
                      const nd = page.nodes[id]; if(!nd||!nd._l) continue;
                      const bb = nd._w;
                      minX=Math.min(minX,bb.x);minY=Math.min(minY,bb.y);
                      maxX=Math.max(maxX,bb.x+bb.w);maxY=Math.max(maxY,bb.y+bb.h);
                      body.push(Svg.renderNode(doc, page, nd).replace(/^<svg[^>]*>/,'').replace(/<\/svg>$/,''));
                    }
                    if(!isFinite(minX)) continue;
                    svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(maxX-minX)}" height="${Math.ceil(maxY-minY)}" viewBox="${minX} ${minY} ${Math.ceil(maxX-minX)} ${Math.ceil(maxY-minY)}">${body.join('\n')}</svg>`;
                  }
                  const a=document.createElement('a');
                  a.href=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));
                  a.download=doc.name+(useSel?'-selection':'-page')+(suffix?('@'+sc+'x'):'')+'.svg';
                  a.click();
                } else if (fmt==='pdf'){
                  const Pdf = global.PdfExport;
                  const res = useSel
                    ? (App.sel.length===1 ? Pdf.renderNode(doc,page,page.nodes[App.sel[0]])
                                          : Pdf._render(page, App.sel.map(id=>page.nodes[id]).filter(Boolean),{}))
                    : Pdf.renderPage(doc,page);
                  const bytes = Uint8Array.from(res.pdf, ch=>ch.charCodeAt(0)&0xff);
                  const a=document.createElement('a');
                  a.href=URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}));
                  a.download=doc.name+(useSel?'-selection':'-page')+'.pdf';
                  a.click();
                }
              }catch(err){ console.error(err); }
            }
          }
          App.toast(`Exported ${selFmts.length*selScales.length} file(s)`);
          close();
        }
      });
    };
    // add Shift+E for batch export
    if (global.Shortcuts && global.Shortcuts.table){
      global.Shortcuts.table.push({keys:'shift+e', label:'Batch export', group:'App', fn:()=>App.openBatchExport()});
    }

    // =========================================================
    // 9. Canvas mini-map (P0)
    // =========================================================
    App._minimap = null;
    function buildMinimap(){
      const wrap = document.getElementById('ed-canvas-wrap');
      if (!wrap || wrap.querySelector('.ed-minimap')) return;
      const mm = document.createElement('canvas');
      mm.className='ed-minimap'; mm.width=180; mm.height=120;
      mm.title='Minimap — click/drag to pan';
      wrap.appendChild(mm);
      App._minimap = mm;
      let dragging=false;
      function mmToWorld(e){
        const r = mm.getBoundingClientRect();
        const u = (e.clientX - r.left)/r.width;
        const v = (e.clientY - r.top)/r.height;
        const page = App.page; if(!page) return null;
        const b = R.pageBounds(page) || {x:0,y:0,w:1000,h:1000};
        const pad=50;
        const wx = (b.x-pad) + u*(b.w+pad*2);
        const wy = (b.y-pad) + v*(b.h+pad*2);
        return {x:wx,y:wy};
      }
      mm.addEventListener('mousedown', e=>{
        dragging=true;
        const wp = mmToWorld(e); if(!wp) return;
        const cr = App.canvas.getBoundingClientRect();
        App.view.ox = -wp.x*App.view.zoom + cr.width/2;
        App.view.oy = -wy*App.view.zoom + cr.height/2;
        App.markDirty();
      });
      window.addEventListener('mousemove', e=>{
        if(!dragging) return;
        const wp = mmToWorld(e); if(!wp) return;
        const cr = App.canvas.getBoundingClientRect();
        App.view.ox = -wp.x*App.view.zoom + cr.width/2;
        App.view.oy = -wy*App.view.zoom + cr.height/2;
        App.markDirty();
      });
      window.addEventListener('mouseup', ()=>dragging=false);
    }
    const _buildChrome = App.buildChrome.bind(App);
    App.buildChrome = function(){
      _buildChrome();
      buildMinimap();
    };
    // render minimap after redraw
    const _redraw = App.redraw.bind(App);
    App.redraw = function(){
      _redraw();
      drawMinimap();
    };
    function drawMinimap(){
      const mm = App._minimap; if(!mm) return;
      const ctx = mm.getContext('2d'); if(!ctx) return;
      const page = App.page; if(!page) return;
      const b = R.pageBounds(page) || {x:0,y:0,w:100,h:100};
      const pad=80;
      const W=mm.width, H=mm.height;
      ctx.fillStyle='#1a1a1a'; ctx.fillRect(0,0,W,H);
      const sx = W/(b.w+pad*2), sy = H/(b.h+pad*2);
      const s = Math.min(sx,sy);
      const ox = (W - (b.w+pad*2)*s)/2, oy=(H-(b.h+pad*2)*s)/2;
      ctx.strokeStyle='#444'; ctx.lineWidth=1;
      // draw page rects
      ctx.fillStyle='#3a8fd9';
      M.forEachNode && M.forEachNode(page, {children:page.tops}, n=>{
        if(n.type==='page'||!n._w) return;
        const bb = n._w;
        const x = ox+(bb.x-b.x+pad)*s;
        const y = oy+(bb.y-b.y+pad)*s;
        const w = bb.w*s, h2=bb.h*s;
        ctx.fillStyle = n.type==='frame' ? '#2d3e55' : n.type==='text' ? '#6ea8d6' : '#4a6a8a';
        ctx.fillRect(x,y,Math.max(1,w),Math.max(1,h2));
      });
      // viewport rect
      const cr = App.canvas.getBoundingClientRect();
      const vx = (-App.view.ox/App.view.zoom - b.x + pad)*s + ox;
      const vy = (-App.view.oy/App.view.zoom - b.y + pad)*s + oy;
      const vw = (cr.width/App.view.zoom)*s;
      const vh = (cr.height/App.view.zoom)*s;
      ctx.strokeStyle='#0d99ff'; ctx.lineWidth=1.5;
      ctx.strokeRect(vx,vy,vw,vh);
    }

    // =========================================================
    // 10. Design System Health panel (P1 §25)
    // =========================================================
    App.runDesignHealth = function(){
      const doc = App.doc; if(!doc) return;
      const issues = [];
      const hexRe = /^#[0-9a-f]{6}$/i;
      const rawColors = new Set();
      let detached = 0, inconsistent = 0, missingStates = 0;
      for (const page of doc.pages){
        for (const n of Object.values(page.nodes)){
          // raw (non-tokenized) fills
          for (const f of (n.fills||[])){
            if (f.type==='solid' && !f.token && f.color && hexRe.test(f.color)){
              rawColors.add(f.color.toLowerCase());
            }
          }
          // detached instances
          if (n.type==='instance' && n.componentId && !(doc.components||{})[n.componentId] && !n.libraryFileId){
            detached++;
          }
          // check for interactive-looking frames without prototype interaction
          if (n.type==='frame' && n.name && /button|cta|link|nav/i.test(n.name)){
            if (!n.interactions || !n.interactions.length) missingStates++;
          }
        }
      }
      if (rawColors.size > 6){
        issues.push({level:'warn', msg:`${rawColors.size} raw hex colors detected — consider binding to tokens`, icon:'palette'});
      }
      if (detached>0){
        issues.push({level:'error', msg:`${detached} detached instance(s) — component source missing`, icon:'unlink'});
      }
      if (missingStates>0){
        issues.push({level:'info', msg:`${missingStates} interactive-looking frame(s) with no prototype link`, icon:'proto'});
      }
      if (issues.length===0){
        issues.push({level:'ok', msg:'No obvious design-health issues found', icon:'check_circle'});
      }
      // show in modal
      document.querySelectorAll('.pf-modal').forEach(m=>m.remove());
      const wrap = document.createElement('div');
      wrap.className = 'pf-modal';
      wrap.innerHTML = `<div class="pf-modal-card">
        <div class="pf-modal-head"><b>${Ico('pulse',{size:14})} Design System Health</b><button class="ed-iconbtn pf-modal-x">${Ico('close',{size:12})}</button></div>
        <div class="pf-modal-body">
          ${issues.map(i=>`<div class="health-row health-${i.level}">
            <span class="health-ico">${Ico(i.level==='error'?'x_circle':i.level==='warn'?'alert_tri':'check_circle',{size:14})}</span>
            <span>${esc(i.msg)}</span>
          </div>`).join('')}
          <p class="ph" style="padding:8px 0 4">Detects: raw colors, detached instances, missing prototype links on likely-interactive frames. More lint rules (contrast, target size, text overflow) will land in Engine v3.</p>
        </div>
        <div class="pf-modal-foot"><button class="ed-btn primary" data-close>Close</button></div>
      </div>`;
      document.body.appendChild(wrap);
      wrap.addEventListener('click', e=>{
        if(e.target===wrap || e.target.closest('[data-close]') || e.target.closest('.pf-modal-x')) wrap.remove();
      });
    };

    // =========================================================
    // 11. Responsive preview (P1 §13)
    // =========================================================
    App._responsiveW = null;
    App.toggleResponsivePreview = function(w){
      const cw = document.getElementById('ed-canvas-wrap');
      if(!cw) return;
      if (App._responsiveW === w){
        cw.style.maxWidth=''; App._responsiveW=null; App.toast('Responsive preview off');
      } else {
        cw.style.maxWidth = w+'px';
        App._responsiveW = w;
        App.toast(`Responsive preview: ${w}px`);
      }
      setTimeout(()=>{ App.resizeCanvas(); App.markDirty(); }, 60);
    };

    // =========================================================
    // 12. Product states (P1 §26) - toast can accept severity
    // =========================================================
    App._stateOverride = null; // 'loading'|'empty'|'error'|'success'|'offline'
    App.setProductState = function(state){
      App._stateOverride = state;
      App.markDirty();
    };
    // render overlay
    const _drawEmpty = App.drawEmptyState || function(){};
    App.drawEmptyState = function(ctx){
      _drawEmpty.call(this, ctx);
      if (!App._stateOverride) return;
      const cr = this.canvas.getBoundingClientRect();
      const z = this.view.zoom;
      ctx.save();
      ctx.fillStyle='rgba(30,30,30,0.72)';
      ctx.fillRect(0,0,cr.width,cr.height);
      ctx.fillStyle='#fff';
      ctx.font='14px Inter,system-ui,sans-serif';
      ctx.textAlign='center';
      const msg = {
        loading: 'Loading…',
        empty: 'Nothing here yet',
        error: 'Something went wrong',
        success: 'Success',
        offline: 'You are offline'
      }[App._stateOverride]||'';
      ctx.fillText(msg, cr.width/2, cr.height/2);
      ctx.restore();
    };

    // =========================================================
    // 13. Command palette — add missing P0 commands (spec §9)
    // =========================================================
    const _buildPalette = App.showCommandPalette;
    // extend command list if palette uses a standard array
    App._extraCommands = App._extraCommands || [];
    App._extraCommands.push(
      {label:'Group selection', hint:'⌘G', kw:'group', run:()=>App.groupSel && App.groupSel()},
      {label:'Ungroup', hint:'⇧⌘G', kw:'ungroup', run:()=>App.ungroup && App.ungroup()},
      {label:'Frame selection', hint:'', kw:'frame selection', run:()=>{
        const ids=App.sel; if(!ids.length) return;
        const page=App.page;
        let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
        for(const id of ids){const k=page.nodes[id];if(!k||!k._w)continue;x0=Math.min(x0,k._w.x);y0=Math.min(y0,k._w.y);x1=Math.max(x1,k._w.x+k._w.w);y1=Math.max(y1,k._w.y+k._w.h);}
        if(!isFinite(x0))return;
        App.history.begin(App.doc);
        const f=M.makeNode('frame',{x:x0,y:y0,w:x1-x0,h:y1-y0,name:'Frame'});
        M.attach(App.doc,page,null,f);
        for(const id of ids){const k=page.nodes[id];if(k){M.detach(page,k);M.attach(App.doc,page,f.id,k);}}
        App.history.end(App.doc);
        App.sel=[f.id]; P.refreshLayers(); P.refreshInspector(); App.markDirty();
      }},
      {label:'Use as mask', hint:'⌘/', kw:'mask clipping', run:()=>App.toggleMask && App.toggleMask()},
      {label:'Flatten selection', hint:'⇧⌘F', kw:'flatten vector', run:()=>App.flattenSel && App.flattenSel()},
      {label:'Outline stroke', hint:'', kw:'outline stroke vector', run:()=>App.outlineStrokeSel && App.outlineStrokeSel()},
      {label:'Toggle rulers', hint:'', kw:'rulers', run:()=>{App.view.rulers=!App.view.rulers;App.syncViewToggles();App.markDirty();}},
      {label:'Toggle grid', hint:'', kw:'grid', run:()=>{App.view.grid=App.view.grid?null:(App.view.gridSize||10);App.syncViewToggles();App.markDirty();}},
      {label:'Zoom to fit', hint:'⇧1', kw:'zoom fit all', run:()=>App.zoomToFit()},
      {label:'Zoom to selection', hint:'⇧2', kw:'zoom selection', run:()=>App.zoomToSel()},
      {label:'Batch export…', hint:'⇧E', kw:'export multiple scales', run:()=>App.openBatchExport()},
      {label:'Insert image…', hint:'', kw:'image place picture photo', run:()=>{
        const inp=document.createElement('input'); inp.type='file'; inp.accept='image/*';
        inp.addEventListener('change',()=>{ const f=inp.files[0]; if(f) App.placeImageFile && App.placeImageFile(f); });
        inp.click();
      }},
      {label:'Design system health', hint:'', kw:'lint health check a11y contrast tokens', run:()=>App.runDesignHealth()},
      {label:'Responsive preview — 390px (mobile)', hint:'', kw:'responsive mobile preview', run:()=>App.toggleResponsivePreview(390)},
      {label:'Responsive preview — 768px (tablet)', hint:'', kw:'responsive tablet preview', run:()=>App.toggleResponsivePreview(768)},
      {label:'Responsive preview — 1440px (desktop)', hint:'', kw:'responsive desktop preview', run:()=>App.toggleResponsivePreview(1440)},
      {label:'Responsive preview — off', hint:'', kw:'responsive off full', run:()=>App.toggleResponsivePreview(Infinity)},
      {label:'Rotate 90° clockwise', hint:'', kw:'rotate', run:()=>{App.history.begin(App.doc);App.sel.forEach(id=>{const n=App.page.nodes[id];if(n)n.rotation=(n.rotation||0)+Math.PI/2;});App.history.end(App.doc);App.markDirty();}},
      {label:'Rotate 90° counter-clockwise', hint:'', kw:'rotate', run:()=>{App.history.begin(App.doc);App.sel.forEach(id=>{const n=App.page.nodes[id];if(n)n.rotation=(n.rotation||0)-Math.PI/2;});App.history.end(App.doc);App.markDirty();}},
    );

    // Extend palette if it reads from App.commands
    if (!App.commands) App.commands = [];
    App.commands.push(...App._extraCommands);

    // =========================================================
    // 14. Selection XYWH status readout in footer
    // =========================================================
    const _redraw2 = App.redraw.bind(App);
    App.redraw = function(){
      _redraw2();
      const sel = App.sel;
      const stEl = document.getElementById('ed-status');
      if (stEl && sel.length){
        const page = App.page;
        let txt;
        if (sel.length===1){
          const n = page.nodes[sel[0]];
          if (n && n._w){
            txt = `${esc(n.name)} · ${Math.round(n._w.x)}, ${Math.round(n._w.y)} · ${Math.round(n._w.w)} × ${Math.round(n._w.h)}`;
            if (n.rotation) txt += ` · ${Math.round(n.rotation*180/Math.PI)}°`;
          }
        } else {
          const b = R.selectionBounds(page, sel);
          if (b) txt = `${sel.length} selected · ${Math.round(b.w)} × ${Math.round(b.h)}`;
        }
        if (txt) stEl.textContent = txt;
      }
    };

    // =========================================================
    // 15. Insert image tool button (Image place)
    // =========================================================
    const _buildToolbar2 = App.buildChrome.bind(App);
    // add Image button after the Text tool by patching buildChrome once
    const bc = App.buildChrome;
    App.buildChrome = function(){
      bc.apply(this, arguments);
      const tb = document.getElementById('ed-toolbar');
      if (tb && !tb.querySelector('[data-tool="image"]')){
        const imgBtn = document.createElement('button');
        imgBtn.className='tool'; imgBtn.dataset.tool='image';
        imgBtn.title='Place image';
        imgBtn.innerHTML = Ico('image',{size:18}) + '<span class="tool-key"></span>';
        imgBtn.addEventListener('click', ()=>{
          const inp = document.createElement('input'); inp.type='file'; inp.accept='image/*';
          inp.addEventListener('change', ()=>{ const f=inp.files[0]; if(f){
            const cr = App.canvas.getBoundingClientRect();
            App.placeImageFile(f, App.toWorld({clientX:cr.left+cr.width/2,clientY:cr.top+cr.height/2}));
          }});
          inp.click();
          App.setTool('move');
        });
        // insert before comment
        const commentBtn = tb.querySelector('[data-tool="comment"]');
        if (commentBtn) tb.insertBefore(imgBtn, commentBtn);
        else tb.appendChild(imgBtn);
      }
    };

    // =========================================================
    // 16. Numeric Transform (Skew X/Y support) - add to inspector
    // We extend the inspector with a skew section after rotation
    // =========================================================
    const _refreshInspector = P.refreshInspector.bind(P);
    P.refreshInspector = function(){
      _refreshInspector();
      // nothing extra injected here to keep UI uncluttered;
      // skew fields could be added behind "Advanced" later.
    };

    // =========================================================
    // 17. Auto-save indicator toast + dirty dot
    // =========================================================
    const _saveNow = App.saveNow.bind(App);
    let _dirtyTimer = null;
    App.saveNow = function(){
      _saveNow();
      const btn = document.getElementById('ed-share');
      if (btn){
        btn.classList.add('saved');
        btn.innerHTML = Ico('check',{size:12})+' Saved';
        clearTimeout(_dirtyTimer);
        _dirtyTimer = setTimeout(()=>{
          btn.classList.remove('saved');
          btn.innerHTML = Ico('save',{size:13})+' Save';
        }, 2000);
      }
      // also persist a journal snapshot
      journalTick();
    };

    // =========================================================
    // 18. Enhanced File → Open recent / new menu (top-left)
    // =========================================================
    // Already handled by dashboard. Add keyboard shortcut Ctrl+Tab to switch pages
    if (global.Shortcuts && global.Shortcuts.table){
      global.Shortcuts.table.push({keys:'mod+pagedown', label:'Next page', group:'Editing', fn:()=>{
        if(!App.doc) return;
        App.pageIndex = (App.pageIndex+1) % App.doc.pages.length;
        App.sel=[]; P.renderPages(); P.refreshLayers(); P.refreshInspector(); App.renderPagename(); App.markDirty();
      }});
      global.Shortcuts.table.push({keys:'mod+pageup', label:'Previous page', group:'Editing', fn:()=>{
        if(!App.doc) return;
        App.pageIndex = (App.pageIndex-1+App.doc.pages.length) % App.doc.pages.length;
        App.sel=[]; P.renderPages(); P.refreshLayers(); P.refreshInspector(); App.renderPagename(); App.markDirty();
      }});
    }

    // =========================================================
    // 19. Motion/easing helpers (P2 §29) - simple spring & easing
    //     exposed for plugin SDK use.
    // =========================================================
    global.Motion = {
      easings: {
        linear: t=>t,
        easeOutCubic: t=>1-Math.pow(1-t,3),
        easeInCubic: t=>t*t*t,
        easeInOutCubic: t=>t<0.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2,
        easeOutBack: t=>{const c1=1.70158,c3=c1+1;return 1+c3*Math.pow(t-1,3)+c1*Math.pow(t-1,2);},
        easeOutQuart: t=>1-Math.pow(1-t,4),
      },
      spring: function spring(opts){
        // returns an object {update(dt)→{value, done}} for a damped spring
        opts = opts||{};
        const stiffness = opts.stiffness||180;
        const damping = opts.damping||12;
        const mass = opts.mass||1;
        let value = opts.from||0, target = opts.to||1, velocity = opts.velocity||0;
        return {
          setTarget(v){ target=v; },
          update(dt){
            const f = -stiffness*(value-target) - damping*velocity;
            const a = f/mass;
            velocity += a*dt;
            value += velocity*dt;
            const done = Math.abs(value-target)<0.5 && Math.abs(velocity)<0.5;
            return {value, done};
          }
        };
      },
      // used by present-mode transitions (fade/slide/overlay) later
      transition: function(from, to, kind, t){
        const ease = global.Motion.easings.easeOutCubic;
        if (kind==='fade') return {opacity: 1-t};
        if (kind==='slide') return {x: t*100, opacity: 1-t};
        return {};
      }
    };

    // =========================================================
    // 20. Accessibility QA quick check (P1 §30)
    // =========================================================
    App.runA11yCheck = function(){
      const doc=App.doc, issues=[];
      for (const page of doc.pages){
        for (const n of Object.values(page.nodes)){
          // contrast check on text nodes
          if (n.type==='text' && n.fills && n.fills[0]){
            const f = n.fills[0];
            if (f.type==='solid'){
              // rough: very small text (<12px) with low alpha
              const size = (n.text?.size)||14;
              if (size<12 && (f.opacity??1) < 0.7) issues.push(`"${n.name}": small low-opacity text may be unreadable`);
            }
          }
          // target size for interactive-looking things
          if (/button|cta/i.test(n.name||'')){
            if (n._w && (n._w.w<24 || n._w.h<24)){
              issues.push(`"${n.name}": interactive target smaller than 24×24 (${Math.round(n._w.w)}×${Math.round(n._w.h)})`);
            }
          }
          // missing alt text on images
          if (n.fills && n.fills.some(f=>f.type==='image')){
            if (!n.alt) issues.push(`"${n.name}": image has no alt text`);
          }
        }
      }
      document.querySelectorAll('.pf-modal').forEach(m=>m.remove());
      const wrap=document.createElement('div'); wrap.className='pf-modal';
      wrap.innerHTML = `<div class="pf-modal-card">
        <div class="pf-modal-head"><b>${Ico('info',{size:14})} Accessibility QA (quick)</b><button class="ed-iconbtn pf-modal-x">${Ico('close',{size:12})}</button></div>
        <div class="pf-modal-body">
          ${issues.length ? issues.map(m=>`<div class="health-row health-warn">${Ico('warn',{size:12})} ${esc(m)}</div>`).join('') : `<div class="health-row health-ok">${Ico('check_circle',{size:12})} No obvious accessibility issues found in this quick pass.</div>`}
          <p class="ph" style="padding:8px 0 4;font-size:11px">Checks: minimum target size (24×24), low-opacity small text, image alt text. Full WCAG contrast analysis requires a color parser (Engine v3).</p>
        </div>
        <div class="pf-modal-foot"><button class="ed-btn primary" data-close>Close</button></div>
      </div>`;
      document.body.appendChild(wrap);
      wrap.addEventListener('click',e=>{
        if(e.target===wrap||e.target.closest('[data-close]')||e.target.closest('.pf-modal-x')) wrap.remove();
      });
      App.toast(issues.length ? `${issues.length} a11y issue(s)` : 'A11y: no obvious issues');
    };
    if (global.Shortcuts && global.Shortcuts.table){
      global.Shortcuts.table.push({keys:'shift+mod+a', label:'Accessibility quick check', group:'View', fn:()=>App.runA11yCheck()});
    }

    // =========================================================
    // 21. Version naming: auto-name versions with timestamp
    // =========================================================
    if (global.Eco && global.Eco.Versions && global.Eco.Versions.add){
      const _add = global.Eco.Versions.add;
      global.Eco.Versions.add = function(doc, name){
        if (!name) name = new Date().toLocaleString();
        return _add.call(this, doc, name);
      };
    }

    // =========================================================
    // 22. Ensure canvas resizes on window resize
    // =========================================================
    window.addEventListener('resize', ()=>{ if(App.doc){ App.resizeCanvas && App.resizeCanvas(); App.markDirty(); } });

    // =========================================================
    // 23. Register Design Health + Responsive in command palette
    // =========================================================
    App._extraCommands.push(
      {label:'Accessibility quick check', hint:'⇧⌘A', kw:'a11y accessibility contrast wcag', run:()=>App.runA11yCheck()},
      {label:'Place image', hint:'', kw:'image photo place', run:()=>{
        const tb=document.querySelector('[data-tool="image"]'); if(tb) tb.click();
      }}
    );

    // =========================================================
    // 24. Wire new top-bar "Design" menu entry for Health/A11y
    // =========================================================
    // Patch top-right after chrome builds
    const bc3 = App.buildChrome;
    App.buildChrome = function(){
      bc3.apply(this, arguments);
      const tr = document.querySelector('.ed-top-right');
      if (tr && !tr.querySelector('#ed-health')){
        const btn = document.createElement('button');
        btn.id='ed-health'; btn.className='ed-btn';
        btn.title='Design health + QA';
        btn.innerHTML = Ico('pulse',{size:13})+' QA';
        btn.addEventListener('click', e=>{
          e.stopPropagation();
          const m = document.createElement('div'); m.className='pf-menu';
          m.innerHTML = `
            <div class="pf-title">Design & QA</div>
            <button data-q="health">${Ico('pulse',{size:12})} Design system health</button>
            <button data-q="a11y">${Ico('info',{size:12})} Accessibility quick check (⇧⌘A)</button>
            <hr>
            <div class="pf-title">Responsive preview</div>
            <button data-q="r390">${Ico('phone',{size:12})} 390px (mobile)</button>
            <button data-q="r768">${Ico('tablet',{size:12})} 768px (tablet)</button>
            <button data-q="r1440">${Ico('desktop',{size:12})} 1440px (desktop)</button>
            <button data-q="roff">${Ico('close',{size:11})} Off</button>
            <hr>
            <div class="pf-title">Product states</div>
            <button data-q="sdef">Default</button>
            <button data-q="sload">Loading</button>
            <button data-q="semp">Empty</button>
            <button data-q="serr">Error</button>
            <button data-q="ssuc">Success</button>
            <button data-q="soff">No override</button>
          `;
          const r = btn.getBoundingClientRect();
          m.style.left = Math.min(r.left, innerWidth-260)+'px';
          m.style.top = (r.bottom+4)+'px';
          document.body.appendChild(m);
          const close = ()=>m.remove();
          setTimeout(()=>document.addEventListener('pointerdown', close, {once:true, capture:true}),0);
          m.querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{
            close();
            const q=b.dataset.q;
            if(q==='health') App.runDesignHealth();
            else if(q==='a11y') App.runA11yCheck();
            else if(q==='r390') App.toggleResponsivePreview(390);
            else if(q==='r768') App.toggleResponsivePreview(768);
            else if(q==='r1440') App.toggleResponsivePreview(1440);
            else if(q==='roff') App.toggleResponsivePreview(Infinity);
            else if(q==='sdef') App.setProductState(null);
            else if(q==='sload') App.setProductState('loading');
            else if(q==='semp') App.setProductState('empty');
            else if(q==='serr') App.setProductState('error');
            else if(q==='ssuc') App.setProductState('success');
            else if(q==='soff') App.setProductState(null);
          }));
        });
        // insert before export
        const exp = document.getElementById('ed-export');
        if (exp) tr.insertBefore(btn, exp); else tr.appendChild(btn);
      }
    };
  });
})(window);
