/* ui-dashboard.js — Penfig dashboard (Figma-style file manager) */
(function (global) {
  'use strict';
  const M = global.Model;
  const R = global.Renderer;

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
    logo.text = { ...logo.text, content: '⚡ Penfig', size: 20, weight: 700, token: primary, font: 'Inter' };
    logo.fills = [{ type: 'solid', color: '#0d99ff', opacity: 1, token: primary }];
    M.attach(doc, page, nav.id, logo);
    ['Home', 'Design', 'Tokens', 'Docs'].forEach((t, i) => {
      const link = M.makeNode('text', { name: 'Link ' + t, w: 40, h: 18 });
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
    // center the text in the button
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
      const root = document.getElementById('view-dashboard');
      const files = M.store.all().sort((a, b) => b.updatedAt - a.updatedAt);
      const filtered = files.filter(f => f.name.toLowerCase().includes(this.filter.toLowerCase()));
      root.innerHTML = `
        <aside class="db-side">
          <div class="db-logo">
            <svg width="22" height="22" viewBox="0 0 24 24"><path fill="#0d99ff" d="M12 2 2 12l10 10 10-10L12 2z"/><circle cx="12" cy="12" r="3.4" fill="#fff"/></svg>
            <b>Penfig</b>
          </div>
          <nav class="db-nav">
            <a class="active" href="#/">Recents</a>
            <a href="#/">Files</a>
            <a href="#/about">About</a>
          </nav>
          <div class="db-side-foot">
            <button id="db-import" class="db-btn">Import .fig…</button>
            <input type="file" id="db-import-file" accept=".fig" hidden>
            <div class="db-tip">Penfig — Figma-style design, real .fig I/O, token system &amp; auto layout (no flexbox).</div>
          </div>
        </aside>
        <main class="db-main">
          <div class="db-top">
            <h1>Recents</h1>
            <div class="db-search"><span>⌕</span><input id="db-search" placeholder="Search files" value="${this.filter.replace(/"/g, '&quot;')}"></div>
            <button id="db-new" class="db-primary">+ New design file</button>
          </div>
          <div class="db-grid">
            <div class="db-card db-new-card" id="db-new-card">
              <div class="db-new-inner"><span>+</span><b>New design</b><small>Blank or starter kit</small></div>
            </div>
            ${filtered.map(f => `
              <div class="db-card" data-id="${f.id}">
                <div class="db-thumb"><img src="${f.thumb || 'data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22300%22 height=%22180%22><rect width=%22300%22 height=%22180%22 fill=%22%23e9eaee%22/></svg>'}" alt=""></div>
                <div class="db-card-meta">
                  <div class="db-card-name">${esc(f.name)}</div>
                  <div class="db-card-sub">${ago(f.updatedAt)} · ${f.pageCount || 1} page${(f.pageCount || 1) > 1 ? 's' : ''}</div>
                  <div class="db-card-actions">
                    <button data-act="rename">Rename</button>
                    <button data-act="duplicate">Duplicate</button>
                    <button data-act="export-fig">.fig</button>
                    <button data-act="delete">Delete</button>
                  </div>
                </div>
              </div>`).join('')}
          </div>
        </main>`;
      // bindings
      root.querySelector('#db-search').addEventListener('input', (e) => { this.filter = e.target.value; this.render(); const el = root.querySelector('#db-search'); el.focus(); el.setSelectionRange(el.value.length, el.value.length); });
      root.querySelector('#db-new').addEventListener('click', () => this.newFileModal());
      root.querySelector('#db-new-card').addEventListener('click', () => this.newFileModal());
      root.querySelector('#db-import').addEventListener('click', () => root.querySelector('#db-import-file').click());
      root.querySelector('#db-import-file').addEventListener('change', (e) => this.importFile(e.target.files[0]));
      root.querySelectorAll('.db-card[data-id]').forEach(card => {
        const id = card.dataset.id;
        card.addEventListener('dblclick', () => global.App.openFile(id));
        card.querySelector('.db-thumb').addEventListener('click', () => global.App.openFile(id));
        card.querySelectorAll('[data-act]').forEach(btn => btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          const act = btn.dataset.act;
          if (act === 'delete') this.deleteFile(id);
          else if (act === 'duplicate') this.duplicateFile(id);
          else if (act === 'rename') this.renameFile(id);
          else if (act === 'export-fig') this.exportFig(id);
        }));
      });
    },
    newFileModal() {
      const m = document.createElement('div');
      m.className = 'modal-back';
      m.innerHTML = `<div class="modal">
        <h3>New design file</h3>
        <label class="fld"><span>Name</span><input id="nf-name" value="Untitled" spellcheck="false"></label>
        <label class="fld"><span>Template</span>
          <select id="nf-tpl">
            <option value="blank">Blank</option>
            <option value="starter" selected>UI Starter Kit (tokens + auto layout demo)</option>
          </select></label>
        <div class="modal-btns"><button class="btn ghost" data-x>Cancel</button><button class="btn primary" id="nf-ok">Create</button></div>
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
      const bytes = new Uint8Array(await file.arrayBuffer());
      try {
        const { doc, report } = global.FigConv.importFig(bytes);
        doc.id = M.uid('doc-');
        doc.name = file.name.replace(/\.fig$/i, '');
        saveDoc(doc);
        global.App.toast(`Imported “${doc.name}” — ${report.nodes} nodes, ${report.pages} page(s), ${report.tokens} tokens, ${report.images} image(s)` + (report.warnings.length ? ` · ${report.warnings.length} note(s)` : ''), 6000);
        this.render();
        global.App.openFile(doc.id);
      } catch (err) {
        console.error(err);
        global.App.toast('Import failed: ' + err.message, 6000);
      }
    },
    exportFig(id) {
      const entry = M.store.get(id);
      if (!entry) return;
      const doc = entry.doc;
      for (const p of doc.pages) M.stampPage(doc, p);
      global.App.layoutDoc(doc);
      const page = doc.pages[0];
      const thumb = thumbDataURL(doc, page, 240);
      try {
        const bytes = global.FigConv.exportFig(doc, { thumbnail: thumb });
        downloadBytes(bytes, doc.name + '.fig');
        global.App.toast('Exported ' + doc.name + '.fig — opens in Figma for supported node types', 5000);
      } catch (err) {
        console.error(err);
        global.App.toast('.fig export failed: ' + err.message, 6000);
      }
    },
    deleteFile(id) {
      const f = M.store.get(id);
      if (!f) return;
      if (!confirm('Delete “' + f.name + '”?')) return;
      M.store.remove(id);
      this.render();
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
    },
    renameFile(id) {
      const f = M.store.get(id);
      if (!f) return;
      const name = prompt('Rename file', f.name);
      if (!name) return;
      f.name = name; f.updatedAt = Date.now();
      M.store.put(f);
      this.render();
    },
  };

  function saveDoc(doc) {
    doc.updatedAt = Date.now();
    const page = doc.pages[0];
    let thumb = '';
    try { thumb = thumbDataURL(doc, page, 240); } catch (e) { }
    M.store.put({ id: doc.id, name: doc.name, createdAt: doc.createdAt, updatedAt: doc.updatedAt, pageCount: doc.pages.length, thumb, doc });
  }

  function thumbDataURL(doc, page, width) {
    global.App.layoutDoc(doc, page);
    const b = R.pageBounds(page);
    const scale = Math.min(1, width / Math.max(1, b.w));
    const c = R.renderRegion(page, doc, b, scale, { background: '#e9eaee', pad: Math.ceil(16 * scale) });
    return c.toDataURL('image/png');
  }

  function downloadBytes(bytes, name) {
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }

  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function ago(ts) {
    const d = Date.now() - ts;
    if (d < 60e3) return 'just now';
    if (d < 3600e3) return Math.floor(d / 60e3) + 'm ago';
    if (d < 86400e3) return Math.floor(d / 3600e3) + 'h ago';
    return Math.floor(d / 86400e3) + 'd ago';
  }

  global.Dash = { D, makeStarterDoc, saveDoc, thumbDataURL, downloadBytes, esc, ago };
})(window);
