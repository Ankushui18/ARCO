/* fonts.js — ARCO Font Manager
 *
 * Provides:
 *   - Curated list of Google Fonts (loaded on demand via FontFace API)
 *   - System font stack fallback
 *   - Local (OS-installed) fonts via the Local Font Access API when available
 *   - Recently-used list (persisted to localStorage)
 *   - Promise-based ensureLoaded() so measurement never runs on fallback
 *   - Searchable font picker UI (Recent / In this doc / System / Google Fonts)
 */
(function(global){
  'use strict';

  const GOOGLE_FONTS = [
    { name: 'Inter',        weights: [300,400,500,600,700,800] },
    { name: 'Roboto',       weights: [300,400,500,700,900] },
    { name: 'Open Sans',    weights: [300,400,500,600,700,800] },
    { name: 'Poppins',      weights: [300,400,500,600,700,800] },
    { name: 'Montserrat',   weights: [300,400,500,600,700,800,900] },
    { name: 'Lato',         weights: [300,400,700,900] },
    { name: 'DM Sans',      weights: [400,500,700] },
    { name: 'Manrope',      weights: [300,400,500,600,700,800] },
    { name: 'Plus Jakarta Sans', weights: [400,500,600,700,800] },
    { name: 'Space Grotesk', weights: [400,500,600,700] },
    { name: 'Work Sans',    weights: [300,400,500,600,700,800] },
    { name: 'Nunito',       weights: [300,400,600,700,800,900] },
    { name: 'Source Sans 3', weights: [300,400,600,700,900] },
    { name: 'Raleway',      weights: [300,400,500,600,700,800,900] },
    { name: 'Ubuntu',       weights: [300,400,500,700] },
    { name: 'Playfair Display', weights: [400,500,600,700,800,900] },
    { name: 'Merriweather', weights: [300,400,700,900] },
    { name: 'PT Sans',      weights: [400,700] },
    { name: 'PT Serif',     weights: [400,700] },
    { name: 'Fira Code',    weights: [400,500,600,700] },
    { name: 'JetBrains Mono', weights: [400,500,700,800] },
    { name: 'IBM Plex Sans', weights: [300,400,500,600,700] },
    { name: 'IBM Plex Mono', weights: [400,500,700] },
    { name: 'Oswald',       weights: [300,400,500,600,700] },
    { name: 'Bebas Neue',   weights: [400] },
    { name: 'Archivo',      weights: [400,500,600,700] },
    { name: 'Outfit',       weights: [300,400,500,600,700,800,900] },
    { name: 'Sora',         weights: [300,400,500,600,700,800] },
    { name: 'Quicksand',    weights: [400,500,600,700] },
    { name: 'Mulish',       weights: [300,400,600,700,800,900] },
  ];

  // Web-safe system fonts — always present in (almost) every browser.
  const SYSTEM_FONTS = [
    'Inter',
    '-apple-system', 'BlinkMacSystemFont',
    'Segoe UI', 'Helvetica Neue', 'Helvetica', 'Arial',
    'Roboto', 'San Francisco', '.SF Pro Text', '.SF Pro Display',
    'Georgia', 'Times New Roman', 'Times',
    'Courier New', 'Courier',
    'Verdana', 'Tahoma', 'Trebuchet MS',
    'Garamond', 'Futura', 'Impact',
    'Menlo', 'Monaco', 'Consolas',
  ];

  const loading = new Map(); // key -> Promise
  const loaded  = new Set(); // key
  const _local  = { loaded:false, fonts:[] };

  function key(family, weight, italic){
    return (family||'').replace(/\s+/g,'+') + ':' + (weight||400) + ':' + (italic?'i':'n');
  }

  function googleCssUrl(name, weights) {
    const fname = encodeURIComponent(name);
    const ital = weights.map(w => '0,' + w).concat(weights.map(w => '1,' + w)).join(';');
    return 'https://fonts.googleapis.com/css2?family=' + fname + ':ital,wght@' + ital + '&display=swap';
  }

  function loadGoogle(name, weights) {
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
          const urlMatch = src && src.match(/url\(([^)]+)\)\s*format\(['"]([^'"]+)['"]\)/);
          if (!urlMatch) continue;
          const url = urlMatch[1];
          const fmt = urlMatch[2];
          const ff = new FontFace(familyRaw, 'url(' + url + ') format("' + fmt + '")',
            { weight: String(weight), style });
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

  function ensureLoaded(family, weight, italic) {
    if (!family) return Promise.resolve();
    const weightN = weight || 400;
    const k = key(family, weightN, !!italic);
    if (loaded.has(k)) return Promise.resolve();
    const gf = GOOGLE_FONTS.find(g => g.name.toLowerCase() === family.toLowerCase());
    if (gf) return loadGoogle(gf.name, gf.weights);
    if (document.fonts && document.fonts.load) {
      const q = (italic ? 'italic ' : '') + weightN + 'px "' + family + '"';
      return document.fonts.load(q, 'Sample ' + family).then(() => {
        loaded.add(k);
      }).catch(() => {});
    }
    return Promise.resolve();
  }

  // Query local system fonts via the Local Font Access API. Adds discovered
  // family names to the System group. Idempotent; resolves immediately on
  // unsupported browsers.
  function queryLocal() {
    if (_local.loaded) return Promise.resolve(_local.fonts);
    _local.loaded = true;
    if (!navigator.fonts || typeof navigator.fonts.query !== 'function') {
      return Promise.resolve(_local.fonts);
    }
    return navigator.fonts.query({ persistentAccess:false })
      .then(fs => {
        const names = Array.from(new Set((fs||[]).map(f => f.family).filter(Boolean)));
        _local.fonts = names.sort((a,b) => a.localeCompare(b));
        return _local.fonts;
      })
      .catch(() => _local.fonts);
  }

  function localFonts() { return _local.fonts.slice(); }

  function list(doc) {
    const docFonts = new Set();
    if (doc && doc.pages) for (const p of doc.pages) {
      for (const id in p.nodes) {
        const n = p.nodes[id];
        if (n && n.type === 'text' && n.text && n.text.font) docFonts.add(n.text.font);
      }
    }
    let recent = [];
    try { recent = JSON.parse(localStorage.getItem('pf-recent-fonts') || '[]'); } catch (e) {}
    const seen = new Set();
    const out = [];
    const push = (group, name) => {
      if (!name) return;
      const k = name.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      out.push({ group, name });
    };
    recent.forEach(n => push('Recent', n));
    docFonts.forEach(n => push('In this document', n));
    _local.fonts.forEach(n => push('System', n));
    GOOGLE_FONTS.forEach(g => push('Google Fonts', g.name));
    SYSTEM_FONTS.forEach(n => push('System', n));
    return out;
  }

  function touchRecent(name) {
    if (!name) return;
    let arr = [];
    try { arr = JSON.parse(localStorage.getItem('pf-recent-fonts') || '[]'); } catch (e) {}
    arr = [name].concat(arr.filter(n => n.toLowerCase() !== name.toLowerCase())).slice(0, 6);
    try { localStorage.setItem('pf-recent-fonts', JSON.stringify(arr)); } catch (e) {}
  }

  function stack(family) {
    return `"${family}", Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif`;
  }

  function closePicker() {
    const w = global._fontPicker;
    if (w) {
      if (w._close) w._close();
      w.remove();
      global._fontPicker = null;
    }
  }

  function openPicker(anchor, current, onChange) {
    closePicker();
    const App = global.App;
    const doc = (App && App.doc) || null;
    const wrap = document.createElement('div');
    wrap.className = 'pf-font-picker';
    wrap.innerHTML =
      '<input type="text" class="pf-font-search" placeholder="Search fonts…" spellcheck="false" autocomplete="off">' +
      '<div class="pf-font-status" style="font-size:10.5px;color:#888;padding:4px 10px;display:none;"></div>' +
      '<div class="pf-font-list"></div>';
    document.body.appendChild(wrap);
    const listEl = wrap.querySelector('.pf-font-list');
    const srch   = wrap.querySelector('.pf-font-search');
    const status = wrap.querySelector('.pf-font-status');

    function render(filter) {
      const items = list(doc);
      listEl.innerHTML = '';
      let lastGroup = '';
      const q = (filter||'').toLowerCase().trim();
      for (const it of items) {
        if (q && !it.name.toLowerCase().includes(q) && !it.group.toLowerCase().includes(q)) continue;
        if (it.group !== lastGroup) {
          const gh = document.createElement('div');
          gh.className = 'pf-font-group';
          gh.textContent = it.group;
          listEl.appendChild(gh);
          lastGroup = it.group;
        }
        const opt = document.createElement('div');
        opt.className = 'pf-font-opt' + (it.name === current ? ' on' : '');
        opt.textContent = it.name;
        opt.style.fontFamily = stack(it.name);
        opt.addEventListener('mousedown', (e) => {
          e.preventDefault();
          // If it's a Google Font, kick off the load right away so the
          // canvas re-renders in the correct face ASAP.
          ensureLoaded(it.name);
          onChange(it.name);
          touchRecent(it.name);
          closePicker();
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
    render('');

    // Offer to scan local fonts if the API is available and we haven't yet.
    if (!_local.loaded && navigator.fonts && navigator.fonts.query) {
      status.style.display = 'block';
      status.textContent = 'Scanning local fonts…';
      queryLocal().then(() => { render(srch.value); status.style.display = 'none'; });
    }

    srch.addEventListener('input', () => render(srch.value));
    requestAnimationFrame(() => { try { srch.focus(); } catch(e){} });

    const ar = anchor.getBoundingClientRect();
    wrap.style.left = Math.max(8, ar.left) + 'px';
    wrap.style.top  = (ar.bottom + 4) + 'px';
    wrap.style.minWidth = Math.max(240, ar.width) + 'px';

    function outside(e) { if (!wrap.contains(e.target)) closePicker(); }
    document.addEventListener('mousedown', outside, true);
    wrap._close = () => document.removeEventListener('mousedown', outside, true);
    global._fontPicker = wrap;
  }

  global.Fonts = {
    list, ensureLoaded, touchRecent, openPicker, closePicker,
    queryLocal, localFonts,
    GOOGLE_FONTS, SYSTEM_FONTS,
    stack,
  };

  // Kick off a local-font scan in the background so the list is populated
  // by the time the user opens the picker. Failures are silent.
  queryLocal().catch(() => {});
})(window);
