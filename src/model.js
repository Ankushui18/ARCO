/* model.js — Penfig document model (Figma-style scene graph)
 *
 * Doc
 * └─ pages[]     (Figma "pages" / CANVAS nodes)
 *    └─ nodes    (id → Node)  +  tops[] (page-level z-order)
 * └─ vars        (design tokens: modes + sets + variables)
 *
 * Nodes reference their parent by id (JSON-safe); parent pointers are
 * resolved on demand. Node types: frame | rect | ellipse | line | text | vector
 */
(function (global) {
  'use strict';

  let _idc = 0;
  const uid = (p) => (p || 'n') + Date.now().toString(36) + (++_idc).toString(36) + Math.random().toString(36).slice(2, 6);

  // ------------------------------------------------------------- colors
  const normHex = (h) => {
    if (typeof h !== 'string') h = '#000000';
    h = h.trim().replace(/^#/, '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return '#000000';
    return '#' + h.toLowerCase();
  };
  const hexToRgb = (h) => { h = normHex(h); return { r: parseInt(h.slice(1, 3), 16) / 255, g: parseInt(h.slice(3, 5), 16) / 255, b: parseInt(h.slice(5, 7), 16) / 255 }; };
  const rgbToHex = (r, g, b) => {
    const c = (v) => Math.max(0, Math.min(255, Math.round(v * 255))).toString(16).padStart(2, '0');
    return '#' + c(r) + c(g) + c(b);
  };
  const rgbaCss = (hex, a) => { const { r, g, b } = hexToRgb(hex); return `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a == null ? 1 : a})`; };

  // ------------------------------------------------------------- nodes
  const DEFAULT_NAMES = { frame: 'Frame', rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line', text: 'Text', vector: 'Vector' };

  function makeNode(type, opts = {}) {
    const n = {
      id: uid(type[0] + '-'),
      type,
      name: DEFAULT_NAMES[type] || type,
      parent: null,           // parent node id, or null (page level)
      children: [],           // child node ids, z-order (first = back)
      x: 0, y: 0, w: 100, h: 100,
      rotation: 0,            // radians, positive = clockwise (Figma convention is clockwise degrees; stored radians for Math API)
      flipH: false,          // horizontal flip around vertical axis
      flipV: false,          // vertical flip around horizontal axis
      visible: true, locked: false,
      opacity: 1,
      blend: 'normal',
      radius: [0, 0, 0, 0],   // tl tr br bl
      clips: type === 'frame',
      fills: [],
      stroke: { color: '#000000', width: 1, opacity: 1, align: 'inside', cap: 'butt', join: 'miter', dash: null, token: null, visible: false },
      shadows: [],            // [{color, opacity, x, y, blur, spread, visible}]
      blur: 0,
      al: null,               // container auto layout
      als: null,              // item auto layout
      text: null,
      // ── ecosystem features ──
      isComponent: false,     // this node is a component (frame)
      componentId: null,      // if instance: id of the component node
      variant: null,          // if instance: variant name in use
      interactions: [],       // prototyping: [{on:'click', to, kind:'node'|'page', anim:'none'|'fade'|'slide'|'overlay'|'scroll'}]
      mask: false,            // use as clipping mask (frame child)
      grid: null,             // layout grid: {kind:'columns'|'rows', count, gap, offset}
      // ── v2: constraints, resize-fit, props, styles ──
      constraints: { h: 'min', v: 'min' }, // min | center | max | stretch | scale (manual layouts)
      resizeToFit: false,     // frame: shrink-wrap to children bounds
      compProps: null,        // (legacy; props now live on the component set def)
      props: {},              // if instance: { propName: value }
      styleId: null,          // text style id (doc.styles.text)
      fillStyleId: null,      // paint style id (doc.styles.paint)
    };
    // Figma frame-tool parity: a newly drawn frame is an opaque white canvas.
    // Group-like frames explicitly clear this fill in group/frame-selection
    // workflows, so those continue to behave as transparent containers.
    if (type === 'frame') {
      n.w = opts.w || 200;
      n.h = opts.h || 200;
      n.fills = [{ type: 'solid', color: '#ffffff', opacity: 1, token: null, visible: true }];
    }
    if (type === 'rect') { n.w = opts.w || 100; n.h = opts.h || 100; n.fills = [{ type: 'solid', color: '#d9d9d9', opacity: 1, token: null }]; }
    if (type === 'ellipse') { n.w = opts.w || 100; n.h = opts.h || 100; n.fills = [{ type: 'solid', color: '#d9d9d9', opacity: 1, token: null }]; }
    if (type === 'line') { n.w = opts.w != null ? opts.w : 200; n.h = opts.h != null ? opts.h : 1; n.fills = []; n.stroke = { color: '#000000', width: 2, opacity: 1, align: 'inside', token: null, visible: true }; }
    if (type === 'text') {
      n.w = opts.w || 120; n.h = opts.h || 24; n.fills = [{ type: 'solid', color: '#ffffff', opacity: 1, token: null }];
      n.text = Object.assign({
        content: 'Text', font: 'Inter', size: 16, weight: 400, italic: false,
        lineHeight: 1.2, letterSpacing: 0, align: 'left', valign: 'top', token: null,
        lineHeightUnit: 'auto', textCase: 'none', list: 'none',
        listSpacing: 0, paragraphSpacing: 0, paragraphIndent: 0,
        hangingLists: false, hangingQuotes: false, truncate: false, maxLines: 1,
        wrapStyle: 'standard', underline: false, strike: false,
        underlineStyle: 'solid', underlineOffset: 0, verticalTrim: false,
        ot: { liga: true, dlig: false, calt: true, kern: true },
        links: [],
        // Figma text auto-resize: 'auto' (hug w+h — Figma's default for new
        // text) | 'auto-w' (hug width) | 'auto-h' (hug height) | 'fixed'
        resize: 'auto',
      }, n.text || {});
    }
    if (type === 'vector') { n.fills = []; }
    if (opts) { for (const k of Object.keys(opts)) if (k !== 'text' && k !== 'id' && k !== 'type') n[k] = opts[k]; }
    if (n.text && opts && opts.text) n.text = Object.assign(n.text, opts.text);
    return n;
  }

  function makeAutoLayout(n, dir, page) {
    n.al = {
      dir: dir || 'v', wrap: false,
      gap: { n: 8, tok: null }, gapCross: { n: 8, tok: null },
      pad: [{ n: 0, tok: null }, { n: 0, tok: null }, { n: 0, tok: null }, { n: 0, tok: null }], // t r b l
      main: 'start',      // start | center | end | space-between | space-evenly
      cross: 'start',     // start | center | end | stretch
      reverse: false,
    };
    if (page) for (const cid of n.children) ensureItemDefaults(page, n.id, cid);
    return n.al;
  }
  function ensureItemDefaults(page, parentId, childId) {
    const c = page.nodes[childId];
    if (!c) return;
    if (!c.als) {
      c.als = {
        w: c.type === 'text' ? 'hug' : 'fixed',
        h: c.type === 'text' ? 'hug' : 'fixed',
        grow: 0, align: 'auto', absolute: false,
      };
    }
  }
  function removeAutoLayout(n, page) {
    if (!n.al) return;
    n.al = null;
    if (page) for (const cid of n.children) { const c = page.nodes[cid]; if (c) c.als = null; }
    else for (const cid of n.children) { const c = n.childrenById?.[cid]; if (c) c.als = null; }
  }

  // ------------------------------------------------------------- pages & doc
  function newPage(name) { return { id: uid('pg-'), name: name || 'Page', nodes: {}, tops: [] }; }
  function newDoc(name) {
    const doc = {
      id: uid('doc-'),
      name: name || 'Untitled',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      pages: [newPage('Page 1')],
      vars: { modes: [{ id: uid('m-'), name: 'Light' }, { id: uid('m-'), name: 'Dark' }], defaultMode: null, sets: [] },
      components: {},         // componentId → { id, name, variants: [name], main: name, props: [{name,type,def}] }
      comments: [],           // [{id, pageId, x, y, text, author, at, resolved}]
      versions: [],           // [{id, name, at, snap}]  (named history snapshots)
      styles: { text: {}, paint: {} }, // {id → {id, name, ...style fields}}
      annotations: [],        // [{id, nodeId, text, author, at}]  (dev-mode notes)
      libraries: [],          // linked local files as component libraries: [{fileId, name, at}]
    };
    if (!doc.vars.defaultMode) doc.vars.defaultMode = doc.vars.modes[0].id;
    return doc;
  }
  function addPage(doc, name) { const p = newPage(name || 'Page ' + (doc.pages.length + 1)); doc.pages.push(p); return p; }
  function pageOf(doc, ref) {
    if (typeof ref === 'number') return doc.pages[Math.max(0, ref)] || doc.pages[0];
    return doc.pages.find(p => p.id === ref) || doc.pages[0];
  }

  // ------------------------------------------------------------- tree ops
  const node = (page, id) => (id ? page.nodes[id] || null : null);
  const kids = (page, n) => n.children.map(id => page.nodes[id]).filter(Boolean);

  // NOTE: nodes never store a back-reference to their page (that would break
  // JSON serialization); the page is always passed explicitly.
  function stampPage() { /* no-op kept for API compatibility */ }

  function attach(doc, page, parentId, n, index) {
    n.parent = parentId || null;
    const list = parentId ? page.nodes[parentId].children : page.tops;
    if (index == null) list.push(n.id); else list.splice(Math.max(0, Math.min(index, list.length)), 0, n.id);
    page.nodes[n.id] = n;
    for (const cid of n.children) { const c = page.nodes[cid] || n.childrenMap?.[cid]; if (c) page.nodes[c.id] = c; }
    const visitKids = (c) => { for (const cid of c.children) { const cc = page.nodes[cid]; if (cc) { page.nodes[cc.id] = cc; visitKids(cc); } } };
    visitKids(n);
    if (parentId && page.nodes[parentId] && page.nodes[parentId].al) ensureItemDefaults(page, parentId, n.id);
    return n;
  }
  function detach(page, n) {
    const list = n.parent ? page.nodes[n.parent].children : page.tops;
    const i = list.indexOf(n.id);
    if (i >= 0) list.splice(i, 1);
    const visit = (c) => { delete page.nodes[c.id]; for (const cid of c.children) { const cc = page.nodes[cid]; if (cc) visit(cc); } };
    visit(n);
  }
  function ancestors(page, n, fn) { let p = n.parent ? page.nodes[n.parent] : null; let g = 0; while (p && g++ < 500) { const r = fn(p); if (r !== undefined) return r; p = p.parent ? page.nodes[p.parent] : null; } }
  function zIndexOf(page, n) { return (n.parent ? page.nodes[n.parent].children : page.tops).indexOf(n.id); }
  function reorder(page, n, dir) { // -1 back, +1 front
    const list = n.parent ? page.nodes[n.parent].children : page.tops;
    const i = list.indexOf(n.id);
    const j = i + dir;
    if (j < 0 || j >= list.length) return false;
    list.splice(i, 1); list.splice(j, 0, n.id);
    return true;
  }
  function reorderTo(page, n, pos) { // 'front' | 'back'
    const list = n.parent ? page.nodes[n.parent].children : page.tops;
    const i = list.indexOf(n.id);
    list.splice(i, 1);
    if (pos === 'front') list.push(n.id); else list.unshift(n.id);
  }
  function reorderBy(page, n, delta) { // +1 forward, -1 backward (one step)
    const list = n.parent ? page.nodes[n.parent].children : page.tops;
    const i = list.indexOf(n.id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return false;
    list.splice(i, 1);
    list.splice(j, 0, n.id);
    return true;
  }
  // Clone a node subtree with fresh ids.
  //   page    — where source children are looked up (falls back to src._cloneMap
  //             for detached trees, e.g. clipboard contents)
  //   freshIds— assign new ids
  //   target  — where clones are registered: a page (target.nodes), a Map, or
  //             null/undefined (not registered; caller keeps the Map it passed)
  function deepClone(page, src, freshIds, target) {
    const reg = (id, c) => { if (target instanceof Map) target.set(id, c); else if (target && target.nodes) target.nodes[c.id] = c; };
    const lookup = (cid) => (page && page.nodes[cid]) || (src && src._cloneMap ? src._cloneMap.get(cid) : null) || null;
    const map = new Map();
    const visit = (n) => {
      const c = Object.assign({}, n, {
        id: freshIds ? uid(n.type[0] + '-') : uid(n.type[0] + '-c'),
        children: [],
      });
      // deep-ish clone of mutable sub-structures
      c.radius = n.radius.slice();
      c.fills = n.fills.map(f => ({ ...f, stops: f.stops ? f.stops.map(s => ({ ...s })) : undefined }));
      c.stroke = { ...n.stroke };
      c.shadows = n.shadows.map(s => ({ ...s }));
      c.al = n.al ? { ...n.al, gap: { ...n.al.gap }, gapCross: { ...n.al.gapCross }, pad: n.al.pad.map(p => ({ ...p })) } : null;
      c.als = n.als ? { ...n.als } : null;
      c.text = n.text ? { ...n.text, links: (n.text.links || []).map(l => ({ ...l })), ot: n.text.ot ? { ...n.text.ot } : undefined, runs: n.text.runs ? n.text.runs.map(r => ({ ...r })) : undefined } : null;
      c.interactions = (n.interactions || []).map(x => ({ ...x }));
      c.grid = n.grid ? { ...n.grid } : null;
      c.constraints = n.constraints ? { ...n.constraints } : { h: 'min', v: 'min' };
      c.props = n.props ? { ...n.props } : {};
      c.rotation = n.rotation || 0;
      c.flipH = !!n.flipH;
      c.flipV = !!n.flipV;
      c._cloneMap = null;
      reg(c.id, c);
      map.set(n.id, c);
      return c;
    };
    const c0 = visit(src);
    // second pass: copy children (resolved via page or the source's own map)
    const copyKids = (n, c) => { for (const cid of n.children) { const kn = lookup(cid); if (!kn) continue; const kc = visit(kn); c.children.push(kc.id); copyKids(kn, kc); } };
    copyKids(src, c0);
    return c0;
  }
  function forEachNode(page, n, fn) { fn(n); for (const cid of n.children) { const c = page.nodes[cid]; if (c) forEachNode(page, c, fn); } }
  // --- rotation / flip helpers ---
  // Apply a node's local rotation+flip around its center. Returns 4 corners
  // (tl, tr, br, bl) of the node's AABB after rotation, in the SAME coords
  // that x,y were passed in (parent-local or world).
  function rotatedCorners(n, x, y, w, h) {
    const rot = n.rotation || 0;
    const fh = n.flipH ? -1 : 1, fv = n.flipV ? -1 : 1;
    const cx = x + w / 2, cy = y + h / 2;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const pts = [
      [-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2],
    ];
    return pts.map(([px, py]) => {
      // flip first (around local center) then rotate
      const lx = px * fh, ly = py * fv;
      return { x: cx + lx * cos - ly * sin, y: cy + lx * sin + ly * cos };
    });
  }
  // Axis-aligned bounding box that encloses an OBB.
  function obbAabb(corners) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of corners) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }
  // Point-in-OBB test (inverse-transform point into local box coords).
  function pointInObb(n, x, y, w, h, px, py) {
    const rot = n.rotation || 0;
    const fh = n.flipH ? -1 : 1, fv = n.flipV ? -1 : 1;
    const cx = x + w / 2, cy = y + h / 2;
    // translate to center, rotate by -rot, undo flip, then check rect
    const dx = px - cx, dy = py - cy;
    const cos = Math.cos(-rot), sin = Math.sin(-rot);
    const rx = dx * cos - dy * sin;
    const ry = dx * sin + dy * cos;
    const lx = rx * fh, ly = ry * fv;
    return lx >= -w / 2 - 0.5 && lx <= w / 2 + 0.5 && ly >= -h / 2 - 0.5 && ly <= h / 2 + 0.5;
  }

  function boundsOf(page, n) {
    // world (page) bounds incl. children — handles rotation via OBB → AABB.
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const addBox = (bx, by, bw, bh, node) => {
      if (node.rotation || node.flipH || node.flipV) {
        const cs = rotatedCorners(node, bx, by, bw, bh);
        for (const p of cs) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
      } else {
        x0 = Math.min(x0, bx); y0 = Math.min(y0, by); x1 = Math.max(x1, bx + bw); y1 = Math.max(y1, by + bh);
      }
    };
    forEachNode(page, n, c => {
      const w = c._l ? c._l.w : c.w, h = c._l ? c._l.h : c.h;
      const cx = c._l ? c._l.x : c.x, cy = c._l ? c._l.y : c.y;
      addBox(cx, cy, w, h, c);
    });
    if (!isFinite(x0)) { x0 = n.x; y0 = n.y; x1 = n.x + n.w; y1 = n.y + n.h; }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  // ------------------------------------------------------------- history
  function ensureDocShape(doc) {
    if (!doc.components) doc.components = {};
    if (!Array.isArray(doc.comments)) doc.comments = [];
    if (!Array.isArray(doc.versions)) doc.versions = [];
    if (!doc.styles || typeof doc.styles !== 'object') doc.styles = { text: {}, paint: {} };
    if (!doc.styles.text || typeof doc.styles.text !== 'object') doc.styles.text = {};
    if (!doc.styles.paint || typeof doc.styles.paint !== 'object') doc.styles.paint = {};
    if (!Array.isArray(doc.annotations)) doc.annotations = [];
    if (!Array.isArray(doc.libraries)) doc.libraries = [];
    return doc;
  }
  function snapshot(doc) {
    ensureDocShape(doc);
    const raw = JSON.parse(JSON.stringify({ name: doc.name, pages: doc.pages, vars: doc.vars, components: doc.components, comments: doc.comments, versions: doc.versions, styles: doc.styles, annotations: doc.annotations, libraries: doc.libraries }));
    stripTransient(raw);
    return JSON.stringify(raw);
  }
  function restore(doc, snap) {
    const d = JSON.parse(snap);
    doc.name = d.name; doc.pages = d.pages; doc.vars = d.vars;
    doc.components = d.components || {}; doc.comments = d.comments || []; doc.versions = d.versions || [];
    doc.styles = d.styles || { text: {}, paint: {} };
    doc.annotations = d.annotations || [];
    doc.libraries = d.libraries || [];
    for (const p of doc.pages) stampPage(doc, p);
  }
  class History {
    // NOTE: the stacks are _u/_r on purpose — instance properties named
    // undo/redo would shadow the undo()/redo() methods (the original bug
    // that made ⌘Z/⌘Y throw "this.history.undo is not a function"; caught
    // by the P0 acceptance matrix).
    constructor() { this._u = []; this._r = []; }
    _cap(doc) {
      let n = 0;
      try { for (const p of (doc && doc.pages) || []) n += Object.keys(p.nodes || {}).length; } catch (e) {}
      return n > 800 ? 16 : n > 250 ? 32 : 60;
    }
    push(doc) { this._u.push(snapshot(doc)); const cap = this._cap(doc); while (this._u.length > cap) this._u.shift(); this._r = []; }
    undo(doc) { const s = this._u.pop(); if (s == null) return false; this._r.push(snapshot(doc)); restore(doc, s); return true; }
    redo(doc) { const s = this._r.pop(); if (s == null) return false; this._u.push(snapshot(doc)); restore(doc, s); return true; }
    begin(doc) { this._batch = snapshot(doc); this._r = []; }
    end(doc) { if (this._batch != null) { this._u.push(this._batch); this._batch = null; if (this._u.length > 80) this._u.shift(); } }
    cancel() { this._batch = null; }
    clear() { this._u = []; this._r = []; }
    get canUndo() { return this._u.length > 0; }
    get canRedo() { return this._r.length > 0; }
  }

  // ------------------------------------------------------------- persistence
  // Durable storage for files. Primary backend: IndexedDB (multi-MB, no
  // 5 MB cap, async). Fallback: localStorage (only where indexedDB is
  // unavailable — then the old quota limits + loud warning apply).
  //
  // The app always works against the in-memory `list` (synchronous reads).
  // Writes update memory immediately and flush to the durable backend
  // asynchronously (debounced), so a save can never block the editor.
  // `await store.init()` must run before first use; `store.flush()` awaits
  // the pending write (used on exit and by tests).
  const LS_KEY = 'penfig.files.v1';
  const IDB_NAME = 'penfig-files';
  const IDB_VER = 1;
  const IDB_STORE = 'files';
  const TRANSIENT_NODE_KEYS = ['_wt', '_wc', '_w', '_l', '_measured', '_cSize', '_rotLabel', '_cloneMap', '_srcTexts', '_pfid'];

  function stripTransient(value) {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const v of value) stripTransient(v); return; }
    for (const k of TRANSIENT_NODE_KEYS) delete value[k];
    for (const k of Object.keys(value)) {
      const v = value[k];
      if (v && typeof v === 'object') stripTransient(v);
    }
  }

  function cloneForSave(entry) {
    // JSON round-trip drops functions / Maps / undefined and is what IDB
    // can always store. Layout caches are stripped first so a 2 000-node
    // import does not write megabytes of _wt/_wc on every keystroke.
    const copy = {
      id: entry.id,
      name: entry.name,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      pageCount: entry.pageCount,
      thumb: entry.thumb && entry.thumb.length < 400000 ? entry.thumb : '',
      doc: entry.doc,
    };
    try {
      const raw = JSON.parse(JSON.stringify(copy));
      if (raw.doc) stripTransient(raw.doc);
      return raw;
    } catch (e) {
      const fallback = {
        id: entry.id, name: entry.name,
        createdAt: entry.createdAt, updatedAt: entry.updatedAt,
        pageCount: entry.pageCount || 1, thumb: '',
        doc: entry.doc,
      };
      try { return JSON.parse(JSON.stringify(fallback)); }
      catch (e2) { return null; }
    }
  }

  function persistBlocked() {
    try {
      if (typeof window !== 'undefined' && window.origin === 'null') return true;
      const k = '__pf_idb_probe__';
      localStorage.setItem(k, '1');
      localStorage.removeItem(k);
      return false;
    } catch (e) { return true; }
  }

  function _openIDB() {
    return new Promise((resolve) => {
      if (persistBlocked()) return resolve(null);
      const idb = typeof indexedDB !== 'undefined' ? indexedDB : null;
      if (!idb) return resolve(null);
      let req;
      try { req = idb.open(IDB_NAME, IDB_VER); } catch (e) { return resolve(null); }
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => {
        const db = req.result;
        try { db.onversionchange = () => { try { db.close(); } catch (e) { } }; } catch (e) { }
        resolve(db);
      };
    });
  }

  const store = {
    quotaError: false,
    backend: 'memory',
    ready: null,
    _list: [],
    _db: null,
    _flushTimer: 0,
    _flushing: null,
    _warned: false,
    _pendingIds: new Set(),

    _readLS() { try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch (e) { return []; } },
    _toastFull(msg) {
      if (this._warned) { console.warn('penfig: ' + msg); return; }
      this._warned = true;
      console.warn('penfig: ' + msg);
      const App = typeof globalThis !== 'undefined' ? globalThis.App : null;
      if (App && typeof App.toast === 'function') {
        App.toast(msg, 10000, [
          { label: 'Export .fig', fn: () => { try { App.exportBackupFig && App.exportBackupFig(); } catch (e) {} } },
        ]);
      }
    },

    init(force) {
      if (this.ready && !force) return this.ready;
      if (force) { try { if (this._db) this._db.close(); } catch (e) { } this._db = null; this.ready = null; }
      this.ready = (async () => {
        if (persistBlocked()) {
          this.backend = 'memory';
          this.ephemeral = true;
          this._warned = true;
          this._list = [];
          return this;
        }
        this._db = await _openIDB();
        if (this._db) {
          this.backend = 'idb';
          const entries = await this._idbGetAll();
          if (entries.length) this._list = entries;
          else {
            this._list = this._readLS();
            for (const e of this._list) await this._idbPutOne(e);
          }
        } else {
          this.backend = 'ls';
          this._list = this._readLS();
        }
        return this;
      })();
      return this.ready;
    },

    _idbGetAll() {
      return new Promise((resolve) => {
        try {
          const req = this._db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => resolve([]);
        } catch (e) { resolve([]); }
      });
    },
    _idbPutOne(entry) {
      return new Promise((resolve) => {
        const clean = cloneForSave(entry);
        if (!clean || clean.id == null) return resolve(false);
        const attempt = (payload) => {
          try {
            const tx = this._db.transaction(IDB_STORE, 'readwrite');
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
            tx.onabort = () => resolve(false);
            tx.objectStore(IDB_STORE).put(payload);
          } catch (e) { resolve(false); }
        };
        attempt(clean);
      }).then((ok) => {
        if (ok) return true;
        // Retry without thumbnail / version history — those are the usual
        // quota blow-ups after a heavy .fig import.
        const slim = cloneForSave(entry);
        if (!slim) return false;
        slim.thumb = '';
        if (slim.doc) slim.doc.versions = [];
        return new Promise((resolve) => {
          try {
            const tx = this._db.transaction(IDB_STORE, 'readwrite');
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
            tx.onabort = () => resolve(false);
            tx.objectStore(IDB_STORE).put(slim);
          } catch (e) { resolve(false); }
        });
      });
    },
    _idbDelete(id) {
      return new Promise((resolve) => {
        try {
          const tx = this._db.transaction(IDB_STORE, 'readwrite');
          tx.oncomplete = () => resolve(true);
          tx.onerror = () => resolve(false);
          tx.objectStore(IDB_STORE).delete(id);
        } catch (e) { resolve(false); }
      });
    },
    flush() {
      clearTimeout(this._flushTimer);
      if (this.ephemeral || this.backend === 'memory') return Promise.resolve(true);
      if (this.backend !== 'idb' || !this._db) return Promise.resolve(true);
      if (this._flushing) return this._flushing;
      const ids = [...this._pendingIds];
      this._pendingIds.clear();
      this._flushing = (async () => {
        let ok = true;
        if (!ids.length) {
          // nothing queued — treat as success (do NOT rewrite the whole library)
          this._flushing = null;
          return true;
        }
        for (const id of ids) {
          const entry = this._list.find(f => f.id === id);
          if (!entry) { await this._idbDelete(id); continue; }
          const wrote = await this._idbPutOne(entry);
          if (!wrote) ok = false;
        }
        this._flushing = null;
        if (!ok) {
          this.quotaError = true;
          this._toastFull('Could not save this file in the browser. Your work is still open — export a .fig backup.');
        } else {
          this.quotaError = false;
          this._warned = false;
        }
        return ok;
      })();
      return this._flushing;
    },

    all() { return this._list.slice(); },
    save(list) {
      this._list = Array.isArray(list) ? list : [];
      if (this.backend === 'idb') {
        for (const e of this._list) if (e && e.id != null) this._pendingIds.add(e.id);
        clearTimeout(this._flushTimer);
        this._flushTimer = setTimeout(() => { this.flush().catch(() => { }); }, 500);
        return true;
      }
      try {
        const slim = this._list.map(e => cloneForSave(e)).filter(Boolean);
        localStorage.setItem(LS_KEY, JSON.stringify(slim));
        this.quotaError = false;
        return true;
      } catch (e) {
        this.quotaError = true;
        this._toastFull('Browser storage is full. Export a .fig backup and delete old files.');
        return false;
      }
    },
    get(id) { return this._list.find(f => f.id === id) || null; },
    put(entry) {
      if (!entry || entry.id == null) return entry;
      const i = this._list.findIndex(f => f.id === entry.id);
      if (i >= 0) this._list[i] = entry; else this._list.push(entry);
      if (this.backend === 'idb') {
        this._pendingIds.add(entry.id);
        clearTimeout(this._flushTimer);
        this._flushTimer = setTimeout(() => { this.flush().catch(() => { }); }, 500);
        return entry;
      }
      store.save(this._list.slice());
      return entry;
    },
    remove(id) {
      this._list = this._list.filter(f => f.id !== id);
      if (this.backend === 'idb' && this._db) {
        this._idbDelete(id);
        return;
      }
      store.save(this._list.slice());
    },
  };

  // ------------------------------------------------------------- text auto-resize
  // Figma's four text auto-resize modes, as independent per-axis hug/fixed
  // bits: 'auto' = (hug w, hug h) — Figma's default for new text;
  // 'auto-w' = (hug w, fixed h); 'auto-h' = (fixed w, hug h); 'fixed'.
  function textResizeMode(n) {
    return (n && n.text && typeof n.text.resize === 'string') ? n.text.resize : 'fixed';
  }
  // Re-fit n.w / n.h to the content per its resize mode.
  // measure(n, boxW) → { w, h } for the text when wrapped at boxW (0 = no wrap);
  // the caller injects it (browser: Renderer.measureText; tests: a deterministic
  // fake) so this stays pure + headless-testable. Auto-layout items (n.als)
  // keep their item sizing — the layout engine owns their size.
  function applyTextResize(n, measure) {
    if (!n || n.type !== 'text' || !n.text) return;
    if (n.als) return;
    const mode = textResizeMode(n);
    if (mode === 'fixed') return;
    const natural = measure(n, 0);
    if (mode === 'auto') { n.w = natural.w; n.h = natural.h; }
    else if (mode === 'auto-w') { n.w = natural.w; }
    else if (mode === 'auto-h') { n.h = measure(n, n.w).h; }
  }
  // Figma resize muscle memory: dragging a handle on an axis that was
  // hugging fixes that axis (hug,hug + W → fixed,hug; hug,hug + H → hug,fixed;
  // hug,fixed + W → fixed,fixed; fixed,hug + H → fixed,fixed).
  function textResizeDemote(n, axis) {
    if (!n || n.type !== 'text' || !n.text) return;
    const m = textResizeMode(n);
    if (axis === 'h') {
      if (m === 'auto') n.text.resize = 'auto-h';
      else if (m === 'auto-w') n.text.resize = 'fixed';
    } else {
      if (m === 'auto') n.text.resize = 'auto-w';
      else if (m === 'auto-h') n.text.resize = 'fixed';
    }
  }

  function wrapDeg180(d) {
    let x = Number(d);
    if (!isFinite(x)) return 0;
    x = x % 360;
    if (x > 180) x -= 360;
    if (x <= -180) x += 360;
    return x;
  }
  // Figma Design panel: +CCW toward 180°, −CW toward −180°.
  // Internal radians stay canvas-clockwise so ctx.rotate() is unchanged.
  function toFigmaDeg(rad) { return Math.round(wrapDeg180(-(rad || 0) * 180 / Math.PI)); }
  function fromFigmaDeg(deg) { return -wrapDeg180(deg) * Math.PI / 180; }

  // HTML escape utility (used by UI layers; lives here so any module can use it
  // without depending on Dash loading first).
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  global.Model = {
    uid, makeNode, makeAutoLayout, removeAutoLayout, ensureItemDefaults,
    newDoc, newPage, addPage, pageOf, node, kids, stampPage, attach, detach,
    ancestors, zIndexOf, reorder, reorderTo, reorderBy, deepClone, forEachNode, boundsOf,
    rotatedCorners, obbAabb, pointInObb,
    History, snapshot, restore, ensureDocShape, store,
    normHex, hexToRgb, rgbToHex, rgbaCss,
    textResizeMode, applyTextResize, textResizeDemote,
    wrapDeg180, toFigmaDeg, fromFigmaDeg,
    esc,
  };
})(window);
