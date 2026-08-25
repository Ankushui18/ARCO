/* ui-dashboard.js — Penfig dashboard (Figma-style file manager) */
(function (global) {
  'use strict';
  const M = global.Model;
  const R = global.Renderer;
  const Ico = global.Icons.svg;
  const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ------------------------------------------------------------- starter file
  function makeStarterDoc() {
    const doc = M.newDoc('UI Starter Kit');
    const page = doc.pages[0];

    // tokens
    const set = global.Tokens.addSet(doc, 'brand');
    global.Tokens.addVar(doc, set.id, { name: 'color/primary', type: 'color', values: { [doc.vars.modes[0].id]: '#0d99ff', [doc.vars.modes[1].id]: '#33aaff' } });
    global.Tokens.addVar(doc, set.id, { name: 'color/accent', type: 'color', values: { [doc.vars.modes[0].id]: '#f24e1e', [doc.vars.modes[1].id]: '#ff6a3d' } });
    global.Tokens.addVar(doc, set.id, { name: 'color/surface', type: 'color', values: { [doc.vars.modes[0].id]: '#ffffff', [doc.vars.modes[1].id]: '#232323' } });
    global.Tokens.addVar(doc, set.id, { name: 'color/text', type: 'color', values: { [doc.vars.modes[0].id]: '#1e1e1e', [doc.vars.modes[1].id]: '#f5f5f5' } });
    global.Tokens.addVar(doc, set.id, { name: 'spacing/md', type: 'number', values: { [doc.vars.modes[0].id]: 16, [doc.vars.modes[1].id]: 16 } });
    global.Tokens.addVar(doc, set.id, { name: 'radius/card', type: 'number', values: { [doc.vars.modes[0].id]: 12, [doc.vars.modes[1].id]: 12 } });
    const primary = doc.vars.sets[0].vars[0].id;
    const surface = doc.vars.sets[0].vars[2].id;
    const textC = doc.vars.sets[0].vars[3].id;
    const spaceMd = doc.vars.sets[0].vars[4].id;
    const radiusCard = doc.vars.sets[0].vars[5].id;

    // ---- page 1: the demo
    const frame = M.makeNode('frame', { w: 900, h: 560, name: 'Landing hero', x: 0, y: 0 });
    frame.fills = [{ type: 'solid', color: '#f7f8fa', opacity: 1 }];
    frame.radius = [0, 0, 0, 0];
    M.attach(doc, page, null, frame);
    M.makeAutoLayout(frame, 'v', page);
    frame.al.pad = [{ n: 0 }, { n: 0 }, { n: 0 }, { n: 0 }];
    frame.al.gap = { n: 0, tok: null };
    frame.als = null;

    // nav bar
    const nav = M.makeNode('frame', { w: 900, h: 64, name: 'Nav bar' });
    nav.fills = [{ type: 'solid', color: '#ffffff', opacity: 1, token: surface }];
    M.attach(doc, page, frame.id, nav);
    M.makeAutoLayout(nav, 'h', page);
    nav.al.pad = [{ n: 16, tok: spaceMd }, { n: 24, tok: null }, { n: 16, tok: spaceMd }, { n: 24, tok: null }];
    nav.al.gap = { n: 12, tok: null };
    nav.al.main = 'start'; nav.al.cross = 'center';
    const logo = M.makeNode('text', { name: 'Logo', w: 110, h: 24 });
    logo.text = { ...logo.text, content: 'Penfig', size: 20, weight: 700, token: primary, font: 'Inter' };
    logo.fills = [{ type: 'solid', color: '#0d99ff', opacity: 1, token: primary }];
    M.attach(doc, page, nav.id, logo);
    ['Home', 'Design', 'Tokens', 'Docs'].forEach((t, i) => {
      const link = M.makeNode('text', { name: 'Link ' + t, w: 48, h: 18 });
      link.text = { ...link.text, content: t, size: 14, weight: 500, token: textC };
      link.fills = [{ type: 'solid', color: '#1e1e1e', opacity: 0.75, token: textC }];
      M.attach(doc, page, nav.id, link);
      if (i < 3) {
        const sp = M.makeNode('frame', { w: 8, h: 1, name: 'spacer' });
        sp.fills = [];
        M.attach(doc, page, nav.id, sp);
        sp.als = { w: 'fixed', h: 'fixed', grow: 0, align: 'auto', absolute: false };
      }
    });
    const navSpacer = M.makeNode('frame', { w: 1, h: 1, name: 'spacer' });
    navSpacer.fills = []; navSpacer.als = { w: 'fill', h: 'fixed', grow: 1, align: 'auto', absolute: false };
    M.attach(doc, page, nav.id, navSpacer);
    const navBtn = M.makeNode('frame', { w: 108, h: 36, name: 'Sign up' });
    navBtn.fills = [{ type: 'solid', color: '#0d99ff', opacity: 1, token: primary }];
    navBtn.radius = [18, 18, 18, 18];
    navBtn.als = { w: 'fixed', h: 'fixed', grow: 0, align: 'center', absolute: false };
    M.attach(doc, page, nav.id, navBtn);
    const navBtnT = M.makeNode('text', { name: 'Sign up text', w: 60, h: 18 });
    navBtnT.text = { ...navBtnT.text, content: 'Sign up', size: 14, weight: 600, align: 'center' };
    navBtnT.fills = [{ type: 'solid', color: '#ffffff', opacity: 1 }];
    navBtnT.als = { w: 'hug', h: 'hug', grow: 0, align: 'auto', absolute: false };
    M.attach(doc, page, navBtn.id, navBtnT);
    navBtnT.x = 24; navBtnT.y = 9;

    // hero
    const hero = M.makeNode('frame', { w: 900, h: 300, name: 'Hero' });
    hero.fills = [];
    M.attach(doc, page, frame.id, hero);
    M.makeAutoLayout(hero, 'h', page);
    hero.al.pad = [{ n: 48, tok: null }, { n: 48, tok: null }, { n: 48, tok: null }, { n: 48, tok: null }];
    hero.al.gap = { n: 48, tok: null };
    hero.al.cross = 'center';
    const heroText = M.makeNode('frame', { w: 440, h: 100, name: 'Hero copy' });
    heroText.fills = [];
    heroText.als = { w: 'fixed', h: 'hug', grow: 0, align: 'auto', absolute: false };
    M.attach(doc, page, hero.id, heroText);
    M.makeAutoLayout(heroText, 'v');
    heroText.al.gap = { n: 12, tok: null };
    heroText.al.pad = [{ n: 0, tok: null }, { n: 0, tok: null }, { n: 0, tok: null }, { n: 0, tok: null }];
    const h1 = M.makeNode('text', { name: 'Headline', w: 440, h: 80 });
    h1.text = { ...h1.text, content: 'Design tools that think in auto layout', size: 34, weight: 800, lineHeight: 1.15, token: textC };
    h1.fills = [{ type: 'solid', color: '#1e1e1e', opacity: 1, token: textC }];
    h1.als = { w: 'fill', h: 'hug', grow: 0, align: 'auto', absolute: false };
    M.attach(doc, page, heroText.id, h1);
    const h2 = M.makeNode('text', { name: 'Subheadline', w: 440, h: 20 });
    h2.text = { ...h2.text, content: 'Figma-style frames, tokens and variable modes — in your browser, with real .fig import & export.', size: 15, weight: 400, token: textC };
    h2.fills = [{ type: 'solid', color: '#1e1e1e', opacity: 0.65, token: textC }];
    h2.als = { w: 'fill', h: 'hug', grow: 0, align: 'auto', absolute: false };
    M.attach(doc, page, heroText.id, h2);
    const heroArt = M.makeNode('frame', { w: 300, h: 220, name: 'Hero art' });
    heroArt.fills = [{ type: 'linear', from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, stops: [{ color: '#0d99ff', opacity: 1, pos: 0 }, { color: '#a259ff', opacity: 1, pos: 1 }] }];
    heroArt.radius = [16, 16, 16, 16];
    heroArt.als = { w: 'fixed', h: 'fixed', grow: 0, align: 'auto', absolute: false };
    M.attach(doc, page, hero.id, heroArt);
    const circle = M.makeNode('ellipse', { w: 90, h: 90, name: 'Circle' });
    circle.fills = [{ type: 'solid', color: '#ffffff', opacity: 0.25 }];
    M.attach(doc, page, heroArt.id, circle);
    circle.x = 60; circle.y = 40;

    // card row (wrap demo)
    const row = M.makeNode('frame', { w: 900, h: 160, name: 'Card row (wrap)' });
    row.fills = [];
    M.attach(doc, page, frame.id, row);
    M.makeAutoLayout(row, 'h', page);
    row.al.wrap = true;
    row.al.gap = { n: 16, tok: spaceMd };
    row.al.gapCross = { n: 16, tok: spaceMd };
    row.al.pad = [{ n: 0, tok: null }, { n: 24, tok: null }, { n: 0, tok: null }, { n: 24, tok: null }];
    const cardDefs = [
      ['Auto layout', 'Measure → distribute → place. No CSS flexbox.'],
      ['Design tokens', 'Variables with Light/Dark modes, applied live.'],
      ['.fig import', 'Open real Figma files — kiwi decoded in-browser.'],
    ];
    for (const [title, body] of cardDefs) {
      const card = M.makeNode('frame', { w: 260, h: 160, name: 'Card: ' + title });
      card.fills = [{ type: 'solid', color: '#ffffff', opacity: 1, token: surface }];
      card.radius = [12, 12, 12, 12];
      card.shadows = [{ color: '#0f172a', opacity: 0.08, x: 0, y: 8, blur: 24, spread: 0, visible: true }];
      card.als = { w: 'fixed', h: 'hug', grow: 0, align: 'auto', absolute: false };
      M.attach(doc, page, row.id, card);
      M.makeAutoLayout(card, 'v', page);
      card.al.pad = [{ n: 20, tok: null }, { n: 20, tok: null }, { n: 20, tok: null }, { n: 20, tok: null }];
      card.al.gap = { n: 8, tok: null };
      card.al.cross = 'start';
      const ct = M.makeNode('text', { name: 'Card title', w: 220, h: 22 });
      ct.text = { ...ct.text, content: title, size: 17, weight: 700, token: textC };
      ct.fills = [{ type: 'solid', color: '#1e1e1e', opacity: 1, token: textC }];
      ct.als = { w: 'fill', h: 'hug', grow: 0, align: 'auto', absolute: false };
      M.attach(doc, page, card.id, ct);
      const cb = M.makeNode('text', { name: 'Card body', w: 220, h: 40 });
      cb.text = { ...cb.text, content: body, size: 13, weight: 400, lineHeight: 1.45, token: textC };
      cb.fills = [{ type: 'solid', color: '#1e1e1e', opacity: 0.6, token: textC }];
      cb.als = { w: 'fill', h: 'hug', grow: 0, align: 'auto', absolute: false };
      M.attach(doc, page, card.id, cb);
    }

    M.stampPage(doc, page);
    return doc;
  }

  // ------------------------------------------------------------- dashboard
  const D = {
    el: null,
    filter: '',
    render() {
      document.body.classList.add('dash-mode');
      const root = document.getElementById('view-dashboard');
      const files = M.store.all().sort((a, b) => b.updatedAt - a.updatedAt);
      const filtered = files.filter(f => f.name.toLowerCase().includes(this.filter.toLowerCase()));
      root.innerHTML = `
        <aside class="db-side">
          <div class="db-logo">
            ${Ico('logo', { size: 22 })}
            <div><b>Penfig</b><div class="db-logo-sub">Design, offline.</div></div>
          </div>
          <nav class="db-nav">
            <a class="active" href="#/">${Ico('recent', { size: 14 })}<span>Recents</span></a>
            <a href="#/">${Ico('draft', { size: 14 })}<span>All files</span></a>
            <a href="#/" id="db-import-link">${Ico('file_import', { size: 14 })}<span>Import .fig</span></a>
            <input type="file" id="db-import-file" accept=".fig,.pfg" hidden>
          </nav>
          <div class="db-side-foot">
            <button id="db-import" class="db-btn secondary">${Ico('file_import', { size: 14 })} Import .fig / .pfg…</button>
            <div class="db-tip">
              Penfig is an offline-first design tool. All files stay in this browser.
              Open/save real <b>.fig</b> files, and export to PNG/SVG/PDF/CSS.
            </div>
          </div>
        </aside>
        <main class="db-main">
          <div class="db-hero">
            <div>
              <h2>Welcome to Penfig</h2>
              <p>A Figma/Sketch-class design tool that runs anywhere — Vercel, local server, even double-clicked offline.</p>
            </div>
            <div class="db-hero-actions">
              <button id="db-new2" class="db-btn">${Ico('plus', { size: 14 })} New design file</button>
            </div>
          </div>
          <div class="db-top">
            <h1>Recents</h1>
            <div class="db-search">${Ico('search', { size: 14 })}<input id="db-search" placeholder="Search files" value="${esc(this.filter)}"></div>
            <button id="db-new" class="db-primary">${Ico('plus', { size: 14 })} New design file</button>
          </div>
          <div class="db-grid">
            <div class="db-card db-new-card" id="db-new-card">
              <div class="db-new-inner">${Ico('plus', { size: 28 })}<b>New design</b><small>Blank or starter kit</small></div>
            </div>
            ${filtered.map(f => `
              <div class="db-card" data-id="${f.id}">
                <div class="db-thumb">
                  ${f.thumb
                    ? `<img src="${f.thumb}" alt="">`
                    : `<div class="db-thumb-fallback">${Ico('draft', { size: 40 })}</div>`}
                </div>
                <div class="db-card-meta">
                  <div class="db-card-name">${Ico('draft', { size: 12 })} ${esc(f.name)}</div>
                  <div class="db-card-sub">${Ico('pages', { size: 10 })} ${f.pageCount || 1} page${(f.pageCount || 1) > 1 ? 's' : ''} · ${ago(f.updatedAt)}</div>
                  <div class="db-card-actions">
                    <button data-act="open">${Ico('folder', { size: 11 })} Open</button>
                    <button data-act="rename">${Ico('edit', { size: 11 })} Rename</button>
                    <button data-act="duplicate">${Ico('duplicate', { size: 11 })} Duplicate</button>
                    <button data-act="export-fig">${Ico('download', { size: 11 })} .fig</button>
                    <button data-act="export-pfg">${Ico('pfg', { size: 11 })} .pfg</button>
                    <button data-act="delete" class="danger">${Ico('trash', { size: 11 })} Delete</button>
                  </div>
                </div>
              </div>`).join('')}
          </div>
        </main>`;
      // bindings
      const searchInput = root.querySelector('#db-search');
      if (searchInput) {
        searchInput.addEventListener('input', (e) => { this.filter = e.target.value; this.render(); const el = root.querySelector('#db-search'); if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length); } });
      }
      root.querySelector('#db-new').addEventListener('click', () => this.newFileModal());
      root.querySelector('#db-new2').addEventListener('click', () => this.newFileModal());
      root.querySelector('#db-new-card').addEventListener('click', () => this.newFileModal());
      const openImport = () => root.querySelector('#db-import-file').click();
      root.querySelector('#db-import').addEventListener('click', openImport);
      root.querySelector('#db-import-link').addEventListener('click', (e) => { e.preventDefault(); openImport(); });
      root.querySelector('#db-import-file').addEventListener('change', (e) => this.importFile(e.target.files[0]));
      root.querySelectorAll('.db-card[data-id]').forEach(card => {
        const id = card.dataset.id;
        const open = () => global.App.openFile(id);
        card.addEventListener('dblclick', open);
        card.querySelector('.db-thumb').addEventListener('click', open);
        card.querySelector('.db-card-name').addEventListener('click', open);
        card.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const act = btn.dataset.act;
          if (act === 'open') open();
          else if (act === 'delete') this.deleteFile(id);
          else if (act === 'duplicate') this.duplicateFile(id);
          else if (act === 'rename') this.renameFile(id);
          else if (act === 'export-fig') this.exportFig(id);
          else if (act === 'export-pfg') this.exportPfg(id);
        }));
      });
    },
    newFileModal() {
      const m = document.createElement('div');
      m.className = 'modal-back';
      m.innerHTML = `<div class="modal">
        <h3>${Ico('file_new', { size: 16 })} New design file</h3>
        <label class="fld"><span>Name</span><input id="nf-name" value="Untitled" spellcheck="false"></label>
        <label class="fld"><span>Template</span>
          <select id="nf-tpl">
            <option value="blank">Blank canvas</option>
            <option value="starter" selected>UI Starter Kit (tokens + auto layout demo)</option>
          </select></label>
        <div class="modal-btns"><button class="btn ghost" data-x>Cancel</button><button class="btn primary" id="nf-ok">${Ico('plus', { size: 12 })} Create</button></div>
      </div>`;
      document.body.appendChild(m);
      const close = () => m.remove();
      m.addEventListener('click', (e) => { if (e.target === m) close(); });
      m.querySelector('[data-x]').addEventListener('click', close);
      m.querySelector('#nf-ok').addEventListener('click', () => {
        const name = m.querySelector('#nf-name').value.trim() || 'Untitled';
        const tpl = m.querySelector('#nf-tpl').value;
        const doc = tpl === 'starter' ? makeStarterDoc() : M.newDoc(name);
        doc.name = name;
        saveDoc(doc);
        close();
        global.App.openFile(doc.id);
      });
      setTimeout(() => m.querySelector('#nf-name').select(), 30);
    },
    async importFile(file) {
      if (!file) return;
      const ab = await file.arrayBuffer();
      const lower = file.name.toLowerCase();
      // Delegate to App's importer — it handles sync-vs-worker tiering,
      // progress UI, and staged commit.
      const A = global.App;
      if (lower.endsWith('.pfg')) {
        A.openFromBytes(new Uint8Array(ab), file.name, 'pfg');
      } else if (lower.endsWith('.fig')) {
        A.openFromBytesAsync(ab, file.name, 'fig');
      } else {
        // Unknown extension: try pfg then fall back to fig.
        try { A.openFromBytes(new Uint8Array(ab), file.name, 'pfg'); }
        catch (_) { A.openFromBytesAsync(ab, file.name, 'fig'); }
      }
    },
    exportFig(id) {
      const entry = M.store.get(id);
      if (!entry) return;
      const doc = JSON.parse(JSON.stringify(entry.doc));
      try { global.App.layoutDoc(doc); } catch (e) { console.warn('layout pre-export failed', e); }
      let thumb = '';
      try { thumb = thumbDataURL(doc, doc.pages[0], 480); } catch (e) { console.warn('thumb failed', e);}
      try {
        const bytes = global.FigConv.exportFig(doc, { thumbnail: thumb });
        downloadBytes(bytes, doc.name + '.fig', 'application/x-figma');
        global.App.toast('Exported ' + doc.name + '.fig — opens in Figma for supported node types', 5000, 'success');
      } catch (err) {
        console.error(err);
        global.App.toast('.fig export failed: ' + err.message, 8000, 'error');
      }
    },
    exportPfg(id) {
      const entry = M.store.get(id);
      if (!entry) return;
      const doc = entry.doc;
      try {
        const bytes = this.exportPfgBytes(doc);
        downloadBytes(bytes, doc.name + '.pfg', 'application/zip');
        global.App.toast('Exported ' + doc.name + '.pfg (Penfig native format)', 4000, 'success');
      } catch (err) {
        console.error(err);
        global.App.toast('.pfg export failed: ' + err.message, 8000, 'error');
      }
    },
    /* PFG = Penfig native format. Deterministic ZIP:
       manifest.json (version, createdAt), document.json, pages/*.json, thumbnails/thumb.png */
    exportPfgBytes(doc) {
      // Minimal ZIP store (no compression) so we don't need JSZip
      const files = [];
      const manifest = {
        format: 'penfig',
        version: 1,
        createdAt: new Date().toISOString(),
        name: doc.name,
        app: 'penfig/1.0',
      };
      files.push({ name: 'manifest.json', data: str2u8(JSON.stringify(manifest, null, 2)) });
      const cleanDoc = JSON.parse(JSON.stringify(doc));
      // Strip transient _l layout caches to keep file small/deterministic
      const strip = (n) => { if (n && typeof n === 'object') { delete n._l; Object.values(n).forEach(v => { if (v && typeof v === 'object') strip(v);}); } };
      strip(cleanDoc);
      files.push({ name: 'document.json', data: str2u8(JSON.stringify(cleanDoc, null, 2)) });
      let thumb;
      try { thumb = thumbDataURL(doc, doc.pages[0], 480); } catch (e) {}
      if (thumb) {
        const b64 = thumb.split(',')[1];
        files.push({ name: 'thumbnails/thumb.png', data: b64ToU8(b64) });
      }
      return zipStore(files);
    },
    importPfg(bytes) {
      const entries = unzipStore(bytes);
      const manifestName = Object.keys(entries).find(n => n.toLowerCase() === 'manifest.json');
      if (!manifestName) throw new Error('Not a .pfg file (missing manifest.json)');
      const manifest = JSON.parse(u8ToStr(entries[manifestName]));
      if (manifest.format !== 'penfig') throw new Error('Not a Penfig file');
      const docName = Object.keys(entries).find(n => n.toLowerCase() === 'document.json');
      if (!docName) throw new Error('.pfg is missing document.json');
      const doc = JSON.parse(u8ToStr(entries[docName]));
      if (!doc || !doc.pages) throw new Error('Invalid document.json');
      if (!doc.id) doc.id = M.uid('doc-');
      return doc;
    },
    deleteFile(id) {
      const f = M.store.get(id);
      if (!f) return;
      if (!confirm('Delete “' + f.name + '”? This cannot be undone.')) return;
      M.store.remove(id);
      this.render();
      global.App.toast('Deleted ' + f.name, 2500);
    },
    duplicateFile(id) {
      const f = M.store.get(id);
      if (!f) return;
      const doc = JSON.parse(JSON.stringify(f.doc));
      doc.id = M.uid('doc-');
      doc.name = f.name + ' copy';
      doc.createdAt = doc.updatedAt = Date.now();
      saveDoc(doc);
      this.render();
      global.App.toast('Duplicated ' + f.name, 2500, 'success');
    },
    renameFile(id) {
      const f = M.store.get(id);
      if (!f) return;
      const name = prompt('Rename file', f.name);
      if (!name) return;
      f.name = name.trim();
      if (f.doc) f.doc.name = f.name;
      f.updatedAt = Date.now();
      M.store.put(f);
      this.render();
    },
  };

  function saveDoc(doc) {
    doc.updatedAt = Date.now();
    let thumb = '';
    try {
      global.App.layoutDoc && global.App.layoutDoc(doc);
      thumb = thumbDataURL(doc, doc.pages[0], 480);
    } catch (e) { console.warn('thumb/rerender failed', e); }
    const existing = M.store.get(doc.id);
    const createdAt = (existing && existing.createdAt) || doc.createdAt || Date.now();
    M.store.put({ id: doc.id, name: doc.name, createdAt, updatedAt: doc.updatedAt, pageCount: doc.pages.length, thumb, doc });
  }

  function thumbDataURL(doc, page, width) {
    try { global.App.layoutDoc(doc, page); } catch (e) {}
    const b = R.pageBounds(page);
    if (!b || !isFinite(b.w) || b.w < 1 || b.h < 1) return '';
    const scale = Math.min(1, width / Math.max(1, b.w));
    const c = R.renderRegion(page, doc, b, scale, { background: '#f0f1f5', pad: Math.ceil(16 * Math.max(scale, 0.25)) });
    return c.toDataURL('image/png');
  }

  function downloadBytes(bytes, name, mime) {
    const blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(a.href); }, 2000);
  }

  function ago(ts) {
    const d = Date.now() - ts;
    if (d < 60e3) return 'just now';
    if (d < 3600e3) return Math.floor(d / 60e3) + 'm ago';
    if (d < 86400e3) return Math.floor(d / 3600e3) + 'h ago';
    if (d < 30*86400e3) return Math.floor(d / 86400e3) + 'd ago';
    return new Date(ts).toLocaleDateString();
  }

  // ----- minimal STORE-only ZIP (no compression, CRC32). Enough for .pfg. -----
  function str2u8(s) { return new TextEncoder().encode(s); }
  function u8ToStr(u) { return new TextDecoder().decode(u); }
  function b64ToU8(b64) {
    const bin = atob(b64); const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  // CRC32 (IEEE)
  let CRC_TABLE;
  function crc32(buf) {
    if (!CRC_TABLE) {
      CRC_TABLE = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        CRC_TABLE[n] = c >>> 0;
      }
    }
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function dosTime(d) {
    return ((d.getHours() & 0x1F) << 11) | ((d.getMinutes() & 0x3F) << 5) | ((d.getSeconds() >> 1) & 0x1F);
  }
  function dosDate(d) {
    return (((d.getFullYear() - 1980) & 0x7F) << 9) | (((d.getMonth() + 1) & 0x0F) << 5) | (d.getDate() & 0x1F);
  }
  function zipStore(files) {
    // files: [{ name, data: Uint8Array }]
    const parts = [];
    const central = [];
    let offset = 0;
    const now = new Date();
    const t = dosTime(now) & 0xFFFF;
    const dd = dosDate(now) & 0xFFFF;
    for (const f of files) {
      const name = f.name.replace(/^\/+/, '');
      const nameBytes = str2u8(name);
      const data = f.data instanceof Uint8Array ? f.data : str2u8(String(f.data));
      const crc = crc32(data);
      const size = data.length;
      // Local file header
      const lh = new Uint8Array(30 + nameBytes.length);
      const dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);     // version
      dv.setUint16(6, 0, true);      // flags
      dv.setUint16(8, 0, true);      // method=store
      dv.setUint16(10, t, true);
      dv.setUint16(12, dd, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, size, true);
      dv.setUint32(22, size, true);
      dv.setUint16(26, nameBytes.length, true);
      dv.setUint16(28, 0, true);
      lh.set(nameBytes, 30);
      parts.push(lh, data);
      // Central dir entry
      const ch = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, t, true);
      cv.setUint16(14, dd, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, size, true);
      cv.setUint32(24, size, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      ch.set(nameBytes, 46);
      central.push(ch);
      offset += lh.length + data.length;
    }
    const centralStart = offset;
    let centralSize = 0;
    for (const c of central) { parts.push(c); centralSize += c.length; }
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, centralStart, true);
    ev.setUint16(20, 0, true);
    parts.push(end);
    // concat
    let total = 0;
    for (const p of parts) total += p.length;
    const out = new Uint8Array(total);
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  }
  function unzipStore(bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const entries = {};
    let i = 0;
    function u16(p) { return dv.getUint16(p, true); }
    function u32(p) { return dv.getUint32(p, true); }
    while (i + 30 <= bytes.length) {
      const sig = u32(i);
      if (sig === 0x04034b50) {
        const nameLen = u16(i + 26);
        const extraLen = u16(i + 28);
        const comp = u16(i + 8);
        const csize = u32(i + 18);
        const usize = u32(i + 22);
        const name = new TextDecoder().decode(bytes.subarray(i + 30, i + 30 + nameLen));
        const dataStart = i + 30 + nameLen + extraLen;
        const data = bytes.subarray(dataStart, dataStart + csize);
        if (comp === 0 && csize === usize) {
          entries[name] = data;
        } else if (comp === 0) {
          entries[name] = data;
        } else {
          console.warn('pfg: unsupported compression method', comp, 'for', name);
        }
        i = dataStart + csize;
      } else if (sig === 0x02014b50) {
        const nameLen = u16(i + 28);
        const extraLen = u16(i + 30);
        const commentLen = u16(i + 32);
        i += 46 + nameLen + extraLen + commentLen;
      } else if (sig === 0x06054b50) {
        break;
      } else {
        break;
      }
    }
    return entries;
  }

  // Expose the PFG native-format helpers so other modules (import menu,
  // command palette, tests) can call them without reaching into D.
  global.Dash = {
    D, makeStarterDoc, saveDoc, thumbDataURL, downloadBytes, esc, ago,
    exportPfgBytes: (doc) => D.exportPfgBytes(doc),
    importPfg: (bytes) => D.importPfg(bytes),
    exportFig: (doc, opts) => {
      // Convenience wrapper: lays out the doc, generates a thumbnail, and
      // returns the .fig bytes. Mirrors the export menu flow.
      try { global.App && global.App.layoutDoc && global.App.layoutDoc(doc); } catch (e) {}
      let thumb = null;
      try { thumb = thumbDataURL(doc, doc.pages[0], 480); } catch (e) {}
      return global.FigConv.exportFig(doc, Object.assign({ thumbnail: thumb }, opts || {}));
    },
  };
})(window);
