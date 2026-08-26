/* text-figma.js — Figma typography panel, type settings, fonts, lists, links.
 * Overlay: does not rewrite ui-panels.js / ui-editor.js.
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

  function ico(d, size) {
    const s = size || 14;
    return `<svg width="${s}" height="${s}" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4">${d}</svg>`;
  }

  const SVG = {
    style: ico('<path d="M3 13 L8 3 L13 13"/><path d="M5 9h6"/>'),
    type: ico('<rect x="2.5" y="2.5" width="11" height="11" rx="1.5"/><path d="M5 11V6.5h6"/>'),
    left: ico('<path d="M3 4h10M3 8h7M3 12h10"/>'),
    center: ico('<path d="M3 4h10M5 8h6M3 12h10"/>'),
    right: ico('<path d="M3 4h10M6 8h7M3 12h10"/>'),
    justify: ico('<path d="M3 4h10M3 8h10M3 12h10"/>'),
    top: ico('<path d="M3 3h10M5 7v6M8 7v6M11 7v6"/>'),
    middle: ico('<path d="M5 3v10M8 3v10M11 3v10"/>'),
    bottom: ico('<path d="M3 13h10M5 3v6M8 3v6M11 3v6"/>'),
    ul: ico('<circle cx="3.5" cy="4" r=".9" fill="currentColor" stroke="none"/><circle cx="3.5" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="3.5" cy="12" r=".9" fill="currentColor" stroke="none"/><path d="M6 4h7M6 8h7M6 12h7"/>'),
    ol: ico('<path d="M3 5V3.5h2M3 8h2M3 12h2"/><path d="M7 4h6M7 8h6M7 12h6"/>'),
    u: ico('<path d="M4 3v5a4 4 0 0 0 8 0V3"/><path d="M3 13h10"/>'),
    s: ico('<path d="M3 8h10"/><path d="M4 11c.6 1.4 2.2 2 4 2s3.2-.6 4-1.8M12 5c-.6-1.4-2.2-2-4-2S4.8 3.6 4 4.8"/>'),
    link: ico('<path d="M7 9.5l2-2"/><path d="M6 11.5l-1.2 1.2a2.2 2.2 0 1 1-3.1-3.1L3 8.4"/><path d="M10 4.5l1.2-1.2a2.2 2.2 0 1 1 3.1 3.1L13 7.6"/>'),
  };

  function lhLabel(t) {
    const unit = t.lineHeightUnit || 'auto';
    if (unit === 'auto') return 'Auto';
    if (unit === 'pixels') return String(Math.round((+t.lineHeight || 16) * 10) / 10);
    const pct = Math.round((+t.lineHeight || 1.2) * 100);
    return pct + '%';
  }

  function parseLh(raw, t) {
    const s = String(raw || '').trim().toLowerCase();
    if (!s || s === 'auto') return { unit: 'auto', value: 1.2 };
    if (s.endsWith('%')) {
      const n = parseFloat(s);
      return { unit: 'percent', value: isFinite(n) ? n / 100 : 1.2 };
    }
    const n = parseFloat(s);
    if (!isFinite(n)) return { unit: t.lineHeightUnit || 'auto', value: t.lineHeight || 1.2 };
    if (n >= 4) return { unit: 'pixels', value: n };
    return { unit: 'percent', value: n };
  }

  ready(function () {
    const App = global.App;
    const M = global.Model;
    const R = global.Renderer;
    const P = global.Panels;
    const TE = global.TextEngine;
    if (!App || !M || !TE) return;

    // ------------------------------------------------------------------ render
    if (R) {
      R.measureText = function (n, boxW) { return TE.measure(n, boxW); };
      R.textLines = function (n, boxW) { return TE.textLines(n, boxW); };
    }

    // ------------------------------------------------------------------ styles capture
    if (global.Styles) {
      const S = global.Styles;
      const _make = S.makeTextStyle.bind(S);
      S.makeTextStyle = function (doc, name, n) {
        const st = _make(doc, name, n);
        if (st && n && n.text) Object.assign(st, TE.captureStyle(n.text));
        return st;
      };
      const _apply = S.applyTextStyle.bind(S);
      S.applyTextStyle = function (doc, page, styleId, nodeIds) {
        const n = _apply(doc, page, styleId, nodeIds);
        const st = S.getText(doc, styleId);
        if (st) {
          for (const nid of nodeIds || []) {
            const node = page.nodes[nid];
            if (node && node.text) TE.applyStyleFields(node.text, st);
          }
        }
        return n;
      };
    }

    // ------------------------------------------------------------------ font picker
    function openFontPicker(anchor, current, onChange, onHover) {
      if (global.Fonts && global.Fonts.closePicker) global.Fonts.closePicker();
      const doc = App.doc;
      const wrap = document.createElement('div');
      wrap.className = 'pf-font-picker pf-font-picker-v2';
      wrap.innerHTML =
        '<input type="text" class="pf-font-search" placeholder="Search fonts…" spellcheck="false" autocomplete="off">' +
        '<div class="pf-font-filters">' +
          ['All', 'File', 'Popular', 'Google', 'Variable', 'Icons'].map((f, i) =>
            `<button type="button" data-ff="${f.toLowerCase()}" class="${i === 0 ? 'on' : ''}">${f}</button>`
          ).join('') +
        '</div>' +
        '<div class="pf-font-status" style="display:none"></div>' +
        '<div class="pf-font-list"></div>';
      document.body.appendChild(wrap);
      global._fontPicker = wrap;
      const listEl = wrap.querySelector('.pf-font-list');
      const srch = wrap.querySelector('.pf-font-search');
      let filter = 'all';
      let previewed = null;

      function items() {
        const out = [];
        const seen = new Set();
        const push = (group, name) => {
          if (!name) return;
          const k = name.toLowerCase();
          if (seen.has(k)) return;
          seen.add(k);
          out.push({ group, name });
        };
        let recent = [];
        try { recent = JSON.parse(localStorage.getItem('pf-recent-fonts') || '[]'); } catch (e) {}
        const docFonts = new Set();
        if (doc && doc.pages) for (const p of doc.pages) {
          for (const id in p.nodes) {
            const n = p.nodes[id];
            if (n && n.type === 'text' && n.text && n.text.font) docFonts.add(n.text.font);
          }
        }
        const google = (global.Fonts && global.Fonts.GOOGLE_FONTS) || [];
        const system = (global.Fonts && global.Fonts.localFonts) ? global.Fonts.localFonts() : [];
        if (filter === 'icons') {
          TE.ICON_FONTS.forEach((f) => push('Icon fonts', f.name));
          return out;
        }
        if (filter === 'file') { docFonts.forEach((n) => push('In this file', n)); return out; }
        if (filter === 'popular') { TE.POPULAR.forEach((n) => push('Popular', n)); return out; }
        if (filter === 'variable') { TE.VARIABLE.forEach((n) => push('Variable', n)); return out; }
        if (filter === 'google') { google.forEach((g) => push('Google Fonts', g.name)); return out; }
        recent.forEach((n) => push('Recent', n));
        docFonts.forEach((n) => push('In this file', n));
        TE.ICON_FONTS.forEach((f) => push('Icon fonts', f.name));
        google.forEach((g) => push('Google Fonts', g.name));
        system.forEach((n) => push('Installed', n));
        return out;
      }

      function render() {
        const q = (srch.value || '').toLowerCase().trim();
        listEl.innerHTML = '';
        let last = '';
        for (const it of items()) {
          if (q && !it.name.toLowerCase().includes(q) && !it.group.toLowerCase().includes(q)) continue;
          if (it.group !== last) {
            const gh = document.createElement('div');
            gh.className = 'pf-font-group';
            gh.textContent = it.group;
            listEl.appendChild(gh);
            last = it.group;
          }
          const opt = document.createElement('div');
          opt.className = 'pf-font-opt' + (it.name === current ? ' on' : '');
          opt.textContent = it.name;
          opt.style.fontFamily = `"${it.name}", Inter, sans-serif`;
          opt.addEventListener('mouseenter', () => {
            previewed = it.name;
            if (onHover) onHover(it.name);
          });
          opt.addEventListener('mousedown', (e) => {
            e.preventDefault();
            if (TE.isIconFont(it.name)) TE.loadIconFont(it.name);
            else if (global.Fonts) global.Fonts.ensureLoaded(it.name);
            if (global.Fonts) global.Fonts.touchRecent(it.name);
            onChange(it.name);
            close();
          });
          listEl.appendChild(opt);
        }
        if (!listEl.children.length) {
          const none = document.createElement('div');
          none.className = 'pf-font-group';
          none.style.padding = '10px';
          none.textContent = 'No matching fonts';
          listEl.appendChild(none);
        }
      }

      wrap.querySelectorAll('[data-ff]').forEach((b) => b.addEventListener('click', () => {
        filter = b.dataset.ff;
        wrap.querySelectorAll('[data-ff]').forEach((x) => x.classList.toggle('on', x === b));
        render();
      }));
      srch.addEventListener('input', render);
      render();
      requestAnimationFrame(() => { try { srch.focus(); } catch (e) {} });

      const ar = anchor.getBoundingClientRect();
      wrap.style.left = Math.max(8, Math.min(ar.left, innerWidth - 300)) + 'px';
      wrap.style.top = Math.min(ar.bottom + 4, innerHeight - 380) + 'px';
      wrap.style.minWidth = Math.max(260, ar.width) + 'px';

      function close() {
        if (previewed && onHover) onHover(null);
        wrap.remove();
        if (global._fontPicker === wrap) global._fontPicker = null;
        document.removeEventListener('mousedown', outside, true);
      }
      function outside(e) { if (!wrap.contains(e.target)) close(); }
      document.addEventListener('mousedown', outside, true);
      wrap._close = close;
    }

    if (global.Fonts) {
      const _open = global.Fonts.openPicker.bind(global.Fonts);
      global.Fonts.openPicker = function (anchor, current, onChange) {
        openFontPicker(anchor, current, onChange, null);
      };
      global.Fonts.openPickerEx = openFontPicker;
    }

    // ------------------------------------------------------------------ inspector
    function textSectionHtml(n) {
      const t = TE.defaults(n.text || {});
      const S = global.Styles;
      const styles = S && App.doc ? S.textList(App.doc) : [];
      const st = n.styleId && S ? S.getText(App.doc, n.styleId) : null;
      const resize = t.resize || 'fixed';
      const valignOff = resize !== 'fixed';
      const fam = t.font || 'Inter';
      return `
        <section class="ins-sec pf-type">
          <div class="ins-head">
            <span>Typography</span>
            <span class="ins-head-btns">
              <button class="mini" data-act="t-style" title="Text styles">${SVG.style}</button>
              <button class="mini" data-act="t-type" title="Type settings">${SVG.type}</button>
              <button class="mini" data-act="edit-text" title="Edit text">Edit</button>
            </span>
          </div>
          ${st ? `<div class="pf-style-chip">Style · ${esc(st.name)} <button class="mini" data-act="t-detach" title="Detach style">×</button></div>` : ''}
          <div class="ins-grid g2"><label>Font</label>
            <button type="button" class="pf-font-btn" data-act="t-font" title="Browse fonts">
              <span class="pf-font-name" style="font-family:&quot;${esc(fam)}&quot;,Inter,sans-serif">${esc(fam)}</span>
              <span style="margin-left:auto;opacity:.55">▾</span>
            </button>
          </div>
          <div class="pf-type-row">
            <select data-act="t-weight" title="Weight">${TE.WEIGHTS.map((w) =>
              `<option value="${w.n}" ${+t.weight === w.n ? 'selected' : ''}>${w.name}</option>`).join('')}</select>
            <input type="number" min="4" max="300" value="${t.size || 16}" data-act="t-size" title="Font size">
          </div>
          <div class="pf-type-row">
            <input type="text" data-act="t-lh-ui" value="${esc(lhLabel(t))}" title="Line height — Auto, 120%, or 20">
            <input type="number" step="0.5" value="${t.letterSpacing || 0}" data-act="t-ls" title="Letter spacing (px)">
          </div>
          <div class="ins-btnrow pf-align-row">
            ${[['left', SVG.left], ['center', SVG.center], ['right', SVG.right], ['justify', SVG.justify]]
              .map(([a, ic]) => `<button class="al-dir ${t.align === a ? 'on' : ''}" data-talign="${a}" title="Align ${a}">${ic}</button>`).join('')}
            <span class="ins-spacer"></span>
            ${[['top', SVG.top], ['middle', SVG.middle], ['bottom', SVG.bottom]]
              .map(([a, ic]) => `<button class="al-dir ${t.valign === a ? 'on' : ''} ${valignOff ? 'dim' : ''}" data-tvalign="${a}" title="Vertical ${a}${valignOff ? ' (Fixed size only)' : ''}">${ic}</button>`).join('')}
          </div>
          <div class="ins-btnrow">
            <button class="al-dir ${t.underline ? 'on' : ''}" data-act="t-underline" title="Underline">${SVG.u}</button>
            <button class="al-dir ${t.strike ? 'on' : ''}" data-act="t-strike" title="Strikethrough">${SVG.s}</button>
            <button class="al-dir ${t.list === 'bullet' ? 'on' : ''}" data-act="t-ul" title="Bulleted list">${SVG.ul}</button>
            <button class="al-dir ${t.list === 'number' ? 'on' : ''}" data-act="t-ol" title="Numbered list">${SVG.ol}</button>
            <button class="al-dir" data-act="t-link" title="Create link (⇧⌘U)">${SVG.link}</button>
            <label class="chk" style="margin-left:auto"><input type="checkbox" data-act="t-italic" ${t.italic ? 'checked' : ''}> Italic</label>
          </div>
          ${TE.isIconFont(fam) ? `<div class="ins-btnrow"><button class="ed-btn sm" data-act="t-icons">Browse icons</button></div>` : ''}
        </section>
        <section class="ins-sec">
          <div class="ins-head"><span>Resizing</span></div>
          <div class="ins-btnrow">
            ${[
              ['auto', 'Auto width'],
              ['auto-h', 'Auto height'],
              ['fixed', 'Fixed size'],
            ].map(([m, tip]) =>
              `<button class="al-dir ${(resize === m || (m === 'auto' && resize === 'auto-w')) ? 'on' : ''}" data-tresize="${m}" title="${tip}">${tip.replace(' ', '<br>')}</button>`
            ).join('')}
          </div>
          <div class="ph sm">Click creates Auto width. Drag creates Fixed size. Dragging a handle also switches that axis to Fixed.</div>
        </section>`;
    }

    if (P && P.textSection) {
      P.textSection = function (n) { return textSectionHtml(n); };
    }

    function commit(fn) {
      App.history.begin(App.doc);
      fn();
      App.history.end(App.doc);
      App.markDirty();
      try { App.applyTextResize(App.page.nodes[App.sel[0]]); } catch (e) {}
    }

    function selectedText() {
      const id = App.sel && App.sel[0];
      const n = id && App.page && App.page.nodes[id];
      return (n && n.type === 'text') ? n : null;
    }

    function bindTypeExtras(el, n) {
      if (!el || !n || !n.text) return;
      TE.defaults(n.text);

      const lh = el.querySelector('[data-act="t-lh-ui"]');
      if (lh) {
        lh.addEventListener('change', () => {
          const p = parseLh(lh.value, n.text);
          commit(() => { n.text.lineHeightUnit = p.unit; n.text.lineHeight = p.value; });
          if (P.refreshInspector) P.refreshInspector();
        });
      }
      el.querySelectorAll('[data-act="t-underline"]').forEach((b) => b.addEventListener('click', () => {
        commit(() => { n.text.underline = !n.text.underline; });
        if (P.refreshInspector) P.refreshInspector();
      }));
      el.querySelectorAll('[data-act="t-strike"]').forEach((b) => b.addEventListener('click', () => {
        commit(() => { n.text.strike = !n.text.strike; });
        if (P.refreshInspector) P.refreshInspector();
      }));
      el.querySelectorAll('[data-act="t-ul"]').forEach((b) => b.addEventListener('click', () => {
        commit(() => { n.text.list = n.text.list === 'bullet' ? 'none' : 'bullet'; });
        if (P.refreshInspector) P.refreshInspector();
      }));
      el.querySelectorAll('[data-act="t-ol"]').forEach((b) => b.addEventListener('click', () => {
        commit(() => { n.text.list = n.text.list === 'number' ? 'none' : 'number'; });
        if (P.refreshInspector) P.refreshInspector();
      }));
      el.querySelectorAll('[data-act="t-link"]').forEach((b) => b.addEventListener('click', () => openLinkFor(n)));
      el.querySelectorAll('[data-act="t-type"]').forEach((b) => b.addEventListener('click', (e) => {
        e.preventDefault();
        openTypeSettings(b, n);
      }));
      el.querySelectorAll('[data-act="t-style"]').forEach((b) => b.addEventListener('click', (e) => {
        e.preventDefault();
        openStylePicker(b, n);
      }));
      el.querySelectorAll('[data-act="t-detach"]').forEach((b) => b.addEventListener('click', () => {
        commit(() => { n.styleId = null; });
        if (P.refreshInspector) P.refreshInspector();
      }));
      el.querySelectorAll('[data-act="t-icons"]').forEach((b) => b.addEventListener('click', () => openIconBrowser(n)));

      const tf = el.querySelector('[data-act="t-font"]');
      if (tf && !tf._pfFont) {
        tf._pfFont = true;
        tf.addEventListener('click', (ev) => {
          ev.preventDefault(); ev.stopPropagation();
          const prev = n.text.font;
          openFontPicker(tf, n.text.font, (family) => {
            commit(() => { n.text.font = family; n.styleId = n.styleId; });
            const load = TE.isIconFont(family) ? TE.loadIconFont(family)
              : (global.Fonts ? global.Fonts.ensureLoaded(family, n.text.weight, n.text.italic) : Promise.resolve());
            load.then(() => { App.applyTextResize(n); App.markDirty(); if (P.refreshInspector) P.refreshInspector(); });
          }, (hover) => {
            n.text.font = hover || prev;
            App.markDirty();
          });
        }, true);
      }
    }

    if (P && P.bindInspector) {
      const _bind = P.bindInspector.bind(P);
      P.bindInspector = function (el, nodes) {
        _bind(el, nodes);
        if (nodes && nodes[0] && nodes[0].type === 'text') bindTypeExtras(el, nodes[0]);
      };
    }

    // ------------------------------------------------------------------ type settings
    function closePop() {
      document.querySelectorAll('.pf-type-pop,.pf-style-pop,.pf-icon-pop,.pf-link-pop').forEach((n) => n.remove());
    }

    function openTypeSettings(anchor, n) {
      closePop();
      TE.defaults(n.text);
      const t = n.text;
      const pop = document.createElement('div');
      pop.className = 'pf-type-pop';
      const preview = TE.applyCase('Ag Hamburgefonstiv 123', t.textCase === 'small-caps' ? 'none' : t.textCase);
      pop.innerHTML = `
        <div class="pf-type-preview" style="font-family:&quot;${esc(t.font || 'Inter')}&quot;,Inter,sans-serif;font-weight:${t.weight || 400};font-style:${t.italic ? 'italic' : 'normal'};font-size:22px;font-feature-settings:${esc(TE.cssFeatures(t))}">${esc(preview)}</div>
        <div class="pf-type-tabs">
          <button data-tab="basics" class="on">Basics</button>
          <button data-tab="details">Details</button>
        </div>
        <div data-pane="basics">
          <div class="pf-type-label">Decoration</div>
          <div class="ins-btnrow">
            <button class="al-dir ${t.underline ? 'on' : ''}" data-k="underline">Underline</button>
            <button class="al-dir ${t.strike ? 'on' : ''}" data-k="strike">Strike</button>
          </div>
          <div class="ins-grid g2" ${t.underline ? '' : 'style="display:none"'}>
            <label>Style</label>
            <select data-k="underlineStyle">
              <option value="solid" ${t.underlineStyle === 'solid' ? 'selected' : ''}>Solid</option>
              <option value="dotted" ${t.underlineStyle === 'dotted' ? 'selected' : ''}>Dotted</option>
              <option value="wavy" ${t.underlineStyle === 'wavy' ? 'selected' : ''}>Wavy</option>
            </select>
          </div>
          <div class="pf-type-label">Letter case</div>
          <div class="ins-btnrow">
            ${[['none', 'None'], ['upper', 'AG'], ['lower', 'ag'], ['title', 'Ag'], ['small-caps', 'ᴀɢ']]
              .map(([v, lab]) => `<button class="al-dir ${t.textCase === v ? 'on' : ''}" data-case="${v}">${lab}</button>`).join('')}
          </div>
          <div class="pf-type-label">List style</div>
          <div class="ins-btnrow">
            ${[['none', 'None'], ['bullet', '• Bullet'], ['number', '1. Number']]
              .map(([v, lab]) => `<button class="al-dir ${t.list === v ? 'on' : ''}" data-list="${v}">${lab}</button>`).join('')}
          </div>
          <div class="ins-grid g2"><label>List spacing</label><input type="number" min="0" step="1" value="${t.listSpacing || 0}" data-k="listSpacing"></div>
          <div class="ins-grid g2"><label>Paragraph</label><input type="number" min="0" step="1" value="${t.paragraphSpacing || 0}" data-k="paragraphSpacing"></div>
          <div class="ins-row"><label class="chk"><input type="checkbox" data-k="truncate" ${t.truncate ? 'checked' : ''}> Truncate text</label></div>
          <div class="ins-grid g2" ${t.truncate ? '' : 'style="opacity:.45"'}><label>Max lines</label><input type="number" min="1" max="99" value="${t.maxLines || 1}" data-k="maxLines"></div>
          <div class="ins-grid g2"><label>Wrap</label>
            <select data-k="wrapStyle">
              <option value="standard" ${t.wrapStyle === 'standard' ? 'selected' : ''}>Standard</option>
              <option value="pretty" ${t.wrapStyle === 'pretty' ? 'selected' : ''}>Pretty</option>
              <option value="balance" ${t.wrapStyle === 'balance' ? 'selected' : ''}>Balance</option>
            </select>
          </div>
        </div>
        <div data-pane="details" hidden>
          <div class="ins-grid g2"><label>Indent</label><input type="number" min="0" step="1" value="${t.paragraphIndent || 0}" data-k="paragraphIndent"></div>
          <div class="ins-row"><label class="chk"><input type="checkbox" data-k="hangingLists" ${t.hangingLists ? 'checked' : ''}> Hanging lists</label></div>
          <div class="ins-row"><label class="chk"><input type="checkbox" data-k="hangingQuotes" ${t.hangingQuotes ? 'checked' : ''}> Hanging quotes</label></div>
          <div class="ins-row"><label class="chk"><input type="checkbox" data-k="verticalTrim" ${t.verticalTrim ? 'checked' : ''}> Vertical trim</label></div>
          <div class="pf-type-label">OpenType</div>
          <div class="pf-ot-grid">
            ${[
              ['liga', 'Ligatures'], ['dlig', 'Rare ligatures'], ['calt', 'Contextual'],
              ['smcp', 'Small caps'], ['tnum', 'Tabular nums'], ['onum', 'Oldstyle nums'],
              ['frac', 'Fractions'], ['sups', 'Superscript'], ['subs', 'Subscript'],
              ['kern', 'Kerning'], ['ss01', 'ss01'], ['ss02', 'ss02'], ['ss03', 'ss03'],
            ].map(([k, lab]) =>
              `<label class="chk"><input type="checkbox" data-ot="${k}" ${t.ot && t.ot[k] ? 'checked' : (k === 'liga' || k === 'calt' || k === 'kern') && t.ot[k] !== false ? 'checked' : ''}> ${lab}</label>`
            ).join('')}
          </div>
          <div class="ph sm">Canvas honors small-caps, kerning, and case. Full stylistic sets apply in the text editor and in CSS export.</div>
        </div>`;
      document.body.appendChild(pop);
      const ar = anchor.getBoundingClientRect();
      pop.style.left = Math.max(8, Math.min(ar.right - 280, innerWidth - 300)) + 'px';
      pop.style.top = Math.min(ar.bottom + 6, innerHeight - 460) + 'px';

      pop.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => {
        pop.querySelectorAll('[data-tab]').forEach((x) => x.classList.toggle('on', x === b));
        pop.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.getAttribute('data-pane') !== b.dataset.tab; });
      }));

      const apply = (fn) => {
        commit(fn);
        const prev = document.querySelector('.pf-type-preview');
        if (prev) {
          prev.style.fontFeatureSettings = TE.cssFeatures(n.text);
          prev.textContent = TE.applyCase('Ag Hamburgefonstiv 123', n.text.textCase === 'small-caps' ? 'none' : n.text.textCase);
        }
        App.markDirty();
      };
      pop.querySelectorAll('[data-k]').forEach((inp) => inp.addEventListener('change', () => {
        const k = inp.dataset.k;
        apply(() => {
          if (inp.type === 'checkbox') n.text[k] = inp.checked;
          else if (inp.type === 'number') n.text[k] = +inp.value || 0;
          else n.text[k] = inp.value;
        });
      }));
      pop.querySelectorAll('[data-case]').forEach((b) => b.addEventListener('click', () => {
        apply(() => { n.text.textCase = b.dataset.case; });
        pop.querySelectorAll('[data-case]').forEach((x) => x.classList.toggle('on', x === b));
      }));
      pop.querySelectorAll('[data-list]').forEach((b) => b.addEventListener('click', () => {
        apply(() => { n.text.list = b.dataset.list; });
        pop.querySelectorAll('[data-list]').forEach((x) => x.classList.toggle('on', x === b));
      }));
      pop.querySelectorAll('[data-ot]').forEach((inp) => inp.addEventListener('change', () => {
        apply(() => { n.text.ot = n.text.ot || {}; n.text.ot[inp.dataset.ot] = inp.checked; });
      }));

      const outside = (e) => {
        if (!pop.contains(e.target) && e.target !== anchor) { pop.remove(); document.removeEventListener('mousedown', outside, true); }
      };
      setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
    }

    function openStylePicker(anchor, n) {
      closePop();
      const S = global.Styles;
      if (!S) return;
      const list = S.textList(App.doc);
      const pop = document.createElement('div');
      pop.className = 'pf-style-pop';
      pop.innerHTML =
        `<div class="pf-title">Text styles</div>` +
        (list.length ? list.map((st) =>
          `<button data-sid="${st.id}" class="${n.styleId === st.id ? 'on' : ''}"><b>${esc(st.name)}</b><span>${esc(st.font)} ${st.size} · ${TE.weightName(st.weight)}</span></button>`
        ).join('') : '<div class="ph" style="padding:8px">No styles yet.</div>') +
        `<button data-new="+ Create style">+ Create style</button>`;
      document.body.appendChild(pop);
      const ar = anchor.getBoundingClientRect();
      pop.style.left = Math.max(8, ar.left) + 'px';
      pop.style.top = Math.min(ar.bottom + 4, innerHeight - 280) + 'px';
      pop.querySelectorAll('[data-sid]').forEach((b) => b.addEventListener('click', () => {
        commit(() => S.applyTextStyle(App.doc, App.page, b.dataset.sid, App.sel));
        pop.remove();
        if (P.refreshInspector) P.refreshInspector();
      }));
      const nw = pop.querySelector('[data-new]');
      if (nw) nw.addEventListener('click', () => {
        const name = prompt('Style name', n.name || 'Text style');
        if (!name) return;
        commit(() => S.makeTextStyle(App.doc, name.trim(), n));
        pop.remove();
        if (P.renderStyles) P.renderStyles();
        if (P.refreshInspector) P.refreshInspector();
      });
      const outside = (e) => {
        if (!pop.contains(e.target) && e.target !== anchor) { pop.remove(); document.removeEventListener('mousedown', outside, true); }
      };
      setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
    }

    function openIconBrowser(n) {
      closePop();
      TE.loadIconFont(n.text.font || 'Material Symbols Outlined');
      const pop = document.createElement('div');
      pop.className = 'pf-icon-pop';
      pop.innerHTML =
        `<input class="pf-font-search" placeholder="Search icons…" spellcheck="false">` +
        `<div class="pf-icon-grid"></div>`;
      document.body.appendChild(pop);
      const grid = pop.querySelector('.pf-icon-grid');
      const srch = pop.querySelector('input');
      const fam = n.text.font || 'Material Symbols Outlined';
      function render() {
        const q = (srch.value || '').toLowerCase();
        grid.innerHTML = TE.ICON_GLYPHS.filter((g) => !q || g.includes(q)).map((g) =>
          `<button type="button" data-g="${g}" title="${g}" style="font-family:&quot;${esc(fam)}&quot;">${g}</button>`
        ).join('');
        grid.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
          commit(() => {
            n.text.content = (n.text.content && n.text.content !== 'Text') ? (n.text.content + ' ' + b.dataset.g) : b.dataset.g;
            n.text.ot = n.text.ot || {}; n.text.ot.liga = true;
          });
          pop.remove();
        }));
      }
      srch.addEventListener('input', render);
      render();
      const r = document.getElementById('ed-right');
      const box = r ? r.getBoundingClientRect() : { left: innerWidth - 300, top: 80 };
      pop.style.left = Math.max(8, box.left - 8) + 'px';
      pop.style.top = (box.top + 80) + 'px';
      const outside = (e) => {
        if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('mousedown', outside, true); }
      };
      setTimeout(() => document.addEventListener('mousedown', outside, true), 0);
    }

    function openLinkFor(n, range) {
      closePop();
      const t = TE.defaults(n.text);
      const ta = App._textEdit && App._textEdit.n === n ? App._textEdit.ta : null;
      let start = 0, end = (t.content || '').length;
      if (range) { start = range.start; end = range.end; }
      else if (ta) {
        start = ta.selectionStart || 0;
        end = ta.selectionEnd || start;
        if (end === start) { start = 0; end = ta.value.length; }
      }
      const existing = (t.links || []).find((l) => l.start < end && l.end > start);
      const pop = document.createElement('div');
      pop.className = 'pf-link-pop';
      pop.innerHTML =
        `<input type="url" placeholder="https://" value="${esc(existing ? existing.href : '')}">` +
        `<div class="pf-comment-row"><button type="button" data-ok>Apply</button><button type="button" data-rm>Remove</button></div>`;
      document.body.appendChild(pop);
      const inp = pop.querySelector('input');
      const place = () => {
        if (ta) {
          const r = ta.getBoundingClientRect();
          pop.style.left = r.left + 'px';
          pop.style.top = Math.max(8, r.top - 44) + 'px';
        } else if (n._w) {
          const z = App.view.zoom;
          pop.style.left = (n._w.x * z + App.view.ox) + 'px';
          pop.style.top = Math.max(8, n._w.y * z + App.view.oy - 40) + 'px';
        }
      };
      place();
      requestAnimationFrame(() => inp.focus());
      const apply = (href) => {
        commit(() => TE.setLink(n.text, start, end, href));
        pop.remove();
        if (P.refreshInspector) P.refreshInspector();
      };
      pop.querySelector('[data-ok]').onclick = () => apply(inp.value.trim());
      pop.querySelector('[data-rm]').onclick = () => apply('');
      inp.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); apply(inp.value.trim()); }
        if (e.key === 'Escape') { e.preventDefault(); pop.remove(); }
      });
    }

    // ------------------------------------------------------------------ text edit extras
    const _begin = App.beginTextEdit && App.beginTextEdit.bind(App);
    App.beginTextEdit = function (n, opts) {
      if (_begin) _begin(n, opts);
      const ed = this._textEdit;
      if (!ed || !ed.ta || !n || !n.text) return;
      TE.defaults(n.text);
      const ta = ed.ta;
      const css = TE.featureCss(n.text);
      Object.assign(ta.style, {
        fontFeatureSettings: css.fontFeatureSettings,
        fontVariantLigatures: css.fontVariantLigatures,
        fontVariantCaps: css.fontVariantCaps,
        fontVariantNumeric: css.fontVariantNumeric,
        textTransform: css.textTransform,
        textDecoration: css.textDecoration,
        fontKerning: css.fontKerning,
      });

      // Multi-edit: keep sibling text layers in sync.
      const siblings = (this.sel || []).map((id) => this.page.nodes[id]).filter((x) => x && x.type === 'text' && x !== n);
      if (siblings.length) this.status('Multi-edit text · ' + (siblings.length + 1) + ' layers');

      const applyListShortcut = (kind) => {
        n.text.list = n.text.list === kind ? 'none' : kind;
        cssRefresh();
      };
      const cssRefresh = () => {
        const c = TE.featureCss(n.text);
        Object.assign(ta.style, {
          fontFeatureSettings: c.fontFeatureSettings,
          textTransform: c.textTransform,
          textDecoration: c.textDecoration,
        });
      };

      ta.addEventListener('keydown', (ev) => {
        const mod = ev.metaKey || ev.ctrlKey;
        if (mod && ev.key.toLowerCase() === 'b') {
          ev.preventDefault();
          n.text.weight = (n.text.weight || 400) >= 700 ? 400 : 700;
          ta.style.fontWeight = n.text.weight;
          return;
        }
        if (mod && ev.key.toLowerCase() === 'i' && !ev.shiftKey) {
          ev.preventDefault();
          n.text.italic = !n.text.italic;
          ta.style.fontStyle = n.text.italic ? 'italic' : 'normal';
          return;
        }
        if (mod && ev.key.toLowerCase() === 'u' && ev.shiftKey) {
          ev.preventDefault();
          openLinkFor(n);
          return;
        }
        if (mod && ev.key.toLowerCase() === 'u') {
          ev.preventDefault();
          n.text.underline = !n.text.underline;
          cssRefresh();
          return;
        }
        if (mod && ev.shiftKey && ev.key === '8') {
          ev.preventDefault();
          applyListShortcut('bullet');
          return;
        }
        if (mod && ev.shiftKey && ev.key === '7') {
          ev.preventDefault();
          applyListShortcut('number');
          return;
        }
        if (ev.key === 'Tab') {
          ev.preventDefault();
          const s = ta.selectionStart || 0;
          const value = ta.value;
          const lineStart = value.lastIndexOf('\n', s - 1) + 1;
          if (ev.shiftKey) {
            if (value[lineStart] === '\t') {
              ta.value = value.slice(0, lineStart) + value.slice(lineStart + 1);
              ta.selectionStart = ta.selectionEnd = Math.max(lineStart, s - 1);
            } else if (n.text.list !== 'none' && !value.slice(lineStart, s).trim()) {
              n.text.list = 'none';
            }
          } else {
            ta.value = value.slice(0, lineStart) + '\t' + value.slice(lineStart);
            ta.selectionStart = ta.selectionEnd = s + 1;
          }
          n.text.content = ta.value;
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          return;
        }
        if (ev.key === 'Enter' && !mod) {
          const s = ta.selectionStart || 0;
          const value = ta.value;
          const lineStart = value.lastIndexOf('\n', s - 1) + 1;
          const line = value.slice(lineStart, s);
          if (n.text.list !== 'none' && line.replace(/\t/g, '') === '') {
            ev.preventDefault();
            if (line.startsWith('\t')) {
              ta.value = value.slice(0, lineStart) + line.slice(1) + value.slice(s);
              ta.selectionStart = ta.selectionEnd = s - 1;
            } else {
              n.text.list = 'none';
            }
            n.text.content = ta.value;
            ta.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }
      });

      ta.addEventListener('input', () => {
        const v = ta.value;
        // Markdown-style list starters (Figma: "- " / "* " / "1. " / "1) ")
        const m = v.match(/(^|\n)([-*]|1[.)]) $/);
        if (m) {
          const kind = m[2] === '-' || m[2] === '*' ? 'bullet' : 'number';
          n.text.list = kind;
          const cut = v.slice(0, v.length - m[2].length - 1) + (m[1] || '');
          ta.value = cut;
          n.text.content = cut;
          ta.selectionStart = ta.selectionEnd = cut.length;
        }
        if (siblings.length) {
          for (const s of siblings) s.text.content = n.text.content;
        }
      });

      ta.addEventListener('paste', (ev) => {
        const clip = (ev.clipboardData && ev.clipboardData.getData('text')) || '';
        if (/^https?:\/\/\S+$/i.test(clip.trim())) {
          const s = ta.selectionStart || 0, e2 = ta.selectionEnd || s;
          if (e2 > s) {
            ev.preventDefault();
            TE.setLink(n.text, s, e2, clip.trim());
            n.text.underline = true;
            cssRefresh();
          }
        }
      });
    };

    // ------------------------------------------------------------------ click link / multi-edit Enter
    const _onDown = App.onDown && App.onDown.bind(App);
    App.onDown = function (e) {
      if (this.tool === 'move' && e.button === 0 && !e.shiftKey && !this.space && !this._textEdit) {
        const p = this.toWorld(e);
        const hit = this.hitTest(p);
        if (hit && hit.type === 'text' && hit.text && hit.text.links && hit.text.links.length) {
          const z = this.view.zoom;
          const b = hit._w || { x: hit.x, y: hit.y };
          const localX = p.x - b.x;
          const localY = p.y - b.y;
          const link = TE.hitLink(hit, localX, localY);
          if (link && link.href && !(e.metaKey || e.ctrlKey)) {
            try { window.open(link.href, '_blank', 'noopener'); } catch (err) {}
            e.preventDefault();
            return;
          }
        }
      }
      if (_onDown) return _onDown(e);
    };

    const _onKey = App.onKey && App.onKey.bind(App);
    App.onKey = function (e) {
      if (this._textEdit) return _onKey ? _onKey(e) : undefined;
      const tag = (e.target && e.target.tagName) || '';
      if (/INPUT|TEXTAREA|SELECT/.test(tag)) return _onKey ? _onKey(e) : undefined;

      const texts = (this.sel || []).map((id) => this.page && this.page.nodes[id]).filter((n) => n && n.type === 'text');
      if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && texts.length > 1) {
        e.preventDefault();
        this.beginTextEdit(texts[0], { select: 'all' });
        return;
      }

      const n = texts[0];
      if (n && n.text) {
        const mod = e.metaKey || e.ctrlKey;
        if (mod && e.shiftKey && (e.key === 'u' || e.key === 'U')) {
          e.preventDefault();
          openLinkFor(n);
          return;
        }
        if (mod && !e.altKey && e.key.toLowerCase() === 'b') {
          e.preventDefault();
          commit(() => { n.text.weight = (n.text.weight || 400) >= 700 ? 400 : 700; });
          if (P.refreshInspector) P.refreshInspector();
          return;
        }
        if (mod && !e.altKey && e.key.toLowerCase() === 'i') {
          e.preventDefault();
          commit(() => { n.text.italic = !n.text.italic; });
          if (P.refreshInspector) P.refreshInspector();
          return;
        }
        if (mod && !e.shiftKey && e.key.toLowerCase() === 'u') {
          e.preventDefault();
          commit(() => { n.text.underline = !n.text.underline; });
          if (P.refreshInspector) P.refreshInspector();
          return;
        }
        if (mod && e.shiftKey && (e.key === '<' || e.key === ',')) {
          e.preventDefault();
          commit(() => TE.bumpSize(n.text, -1));
          if (P.refreshInspector) P.refreshInspector();
          return;
        }
        if (mod && e.shiftKey && (e.key === '>' || e.key === '.')) {
          e.preventDefault();
          commit(() => TE.bumpSize(n.text, 1));
          if (P.refreshInspector) P.refreshInspector();
          return;
        }
        if (mod && e.altKey && (e.key === '<' || e.key === ',')) {
          e.preventDefault();
          commit(() => TE.bumpWeight(n.text, -1));
          if (P.refreshInspector) P.refreshInspector();
          return;
        }
        if (mod && e.altKey && (e.key === '>' || e.key === '.')) {
          e.preventDefault();
          commit(() => TE.bumpWeight(n.text, 1));
          if (P.refreshInspector) P.refreshInspector();
          return;
        }
        if (mod && e.shiftKey && e.key === '8') {
          e.preventDefault();
          commit(() => { n.text.list = n.text.list === 'bullet' ? 'none' : 'bullet'; });
          if (P.refreshInspector) P.refreshInspector();
          return;
        }
        if (mod && e.shiftKey && e.key === '7') {
          e.preventDefault();
          commit(() => { n.text.list = n.text.list === 'number' ? 'none' : 'number'; });
          if (P.refreshInspector) P.refreshInspector();
          return;
        }
      }
      if (_onKey) return _onKey(e);
    };

    if (global.Shortcuts && global.Shortcuts.def) {
      const def = global.Shortcuts.def;
      def('mod+b', 'Bold text', 'Text', (a) => {
        const n = a.page && a.sel[0] && a.page.nodes[a.sel[0]];
        if (n && n.text) { n.text.weight = (n.text.weight || 400) >= 700 ? 400 : 700; a.markDirty(); }
      });
      def('mod+i', 'Italic text', 'Text', (a) => {
        const n = a.page && a.sel[0] && a.page.nodes[a.sel[0]];
        if (n && n.text) { n.text.italic = !n.text.italic; a.markDirty(); }
      });
      def('mod+u', 'Underline text', 'Text', (a) => {
        const n = a.page && a.sel[0] && a.page.nodes[a.sel[0]];
        if (n && n.text) { n.text.underline = !n.text.underline; a.markDirty(); }
      });
      def('shift+mod+u', 'Add link to text', 'Text', () => {});
      def('shift+mod+7', 'Numbered list', 'Text', () => {});
      def('shift+mod+8', 'Bulleted list', 'Text', () => {});
    }

    // Hover chip for links
    const wrap = document.querySelector('.ed-canvas-wrap') || document.body;
    const chip = document.createElement('div');
    chip.className = 'pf-link-chip';
    chip.hidden = true;
    wrap.appendChild(chip);
    const _move = App.onMove && App.onMove.bind(App);
    App.onMove = function (e) {
      if (_move) _move(e);
      if (this._textEdit || this._drag || this.tool !== 'move') { chip.hidden = true; return; }
      const p = this.toWorld(e);
      const hit = this.hitTest(p);
      if (hit && hit.type === 'text') {
        const b = hit._w || { x: hit.x, y: hit.y };
        const link = TE.hitLink(hit, p.x - b.x, p.y - b.y);
        if (link && link.href) {
          chip.hidden = false;
          chip.textContent = link.href;
          const rect = this.canvas.getBoundingClientRect();
          chip.style.left = (e.clientX - rect.left + 12) + 'px';
          chip.style.top = (e.clientY - rect.top + 16) + 'px';
          return;
        }
      }
      chip.hidden = true;
    };

    // Preload icon fonts used in the open file
    if (App.doc) {
      for (const p of App.doc.pages || []) {
        for (const id in p.nodes) {
          const n = p.nodes[id];
          if (n && n.text && TE.isIconFont(n.text.font)) TE.loadIconFont(n.text.font);
        }
      }
    }
  });
})(window);
