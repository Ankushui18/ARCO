/* fonts.js — Penfig Font Manager
 *
 * Provides:
 *   - Curated list of Google Fonts (loaded on demand via FontFace API)
 *   - System font stack fallback
 *   - recently-used list
 *   - Promise-based load() so measurement never runs on fallback
 *   - ensureLoaded(family, weight, italic) — loads before measurement/layout
 *   - list() — merged system + google + doc fonts
 *   - picker element helper (searchable dropdown used by inspector)
 */
(function(global){
  'use strict';

  // Curated list of popular Google Fonts. Keep each entry as a name/weights
  // pair; we construct the CSS URL and WOFF2 request dynamically. Using
  // the Google Fonts CSS v2 endpoint with the 'display=swap' parameter
  // keeps things fast while we wait for the font to finish loading.
  const GOOGLE_FONTS = [
    { name: 'Inter',        weights: [300,400,500,600,700,800] },
    { name: 'Roboto',       weights: [300,400,500,700,900] },
    { name: 'Open Sans',    weights: [300,400,500,600,700,800] },
    { name: 'Poppins',     weights: [300,400,500,600,700,800] },
    { name: 'Montserrat',  weights: [300,400,500,600,700,800,900] },
    { name: 'Lato',        weights: [300,400,700,900] },
    { name: 'DM Sans',     weights: [400,500,700] },
    { name: 'Manrope',     weights: [300,400,500,600,700,800] },
    { name: 'Plus Jakarta Sans', weights: [400,500,600,700,800] },
    { name: 'Space Grotesk', weights: [400,500,600,700] },
    { name: 'Work Sans',   weights: [300,400,500,600,700,800] },
    { name: 'Nunito',      weights: [300,400,600,700,800,900] },
    { name: 'Source Sans 3', weights: [300,400,600,700,900] },
    { name: 'Raleway',     weights: [300,400,500,600,700,800,900] },
    { name: 'Ubuntu',      weights: [300,400,500,700] },
    { name: 'Playfair Display', weights: [400,500,600,700,800,900] },
    { name: 'Merriweather', weights: [300,400,700,900] },
    { name: 'PT Sans',     weights: [400,700] },
    { name: 'PT Serif',    weights: [400,700] },
    { name: 'Fira Code',   weights: [400,500,600,700] },
    { name: 'JetBrains Mono', weights: [400,500,700,800] },
    { name: 'IBM Plex Sans', weights: [300,400,500,600,700] },
    { name: 'IBM Plex Mono', weights: [400,500,700] },
    { name: 'Oswald',      weights: [300,400,500,600,700] },
    { name: 'Bebas Neue',  weights: [400] },
    { name: 'Archivo',     weights: [400,500,600,700] },
    { name: 'Outfit',      weights: [300,400,500,600,700,800,900] },
    { name: 'Sora',        weights: [300,400,500,600,700,800] },
    { name: 'Quicksand',   weights: [400,500,600,700] },
    { name: 'Mulish',      weights: [300,400,600,700,800,900] },
  ];

  // System fonts — these always exist, never need loading.
  const SYSTEM_FONTS = [
    'Inter', // bundled-ish in many systems; falls back gracefully
    '-apple-system', 'BlinkMacSystemFont',
    'Segoe UI', 'Helvetica Neue', 'Helvetica', 'Arial',
    'Roboto', 'San Francisco', '.SF Pro Text',
    'Georgia', 'Times New Roman', 'Times',
    'Courier New', 'Courier',
    'Verdana', 'Tahoma', 'Trebuchet MS',
    'Garamond', 'Futura', 'Impact',
  ];

  // Cache of promises per "family:weight:style" so we don't double-load.
  const loading = new Map();
  const loaded  = new Set();

  function key(family, weight, italic){ return (family||'').replace(/\s+/g,'+') + ':' + (weight||400) + ':' + (italic?'i':'n'); }

  // Google Fonts CSS API endpoint. For a given family we request the
  // supported weights in both normal and italic.
  function googleCssUrl(name, weights) {
    const fname = name.replace(/ /g, '+');
    const ital = weights.map(w => '0,' + w).concat(weights.map(w => '1,' + w)).join(';');
    return 'https://fonts.googleapis.com/css2?family=' + fname + ':ital,wght@' + ital + '&display=swap';
  }

  function loadGoogle(name, weights) {
    // Fetch CSS, parse @font-face blocks, register each as a FontFace so
    // we have precise control over when the font is ready.
    const k = 'g:' + name;
    if (loading.has(k)) return loading.get(k);
    const p = fetch(googleCssUrl(name, weights), { mode:'cors' })
      .then(r => r.text())
      .then(css => {
        const faceRe = /@font-face\s*\{([^}]+)\}/g;
        const adds = [];
        let m;
        while ((m = faceRe.exec(css)) !== null) {
          const block = m[1];
          const get = (prop) => {
            const mm = block.match(new RegExp(prop + ':\\s*([^;]+);'));
            return mm ? mm[1].trim() : '';
          };
          const familyRaw = get('font-family').replace(/^["']|["']$/g,'');
          const weight = parseInt(get('font-weight'), 10) || 400;
          const style  = get('font-style') || 'normal';
          const src    = get('src');
          // Extract first URL (WOFF2 preferred)
          const urlMatch = src.match(/url\(([^)]+)\)\s+format\(['"]([^'"]+)['"]\)/);
          if (!urlMatch) continue;
          const url = urlMatch[1];
          const fmt = urlMatch[2];
          const ff = new FontFace(familyRaw, 'url(' + url + ') format("' + fmt + '")', { weight: String(weight), style });
          adds.push(ff.load().then(f => {
            try { document.fonts.add(f); } catch (e) {}
            loaded.add(key(familyRaw, weight, style==='italic'));
          }).catch(err => console.warn('Font load failed:', familyRaw, weight, style, err)));
        }
        return Promise.all(adds);
      })
      .catch(err => { console.warn('Google Fonts CSS fetch failed for', name, err); throw err; });
    loading.set(k, p);
    return p;
  }

  // Ensure the named font is ready (loaded + in document.fonts) before
  // measuring/rendering. Returns a Promise that resolves when the font
  // is available. For system fonts it resolves immediately.
  function ensureLoaded(family, weight, italic) {
    if (!family) return Promise.resolve();
    const weightN = weight || 400;
    const k = key(family, weightN, !!italic);
    if (loaded.has(k)) return Promise.resolve();
    const gf = GOOGLE_FONTS.find(g => g.name.toLowerCase() === family.toLowerCase());
    if (gf) return loadGoogle(gf.name, gf.weights);
    // System / unknown — rely on document.fonts.ready at minimum.
    if (document.fonts && document.fonts.load) {
      const q = (italic ? 'italic ' : '') + weightN + 'px "' + family + '"';
      return document.fonts.load(q, 'Sample ' + family).then(() => {
        loaded.add(k);
      }).catch(() => {});
    }
    return Promise.resolve();
  }

  // List all fonts (prefs + Google + system + doc), grouped.
  function list(doc) {
    const docFonts = new Set();
    if (doc && doc.pages) for (const p of doc.pages) {
      for (const id in p.nodes) {
        const n = p.nodes[id];
        if (n && n.type === 'text' && n.text && n.text.font) docFonts.add(n.text.font);
      }
    }
    // Recent from localStorage
    let recent = [];
    try { recent = JSON.parse(localStorage.getItem('pf-recent-fonts') || '[]'); } catch (e) {}
    const seen = new Set();
    const out = [];
    const push = (group, name) => {
      const lname = name.toLowerCase();
      if (seen.has(lname)) return;
      seen.add(lname);
      out.push({ group, name });
    };
    recent.forEach(n => push('Recent', n));
    docFonts.forEach(n => push('In this document', n));
    GOOGLE_FONTS.forEach(g => push('Google Fonts', g.name));
    // System fonts (intersection with what browser reports available, or
    // just our curated list if we can't detect).
    SYSTEM_FONTS.forEach(n => push('System', n));
    return out;
  }

  // Save a recently-used font.
  function touchRecent(name) {
    if (!name) return;
    let arr = [];
    try { arr = JSON.parse(localStorage.getItem('pf-recent-fonts') || '[]'); } catch(e) {}
    arr = [name].concat(arr.filter(n => n.toLowerCase() !== name.toLowerCase())).slice(0, 6);
    try { localStorage.setItem('pf-recent-fonts', JSON.stringify(arr)); } catch(e) {}
  }

  // Build a searchable font picker <div> (not a <select>) that drops down
  // over the anchor element. Calls onChange(family) when chosen.
  function openPicker(anchor, current, onChange) {
    closePicker();
    const doc = (global.App && global.App.doc) || null;
    const items = list(doc);
    const wrap = document.createElement('div');
    wrap.className = 'pf-font-picker';
    wrap.innerHTML =
      '<input type="text" class="pf-font-search" placeholder="Search fonts…" spellcheck="false" autocomplete="off">' +
      '<div class="pf-font-list"></div>';
    document.body.appendChild(wrap);
    const list = wrap.querySelector('.pf-font-list');
    const srch = wrap.querySelector('.pf-font-search');
    let lastGroup = '';
    function render(filter) {
      list.innerHTML = '';
      lastGroup = '';
      const q = (filter||'').toLowerCase().trim();
      for (const it of items) {
        if (q && !it.name.toLowerCase().includes(q) && !it.group.toLowerCase().includes(q)) continue;
        if (it.group !== lastGroup) {
          const gh = document.createElement('div');
          gh.className = 'pf-font-group';
          gh.textContent = it.group;
          list.appendChild(gh);
          lastGroup = it.group;
        }
        const opt = document.createElement('div');
        opt.className = 'pf-font-opt' + (it.name === current ? ' on' : '');
        opt.textContent = it.name;
        opt.style.fontFamily = '"' + it.name + '", Inter, -apple-system, sans-serif';
        opt.addEventListener('mousedown', (e) => {
          e.preventDefault();
          onChange(it.name);
          touchRecent(it.name);
          closePicker();
        });
        list.appendChild(opt);
      }
    }
    render('');
    srch.addEventListener('input', () => render(srch.value));
    requestAnimationFrame(() => srch.focus());
    // Position below anchor.
    const ar = anchor.getBoundingClientRect();
    wrap.style.left = Math.max(8, ar.left) + 'px';
    wrap.style.top = (ar.bottom + 4) + 'px';
    wrap.style.minWidth = Math.max(220, ar.width) + 'px';
    document.addEventListener('mousedown', outside, true);
    function outside(e){
      if (!wrap.contains(e.target)) closePicker();
    }
    wrap._close = () => document.removeEventListener('mousedown', outside, true);
    global._fontPicker = wrap;
  }
  function closePicker(){
    const w = global._fontPicker;
    if (w) {
      if (w._close) w._close();
      w.remove();
      global._fontPicker = null;
    }
  }

  global.Fonts = {
    list, ensureLoaded, touchRecent, openPicker, closePicker,
    GOOGLE_FONTS, SYSTEM_FONTS,
    stack: (family) => `"${family}", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif`,
  };
})(window);
