/* ui-panels.js — Penfig panels: layers, pages, inspector, tokens, menus */
(function (global) {
  'use strict';
  const M = global.Model;
  const R = global.Renderer;
  const T = global.Tokens;
  const App = global.App;
  const esc = global.Dash.esc;

  const P = {

    // ============================================================ LAYERS
    refreshLayers() {
      const el = document.getElementById('ed-layers');
      if (!el || !App.doc) return;
      const page = App.page;
      const rows = [];
      const icon = { frame: '▭', rect: '■', ellipse: '●', line: '—', text: 'T', vector: '◈', instance: '⧉' };
      const render = (parentId, depth) => {
        const ids = parentId ? page.nodes[parentId].children : page.tops;
        for (let i = ids.length - 1; i >= 0; i--) {
          const n = page.nodes[ids[i]];
          if (!n) continue;
          const hasKids = n.children.length > 0;
          const sel = App.sel.includes(n.id) ? ' sel' : '';
          rows.push(`
            <div class="ly-row${sel}" data-id="${n.id}" style="padding-left:${8 + depth * 14}px">
              <span class="ly-caret" data-caret="${n.id}">${hasKids ? '▾' : ''}</span>
              <span class="ly-ico">${icon[n.type] || '?'}</span>
              <span class="ly-name" data-rename="${n.id}">${n.isComponent || (App.doc.components || {})[n.id] ? '<b class="ly-comp">◆</b> ' : ''}${esc(n.name)}${n.al ? ' <i class="ly-al">AL</i>' : ''}${n.mask ? ' <i class="ly-al">MASK</i>' : ''}</span>
              <span class="ly-tools">
                <button class="ly-eye" data-eye="${n.id}" title="Visibility">${n.visible ? '👁' : '─'}</button>
                <button class="ly-lock" data-lock="${n.id}" title="Lock">${n.locked ? '🔒' : ''}</button>
              </span>
            </div>`);
          if (hasKids && !P._collapsed?.[n.id]) render(n.id, depth + 1);
        }
      };
      render(null, 0);
      el.innerHTML = rows.join('') || '<div class="ph">No layers yet.<br><b>F</b> frame · <b>R</b> rect · <b>O</b> ellipse · <b>T</b> text<br><b>P</b> pen · <b>N</b> pencil · <b>A</b> arrow · <b>S</b> section</div>';
      el.querySelectorAll('.ly-row').forEach(row => {
        const id = row.dataset.id;
        row.addEventListener('click', (e) => {
          if (e.target.closest('button') || e.target.closest('[data-caret]')) return;
          const n = page.nodes[id];
          if (e.shiftKey) {
            const i = App.sel.indexOf(id);
            if (i >= 0) App.sel.splice(i, 1); else App.sel.push(id);
          } else App.sel = [id];
          P.refreshLayers(); P.refreshInspector(); App.markDirty();
        });
      });
      el.querySelectorAll('[data-rename]').forEach(sp => sp.addEventListener('dblclick', () => {
        const id = sp.dataset.rename;
        const n = page.nodes[id];
        const name = prompt('Rename layer', n.name);
        if (name) { App.history.begin(App.doc); n.name = name; App.history.end(App.doc); P.refreshLayers(); App.markDirty(); }
      }));
      el.querySelectorAll('[data-caret]').forEach(c => c.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = c.dataset.caret;
        P._collapsed = P._collapsed || {};
        P._collapsed[id] = !P._collapsed[id];
        P.refreshLayers();
      }));
      el.querySelectorAll('[data-eye]').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation();
        const n = page.nodes[b.dataset.eye];
        App.history.begin(App.doc); n.visible = !n.visible; App.history.end(App.doc);
        P.refreshLayers(); App.markDirty();
      }));
      el.querySelectorAll('[data-lock]').forEach(b => b.addEventListener('click', (e) => {
        e.stopPropagation();
        const n = page.nodes[b.dataset.lock];
        App.history.begin(App.doc); n.locked = !n.locked; App.history.end(App.doc);
        P.refreshLayers(); App.markDirty();
      }));
    },

    // ============================================================ PAGES
    renderPages() {
      const el = document.getElementById('ed-pages');
      if (!el || !App.doc) return;
      const doc = App.doc;
      el.innerHTML = doc.pages.map((p, i) => `
        <div class="pg-row${i === App.pageIndex ? ' sel' : ''}" data-i="${i}">
          <span>📄</span><span data-pgname="${i}">${esc(p.name)}</span>
        </div>`).join('') + `
        <div class="pg-add"><button id="pg-new">+ Add page</button></div>`;
      el.querySelectorAll('.pg-row').forEach(r => r.addEventListener('click', () => {
        App.pageIndex = +r.dataset.i;
        App.sel = [];
        P.renderPages(); P.refreshLayers(); P.refreshInspector(); App.markDirty();
      }));
      el.querySelectorAll('[data-pgname]').forEach(s => s.addEventListener('dblclick', () => {
        const i = +s.dataset.pgname;
        const name = prompt('Page name', doc.pages[i].name);
        if (name) { doc.pages[i].name = name; P.renderPages(); App.markDirty(); }
      }));
      el.querySelector('#pg-new').addEventListener('click', () => {
        M.addPage(doc, 'Page ' + (doc.pages.length + 1));
        P.renderPages(); P.refreshInspector(); App.markDirty();
      });
    },

    // ============================================================ INSPECTOR
    selNodes() { return App.sel.map(id => App.page.nodes[id]).filter(Boolean); },

    refreshInspector() {
      const el = document.getElementById('ed-right');
      if (!el || !App.doc) return;
      const nodes = this.selNodes();
      if (App.devMode) {
        el.innerHTML = nodes.length ? this.devCodeView(nodes[0]) : `
          <div class="ph big"><h3>Dev mode</h3><p>Select a layer to inspect its code.</p>
          <p class="keys"><span><b>D</b> exit dev mode</span></p></div>`;
        return;
      }
      if (!nodes.length) {
        el.innerHTML = `
          <div class="ph big">
            <h3>Nothing selected</h3>
            <p>Pick a tool on the left, or click a layer.</p>
            <p class="keys">
              <span><b>F</b> frame</span><span><b>R</b> rect</span><span><b>O</b> ellipse</span><span><b>T</b> text</span><span><b>P</b> pen</span><span><b>N</b> pencil</span><br>
              <span><b>A</b> arrow</span><span><b>S</b> section</span><span><b>D</b> dev mode</span><span><b>⌘/</b> mask / commands</span><br>
              <span><b>⌘K</b> versions</span><span><b>⌘E</b> export</span><span><b>⇧K</b> present</span><span><b>?</b> shortcuts</span>
            </p>
          </div>`;
        return;
      }
      const n = nodes[0];
      const multi = nodes.length > 1;
      const inAL = n.parent && App.page.nodes[n.parent] && App.page.nodes[n.parent].al;
      const parts = [];

      // ---- path / node editor (spec §6) — shown while the Pen tool is in edit mode
      if (App.pen && App.pen.kind === 'edit' && App.pen.node) parts.push(this.penSection());

      // ---- position & size
      parts.push(`
        <section class="ins-sec">
          <div class="ins-grid g4">
            ${field('X', 'x', Math.round(n.x))}${field('Y', 'y', Math.round(n.y))}
            ${multi ? '<span class="ins-dim">W</span><span class="ins-dim">H</span>' : field('W', 'w', Math.round(n.w)) + field('H', 'h', Math.round(n.h))}
          </div>
          ${!multi ? radiusRow(n) : ''}
          <div class="ins-row">
            <label>Opacity</label>
            <input type="range" min="0" max="100" data-act="opacity" value="${Math.round((n.opacity == null ? 1 : n.opacity) * 100)}"><span class="ins-val" id="op-val">${Math.round((n.opacity == null ? 1 : n.opacity) * 100)}%</span>
          </div>
        </section>`);

      // ---- fills
      if (n.type !== 'line' && n.type !== 'text' ? true : n.type === 'text') {
        parts.push(this.fillsSection(n, multi));
      }
      // ---- stroke
      parts.push(this.strokeSection(n, multi));
      // ---- effects
      if (n.type === 'rect' || n.type === 'ellipse' || n.type === 'frame' || n.type === 'instance') parts.push(this.effectsSection(n));
      // ---- auto layout (container)
      if ((n.type === 'frame' || n.type === 'instance') && !multi) parts.push(this.alSection(n));
      // ---- item
      if (inAL && n.type !== 'frame' || inAL && n.als) parts.push(this.itemSection(n));
      // ---- text
      if (n.type === 'text' && !multi) parts.push(this.textSection(n));
      // ---- component / instance
      if (!multi) parts.push(this.componentSection(n));
      // ---- component props
      if (!multi && (n.componentId || (n.type === 'frame' && global.Components.get(App.doc, n.id)))) parts.push(this.propsSection(n));
      // ---- constraints (children of manual-layout frames) + resize-to-fit
      if (n.parent && !multi) parts.push(this.constraintsSection(n));
      // ---- interactions (prototyping)
      if (!multi && n.type !== 'text') parts.push(this.interactionsSection(n));
      // ---- layout grid
      if ((n.type === 'frame' || n.type === 'instance') && !multi) parts.push(this.gridSection(n));
      // ---- mask
      if (n.parent && !multi) parts.push(`<section class="ins-sec"><div class="ins-row"><label>Mask</label><button class="ed-btn sm" data-act="mask-toggle" title="⌘/">${n.mask ? 'Remove mask' : 'Use as mask'}</button></div></section>`);
      // ---- z-order
      parts.push(`
        <section class="ins-sec">
          <div class="ins-btnrow">
            <button data-act="z-front" title="Bring to front">⇪</button>
            <button data-act="z-fwd" title="Bring forward">↑</button>
            <button data-act="z-bwd" title="Send backward">↓</button>
            <button data-act="z-back" title="Send to back">⇩</button>
            <button data-act="dup" title="Duplicate (⌘D)">⧉</button>
            <button data-act="del" title="Delete (⌫)">🗑</button>
          </div>
        </section>`);

      el.innerHTML = parts.join('');
      this.bindInspector(el, nodes);
    },

    fillsSection(n, multi) {
      const rows = (n.fills || []).map((f, i) => {
        if (f.type === 'solid') {
          const c = f._resolved && typeof f._resolved === 'string' ? f._resolved : f.color;
          return `
          <div class="fill-row" data-fi="${i}">
            <input type="color" class="f-color" value="${M.normHex(c)}" data-fi="${i}">
            <input class="f-hex" value="${M.normHex(c)}" spellcheck="false" data-fi="${i}">
            <input class="f-op" type="range" min="0" max="100" value="${Math.round((f.opacity == null ? 1 : f.opacity) * 100)}" data-fi="${i}">
            ${tokenSelect('color', f.token, 'f-token')}
            <button class="f-del" data-fi="${i}" title="Remove">✕</button>
          </div>`;
        }
        if (f.type === 'linear') {
          return `
          <div class="fill-row" data-fi="${i}">
            <span class="f-grad-swatch" style="background:linear-gradient(90deg, ${(f.stops || []).map(s => s.color + ' ' + Math.round((s.pos ?? 0) * 100) + '%').join(',')})"></span>
            <span class="f-type">Linear gradient</span>
            <button class="f-del" data-fi="${i}" title="Remove">✕</button>
          </div>
          <div class="grad-edit" data-fi="${i}">
            ${(f.stops || []).map((s, si) => `
              <div class="grad-stop">
                <input type="color" data-gs="${si}" value="${M.normHex(s.color)}">
                <input type="number" min="0" max="100" value="${Math.round((s.pos ?? 0) * 100)}" data-gp="${si}"><span>%</span>
                <button data-gdel="${si}">✕</button>
              </div>`).join('')}
            <button class="mini" data-gadd>+ stop</button>
          </div>`;
        }
        return `<div class="fill-row" data-fi="${i}"><span class="f-type">Image</span><button class="f-del" data-fi="${i}">✕</button></div>`;
      }).join('');
      return `
        <section class="ins-sec">
          <div class="ins-head"><span>Fills</span><span class="ins-head-btns">
            <button class="mini" data-act="add-solid" title="Solid fill">+ ▦</button>
            <button class="mini" data-act="add-grad" title="Linear gradient">+ ◫</button>
          </span></div>
          ${rows || '<div class="ph sm">No fills</div>'}
        </section>`;
    },
    strokeSection(n, multi) {
      const s = n.stroke || {};
      const c = s.token && s._resolved ? s._resolved : (s.color || '#000000');
      return `
        <section class="ins-sec">
          <div class="ins-head"><span>Stroke</span><label class="chk"><input type="checkbox" data-act="stroke-on" ${s.visible ? 'checked' : ''}> on</label></div>
          <div class="ins-grid g2">
            <span class="ins-lbl">Color</span>
            <span class="ins-crow"><input type="color" value="${M.normHex(c)}" data-act="stroke-color" ${s.visible ? '' : 'disabled'}>
            ${tokenSelect('color', s.token, 'stroke-token')}</span>
          </div>
          <div class="ins-grid g3">
            <label>Width</label><input type="number" min="0" step="1" value="${s.width || 0}" data-act="stroke-width" ${s.visible ? '' : 'disabled'}>
            <label>Pos</label><select data-act="stroke-align" ${s.visible ? '' : 'disabled'}>
              <option value="inside" ${s.align === 'inside' ? 'sel' : ''}>Inside</option>
              <option value="center" ${s.align === 'center' ? 'sel' : ''}>Center</option>
              <option value="outside" ${s.align === 'outside' ? 'sel' : ''}>Outside</option>
            </select>
          </div>
        </section>`;
    },
    penSection() {
      const pen = App.pen;
      const sp = pen.subpaths[pen.subIdx] || { nodes: [], closed: false };
      const node = pen.sel >= 0 && pen.sel < sp.nodes.length ? sp.nodes[pen.sel] : null;
      const sel = pen.sel >= 0 && pen.sel < sp.nodes.length;
      return `
        <section class="ins-sec pen-sec">
          <div class="ins-head"><span>Path</span><span class="ins-val">${sp.nodes.length} node${sp.nodes.length === 1 ? '' : 's'} · ${sp.closed ? 'closed' : 'open'}</span></div>
          <div class="ins-row"><label>Selected</label><span class="ins-val">${node ? (node.type === 'smooth' ? 'smooth' : 'corner') : '—'}</span></div>
          <div class="ins-btnrow">
            <button data-pen="smooth" title="Make selected node smooth" ${sel ? '' : 'disabled'}>Smooth</button>
            <button data-pen="corner" title="Make selected node a corner" ${sel ? '' : 'disabled'}>Corner</button>
            <button data-pen="del-node" title="Delete selected node (Backspace)" ${sel ? '' : 'disabled'}>Delete node</button>
          </div>
          <div class="ins-btnrow">
            <button data-pen="close" title="Close the current path (Enter)" ${sp.nodes.length >= 3 && !sp.closed ? '' : 'disabled'}>Close path</button>
            <button data-pen="split" title="Split the path at the selected node" ${sel ? '' : 'disabled'}>Split path</button>
            <button data-pen="finish" title="Finish editing (Esc)">Done</button>
          </div>
          <div class="ph" style="padding:2px 4px;font-size:10px">Click a node to select · click a segment to add one · drag handles to shape · Esc to finish.</div>
        </section>`;
    },
    effectsSection(n) {
      const sh = (n.shadows || []).map((s, i) => `
        <div class="sh-row">
          <input type="color" value="${M.normHex(s.color)}" data-sh="${i}" data-f="color">
          <input type="number" value="${Math.round(s.x || 0)}" data-sh="${i}" data-f="x" title="X">
          <input type="number" value="${Math.round(s.y || 0)}" data-sh="${i}" data-f="y" title="Y">
          <input type="number" value="${Math.round(s.blur || 0)}" data-sh="${i}" data-f="blur" title="Blur">
          <input type="number" value="${Math.round(s.spread || 0)}" data-sh="${i}" data-f="spread" title="Spread">
          <button data-shdel="${i}">✕</button>
        </div>`).join('');
      return `
        <section class="ins-sec">
          <div class="ins-head"><span>Effects</span><button class="mini" data-act="add-shadow">+ Shadow</button></div>
          ${sh || '<div class="ph sm">No effects</div>'}
          <div class="ins-grid g2"><label>Layer blur</label><input type="number" min="0" value="${n.blur || 0}" data-act="blur"></div>
        </section>`;
    },
    alSection(n) {
      if (!n.al) {
        return `
          <section class="ins-sec al-sec">
            <div class="ins-head"><span>Auto layout</span></div>
            <div class="ins-btnrow">
              <button class="al-add" data-al="h" title="Add auto layout (horizontal)">→ Add →</button>
              <button class="al-add" data-al="v" title="Add auto layout (vertical)">↓ Add ↓</button>
            </div>
            <div class="ph sm">Figma-style layout: padding, gap, wrap, hug / fill / fixed sizing. Implemented with a custom layout engine — no CSS flexbox.</div>
          </section>`;
      }
      const al = n.al;
      const alignGrid = (() => {
        const mains = ['start', 'center', 'end'];
        let html = '<div class="al-grid" title="Alignment: row = cross axis, column = primary axis">';
        for (const cross of ['end', 'center', 'start']) {
          for (const main of ['start', 'center', 'end']) {
            html += `<button class="al-cell${al.main === main && al.cross === cross ? ' on' : ''}" data-main="${main}" data-cross="${cross}"><span class="al-dot"></span></button>`;
          }
        }
        html += '</div>';
        return html;
      })();
      const more = `
        <div class="ins-grid g3 al-more">
          <select data-act="al-main-more" title="Primary axis">
            ${['start', 'center', 'end', 'space-between', 'space-evenly'].map(v => `<option value="${v}" ${al.main === v ? 'sel' : ''}>${v}</option>`).join('')}
          </select>
          <select data-act="al-cross-more" title="Cross axis">
            ${['start', 'center', 'end', 'stretch'].map(v => `<option value="${v}" ${al.cross === v ? 'sel' : ''}>${v}</option>`).join('')}
          </select>
          <label class="chk"><input type="checkbox" data-act="al-reverse" ${al.reverse ? 'checked' : ''}> reverse</label>
        </div>`;
      return `
        <section class="ins-sec al-sec">
          <div class="ins-head"><span>Auto layout</span><button class="mini" data-act="al-remove">Remove</button></div>
          <div class="ins-btnrow">
            <button class="al-dir ${al.dir === 'h' ? 'on' : ''}" data-aldir="h" title="Horizontal">→</button>
            <button class="al-dir ${al.dir === 'v' ? 'on' : ''}" data-aldir="v" title="Vertical">↓</button>
            <button class="al-dir ${al.wrap ? 'on' : ''}" data-act="al-wrap" title="Wrap">⇄ wrap</button>
          </div>
          <div class="al-alignwrap">${alignGrid}${more}</div>
          <div class="ins-grid g2">
            <label>Gap</label><input type="number" min="0" value="${al.gap.n}" data-act="al-gap">${tokenSelect('number', al.gap.tok, 'al-gap-tok')}
          </div>
          ${al.wrap ? `<div class="ins-grid g2"><label>Gap (rows)</label><input type="number" min="0" value="${al.gapCross.n}" data-act="al-gapc"></div>` : ''}
          <div class="al-pads">
            <label>P</label>
            <div class="al-padgrid">
              <input type="number" min="0" value="${al.pad[0].n}" data-padi="0" title="Top">
              <input type="number" min="0" value="${al.pad[1].n}" data-padi="1" title="Right">
              <input type="number" min="0" value="${al.pad[3].n}" data-padi="3" title="Left">
              <input type="number" min="0" value="${al.pad[2].n}" data-padi="2" title="Bottom">
            </div>
            <label class="chk al-padlink"><input type="checkbox" ${al.pad.every(p => p.n === al.pad[0].n) ? 'checked' : ''} data-act="pad-link"> link</label>
          </div>
        </section>`;
    },
    itemSection(n) {
      if (!n.als) return '';
      const a = n.als;
      const seg = (key, cur) => `
        <div class="seg ins-seg" data-seg="${key}">
          ${['hug', 'fill', 'fixed'].map(v => `<button class="seg-btn ${cur === v ? 'active' : ''}" data-sv="${v}">${v}</button>`).join('')}
        </div>`;
      return `
        <section class="ins-sec al-sec">
          <div class="ins-head"><span>Layout (item)</span></div>
          <div class="ins-grid g2"><label>Width</label>${seg('w', a.w)}</div>
          <div class="ins-grid g2"><label>Height</label>${seg('h', a.h)}</div>
          <div class="ins-grid g2">
            <label>Align</label>
            <select data-act="alself">
              ${['auto', 'start', 'center', 'end', 'stretch'].map(v => `<option value="${v}" ${a.align === v ? 'sel' : ''}>${v}</option>`).join('')}
            </select>
          </div>
          <label class="chk"><input type="checkbox" data-act="al-abs" ${a.absolute ? 'checked' : ''}> Absolute position</label>
        </section>`;
    },
    textSection(n) {
      const t = n.text || {};
      const fonts = ['Inter', 'Helvetica', 'Arial', 'Roboto', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Trebuchet MS', 'Garamond', 'Futura', 'Impact'];
      return `
        <section class="ins-sec">
          <div class="ins-head"><span>Text</span><button class="mini" data-act="edit-text" title="Edit text">✎</button></div>
          <div class="ins-btnrow">
            ${[['auto', '⇲', 'Auto width and height (hug — Figma default for new text)'], ['auto-w', '⇆', 'Auto width (fixed height)'], ['auto-h', '⇵', 'Auto height (fixed width)'], ['fixed', '▣', 'Fixed size']].map(([m, g, tip]) => `<button class="al-dir ${(t.resize || 'fixed') === m ? 'on' : ''}" data-tresize="${m}" title="${tip}">${g}</button>`).join('')}
            <span class="ins-spacer"></span><span style="font-size:9px;opacity:.55">Auto-resize</span>
          </div>
          <div class="ins-grid g2"><label>Font</label>
            <select data-act="t-font">${fonts.map(f => `<option ${t.font === f ? 'sel' : ''}>${f}</option>`).join('')}</select>
          </div>
          <div class="ins-grid g3">
            <label>Size</label><input type="number" min="4" max="300" value="${t.size}" data-act="t-size">
            <label>Weight</label>
            <select data-act="t-weight">${[100, 200, 300, 400, 500, 600, 700, 800, 900].map(w => `<option value="${w}" ${t.weight === w ? 'sel' : ''}>${w}</option>`).join('')}</select>
          </div>
          <div class="ins-grid g3">
            <label>Line height</label><input type="number" step="0.05" min="0.5" value="${t.lineHeight}" data-act="t-lh">
            <label>Tracking</label><input type="number" step="0.5" value="${t.letterSpacing}" data-act="t-ls">
            <label class="chk"><input type="checkbox" data-act="t-italic" ${t.italic ? 'checked' : ''}> Italic</label>
          </div>
          <div class="ins-btnrow">
            ${['left', 'center', 'right'].map(a => `<button class="al-dir ${t.align === a ? 'on' : ''}" data-talign="${a}">${{ left: '⯇', center: '≡', right: '⯈' }[a]}</button>`).join('')}
            <span class="ins-spacer"></span>
            ${['top', 'middle', 'bottom'].map(a => `<button class="al-dir ${t.valign === a ? 'on' : ''}" data-tvalign="${a}">${{ top: '↑', middle: '⇕', bottom: '↓' }[a]}</button>`).join('')}
          </div>
        </section>`;
    },

    // ============================================================ component / instance
    componentSection(n) {
      const C = global.Components;
      const doc = App.doc;
      let set = n.componentId ? C.get(doc, n.componentId) : (C.get(doc, n.id));
      // library instance: the set lives in the linked file
      if (n.type === 'instance' && !set && n.libraryFileId) {
        const src = global.Libraries.sourceFor(doc, n.componentId, n.libraryFileId);
        if (src) set = src.set;
      }
      if (n.type === 'instance' && set) {
        const variants = Object.keys(set.variants);
        const libName = n.libraryFileId ? (global.Libraries.list(doc).find(l => l.fileId === n.libraryFileId) || {}).name : null;
        return `<section class="ins-sec">
          <div class="ins-sec-title">Instance</div>
          <div class="ins-row"><label>Component</label><span class="ins-val">${esc(set.name)}${libName ? ` <span class="alias-chip" title="From library file">📚 ${esc(libName)}</span>` : ''}</span></div>
          ${!n.libraryFileId ? `<div class="ins-row"><label>Variant</label>
            <select data-act="inst-variant">
              ${variants.map(v => `<option value="${esc(v)}" ${n.variant === v ? 'selected' : ''}>${esc(v)}</option>`).join('')}
            </select>
          </div>` : ''}
          <div class="ins-btnrow"><button data-act="inst-update" title="${n.libraryFileId ? 'Re-clone from the library file' : 'Re-clone from component (keeps text overrides)'}">↻ Update ${n.libraryFileId ? 'from library' : 'instance'}</button></div>
        </section>`;
      }
      if (n.type === 'frame' && set) {
        const variants = Object.keys(set.variants).filter(v => v !== n.name);
        return `<section class="ins-sec">
          <div class="ins-sec-title">Component</div>
          <div class="ins-row"><label>Main variant</label><span class="ins-val">${esc(n.name)}</span></div>
          ${variants.map(v => `<div class="ins-row"><label>&nbsp;</label><span class="ins-val">${esc(v)}</span></div>`).join('')}
          <div class="ins-row"><label>Add variant</label><input type="text" data-act="variant-name" placeholder="e.g. Disabled" style="width:110px"><button class="ed-btn sm" data-act="variant-add">+</button></div>
          <div class="ins-btnrow"><button data-act="inst-count" title="How many instances exist">⧉ ${C.instancesOf(doc, n.id).length} instance(s)</button></div>
        </section>`;
      }
      if (n.type === 'frame') {
        return `<section class="ins-sec">
          <div class="ins-sec-title">Component</div>
          <div class="ins-btnrow"><button data-act="make-component" title="⌥C">◆ Make component</button></div>
        </section>`;
      }
      return '';
    },

    // ============================================================ component props
    propsSection(n) {
      const C = global.Components, doc = App.doc;
      const setId = n.componentId || n.id;
      // library instance: prop definitions live in the linked file's doc
      let srcDoc = doc;
      if (n.libraryFileId) {
        const src = global.Libraries.sourceFor(doc, n.componentId, n.libraryFileId);
        if (src) srcDoc = src.libraryDoc;
      }
      const props = C.propsOf(srcDoc, setId);
      if (n.componentId) {
        // instance: show value editors
        const rows = props.map(p => `\n          <div class="ins-row"><label>${esc(p.name)}</label>${
            p.type === 'text'
              ? `<input type="text" data-act="prop-set" data-name="${esc(p.name)}" value="${esc(n.props ? (n.props[p.name] != null ? n.props[p.name] : '') : '')}" style="width:110px">`
              : `<input type="checkbox" data-act="prop-set" data-name="${esc(p.name)}" ${n.props && n.props[p.name] ? 'checked' : ''}>`
          }</div>`).join('');
        return `<section class="ins-sec">
          <div class="ins-sec-title">Properties</div>
          ${props.length ? rows : '<p class="ph" style="padding:4px">No props on this component.</p>'}
        </section>`;
      }
      // component: manage the prop definitions
      const rows = props.map(p => `\n          <div class="ins-row"><label>${esc(p.name)}</label><span class="ins-val">${p.type}</span><button class="ed-btn sm" data-act="prop-del" data-name="${esc(p.name)}">✕</button></div>`).join('');
      return `<section class="ins-sec">
        <div class="ins-sec-title">Properties</div>
        ${rows || '<p class="ph" style="padding:4px">No props yet.</p>'}
        <div class="ins-row" style="margin-top:6px">
          <input type="text" data-act="prop-name" placeholder="Child name" style="width:86px">
          <select data-act="prop-type"><option value="bool">Boolean</option><option value="text">Text</option></select>
          <button class="ed-btn sm" data-act="prop-add">+ Prop</button>
        </div>
        <p class="ph" style="padding:2px 4px 0;font-size:10px">Bound by child name: text props set that child's text, bool props toggle its visibility.</p>
      </section>`;
    },

    // ============================================================ constraints + resize-to-fit
    constraintsSection(n) {
      const page = App.page;
      const parent = n.parent ? page.nodes[n.parent] : null;
      if (!parent) return '';
      const c = n.constraints || { h: 'min', v: 'min' };
      const OPTS = ['min', 'center', 'max', 'stretch', 'scale'];
      const sel = (axis, cur) => `<select data-act="con-${axis}">${OPTS.map(o => `<option value="${o}" ${cur === o ? 'selected' : ''}>${o}</option>`).join('')}</select>`;
      const isContainer = (n.type === 'frame' || n.type === 'instance') && !parent.al;
      return `<section class="ins-sec">
        <div class="ins-sec-title">Constraints${parent.al ? ' (off in auto layout)' : ''}</div>
        <div class="ins-grid g2" style="grid-template-columns:64px 1fr 1fr">
          <span class="ins-dim">H / V</span>
          ${parent.al ? '<span class="ins-dim" colspan="2">managed by auto layout</span>' : sel('h', c.h) + sel('v', c.v)}
        </div>
        ${isContainer ? `<div class="ins-btnrow"><button data-act="resize-fit" title="Shrink-wrap this frame to its content">⤡ Resize to fit</button></div>` : ''}
      </section>`;
    },

    // ============================================================ interactions
    interactionsSection(n) {
      const page = App.page, doc = App.doc;
      const opts = (kind) => {
        if (kind === 'node') return page.tops.map(tid => `<option value="${tid}">${esc(page.nodes[tid].name)}</option>`).join('');
        return doc.pages.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
      };
      const rows = (n.interactions || []).map((it, i) => `
        <div class="ins-inter">
          <div class="ins-grid g2" style="grid-template-columns:64px 1fr">
            <span class="ins-dim">On click</span>
            <select data-act="it-kind" data-i="${i}"><option value="node" ${it.kind === 'node' ? 'selected' : ''}>Frame…</option><option value="page" ${it.kind === 'page' ? 'selected' : ''}>Page…</option></select>
          </div>
          <div class="ins-grid g2" style="grid-template-columns:64px 1fr 1fr">
            <span class="ins-dim">Navigate</span>
            <select data-act="it-to" data-i="${i}">${(it.kind === 'page' ? opts('page') : opts('node')).replace(`<option value="${it.to}"`, `<option value="${it.to}" selected`)}</select>
            <select data-act="it-anim" data-i="${i}">${['none', 'fade', 'slide', 'overlay', 'scroll'].map(a => `<option value="${a}" ${it.anim === a ? 'selected' : ''}>${a}</option>`).join('')}</select>
          </div>
          <div class="ins-btnrow"><button data-act="it-del" data-i="${i}">✕</button></div>
        </div>`).join('');
      return `<section class="ins-sec">
        <div class="ins-sec-title">Prototype</div>
        ${rows}
        <div class="ins-btnrow"><button data-act="it-add">+ Interaction</button></div>
      </section>`;
    },

    // ============================================================ layout grid
    gridSection(n) {
      const g = n.grid;
      return `<section class="ins-sec">
        <div class="ins-sec-title">Layout grid</div>
        ${g ? `
          <div class="ins-grid g4">
            <span class="ins-dim">Type</span><span class="ins-dim">#</span><span class="ins-dim">Gap</span><span class="ins-dim">Offset</span>
            <select data-act="grid-kind">${['columns', 'rows'].map(k => `<option ${g.kind === k ? 'selected' : ''}>${k}</option>`).join('')}</select>
            <input type="number" data-act="grid-count" value="${g.count}" min="1" max="32">
            <input type="number" data-act="grid-gap" value="${g.gap}" min="0">
            <input type="number" data-act="grid-offset" value="${g.offset}" min="0">
          </div>
          <div class="ins-btnrow"><button data-act="grid-del">Remove grid</button></div>` : `
          <div class="ins-btnrow"><button data-act="grid-add">+ Columns</button><button data-act="grid-add-rows">+ Rows</button></div>`}
      </section>`;
    },

    // ============================================================ dev mode code view
    devCodeView(n) {
      const doc = App.doc, page = App.page;
      App.layoutDoc(doc, page);
      const E = global.Eco.CodeGen;
      const css = E.css(doc, page, n);
      const html = E.html(doc, page, n);
      const spec = [
        ['Name', n.name],
        ['Size', Math.round(n._l ? n._l.w : n.w) + ' × ' + Math.round(n._l ? n._l.h : n.h)],
        ['Position', Math.round(n._l ? n._l.x : n.x) + ', ' + Math.round(n._l ? n._l.y : n.y)],
        ['Type', n.type + (n.al ? ' · auto-layout ' + n.al.dir : '')],
        ['Fill', n.fills && n.fills[0] ? (n.fills[0].type === 'solid' ? n.fills[0].color : n.fills[0].type) : '—'],
        ['Opacity', Math.round((n.opacity == null ? 1 : n.opacity) * 100) + '%'],
        ['Constraints', (n.constraints || {}).h + ' / ' + (n.constraints || {}).v],
      ].map(([k, v]) => `<div class="spec-row"><span>${esc(k)}</span><b>${esc(String(v))}</b></div>`).join('');
      const E2 = global.Eco.Annotations;
      const anns = E2.listFor(doc, n.id);
      const annRows = anns.map(a => `<div class="spec-row"><span>${esc(a.author)} · ${new Date(a.at).toLocaleTimeString()}</span><b>${esc(a.text)}</b></div><button class="ed-btn sm" data-act="ann-del" data-id="${a.id}" style="margin:-2px 0 4px 8px">✕</button>`).join('');
      return `
        <section class="ins-sec"><div class="ins-sec-title">Inspect</div>${spec}</section>
        <section class="ins-sec"><div class="ins-sec-title">Annotations</div>${annRows || '<p class="ph" style="padding:4px">No notes on this node.</p>'}
          <div class="ins-row" style="margin-top:6px"><input type="text" data-act="ann-text" placeholder="Add a dev note…" style="width:150px"><button class="ed-btn sm" data-act="ann-add">+</button></div>
        </section>
        <section class="ins-sec"><div class="ins-sec-title">CSS</div><pre class="code-block">${esc(css)}</pre><button class="ed-btn sm" data-act="copy-css">Copy CSS</button></section>
        <section class="ins-sec"><div class="ins-sec-title">HTML</div><pre class="code-block">${esc(html)}</pre><button class="ed-btn sm" data-act="copy-html">Copy HTML</button></section>`;
    },

    // ============================================================ versions menu
    versionsMenu(x, y) {
      const doc = App.doc;
      if (!doc) return;
      const V = global.Eco.Versions;
      const el = document.createElement('div');
      el.className = 'pf-menu versions-menu';
      const list = V.list(doc);
      el.innerHTML = `
        <div class="pf-title">Version history</div>
        <div class="ver-add"><input type="text" id="ver-name" placeholder="Version name (⌘K)"><button data-v="add">Add now</button></div>
        ${list.length ? list.map(v => `
          <div class="ver-row">
            <div class="ver-meta"><b>${esc(v.name)}</b><span>${new Date(v.at).toLocaleString()}</span></div>
            <div class="ver-actions"><button data-v="restore" data-id="${v.id}">Restore</button><button data-v="del" data-id="${v.id}">🗑</button></div>
          </div>`).join('') : '<div class="ph" style="padding:8px">No versions yet — "Add now" snapshots the whole file.</div>'}`;
      if (x == null) { const r = document.getElementById('ed-versions').getBoundingClientRect(); x = r.right; y = r.bottom + 4; }
      el.style.left = Math.min(x, innerWidth - 340) + 'px';
      el.style.top = Math.min(y, innerHeight - 400) + 'px';
      this._menu(el);
      el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        const v = b.dataset.v;
        if (v === 'add') {
          const name = el.querySelector('#ver-name').value.trim() || undefined;
          App.history.begin(doc);
          V.add(doc, name);
          App.history.end(doc);
          App.saveNow();
          App.toast('Version added');
          el.remove();
          global.Panels.versionsMenu(x, y);
        } else if (v === 'restore') {
          App.history.begin(doc);
          V.restore(doc, b.dataset.id);
          App.history.end(doc);
          App.sel = [];
          App.saveNow();
          App.markDirty();
          App.toast('Version restored');
          el.remove();
        } else if (v === 'del') {
          V.remove(doc, b.dataset.id);
          global.Panels.versionsMenu(x, y);
        }
      }));
    },

    // ============================================================ plugins modal
    pluginsModal() {
      const doc = App.doc;
      if (!doc) return;
      const Pl = global.Plugins;
      document.querySelectorAll('.pf-modal').forEach(m => m.remove());
      const wrap = document.createElement('div');
      wrap.className = 'pf-modal';
      const renderList = () => {
        const custom = Pl.custom.all();
        const acts = (p) => (p.ui ? `<button data-open="${p.id}" title="Open plugin UI panel">🖥 Open</button>` : '') +
          (p.code ? `<button data-run="${p.id}" title="Run (headless)">▶ Run</button>` : '');
        const actsC = (p) => (p.ui ? `<button data-open-c="${p.id}" title="Open plugin UI panel">🖥</button>` : '') +
          (p.code ? `<button data-run-c="${p.id}" title="Run">▶</button>` : '');
        wrap.querySelector('.pl-list').innerHTML =
          Pl.builtins.map(p => `<div class="pl-row"><div class="pl-meta"><b>${esc(p.name)}</b><span>${esc(p.desc)}</span></div><div class="pl-acts">${acts(p)}</div></div>`).join('') +
          (custom.length ? '<div class="pf-title" style="margin-top:8px">Custom</div>' : '') +
          custom.map(p => `<div class="pl-row"><div class="pl-meta"><b>${esc(p.name)}</b></div><div class="pl-acts">${actsC(p)}<button data-del-c="${p.id}">🗑</button></div></div>`).join('') || '';
      };
      wrap.innerHTML = `
        <div class="pf-modal-card">
          <div class="pf-modal-head"><b>Plugins</b><button class="ed-iconbtn pf-modal-x">✕</button></div>
          <div class="pl-trust"><b>▶ Run</b> headless plugins execute in a sandboxed Web Worker (async <code>penfig</code> API, whitelisted RPC only) — where Workers are unavailable they fall back to trusted local code, as labeled in the output. <b>🖥 Open</b> UI plugins run sandboxed (iframe, scripts-only) and may only call the same whitelisted RPC surface.</div>
          <div class="pl-list"></div>
          <div class="pf-title" style="margin-top:10px">New custom plugin</div>
          <div class="pl-new"><input type="text" id="pl-name" placeholder="Name"><textarea id="pl-code" rows="6" placeholder='Headless code (optional).\ne.g. penfig.toast("hi"); penfig.refresh(); return "done";'></textarea>
          <textarea id="pl-ui" rows="6" placeholder='UI code (optional) — runs in a sandboxed panel; use await penfig.call("doc")…\ne.g. const doc = await penfig.call("doc"); document.body.textContent = doc.name;'></textarea>
          <div class="pl-acts"><button data-pl="save">＋ Add to list</button></div></div>
          <pre class="pl-out" style="display:none"></pre>
        </div>`;
      document.body.appendChild(wrap);
      renderList();
      const close = () => wrap.remove();
      wrap.querySelector('.pf-modal-x').addEventListener('click', close);
      wrap.addEventListener('click', (e) => {
        if (e.target === wrap) close();
        const run = e.target.dataset.run;
        const runC = e.target.dataset.runC;
        const delC = e.target.dataset.delC;
        const open = e.target.dataset.open;
        const openC = e.target.dataset.openC;
        if (run) {
          const p = Pl.builtins.find(b => b.id === run);
          this._runPlugin(p.code, wrap);
        } else if (runC) {
          const p = Pl.custom.all().find(b => b.id === runC);
          if (p) this._runPlugin(p.code, wrap);
        } else if (delC) {
          Pl.custom.remove(delC);
          renderList();
        } else if (open || openC) {
          const p = open ? Pl.builtins.find(b => b.id === open) : Pl.custom.all().find(b => b.id === openC);
          if (p) this._openPluginUI(p, wrap);
        }
        if (e.target.dataset.pl === 'save') {
          const name = wrap.querySelector('#pl-name').value.trim();
          const code = wrap.querySelector('#pl-code').value;
          const ui = wrap.querySelector('#pl-ui').value;
          if (!name || (!code.trim() && !ui.trim())) { App.toast('Name + code (or UI code) required'); return; }
          Pl.custom.add({ name, code, ui: ui.trim() || undefined });
          wrap.querySelector('#pl-name').value = '';
          wrap.querySelector('#pl-code').value = '';
          wrap.querySelector('#pl-ui').value = '';
          renderList();
          App.toast('Plugin added');
        }
      });
      this._menu(wrap);
    },
    async _runPlugin(code, wrap) {
      const out = wrap.querySelector('.pl-out');
      out.style.display = '';
      out.textContent = '… running in ' + (global.Plugins.workerAvailable() ? 'sandboxed worker' : 'local trusted mode') + '';
      const res = await global.Plugins.run(code, App);
      out.textContent = (res.ok ? '✔ ' + res.result : '✖ ' + res.error) + (res.logs.length ? '\n' + res.logs.join('\n') : '');
      if (res.ok && res.result !== 'Done.') App.toast(res.result);
    },
    _openPluginUI(p, wrap) {
      const out = wrap.querySelector('.pl-out');
      const h = global.Plugins.runUI(p.code || '', p.ui, App, (line) => {
        out.style.display = '';
        out.textContent = (out.textContent ? out.textContent + '\n' : '') + line;
      });
      // when the plugins modal goes away, close the UI panel with it
      try {
        const obs = new MutationObserver(() => {
          if (!document.body.contains(wrap)) { obs.disconnect(); h.close(); }
        });
        obs.observe(document.body, { childList: true });
      } catch (e) { /* no observer support — the panel has its own ✕ */ }
    },

    // ============================================================ assets panel
    renderAssets() {
      const el = document.getElementById('ed-assets');
      if (!el || !App.doc) return;
      const C = global.Components, L = global.Libraries;
      const doc = App.doc;
      const list = C.list(doc);
      const libs = L.list(doc);
      const libRows = libs.map(lib => {
        const comps = L.componentsOf(doc, lib.fileId);
        return `
        <div class="pf-title" style="display:flex;justify-content:space-between;align-items:center">
          <span>📚 ${esc(lib.name)}</span>
          <span>
            <button class="mini" data-llib-update="${lib.fileId}" title="Re-clone all instances from the library file">↻</button>
            <button class="mini" data-llib-unlink="${lib.fileId}" title="Unlink library">🗑</button>
          </span>
        </div>
        ${comps.length ? comps.map(c => `
          <div class="asset-row" data-llib="${lib.fileId}" data-lcomp="${c.id}" title="Double-click to insert instance">
            <span class="asset-ico" style="opacity:.75">◆</span>
            <div class="asset-meta"><b>${esc(c.name)}</b><span>library · ${Object.keys(c.variants).length} variant(s)</span></div>
          </div>`).join('') : '<div class="ph" style="padding:2px 10px">No components in this file.</div>'}`;
      }).join('');
      el.innerHTML = `
        ${list.length ? `<div class="pf-title">This file</div>` + list.map(c => `
          <div class="asset-row" data-comp="${c.id}" title="Double-click to insert instance">
            <span class="asset-ico">◆</span>
            <div class="asset-meta"><b>${esc(c.name)}</b><span>${Object.keys(c.variants).length} variant(s) · ${C.instancesOf(doc, c.id).length} instance(s)</span></div>
          </div>`).join('') : '<div class="ph">No components yet.<br>Select a frame → <b>Make component</b> (or ⌥C).</div>'}
        ${libRows}
        <div class="ins-btnrow" style="padding:8px"><button class="ed-btn sm" data-llib-link>＋ Link a file as library…</button></div>`;
      // local component rows
      el.querySelectorAll('[data-comp]').forEach(r => r.addEventListener('dblclick', () => {
        App.history.begin(doc);
        const rect = App.canvas.getBoundingClientRect();
        const c = App.toWorld({ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 });
        const inst = C.makeInstance(doc, App.page, r.dataset.comp, null, c.x - 60, c.y - 40);
        App.history.end(doc);
        if (inst) { App.sel = [inst.id]; P.refreshLayers(); App.markDirty(); App.toast('Instance inserted'); }
      }));
      // library component rows
      el.querySelectorAll('[data-llib]').forEach(r => r.addEventListener('dblclick', () => {
        App.history.begin(doc);
        const rect = App.canvas.getBoundingClientRect();
        const c = App.toWorld({ clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 });
        const inst = L.makeInstance(doc, App.page, r.dataset.llib, r.dataset.lcomp, c.x - 60, c.y - 40);
        App.history.end(doc);
        if (inst) { App.sel = [inst.id]; P.refreshLayers(); App.markDirty(); App.toast('Library instance inserted'); }
      }));
      el.querySelectorAll('[data-llib-unlink]').forEach(b => b.addEventListener('click', () => {
        App.history.begin(doc); L.unlink(doc, b.dataset.llibUnlink); App.history.end(doc);
        P.renderAssets(); App.markDirty(); App.toast('Library unlinked (instances keep their content)');
      }));
      el.querySelectorAll('[data-llib-update]').forEach(b => b.addEventListener('click', () => {
        App.history.begin(doc);
        const n = L.updateAll(doc, b.dataset.llibUpdate);
        App.history.end(doc);
        P.renderAssets(); P.refreshLayers(); App.markDirty(); App.toast(`Updated ${n} instance(s) from library`);
      }));
      const linkBtn = el.querySelector('[data-llib-link]');
      if (linkBtn) linkBtn.addEventListener('click', () => {
        const files = M.store.all().filter(f => f.id !== doc.id && f.doc && Object.keys(f.doc.components || {}).length);
        if (!files.length) { App.toast('No other files with components to link'); return; }
        const name = prompt('Link a local file as a component library:\n\n' + files.map((f, i) => `${i + 1}. ${f.name}`).join('\n'), '1');
        const i = parseInt(name, 10) - 1;
        if (isFinite(i) && files[i]) {
          App.history.begin(doc); L.link(doc, files[i].id); App.history.end(doc);
          P.renderAssets(); App.markDirty(); App.toast(`Linked “${files[i].name}”`);
        }
      });
    },

    // ============================================================ styles tab
    renderStyles() {
      const el = document.getElementById('ed-styles');
      if (!el || !App.doc) return;
      const S = global.Styles, doc = App.doc, page = App.page;
      const commit = (fn) => { App.history.begin(doc); fn(); App.history.end(doc); P.renderStyles(); P.refreshInspector(); App.markDirty(); };
      const selIds = App.sel.slice();
      const selNodes = selIds.map(id => page.nodes[id]).filter(Boolean);
      const selText = selNodes.find(n => n.type === 'text' && n.text);
      const selPainted = selNodes.find(n => (n.fills || []).length);

      const textRows = S.textList(doc).map(st => `
        <div class="asset-row" data-tstyle="${st.id}" title="Click to apply to selection">
          <span class="asset-ico" style="font-size:15px">T</span>
          <div class="asset-meta"><b>${esc(st.name)}</b><span>${esc(st.font)} ${st.size}px · ${st.weight}${st.italic ? ' · italic' : ''}</span></div>
          <button class="mini" data-trename="${st.id}" title="Rename">✎</button>
          <button class="mini" data-tdel="${st.id}" title="Delete">✕</button>
        </div>`).join('');
      const paintRows = S.paintList(doc).map(st => `
        <div class="asset-row" data-pstyle="${st.id}" title="Click to apply to selection">
          <span class="asset-ico" style="display:inline-block;width:14px;height:14px;border-radius:3px;background:${st.fills && st.fills[0] && st.fills[0].type === 'solid' ? st.fills[0].color : 'repeating-linear-gradient(45deg,#888 0 4px,#555 4px 8px)'}"></span>
          <div class="asset-meta"><b>${esc(st.name)}</b><span>${(st.fills || []).map(f => f.type === 'solid' ? f.color : f.type).join(', ') || '—'}</span></div>
          <button class="mini" data-prename="${st.id}" title="Rename">✎</button>
          <button class="mini" data-pdel="${st.id}" title="Delete">✕</button>
        </div>`).join('');

      el.innerHTML = `
        <div class="ph" style="padding:6px 8px 2px">Click a style to apply it to the selection.</div>
        <div class="pf-title" style="padding:4px 8px">Text styles</div>
        ${textRows || '<div class="ph" style="padding:4px 10px">None yet.</div>'}
        <div class="ins-btnrow" style="padding:4px 8px"><button class="ed-btn sm" data-new="text" ${selText ? '' : 'disabled'}>＋ From selection</button></div>
        <div class="pf-title" style="padding:8px 8px 4px">Paint styles</div>
        ${paintRows || '<div class="ph" style="padding:4px 10px">None yet.</div>'}
        <div class="ins-btnrow" style="padding:4px 8px"><button class="ed-btn sm" data-new="paint" ${selPainted ? '' : 'disabled'}>＋ From selection</button></div>`;

      el.querySelectorAll('[data-tstyle]').forEach(r => r.addEventListener('click', (e) => {
        if (e.target.closest('[data-trename]') || e.target.closest('[data-tdel]')) return;
        commit(() => { const n = S.applyTextStyle(doc, page, r.dataset.tstyle, selIds); App.toast(n ? `Applied to ${n} node(s)` : 'Select a text node first'); });
      }));
      el.querySelectorAll('[data-pstyle]').forEach(r => r.addEventListener('click', (e) => {
        if (e.target.closest('[data-prename]') || e.target.closest('[data-pdel]')) return;
        commit(() => { const n = S.applyPaintStyle(doc, page, r.dataset.pstyle, selIds); App.toast(n ? `Applied to ${n} node(s)` : 'Select a node first'); });
      }));
      el.querySelectorAll('[data-trename]').forEach(b => b.addEventListener('click', () => {
        const st = S.getText(doc, b.dataset.trename); const nm = prompt('Style name', st.name); if (nm) commit(() => S.renameTextStyle(doc, st.id, nm.trim()));
      }));
      el.querySelectorAll('[data-prename]').forEach(b => b.addEventListener('click', () => {
        const st = S.getPaint(doc, b.dataset.prename); const nm = prompt('Style name', st.name); if (nm) commit(() => S.renamePaintStyle(doc, st.id, nm.trim()));
      }));
      el.querySelectorAll('[data-tdel]').forEach(b => b.addEventListener('click', () => commit(() => S.deleteTextStyle(doc, b.dataset.tdel))));
      el.querySelectorAll('[data-pdel]').forEach(b => b.addEventListener('click', () => commit(() => S.deletePaintStyle(doc, b.dataset.pdel))));
      el.querySelectorAll('[data-new]').forEach(b => b.addEventListener('click', () => {
        if (b.dataset.new === 'text') commit(() => S.makeTextStyle(doc, prompt('Style name', 'Text style'), selText));
        else commit(() => S.makePaintStyle(doc, prompt('Style name', 'Paint style'), selPainted));
      }));
    },

    bindInspector(el, nodes) {
      const n = nodes[0];
      const page = App.page;
      const doc = App.doc;
      const commit = (fn) => { App.history.begin(doc); fn(); App.history.end(doc); App.markDirty(); };

      // numbers x/y/w/h
      el.querySelectorAll('input[data-xy]').forEach(inp => inp.addEventListener('input', () => {
        const v = parseFloat(inp.value);
        if (!isFinite(v)) return;
        const ax = inp.dataset.xy;
        const apply = () => { for (const x of nodes) x[ax] = v; };
        commit(apply);
      }));

      // ---- pen node editor (spec §6)
      el.querySelectorAll('[data-pen]').forEach(b => b.addEventListener('click', () => {
        const pen = App.pen;
        if (!pen || pen.kind !== 'edit' || !pen.node) return;
        const act = b.dataset.pen;
        if (act === 'finish') {
          App.penEscape();
          App.setTool('move');
          P.refreshInspector();
          return;
        }
        const sp = pen.subpaths[pen.subIdx];
        const pNodes = sp.nodes, sel = pen.sel;
        App.history.begin(doc);
        if (act === 'smooth' || act === 'corner') {
          if (sel >= 0 && sel < pNodes.length) global.Pen.convert(pNodes, sel, act, sp.closed);
        } else if (act === 'del-node') {
          if (sel >= 0 && sel < pNodes.length && global.Pen.removeAt(pNodes, sel, sp.closed)) pen.sel = -1;
        } else if (act === 'close') {
          if (pNodes.length >= 3) sp.closed = true;
        } else if (act === 'split') {
          if (sel >= 1 && sel < pNodes.length - 1) {
            const pieces = global.Pen.splitAt(pNodes, sel);
            if (pieces) {
              pen.subpaths.splice(pen.subIdx, 1, { nodes: pieces[0], closed: false }, { nodes: pieces[1], closed: false });
              pen.sel = -1;
            }
          }
        }
        let d = '';
        pen.subpaths.forEach(s => { if (s.nodes.length) d += (d ? ' ' : '') + global.Pen.nodesToD(s.nodes, s.closed); });
        if (d) {
          // d is in the vector's LOCAL space — keep the world origin
          const ox = pen.node.x, oy = pen.node.y;
          const bb = global.FigIO.pathBBox(d);
          if (bb) { pen.node.path = d; pen.node.x = ox + bb.x; pen.node.y = oy + bb.y; pen.node.w = bb.w; pen.node.h = bb.h; }
        }
        App.history.end(doc);
        P.refreshInspector(); App.markDirty();
      }));

      // ---------- ecosystem actions ----------
      const C = global.Components, E = global.Eco;
      el.querySelectorAll('[data-act="make-component"]').forEach(b => b.addEventListener('click', () => commit(() => { C.makeComponent(doc, page, n.id); P.renderAssets(); })));
      el.querySelectorAll('[data-act="inst-update"]').forEach(b => b.addEventListener('click', () => commit(() => { C.updateAny(doc, page, n.id); P.refreshLayers(); })));
      el.querySelectorAll('[data-act="inst-variant"]').forEach(sel => sel.addEventListener('change', () => commit(() => { n.variant = sel.value; C.updateInstance(doc, page, n.id); })));
      el.querySelectorAll('[data-act="variant-add"]').forEach(b => b.addEventListener('click', () => {
        const name = b.parentElement.querySelector('[data-act="variant-name"]').value.trim();
        if (!name) return;
        commit(() => { C.addVariant(doc, page, n.id, name); P.renderAssets(); P.refreshInspector(); });
      }));
      el.querySelectorAll('[data-act="it-add"]').forEach(b => b.addEventListener('click', () => commit(() => {
        n.interactions = n.interactions || [];
        const first = page.tops.find(tid => tid !== n.id) || page.tops[0] || null;
        E.Proto.add(n, { on: 'click', to: first, kind: 'node', anim: 'none' });
        P.refreshInspector();
      })));
      el.querySelectorAll('[data-act="it-del"]').forEach(b => b.addEventListener('click', () => commit(() => { E.Proto.remove(n, +b.dataset.i); P.refreshInspector(); })));
      el.querySelectorAll('[data-act="it-kind"]').forEach(sel => sel.addEventListener('change', () => commit(() => {
        const it = n.interactions[+sel.dataset.i]; it.kind = sel.value; it.to = null; P.refreshInspector();
      })));
      el.querySelectorAll('[data-act="it-to"]').forEach(sel => sel.addEventListener('change', () => commit(() => { const it = n.interactions[+sel.dataset.i]; it.to = sel.value; })));
      el.querySelectorAll('[data-act="it-anim"]').forEach(sel => sel.addEventListener('change', () => commit(() => { const it = n.interactions[+sel.dataset.i]; it.anim = sel.value; })));
      el.querySelectorAll('[data-act="grid-add"]').forEach(b => b.addEventListener('click', () => commit(() => { n.grid = { kind: b.dataset.rows ? 'rows' : 'columns', count: 4, gap: 8, offset: 0 }; })));
      el.querySelectorAll('[data-act="grid-del"]').forEach(b => b.addEventListener('click', () => commit(() => { n.grid = null; })));
      el.querySelectorAll('select[data-act="grid-kind"]').forEach(sel => sel.addEventListener('change', () => commit(() => { n.grid.kind = sel.value; })));
      ['count', 'gap', 'offset'].forEach(k => el.querySelectorAll('input[data-act="grid-' + k + '"]').forEach(inp => inp.addEventListener('input', () => {
        const v = parseInt(inp.value, 10); if (!isFinite(v)) return;
        commit(() => { n.grid[k] = v; });
      })));
      el.querySelectorAll('[data-act="mask-toggle"]').forEach(b => b.addEventListener('click', () => App.toggleMask()));
      // ---- component props
      el.querySelectorAll('[data-act="prop-add"]').forEach(b => b.addEventListener('click', () => {
        const row = b.closest('.ins-sec');
        const name = row.querySelector('[data-act="prop-name"]').value.trim();
        if (!name) { App.toast('Prop name = the child to bind'); return; }
        const type = row.querySelector('[data-act="prop-type"]').value;
        commit(() => {
          C.addProp(doc, n.componentId || n.id, { name, type, def: type === 'text' ? '' : true });
          for (const inst of C.instancesOf(doc, n.componentId || n.id)) C.applyProps(doc, page, inst);
          P.refreshInspector();
        });
      }));
      el.querySelectorAll('[data-act="prop-del"]').forEach(b => b.addEventListener('click', () => commit(() => {
        C.removeProp(doc, n.componentId || n.id, b.dataset.name);
        for (const inst of C.instancesOf(doc, n.componentId || n.id)) { if (inst.props) delete inst.props[b.dataset.name]; }
        P.refreshInspector();
      })));
      el.querySelectorAll('[data-act="prop-set"]').forEach(inp => inp.addEventListener('change', () => {
        const v = inp.type === 'checkbox' ? inp.checked : inp.value;
        commit(() => { C.setInstanceProp(doc, page, n.id, inp.dataset.name, v); });
      }));
      // ---- constraints + resize-to-fit
      ['h', 'v'].forEach(ax => el.querySelectorAll('select[data-act="con-' + ax + '"]').forEach(sel => sel.addEventListener('change', () => commit(() => { n.constraints = n.constraints || { h: 'min', v: 'min' }; n.constraints[ax] = sel.value; }))));
      el.querySelectorAll('[data-act="resize-fit"]').forEach(b => b.addEventListener('click', () => commit(() => { global.Layout.resizeToFit(page, n); P.refreshInspector(); })));
      // ---- dev annotations
      el.querySelectorAll('[data-act="ann-add"]').forEach(b => b.addEventListener('click', () => {
        const text = b.parentElement.querySelector('[data-act="ann-text"]').value.trim();
        if (!text) return;
        commit(() => { global.Eco.Annotations.add(doc, n.id, text, global.Collab.self ? global.Collab.self.name : 'You'); P.refreshInspector(); });
      }));
      el.querySelectorAll('[data-act="ann-del"]').forEach(b => b.addEventListener('click', () => commit(() => { global.Eco.Annotations.remove(doc, b.dataset.id); P.refreshInspector(); })));
      el.querySelectorAll('[data-act="copy-css"]').forEach(b => b.addEventListener('click', () => {
        const code = E.CodeGen.css(doc, page, n);
        (navigator.clipboard ? navigator.clipboard.writeText(code) : Promise.reject()).then(() => App.toast('CSS copied')).catch(() => App.toast('Copy failed'));
      }));
      el.querySelectorAll('[data-act="copy-html"]').forEach(b => b.addEventListener('click', () => {
        const code = E.CodeGen.html(doc, page, n);
        (navigator.clipboard ? navigator.clipboard.writeText(code) : Promise.reject()).then(() => App.toast('HTML copied')).catch(() => App.toast('Copy failed'));
      }));
      // opacity
      const op = el.querySelector('[data-act="opacity"]');
      if (op) op.addEventListener('input', () => {
        commit(() => { for (const x of nodes) x.opacity = op.value / 100; });
        const lab = el.querySelector('#op-val'); if (lab) lab.textContent = op.value + '%';
      });
      // radius
      el.querySelectorAll('[data-rad]').forEach(inp => inp.addEventListener('input', () => {
        const v = Math.max(0, parseFloat(inp.value) || 0);
        const i = +inp.dataset.rad;
        commit(() => { n.radius[i] = v; if (inp.dataset.all) n.radius = [v, v, v, v]; P.refreshInspector(); });
      }));
      // fills
      el.querySelectorAll('.f-color').forEach(inp => inp.addEventListener('input', () => {
        const i = +inp.dataset.fi;
        commit(() => { n.fills[i].color = inp.value; if (n.type === 'text') n.text._fillSync = true; P.refreshInspector(); });
      }));
      el.querySelectorAll('.f-hex').forEach(inp => inp.addEventListener('change', () => {
        const i = +inp.dataset.fi;
        commit(() => { n.fills[i].color = M.normHex(inp.value); P.refreshInspector(); });
      }));
      el.querySelectorAll('.f-op').forEach(inp => inp.addEventListener('input', () => {
        const i = +inp.dataset.fi;
        commit(() => { n.fills[i].opacity = inp.value / 100; });
      }));
      el.querySelectorAll('.f-token').forEach(inp => inp.addEventListener('change', () => {
        const i = +inp.dataset.fi;
        commit(() => {
          const f = n.fills[i]; f.token = inp.value || null;
          const v = T.getValue(doc, f.token, doc.vars.defaultMode);
          if (typeof v === 'string') f.color = v;
          if (n.stroke) { n.stroke.token = inp.value || null; if (typeof v === 'string') n.stroke.color = v; }
          if (n.text) n.text.token = inp.value || null;
          P.refreshInspector();
        });
      }));
      el.querySelectorAll('.f-del').forEach(b => b.addEventListener('click', () => {
        commit(() => { n.fills.splice(+b.dataset.fi, 1); P.refreshInspector(); });
      }));
      // gradient stops
      const grad = el.querySelector('.grad-edit');
      if (grad) {
        const fi = +grad.dataset.fi;
        const f = n.fills[fi];
        grad.querySelectorAll('[data-gs]').forEach(inp => inp.addEventListener('input', () => {
          commit(() => { f.stops[+inp.dataset.gs].color = inp.value; P.refreshInspector(); });
        }));
        grad.querySelectorAll('[data-gp]').forEach(inp => inp.addEventListener('input', () => {
          commit(() => { f.stops[+inp.dataset.gp].pos = Math.max(0, Math.min(100, +inp.value)) / 100; });
        }));
        grad.querySelectorAll('[data-gdel]').forEach(b => b.addEventListener('click', () => {
          commit(() => { if (f.stops.length > 1) { f.stops.splice(+b.dataset.gdel, 1); P.refreshInspector(); } });
        }));
        const add = grad.querySelector('[data-gadd]');
        if (add) add.addEventListener('click', () => {
          commit(() => { f.stops.push({ color: '#ffffff', opacity: 1, pos: 1 }); P.refreshInspector(); });
        });
      }
      // add fills
      const addSolid = el.querySelector('[data-act="add-solid"]');
      if (addSolid) addSolid.addEventListener('click', () => {
        commit(() => { n.fills.unshift({ type: 'solid', color: '#ffffff', opacity: 1, token: null }); P.refreshInspector(); });
      });
      const addGrad = el.querySelector('[data-act="add-grad"]');
      if (addGrad) addGrad.addEventListener('click', () => {
        commit(() => {
          n.fills.unshift({ type: 'linear', from: { x: 0, y: 0 }, to: { x: 1, y: 1 }, stops: [{ color: '#0d99ff', opacity: 1, pos: 0, token: null }, { color: '#a259ff', opacity: 1, pos: 1, token: null }], opacity: 1, token: null });
          P.refreshInspector();
        });
      });
      // stroke
      const so = el.querySelector('[data-act="stroke-on"]');
      if (so) so.addEventListener('change', () => commit(() => { n.stroke.visible = so.checked; P.refreshInspector(); }));
      const sc = el.querySelector('[data-act="stroke-color"]');
      if (sc) sc.addEventListener('input', () => commit(() => { n.stroke.color = sc.value; P.refreshInspector(); }));
      const st = el.querySelector('[data-act="stroke-token"]');
      if (st) st.addEventListener('change', () => commit(() => {
        n.stroke.token = st.value || null;
        const v = T.getValue(doc, n.stroke.token, doc.vars.defaultMode);
        if (typeof v === 'string') n.stroke.color = v;
        P.refreshInspector();
      }));
      const sw = el.querySelector('[data-act="stroke-width"]');
      if (sw) sw.addEventListener('input', () => commit(() => { n.stroke.width = Math.max(0, +sw.value || 0); }));
      const sa = el.querySelector('[data-act="stroke-align"]');
      if (sa) sa.addEventListener('change', () => commit(() => { n.stroke.align = sa.value; }));
      // effects
      el.querySelectorAll('[data-sh]').forEach(inp => inp.addEventListener('input', () => {
        const i = +inp.dataset.sh, f = inp.dataset.f, v = f === 'color' ? inp.value : (+inp.value || 0);
        commit(() => { n.shadows[i][f] = v; });
      }));
      el.querySelectorAll('[data-shdel]').forEach(b => b.addEventListener('click', () => {
        commit(() => { n.shadows.splice(+b.dataset.shdel, 1); P.refreshInspector(); });
      }));
      const ash = el.querySelector('[data-act="add-shadow"]');
      if (ash) ash.addEventListener('click', () => {
        commit(() => { n.shadows.push({ color: '#0f172a', opacity: 0.25, x: 0, y: 8, blur: 24, spread: 0, visible: true }); P.refreshInspector(); });
      });
      const bl = el.querySelector('[data-act="blur"]');
      if (bl) bl.addEventListener('input', () => commit(() => { n.blur = Math.max(0, +bl.value || 0); }));
      // auto layout
      const alH = el.querySelector('[data-al="h"]'), alV = el.querySelector('[data-al="v"]');
      if (alH) alH.addEventListener('click', () => commit(() => { M.makeAutoLayout(n, 'h', page); P.refreshInspector(); }));
      if (alV) alV.addEventListener('click', () => commit(() => { M.makeAutoLayout(n, 'v', page); P.refreshInspector(); }));
      const alrm = el.querySelector('[data-act="al-remove"]');
      if (alrm) alrm.addEventListener('click', () => commit(() => { M.removeAutoLayout(n, page); P.refreshInspector(); }));
      el.querySelectorAll('[data-aldir]').forEach(b => b.addEventListener('click', () => commit(() => { n.al.dir = b.dataset.aldir; P.refreshInspector(); })));
      const alw = el.querySelector('[data-act="al-wrap"]');
      if (alw) alw.addEventListener('click', () => commit(() => { n.al.wrap = !n.al.wrap; P.refreshInspector(); }));
      el.querySelectorAll('.al-cell').forEach(b => b.addEventListener('click', () => commit(() => {
        n.al.main = b.dataset.main; n.al.cross = b.dataset.cross; P.refreshInspector();
      })));
      const am = el.querySelector('[data-act="al-main-more"]');
      if (am) am.addEventListener('change', () => commit(() => { n.al.main = am.value; P.refreshInspector(); }));
      const ac = el.querySelector('[data-act="al-cross-more"]');
      if (ac) ac.addEventListener('change', () => commit(() => { n.al.cross = ac.value; P.refreshInspector(); }));
      const arv = el.querySelector('[data-act="al-reverse"]');
      if (arv) arv.addEventListener('change', () => commit(() => { n.al.reverse = arv.checked; P.refreshInspector(); }));
      const ag = el.querySelector('[data-act="al-gap"]');
      if (ag) ag.addEventListener('input', () => commit(() => { n.al.gap.n = Math.max(0, +ag.value || 0); }));
      const agc = el.querySelector('[data-act="al-gapc"]');
      if (agc) agc.addEventListener('input', () => commit(() => { n.al.gapCross.n = Math.max(0, +agc.value || 0); }));
      const agtok = el.querySelector('[data-act="al-gap-tok"]');
      if (agtok) agtok.addEventListener('change', () => commit(() => {
        n.al.gap.tok = agtok.value || null;
        const v = T.getValue(doc, n.al.gap.tok, doc.vars.defaultMode);
        if (typeof v === 'number') n.al.gap.n = v;
        P.refreshInspector();
      }));
      el.querySelectorAll('[data-padi]').forEach(inp => inp.addEventListener('input', () => {
        const i = +inp.dataset.padi;
        const v = Math.max(0, +inp.value || 0);
        commit(() => {
          if (el.querySelector('[data-act="pad-link"]')?.checked) n.al.pad = [{ n: v, tok: null }, { n: v, tok: null }, { n: v, tok: null }, { n: v, tok: null }];
          else n.al.pad[i] = { n: v, tok: null };
          P.refreshInspector();
        });
      }));
      // item sizing
      el.querySelectorAll('.ins-seg').forEach(seg => seg.querySelectorAll('.seg-btn').forEach(b => b.addEventListener('click', () => {
        const key = seg.dataset.seg;
        commit(() => {
          n.als[key] = b.dataset.sv;
          if (n.als[key] === 'fill') n.als.grow = 1; else if (n.als[key] !== 'fill') n.als.grow = 0;
          if (n.als[key] === 'fixed') {
            if (key === 'w') n.w = n._l ? n._l.w : n.w; else n.h = n._l ? n._l.h : n.h;
          }
          P.refreshInspector();
        });
      })));
      const selfA = el.querySelector('[data-act="alself"]');
      if (selfA) selfA.addEventListener('change', () => commit(() => { n.als.align = selfA.value; P.refreshInspector(); }));
      const absA = el.querySelector('[data-act="al-abs"]');
      if (absA) absA.addEventListener('change', () => commit(() => { n.als.absolute = absA.checked; P.refreshInspector(); }));
      // text
      el.querySelectorAll('[data-tresize]').forEach(b => b.addEventListener('click', () => commit(() => {
        n.text.resize = b.dataset.tresize;
        App.applyTextResize(n); // re-fit hug axes to the content
      })));
      const tf = el.querySelector('[data-act="t-font"]');
      if (tf) tf.addEventListener('change', () => commit(() => { n.text.font = tf.value; App.applyTextResize(n); }));
      const ts = el.querySelector('[data-act="t-size"]');
      if (ts) ts.addEventListener('input', () => commit(() => { n.text.size = Math.max(4, +ts.value || 14); App.applyTextResize(n); }));
      const tw = el.querySelector('[data-act="t-weight"]');
      if (tw) tw.addEventListener('change', () => commit(() => { n.text.weight = +tw.value; App.applyTextResize(n); P.refreshInspector(); }));
      const tlh = el.querySelector('[data-act="t-lh"]');
      if (tlh) tlh.addEventListener('input', () => commit(() => { n.text.lineHeight = Math.max(0.5, +tlh.value || 1.2); App.applyTextResize(n); }));
      const tls = el.querySelector('[data-act="t-ls"]');
      if (tls) tls.addEventListener('input', () => commit(() => { n.text.letterSpacing = +tls.value || 0; App.applyTextResize(n); }));
      const tit = el.querySelector('[data-act="t-italic"]');
      if (tit) tit.addEventListener('change', () => commit(() => { n.text.italic = tit.checked; App.applyTextResize(n); P.refreshInspector(); }));
      el.querySelectorAll('[data-talign]').forEach(b => b.addEventListener('click', () => commit(() => { n.text.align = b.dataset.talign; P.refreshInspector(); })));
      el.querySelectorAll('[data-tvalign]').forEach(b => b.addEventListener('click', () => commit(() => { n.text.valign = b.dataset.tvalign; P.refreshInspector(); })));
      const et = el.querySelector('[data-act="edit-text"]');
      if (et) et.addEventListener('click', () => App.beginTextEdit(n));
      // z-order / misc
      const z = (fn) => commit(() => { for (const x of nodes) { if (x.parent || page.tops.includes(x.id)) fn(x); } });
      const zb = el.querySelector('[data-act="z-front"]'); if (zb) zb.addEventListener('click', () => z(x => M.reorderTo(page, x, 'front')));
      const z1 = el.querySelector('[data-act="z-fwd"]'); if (z1) z1.addEventListener('click', () => z(x => M.reorder(page, x, 1)));
      const z2 = el.querySelector('[data-act="z-bwd"]'); if (z2) z2.addEventListener('click', () => z(x => M.reorder(page, x, -1)));
      const z3 = el.querySelector('[data-act="z-back"]'); if (z3) z3.addEventListener('click', () => z(x => M.reorderTo(page, x, 'back')));
      const dd = el.querySelector('[data-act="dup"]'); if (dd) dd.addEventListener('click', () => App.duplicateSel());
      const dd2 = el.querySelector('[data-act="del"]'); if (dd2) dd2.addEventListener('click', () => App.deleteSel());
    },

    // ============================================================ TOKENS PANEL
    renderVars() {
      const el = document.getElementById('ed-vars');
      if (!el || !App.doc) return;
      const doc = App.doc;
      const mid = doc.vars.defaultMode;
      const sets = doc.vars.sets.map(set => `
        <div class="varset">
          <div class="varset-head">
            <b>${esc(set.name)}</b>
            <span class="varset-actions">
              <button data-va="del-set" data-set="${set.id}">✕</button>
            </span>
          </div>
          ${set.vars.map(v => {
            const raw = v.values[mid] != null ? v.values[mid] : Object.values(v.values)[0];
            const aliased = T.isAlias(raw);
            const safeVal = aliased ? (T.getValue(doc, v.id, mid) != null ? T.getValue(doc, v.id, mid) : raw) : raw;
            const aliasLabel = aliased ? T.varLabel(doc, raw.alias) : null;
            const disp = typeof safeVal === 'string' ? safeVal : (safeVal == null ? '' : safeVal);
            const swatch = v.type === 'color' ? `<span class="var-swatch" style="background:${M.normHex(disp)}"></span>` : `<span class="var-num">${v.type === 'number' ? disp : esc(String(disp))}</span>`;
            return `
            <div class="var-row" data-var="${v.id}">
              ${swatch}
              <span class="var-name" data-vrname="${v.id}">${esc(v.name)}${aliasLabel ? ` <span class="alias-chip" title="Alias — resolves through ${esc(aliasLabel)}">→ ${esc(aliasLabel)}</span>` : ''}</span>
              ${v.type === 'color'
                ? `<input type="color" data-vv="${v.id}" value="${M.normHex(disp)}" ${aliased ? 'title="Editing breaks the alias"' : ''}>`
                : v.type === 'number' ? `<input type="number" data-vv="${v.id}" value="${disp}" ${aliased ? 'title="Editing breaks the alias"' : ''}>`
                : v.type === 'boolean' ? `<select data-vv="${v.id}"><option ${disp ? 'sel' : ''}>true</option><option ${!disp ? 'sel' : ''}>false</option></select>`
                : `<input data-vv="${v.id}" value="${esc(String(disp))}">`}
              <button class="var-del" data-valias="${v.id}" title="Link to another variable (alias)">🔗</button>
              <button class="var-del" data-vdel="${v.id}">✕</button>
            </div>`;
          }).join('')}
          <div class="var-add">
            <select data-vtype="${set.id}">
              <option value="color">color</option><option value="number">number</option>
              <option value="string">string</option><option value="boolean">boolean</option>
            </select>
            <input data-vname="${set.id}" placeholder="name (e.g. color/brand)">
            <button data-vadd="${set.id}">+</button>
          </div>
        </div>`).join('');
      el.innerHTML = `
        <div class="vars-modes">
          ${doc.vars.modes.map(m => `<button class="seg-btn ${m.id === mid ? 'active' : ''}" data-mode="${m.id}">${esc(m.name)}</button>`).join('')}
          <button class="mini" id="var-add-mode">+ mode</button>
        </div>
        ${sets || '<div class="ph">No token sets yet.</div>'}
        <div class="var-sets-foot">
          <button id="var-add-set" class="mini">+ New set (collection)</button>
          <span class="var-actions">
            <button class="mini" id="var-exp-json">Export JSON</button>
            <button class="mini" id="var-exp-css">Export CSS</button>
            <button class="mini" id="var-import">Import…</button>
            <input type="file" id="var-import-file" accept=".json" hidden>
          </span>
        </div>`;
      // bindings
      el.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
        App.history.begin(doc); doc.vars.defaultMode = b.dataset.mode; App.history.end(doc);
        App.renderModes(); P.renderVars(); P.refreshInspector(); App.markDirty();
      }));
      const am = el.querySelector('#var-add-mode');
      if (am) am.addEventListener('click', () => {
        const name = prompt('New mode name', 'Mode ' + (doc.vars.modes.length + 1));
        if (!name) return;
        App.history.begin(doc); T.addMode(doc, name); App.history.end(doc);
        P.renderVars(); App.renderModes(); App.markDirty();
      });
      const as = el.querySelector('#var-add-set');
      if (as) as.addEventListener('click', () => {
        const name = prompt('New set (collection) name', 'ui');
        if (!name) return;
        App.history.begin(doc); T.addSet(doc, name); App.history.end(doc);
        P.renderVars();
      });
      el.querySelectorAll('[data-vadd]').forEach(b => b.addEventListener('click', () => {
        const setId = b.dataset.vadd;
        const name = el.querySelector(`[data-vname="${setId}"]`).value.trim() || 'token';
        const type = el.querySelector(`[data-vtype="${setId}"]`).value;
        App.history.begin(doc); T.addVar(doc, setId, { name, type }); App.history.end(doc);
        P.renderVars(); App.markDirty();
      }));
      el.querySelectorAll('[data-vv]').forEach(inp => inp.addEventListener('input', () => {
        const vid = inp.dataset.vv;
        const set = doc.vars.sets.find(s => s.vars.some(v => v.id === vid));
        const v = set.vars.find(v => v.id === vid);
        let val = inp.value;
        if (v.type === 'number') val = +val;
        if (v.type === 'boolean') val = val === 'true';
        App.history.begin(doc); v.values[mid] = val; App.history.end(doc);
        // live-sync usages
        P.syncTokenUsage(doc, vid);
        App.markDirty();
      }));
      el.querySelectorAll('[data-valias]').forEach(b => b.addEventListener('click', (e) => {
        const vid = b.dataset.valias;
        const set = doc.vars.sets.find(s => s.vars.some(x => x.id === vid));
        const v = set && set.vars.find(x => x.id === vid);
        if (!v) return;
        const sameType = [];
        for (const s of doc.vars.sets) for (const x of s.vars) if (x.id !== vid && x.type === v.type) {
          sameType.push({ id: x.id, label: (s.name ? s.name + '/' : '') + x.name });
        }
        const curTarget = T.aliasTarget(doc, vid, mid);
        const menu = document.createElement('div');
        menu.className = 'pf-menu';
        menu.innerHTML = `<div class="pf-title">Link “${esc(v.name)}” to…</div>` +
          (curTarget ? `<button data-av="clear">Clear alias</button><hr>` : '') +
          (sameType.length
            ? sameType.map(t => `<button data-av="${t.id}">→ ${esc(t.label)}</button>`).join('')
            : '<div class="ph" style="padding:8px">No other ' + v.type + ' variables.</div>');
        const r = b.getBoundingClientRect();
        menu.style.left = Math.min(r.right, innerWidth - 240) + 'px';
        menu.style.top = Math.min(r.bottom + 4, innerHeight - 200) + 'px';
        P._menu(menu);
        menu.querySelectorAll('button').forEach(x => x.addEventListener('click', () => {
          const target = x.dataset.av === 'clear' ? null : x.dataset.av;
          App.history.begin(doc); T.setAlias(doc, vid, target, mid); App.history.end(doc);
          P.renderVars(); P.syncTokenUsage(doc, vid); P.refreshInspector(); App.markDirty();
        }));
      }));
      el.querySelectorAll('[data-vdel]').forEach(b => b.addEventListener('click', () => {
        App.history.begin(doc); T.removeVar(doc, b.dataset.vdel); App.history.end(doc);
        P.renderVars(); P.refreshInspector(); App.markDirty();
      }));
      el.querySelectorAll('[data-vrname]').forEach(s => s.addEventListener('dblclick', () => {
        const vid = s.dataset.vrname;
        const set = doc.vars.sets.find(x => x.vars.some(v => v.id === vid));
        const v = set.vars.find(v => v.id === vid);
        const name = prompt('Rename token', v.name);
        if (name) { App.history.begin(doc); v.name = name; App.history.end(doc); P.renderVars(); }
      }));
      const ds = el.querySelector('[data-va="del-set"]');
      if (ds) ds.addEventListener('click', () => {
        App.history.begin(doc); doc.vars.sets = doc.vars.sets.filter(s => s.id !== ds.dataset.set); App.history.end(doc);
        P.renderVars(); P.refreshInspector(); App.markDirty();
      });
      el.querySelector('#var-exp-json').addEventListener('click', () => {
        const json = T.exportW3C(doc);
        download(new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' }), doc.name + '-tokens.json');
      });
      el.querySelector('#var-exp-css').addEventListener('click', () => {
        download(new Blob([T.exportCSS(doc)], { type: 'text/css' }), doc.name + '-tokens.css');
      });
      el.querySelector('#var-import').addEventListener('click', () => el.querySelector('#var-import-file').click());
      el.querySelector('#var-import-file').addEventListener('change', async (e) => {
        const f = e.target.files[0];
        if (!f) return;
        try {
          const json = JSON.parse(await f.text());
          App.history.begin(doc);
          const count = T.importW3C(doc, json, mid);
          App.history.end(doc);
          App.toast(`Imported ${count} tokens`);
          P.renderVars(); App.markDirty();
        } catch (err) { App.toast('Token import failed: ' + err.message); }
      });
    },
    syncTokenUsage(doc, varId) {
      // update node-level cached values for a changed token
      for (const page of doc.pages) {
        for (const n of Object.values(page.nodes)) {
          for (const f of n.fills || []) if (f.token === varId) { const v = T.getValue(doc, varId, doc.vars.defaultMode); if (typeof v === 'string') f.color = v; }
          if (n.stroke && n.stroke.token === varId) { const v = T.getValue(doc, varId, doc.vars.defaultMode); if (typeof v === 'string') n.stroke.color = v; }
          if (n.al) {
            for (const f of [n.al.gap, n.al.gapCross, ...n.al.pad]) if (f.tok === varId) { const v = T.getValue(doc, varId, doc.vars.defaultMode); if (typeof v === 'number') f.n = v; }
          }
          if (n.radiusTok === varId) { const v = T.getValue(doc, varId, doc.vars.defaultMode); if (typeof v === 'number') n.radius = [v, v, v, v]; }
        }
      }
    },

    // ============================================================ MENUS
    _menu(el) {
      document.querySelectorAll('.pf-menu').forEach(m => m.remove());
      if (el) document.body.appendChild(el);
      const close = () => { el.remove(); document.removeEventListener('pointerdown', close, true); };
      setTimeout(() => document.addEventListener('pointerdown', close, true), 0);
      return el;
    },
    viewMenu(x, y) {
      const v = App.view;
      const el = document.createElement('div');
      el.className = 'pf-menu view-menu';
      el.innerHTML = `
        <div class="pf-title">View</div>
        <button data-v="rulers">${v.rulers ? '✓ ' : ''}Show rulers</button>
        <button data-v="grid">${v.grid ? '✓ ' : ''}Show grid</button>
        <div class="pf-gridsize" title="Grid spacing (world px)">
          ${[10, 20, 50].map(s => `<button data-gs="${s}" class="${v.grid === s ? 'active' : ''}">${s}</button>`).join('')}
        </div>
        <button data-v="snap">${v.snap ? '✓ ' : ''}Snap on (smart guides)</button>
        <button data-v="magnet" title="Snap only while holding Shift">🧲 Magnet mode</button>`;
      if (x == null || y == null) {
        const r = document.getElementById('ed-view').getBoundingClientRect();
        x = r.right; y = r.bottom + 4;
      }
      el.style.left = Math.min(x, innerWidth - 280) + 'px';
      el.style.top = Math.min(y, innerHeight - 240) + 'px';
      this._menu(el);
      const refresh = () => {
        el.remove();
        App.markDirty();
      };
      el.querySelectorAll('[data-v]').forEach(b => b.addEventListener('click', () => {
        const k = b.dataset.v;
        if (k === 'rulers') v.rulers = !v.rulers;
        else if (k === 'snap') v.snap = !v.snap;
        else if (k === 'magnet') v.magnet = !v.magnet;
        else if (k === 'grid') v.grid = v.grid ? null : (v.gridSize || 10);
        refresh();
      }));
      el.querySelectorAll('[data-gs]').forEach(b => b.addEventListener('click', () => {
        v.gridSize = +b.dataset.gs;
        v.grid = v.gridSize; // picking a spacing turns the grid on
        refresh();
      }));
    },
    exportMenu(x, y) {
      const doc = App.doc;
      const el = document.createElement('div');
      el.className = 'pf-menu';
      el.innerHTML = `
        <div class="pf-title">Export</div>
        ${App.sel.length ? '<button data-x="sel-png-1">PNG — selection (1×)</button><button data-x="sel-png-2">PNG — selection (2×)</button><button data-x="sel-svg">SVG — selection</button><button data-x="sel-pdf">PDF — selection</button><hr>' : ''}
        <button data-x="page-png-1">PNG — whole page (1×)</button>
        <button data-x="page-png-2">PNG — whole page (2×)</button>
        <button data-x="page-svg">SVG — whole page</button>
        <button data-x="page-pdf">PDF — whole page</button>
        <hr>
        <button data-x="fig">Figma file (.fig)</button>
        <hr>
        <button data-x="tok-json">Tokens — JSON (W3C)</button>
        <button data-x="tok-css">Tokens — CSS variables</button>`;
      if (x == null) { const r = document.getElementById('ed-export').getBoundingClientRect(); x = r.right; y = r.bottom + 4; }
      el.style.left = Math.min(x, innerWidth - 260) + 'px';
      el.style.top = Math.min(y, innerHeight - 300) + 'px';
      this._menu(el);
      el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        el.remove();
        const x = b.dataset.x;
        if (x === 'fig') DashExportFig();
        else if (x === 'tok-json') download(new Blob([JSON.stringify(T.exportW3C(doc), null, 2)], { type: 'application/json' }), doc.name + '-tokens.json');
        else if (x === 'tok-css') download(new Blob([T.exportCSS(doc)], { type: 'text/css' }), doc.name + '-tokens.css');
        else if (x === 'sel-svg' || x === 'page-svg') {
          const isSel = x === 'sel-svg';
          const page = App.page;
          App.layoutDoc(doc, page);
          const Svg = global.SvgExport;
          let svg;
          if (isSel) {
            if (!App.sel.length) { App.toast('Nothing selected'); return; }
            // render each selected node (or a shared wrapper) to one SVG
            const b2 = R.selectionBounds(page, App.sel);
            if (!b2) { App.toast('Nothing to export'); return; }
            const parts = [];
            for (const id of App.sel) { const nd = page.nodes[id]; if (!nd) continue; }
            // single-node selection → direct; multi → export the union as a group
            if (App.sel.length === 1) svg = Svg.renderNode(doc, page, page.nodes[App.sel[0]]);
            else {
              let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
              for (const id of App.sel) { const nd = page.nodes[id]; if (!nd || !nd._l) continue; minX = Math.min(minX, nd._l.x); minY = Math.min(minY, nd._l.y); maxX = Math.max(maxX, nd._l.x + nd._l.w); maxY = Math.max(maxY, nd._l.y + nd._l.h); }
              const body = [];
              for (const id of App.sel) { const nd = page.nodes[id]; if (nd) body.push(Svg.renderNode(doc, page, nd).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')); }
              svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(maxX - minX)}" height="${Math.ceil(maxY - minY)}" viewBox="${minX} ${minY} ${Math.ceil(maxX - minX)} ${Math.ceil(maxY - minY)}">\n${body.join('\n')}\n</svg>`;
            }
            download(new Blob([svg], { type: 'image/svg+xml' }), doc.name + '-selection.svg');
            App.toast('Exported SVG');
          } else {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (const tid of page.tops) { const nd = page.nodes[tid]; if (!nd || !nd._l) continue; M.forEachNode(page, nd, (c) => { if (!c._l) return; minX = Math.min(minX, c._l.x); minY = Math.min(minY, c._l.y); maxX = Math.max(maxX, c._l.x + c._l.w); maxY = Math.max(maxY, c._l.y + c._l.h); }); }
            if (!isFinite(minX)) { App.toast('Nothing to export'); return; }
            const body = page.tops.map(tid => { const nd = page.nodes[tid]; return nd ? Svg.renderNode(doc, page, nd).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '') : ''; }).join('\n');
            svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(maxX - minX)}" height="${Math.ceil(maxY - minY)}" viewBox="${minX} ${minY} ${Math.ceil(maxX - minX)} ${Math.ceil(maxY - minY)}">\n${body}\n</svg>`;
            download(new Blob([svg], { type: 'image/svg+xml' }), doc.name + '-page.svg');
            App.toast('Exported SVG');
          }
          return;
        }
        else if (x === 'sel-pdf' || x === 'page-pdf') {
          const isSel = x === 'sel-pdf';
          const page = App.page;
          App.layoutDoc(doc, page);
          const Pdf = global.PdfExport;
          if (isSel && !App.sel.length) { App.toast('Nothing selected'); return; }
          const res = isSel
            ? (App.sel.length === 1 ? Pdf.renderNode(doc, page, page.nodes[App.sel[0]]) : Pdf._render(page, App.sel.map(id => page.nodes[id]).filter(Boolean), {}))
            : Pdf.renderPage(doc, page);
          const bytes = Uint8Array.from(res.pdf, ch => ch.charCodeAt(0) & 0xff);
          download(new Blob([bytes], { type: 'application/pdf' }), doc.name + (isSel ? '-selection' : '-page') + '.pdf');
          App.toast('Exported PDF');
          return;
        }
        else {
          const isSel = x.startsWith('sel');
          const scale = +x.slice(-1);
          const page = App.page;
          App.layoutDoc(doc, page);
          const b2 = isSel ? R.selectionBounds(page, App.sel) : R.pageBounds(page);
          if (!b2) { App.toast('Nothing to export'); return; }
          const c = R.renderRegion(page, doc, b2, scale, { background: '#ffffff' });
          const a = document.createElement('a');
          a.href = c.toDataURL('image/png');
          a.download = doc.name + (isSel ? '-selection' : '-page') + '.png';
          a.click();
          App.toast('Exported PNG (' + scale + '×)');
        }
      }));
    },
    contextMenu(x, y, ids) {
      if (!ids.length) return;
      const el = document.createElement('div');
      el.className = 'pf-menu';
      const n = App.page.nodes[ids[0]];
      const isFrame = n.type === 'frame';
      const multi = ids.length >= 2;
      const vecCount = ids.filter(id => { const k = App.page.nodes[id]; return k && k.type === 'vector' && k.path; }).length;
      el.innerHTML = `
        <button data-c="cut">Cut</button>
        <button data-c="dup">Duplicate</button>
        <button data-c="copy">Copy</button>
        <button data-c="paste">Paste</button>
        <hr>
        ${!multi ? '<button data-c="group">Group</button>' : `<button data-c="group">Group selection</button><button data-c="frame-sel">Frame selection</button>`}
        ${multi && ids.some(id => App.page.nodes[id] && App.page.nodes[id].type === 'group') ? '<button data-c="ungroup">Ungroup</button>' : ''}
        <hr>
        <button data-c="ztop">Bring to front</button>
        <button data-c="zup">Bring forward</button>
        <button data-c="zdown">Send backward</button>
        <button data-c="zbot">Send to back</button>
        <hr>
        <button data-c="copyp">Copy properties</button>
        <button data-c="pastep">Paste properties</button>
        ${isFrame ? `<hr><button data-c="${n.al ? 'alrm' : 'alv'}">${n.al ? 'Remove auto layout' : 'Add auto layout ↓'}</button>
          ${(!App.doc.components || !App.doc.components[n.id]) ? '<button data-c="makecomp">◆ Make component</button>' : ''}` : ''}
        ${n.parent ? `<button data-c="mask">${n.mask ? 'Remove mask' : 'Use as mask (⌘/)'}</button>` : ''}
        ${n.type === 'vector' && n.path ? `<hr>
        <button data-c="penedit">✒ Edit path nodes (Pen)</button>
        <button data-c="vsmooth">Make smooth</button>
        <button data-c="vcorner">Make corner</button>
        <button data-c="vsplit">Split path</button>
        <button data-c="vclose">Close path</button>` : ''}
        ${vecCount >= 2 ? `<hr>
        <button data-c="bool-union">Union (⌘])</button>
        <button data-c="bool-subtract">Subtract (⌘[)</button>
        <button data-c="bool-intersect">Intersect (⌘\\)</button>
        <button data-c="bool-exclude">Exclude (⇧⌘\\)</button>
        <button data-c="flatten">Flatten (⇧⌘F)</button>` : ''}
        ${vecCount >= 1 ? `<button data-c="outline">Outline stroke</button>` : ''}
        ${multi ? `<hr>
        <button data-c="al-left">⬅ Align left</button>
        <button data-c="al-hc">↔ Align horizontal center</button>
        <button data-c="al-right">➡ Align right</button>
        <button data-c="al-top">⬆ Align top</button>
        <button data-c="al-vc">↕ Align vertical center</button>
        <button data-c="al-bottom">⬇ Align bottom</button>
        ${ids.length >= 3 ? `<button data-c="dis-h">⇹ Distribute horizontally</button><button data-c="dis-v">⇸ Distribute vertically</button>` : ''}` : ''}
        <hr>
        <button data-c="lock">${n.locked ? 'Unlock' : 'Lock'}</button>
        <button data-c="${n.visible ? 'hide' : 'show'}">${n.visible ? 'Hide' : 'Show'}</button>
        <button data-c="rename">Rename</button>
        ${n.type === 'text' ? '<button data-c="edit">Edit text</button>' : ''}
        <button data-c="del" class="danger">Delete</button>`;
      el.style.left = Math.min(x, innerWidth - 220) + 'px';
      el.style.top = Math.min(y, innerHeight - 340) + 'px';
      this._menu(el);
      el.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        el.remove();
        const c = b.dataset.c;
        const doc = App.doc, page = App.page;
        const selNodes = ids.map(id => page.nodes[id]).filter(Boolean);
        if (c === 'cut') App.copySel(true);
        if (c === 'dup') App.duplicateSel();
        if (c === 'copy') App.copySel();
        if (c === 'paste') App.paste();
        if (c === 'group') { App.sel = ids.slice(); App.groupSel(); return; }
        if (c === 'ungroup') { App.sel = ids.slice(); App.ungroup(); return; }
        if (c === 'frame-sel') {
          let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
          for (const id of ids) { const k = page.nodes[id]; if (!k || !k._l) continue; x0 = Math.min(x0, k._l.x); y0 = Math.min(y0, k._l.y); x1 = Math.max(x1, k._l.x + k._l.w); y1 = Math.max(y1, k._l.y + k._l.h); }
          if (!isFinite(x0)) return;
          App.history.begin(doc);
          const f = M.makeNode('frame', { x: x0, y: y0, w: x1 - x0, h: y1 - y0, name: 'Frame' });
          M.attach(doc, page, null, f);
          for (const id of ids) { const k = page.nodes[id]; if (k) { M.detach(page, k); M.attach(doc, page, f.id, k); } }
          App.history.end(doc);
          App.sel = [f.id];
          return;
        }
        if (c === 'ztop') selNodes.forEach(k => M.reorderTo(page, k, 'front'));
        if (c === 'zbot') selNodes.forEach(k => M.reorderTo(page, k, 'back'));
        if (c === 'zup') selNodes.forEach(k => M.reorderBy(page, k, 1));
        if (c === 'zdown') selNodes.forEach(k => M.reorderBy(page, k, -1));
        if (c === 'copyp') {
          const src = selNodes[0];
          App.propClip = JSON.parse(JSON.stringify({ fills: src.fills, stroke: src.stroke, radius: src.radius, opacity: src.opacity, shadows: src.shadows, blur: src.blur, blend: src.blend }));
          App.toast('Properties copied');
        }
        if (c === 'pastep' && App.propClip) {
          App.history.begin(doc);
          for (const k of selNodes) Object.assign(k, JSON.parse(JSON.stringify(App.propClip)));
          App.history.end(doc);
        }
        if (c === 'alv') { App.history.begin(doc); M.makeAutoLayout(n, 'v', page); App.history.end(doc); }
        if (c === 'alrm') { App.history.begin(doc); M.removeAutoLayout(n, page); App.history.end(doc); }
        if (c === 'makecomp') { App.history.begin(doc); global.Components.makeComponent(doc, page, n.id); App.history.end(doc); P.renderAssets(); }
        if (c === 'mask') { App.sel = [n.id]; App.toggleMask(); return; }
        // ---- vector node operations (spec §6)
        if (c === 'penedit') {
          App.setTool('pen');
          const dn = global.Pen.dToNodes(n.path);
          App.history.begin(doc);
          App.pen = { kind: 'edit', node: n, subpaths: dn.subpaths.length ? dn.subpaths : [{ nodes: [], closed: false }], subIdx: 0, sel: -1, cursor: null };
          P.refreshInspector();
          App.status('Editing path nodes — Esc to finish');
          return;
        }
        if (c === 'vsmooth' || c === 'vcorner') {
          App.history.begin(doc);
          const dn = global.Pen.dToNodes(n.path);
          dn.subpaths.forEach(sp => global.Pen.convert(sp.nodes, null, c === 'vsmooth' ? 'smooth' : 'corner', sp.closed));
          let d = '';
          dn.subpaths.forEach(sp => { if (sp.nodes.length) d += (d ? ' ' : '') + global.Pen.nodesToD(sp.nodes, sp.closed); });
          if (d) { const ox = n.x, oy = n.y; const bb = global.FigIO.pathBBox(d); if (bb) { n.path = d; n.x = ox + bb.x; n.y = oy + bb.y; n.w = bb.w; n.h = bb.h; } }
          App.history.end(doc);
        }
        if (c === 'vsplit') {
          const dn = global.Pen.dToNodes(n.path);
          let sp = dn.subpaths.find(s => !s.closed);
          if (!sp) { App.toast('Open a subpath first (or use the pen to end one)'); return; }
          if (sp.nodes.length < 3) { App.toast('Too few nodes to split'); return; }
          const parts = global.Pen.splitAt(sp.nodes, Math.floor(sp.nodes.length / 2));
          if (parts) {
            const i = dn.subpaths.indexOf(sp);
            dn.subpaths.splice(i, 1, { nodes: parts[0], closed: false }, { nodes: parts[1], closed: false });
            let d = '';
            dn.subpaths.forEach(s => { if (s.nodes.length) d += (d ? ' ' : '') + global.Pen.nodesToD(s.nodes, s.closed); });
            if (d) { App.history.begin(doc); const ox = n.x, oy = n.y; n.path = d; const bb = global.FigIO.pathBBox(d); if (bb) { n.x = ox + bb.x; n.y = oy + bb.y; n.w = bb.w; n.h = bb.h; } App.history.end(doc); }
          }
        }
        if (c === 'vclose') {
          const dn = global.Pen.dToNodes(n.path);
          const sp = dn.subpaths.find(s => !s.closed);
          if (!sp) { App.toast('No open subpath'); return; }
          if (sp.nodes.length < 3) { App.toast('Too few nodes to close'); return; }
          App.history.begin(doc);
          sp.closed = true;
          let d = '';
          dn.subpaths.forEach(s => { if (s.nodes.length) d += (d ? ' ' : '') + global.Pen.nodesToD(s.nodes, s.closed); });
          if (d) { const ox = n.x, oy = n.y; n.path = d; const bb = global.FigIO.pathBBox(d); if (bb) { n.x = ox + bb.x; n.y = oy + bb.y; n.w = bb.w; n.h = bb.h; } }
          App.history.end(doc);
        }
        // ---- vector booleans / flatten / outline (spec §7–8)
        if (c === 'bool-union' || c === 'bool-subtract' || c === 'bool-intersect' || c === 'bool-exclude') {
          App.sel = ids.slice();
          App.booleanSel(c.slice(5));
          return;
        }
        if (c === 'flatten') { App.sel = ids.slice(); App.flattenSel(); return; }
        if (c === 'outline') { App.sel = ids.slice(); App.outlineStrokeSel(); return; }
        if (c === 'lock') { App.history.begin(doc); selNodes.forEach(k => k.locked = !n.locked); App.history.end(doc); }
        if (c === 'hide' || c === 'show') { App.history.begin(doc); selNodes.forEach(k => k.visible = c === 'show'); App.history.end(doc); }
        if (c === 'rename') { const nm = prompt('Rename', n.name); if (nm) { App.history.begin(doc); n.name = nm; App.history.end(doc); } }
        if (c === 'edit') App.beginTextEdit(n);
        if (c === 'del') App.deleteSel();
        if (c && c.startsWith('al-')) {
          const kind = { 'al-left': 'left', 'al-hc': 'hcenter', 'al-right': 'right', 'al-top': 'top', 'al-vc': 'vcenter', 'al-bottom': 'bottom' }[c];
          App.history.begin(doc); global.Arrange.align(page, ids, kind); App.history.end(doc);
        }
        if (c === 'dis-h' || c === 'dis-v') {
          App.history.begin(doc); global.Arrange.distribute(page, ids, c === 'dis-h' ? 'h' : 'v'); App.history.end(doc);
        }
        P.refreshLayers(); P.refreshInspector(); App.markDirty();
      }));
    },
    // rendered from the central shortcut registry (src/shortcuts.js) — the
    // table, the dispatch, and this modal never drift apart (spec §5)
    shortcutsModal() {
      const pretty = (k) => {
        const map = { mod: '⌘', shift: '⇧', alt: '⌥', space: 'Space', arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓', delete: '⌫', backspace: '⌫', escape: 'Esc', tab: 'Tab', '+': '+', '=': '=', '-': '−', '/': '/', '?': '?', ']': ']', '[': '[', '\\': '\\' };
        return k.split('+').map(p => (map[p] || p.toUpperCase())).join('');
      };
      const S = global.Shortcuts;
      const groups = {};
      const seen = new Set();
      for (const b of S.table) {
        if (seen.has(b.label)) continue; // alias entries (e.g. shift+/ = ?)
        seen.add(b.label);
        (groups[b.group] = groups[b.group] || []).push(b);
      }
      const order = ['Tools', 'Editing', 'Vector', 'View', 'Prototype', 'App'];
      const html = order.filter(g => groups[g]).map(g =>
        `<div class="sc-group"><h4>${g}</h4><div class="sc-grid">` +
        groups[g].map(b => `<span class="sc-key">${M.esc ? M.esc(pretty(b.keys)) : pretty(b.keys)}</span><span>${b.label}</span>`).join('') +
        '</div></div>').join('');
      const m = document.createElement('div');
      m.className = 'modal-back';
      m.innerHTML = `<div class="modal wide"><h3>Keyboard shortcuts</h3><div class="sc-groups">${html}</div>
        <div class="sc-grid" style="margin-top:8px">
          <span>Space+drag</span><span>Pan</span><span>⌘/Ctrl+scroll</span><span>Zoom</span><span>Double-click text</span><span>Edit</span><span>Double-click frame</span><span>Zoom in</span><span>Double-click asset</span><span>Insert instance</span>
        </div>
        <div class="modal-btns"><button class="btn primary" data-x>Close</button></div></div>`;
      document.body.appendChild(m);
      const close = () => m.remove();
      m.addEventListener('click', e => { if (e.target === m || e.target.closest('[data-x]')) close(); });
    },
  };

  function field(label, key, val) {
    return `<label>${label}</label><input type="number" data-xy="${key}" value="${val}">`;
  }
  function radiusRow(n) {
    const r = n.radius;
    const linked = r.every(v => v === r[0]);
    return `
      <div class="ins-row radius-row">
        <span class="ins-lbl">Radius</span>
        <input type="number" min="0" data-rad="0" ${linked ? 'data-all="1"' : ''} value="${Math.round(r[0])}">
        <input type="number" min="0" data-rad="1" value="${Math.round(r[1])}">
        <input type="number" min="0" data-rad="2" value="${Math.round(r[2])}">
        <input type="number" min="0" data-rad="3" value="${Math.round(r[3])}">
      </div>`;
  }
  function tokenSelect(kind, cur, act) {
    if (!App.doc) return '';
    const list = kind === 'color' ? T.colorVarList(App.doc) : T.numberVarList(App.doc);
    return `<select class="f-token" data-act="${act}"><option value="">No token</option>${list.map(v => `<option value="${v.id}" ${cur === v.id ? 'sel' : ''}>◈ ${esc(v.label)}</option>`).join('')}</select>`;
  }
  function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  function DashExportFig() {
    const doc = App.doc;
    App.saveNow();
    App.layoutDoc(doc, App.page);
    const thumb = global.Dash.thumbDataURL(doc, App.page, 240);
    try {
      const bytes = global.FigConv.exportFig(doc, { thumbnail: thumb });
      global.Dash.downloadBytes(bytes, doc.name + '.fig');
      App.toast('Exported ' + doc.name + '.fig — opens in Figma for supported node types', 5000);
    } catch (err) {
      console.error(err);
      App.toast('.fig export failed: ' + err.message, 6000);
    }
  }

  global.Panels = P;
})(window);
