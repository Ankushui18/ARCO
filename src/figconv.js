/* figconv.js — Figma .fig ⇄ ARCO model conversion.
 *
 * Import:  .fig (zip) → canvas.fig (fig-kiwi) → kiwi JSON (NodeChanges)
 *          → tree → ARCO document.  Uses the schema EMBEDDED in the file,
 *          so older and newer Figma exports both decode (old + new field
 *          names are both handled).
 *
 * Export:  ARCO document → kiwi NodeChanges (Figma's current schema, 550
 *          defs) → fig-kiwi chunks → zip with meta.json + thumbnail + images.
 *          The result is a real .fig file Figma can open: frames, rects,
 *          ellipses, lines, text, auto layout, fills/strokes/effects,
 *          images, and design tokens as VARIABLE_SET / VARIABLE nodes.
 */
(function (global) {
  'use strict';

  const M = global.Model;
  const T = global.Tokens;

  const gid = (n) => n.guid.sessionID + ':' + n.guid.localID;
  const gidOf = (g) => g.sessionID + ':' + g.localID;
  const g = (o, ...keys) => {
    for (const k of keys) { if (o && o[k] != null) return o[k]; }
    return undefined;
  };
  const fcolor = (c) => {
    if (!c) return '#000000';
    const r = c.r != null ? c.r : (c.red != null ? c.red : 0);
    const g = c.g != null ? c.g : (c.green != null ? c.green : 0);
    const b = c.b != null ? c.b : (c.blue != null ? c.blue : 0);
    // Figma stores 0–1 floats. If a channel is > 1 it is already 0–255.
    const to01 = (v) => (v > 1 ? v / 255 : v);
    return M.rgbToHex(to01(r), to01(g), to01(b));
  };

  // ================================================================ IMPORT
  function importFig(bytes, onProgress, parsed) {
    parsed = parsed || global.FigIO.parseFigFile(bytes);
    const msg = parsed.binary.message;
    const blobs = msg.blobs || []; // binary blobs referenced by index (vector paths, …)
    // kiwi decoders omit fields that equal their default (e.g. guid 0:0,
    // phase CREATED) — normalize before building the tree.
    const nodes = (msg.nodeChanges || []).map(n => {
      if (!n.guid) n.guid = { sessionID: 0, localID: 0 };
      if (n.phase === undefined) n.phase = 'CREATED';
      return n;
    }).filter(n => n.phase !== 'REMOVED');
    const byId = new Map();
    const children = new Map();
    for (const n of nodes) byId.set(gid(n), n);
    for (const n of nodes) {
      const pid = n.parentIndex && n.parentIndex.guid ? gidOf(n.parentIndex.guid) : null;
      if (!pid) continue;
      if (!children.has(pid)) children.set(pid, []);
      children.get(pid).push(n);
    }
    const sortKids = (id) => {
      const ks = children.get(id) || [];
      ks.sort(posCmp);
      return ks;
    };

    // images — encode to data URL lazily when a fill actually uses the hash.
    // Eager btoa of every archive image is a large part of "import froze the tab".
    const images = new Map(); // hex hash → {bytesU8, dataURL}
    for (const [name, bytesU8] of parsed.images) {
      images.set(name, { bytesU8, dataURL: null });
    }

    const doc = M.newDoc((parsed.meta && (parsed.meta.file_name || parsed.meta.name)) || 'Imported file');
    const report = { nodes: 0, skipped: {}, images: images.size, pages: 0, tokens: 0, warnings: [] };

    // --- variables / tokens
    const docNode = nodes.find(n => n.type === 'DOCUMENT');
    const docId = docNode ? gid(docNode) : null;
    const varSets = nodes.filter(n => n.type === 'VARIABLE_SET' && n.phase !== 'REMOVED');
    if (varSets.length) {
      doc.vars.sets = [];
      for (const vs of varSets) {
        const set = { id: M.uid('set-'), name: vs.name || 'Set', vars: [] };
        const modeGuidMap = new Map(); // fig GUID string → our mode id
        for (const m of vs.variableSetModes || []) {
          let mode = doc.vars.modes.find(x => x.name === m.name);
          if (!mode) { mode = { id: M.uid('m-'), name: m.name }; doc.vars.modes.push(mode); }
          if (m.id) modeGuidMap.set(gidOf(m.id), mode.id);
        }
        if (!doc.vars.defaultMode || !doc.vars.modes.find(m => m.id === doc.vars.defaultMode)) doc.vars.defaultMode = doc.vars.modes[0].id;
        const kv = sortKids(gid(vs));
        for (const vn of kv) {
          if (vn.type !== 'VARIABLE') continue;
          const dt = vn.variableData && vn.variableData.dataType;
          const type = dt === 'COLOR' ? 'color' : dt === 'FLOAT' ? 'number' : dt === 'BOOLEAN' ? 'boolean' : dt === 'STRING' ? 'string' : 'string';
          const values = {};
          for (const entry of (vn.variableDataValues && vn.variableDataValues.entries) || []) {
            const modeId = entry.modeID ? modeGuidMap.get(gidOf(entry.modeID)) : null;
            const mode = doc.vars.modes.find(mm => mm.id === modeId);
            const mv = kiwiValueToJs(entry.variableData && entry.variableData.value, type);
            if (mode) values[mode.id] = mv;
          }
          if (Object.keys(values).length === 0 && vn.variableData && vn.variableData.value) {
            values[doc.vars.defaultMode] = kiwiValueToJs(vn.variableData.value, type);
          }
          set.vars.push({ id: M.uid('var-'), name: vn.name || 'token', type, values });
          report.tokens++;
        }
        doc.vars.sets.push(set);
      }
      T.rebuildIndex(doc);
    } else if (!doc.vars.modes.length) {
      doc.vars = { modes: [{ id: M.uid('m-'), name: 'Light' }], defaultMode: null, sets: [] };
      doc.vars.defaultMode = doc.vars.modes[0].id;
    }

    // --- pages (CANVAS, SLIDE, and Slides decks via SLIDE_GRID/SLIDE_ROW)
    const roots = docId ? sortKids(docId) : nodes.filter(n => !n.parentIndex);
    let canvasNodes = [];
    const seenPage = new Set();
    const pushPage = (cn) => {
      if (!cn || seenPage.has(gid(cn))) return;
      seenPage.add(gid(cn));
      canvasNodes.push(cn);
    };
    for (const n of roots) {
      if (n.type === 'CANVAS' || n.type === 'SLIDE') pushPage(n);
      else if (n.type === 'SLIDE_GRID') {
        for (const row of sortKids(gid(n))) {
          if (row.type === 'SLIDE_ROW') {
            for (const sl of sortKids(gid(row))) if (sl.type === 'SLIDE') pushPage(sl);
          } else if (row.type === 'SLIDE' || row.type === 'CANVAS') pushPage(row);
        }
      }
    }
    report.rawPages = canvasNodes.length;
    // Only drop Figma's hidden system canvas. Never drop a user page because
    // it looked "empty" — that is why some pages never imported.
    canvasNodes = canvasNodes.filter(cn => {
      const name = (cn.name || '').trim().toLowerCase();
      return name !== 'internal only canvas' && !name.startsWith('internal only');
    });
    if (!canvasNodes.length) {
      const page = M.newPage('Page 1');
      doc.pages = [page];
      for (const n of nodes) if (!n.parentIndex && n.type !== 'DOCUMENT' && n.type !== 'VARIABLE' && n.type !== 'VARIABLE_SET') {
        mapNode(page, doc, null, n, images, report, byId, blobs, sortKids);
      }
      report.pages = 1;
    } else {
      doc.pages = canvasNodes.map(cn => {
        const page = M.newPage(cn.name || 'Page');
        for (const kid of sortKids(gid(cn))) {
          if (kid.type === 'VARIABLE' || kid.type === 'VARIABLE_SET' || kid.type === 'VARIABLE_OVERRIDE') continue;
          mapNode(page, doc, null, kid, images, report, byId, blobs, sortKids);
        }
        report.pages++;
        return page;
      });
    }
    for (const p of doc.pages) {
      M.stampPage(doc, p);
      fixImportedSizes(p);
    }
    // Re-bind imported instances to their components (may be on any page).
    {
      const guidToId = new Map();
      for (const raw of byId.values()) {
        if (raw && raw._pfid && raw.guid) guidToId.set(raw.guid.sessionID + ':' + raw.guid.localID, raw._pfid);
      }
      for (const p of doc.pages) for (const id of Object.keys(p.nodes)) {
        const n = p.nodes[id];
        if (n.type === 'instance' && n._figMainGuid) {
          n.componentId = guidToId.get(n._figMainGuid) || null;
          let t = null;
          if (n.componentId) for (const p2 of doc.pages) { t = p2.nodes[n.componentId]; if (t) break; }
          n.variant = t ? t.name : null;
          delete n._figMainGuid;
        }
      }
    }
    if (report.nodes < 2500) expandEmptyInstances(doc);
    else report.warnings.push('Skipped expanding empty instances (' + report.nodes + ' layers) so the file can open.');
    doc.meta = parsed.meta;
    const imageBytes = collectUsedImageBytes(doc, images);
    return { doc, report, imageBytes };
  }

  function collectUsedImageBytes(doc, images) {
    const used = new Set();
    for (const page of doc.pages) {
      for (const id of Object.keys(page.nodes)) {
        const n = page.nodes[id];
        for (const f of (n && n.fills) || []) {
          if (f && f.type === 'image' && f.hash) used.add(String(f.hash));
        }
      }
    }
    const out = [];
    for (const [name, rec] of images) {
      if (!rec || !rec.bytesU8) continue;
      const key = String(name);
      if (used.has(key) || used.has(key.toLowerCase())) out.push([key, rec.bytesU8]);
    }
    return out;
  }

  // After the tree is built, Figma INSTANCE nodes that shipped without a
  // cloned subtree (common in newer files) stay visually empty. Clone the
  // bound component's children so the canvas actually shows something.
  // Groups / unknown containers often omit size in kiwi. After children
  // exist, hug to their union so the page is not a 1×1 empty box.
  function fixImportedSizes(page) {
    const visit = (id) => {
      const n = page.nodes[id];
      if (!n) return;
      for (const cid of n.children || []) visit(cid);
      if (!n.children || !n.children.length) return;
      if ((n.w > 2 && n.h > 2) && n.type !== 'frame') return;
      if (n.w > 4 && n.h > 4) return;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const cid of n.children) {
        const k = page.nodes[cid];
        if (!k) continue;
        x0 = Math.min(x0, k.x); y0 = Math.min(y0, k.y);
        x1 = Math.max(x1, k.x + (k.w || 0)); y1 = Math.max(y1, k.y + (k.h || 0));
      }
      if (!isFinite(x0)) return;
      const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
      if (n.w <= 4 || n.h <= 4) {
        // Shift children so they stay in local space of the new box.
        for (const cid of n.children) {
          const k = page.nodes[cid];
          if (!k) continue;
          k.x -= x0; k.y -= y0;
        }
        n.x += x0; n.y += y0;
        n.w = w; n.h = h;
      }
    };
    for (const id of page.tops) visit(id);
  }

  function expandEmptyInstances(doc) {
    for (const page of doc.pages) {
      for (const id of Object.keys(page.nodes)) {
        const n = page.nodes[id];
        if (!n || n.type !== 'instance' || !n.componentId) continue;
        if (n.children && n.children.length) continue;
        let src = null, srcPage = null;
        for (const p of doc.pages) {
          const t = p.nodes[n.componentId];
          if (t) { src = t; srcPage = p; break; }
        }
        if (!src) continue;
        n.w = n.w || src.w; n.h = n.h || src.h;
        if ((!n.fills || !n.fills.length) && src.fills && src.fills.length) {
          n.fills = src.fills.map(f => Object.assign({}, f, { stops: f.stops ? f.stops.map(s => Object.assign({}, s)) : undefined }));
        }
        for (const cid of src.children || []) {
          const k = srcPage.nodes[cid];
          if (!k) continue;
          const c = M.deepClone(srcPage, k, true, page);
          M.attach(doc, page, n.id, c);
        }
      }
    }
  }

  function readFigSize(fn) {
    const s = fn.size || {};
    let w = s.x != null ? s.x : (fn.width != null ? fn.width : null);
    let h = s.y != null ? s.y : (fn.height != null ? fn.height : null);
    if ((w == null || !(w > 0)) && fn.vectorData && fn.vectorData.normalizedSize) {
      w = fn.vectorData.normalizedSize.x;
      h = fn.vectorData.normalizedSize.y;
    }
    if ((w == null || !(w > 0)) && fn.textData && fn.textData.layoutSize) {
      w = fn.textData.layoutSize.x;
      h = fn.textData.layoutSize.y;
    }
    return {
      w: (w != null && w > 0) ? w : 1,
      h: (h != null && h > 0) ? h : 1,
    };
  }

  // Convert Figma's 2×3 matrix (maps local origin = top-left) into ARCO's
  // parent-local x/y + center-pivot rotation. The local box's center
  // (hw,hh) must map, under this matrix, to the world center (x+hw,y+hh) —
  // that identity holds regardless of rotation/flip, so x/y is solved
  // directly from the matrix entries rather than reconstructed from a
  // separately-decoded rotation angle (a prior version did that and had a
  // sign error that made every rotated node drift on import).
  function applyFigTransform(n, tr) {
    if (!tr) { n.x = 0; n.y = 0; return; }
    let a = tr.m00 != null ? tr.m00 : 1;
    let b = tr.m01 != null ? tr.m01 : 0;
    let e = tr.m02 != null ? tr.m02 : 0;
    let c = tr.m10 != null ? tr.m10 : 0;
    let d = tr.m11 != null ? tr.m11 : 1;
    let f = tr.m12 != null ? tr.m12 : 0;
    const sx = Math.hypot(a, c) || 1;
    const sy = Math.hypot(b, d) || 1;
    if (Math.abs(sx - 1) > 1e-3) { n.w = Math.max(0.01, (n.w || 1) * sx); a /= sx; c /= sx; }
    if (Math.abs(sy - 1) > 1e-3) { n.h = Math.max(0.01, (n.h || 1) * sy); b /= sy; d /= sy; }
    const hw = (n.w || 0) / 2, hh = (n.h || 0) / 2;
    n.x = a * hw + b * hh + e - hw;
    n.y = c * hw + d * hh + f - hh;
    const det = a * d - b * c;
    if (det < -1e-6) { n.flipH = true; a = -a; c = -c; }
    const rot = Math.atan2(c, a);
    if (Math.abs(rot) > 1e-4) n.rotation = rot;
  }

  // Inverse of applyFigTransform: ARCO node -> Figma transform matrix.
  // Kept as the single source of truth for both directions so a future
  // change to one can't silently drift out of sync with the other (see
  // the position round-trip regression covered by test-fig-transform.js).
  function figTransformFor(n) {
    const rot = n.rotation || 0;
    const fh = n.flipH ? -1 : 1, fv = n.flipV ? -1 : 1;
    const cos = Math.cos(rot), sin = Math.sin(rot);
    const cx = (n.w || 0) / 2, cy = (n.h || 0) / 2;
    return {
      m00: cos * fh, m01: -sin * fv,
      m02: (n.x || 0) + cx - cos * fh * cx + sin * fv * cy,
      m10: sin * fh, m11: cos * fv,
      m12: (n.y || 0) + cy - sin * fh * cx - cos * fv * cy,
    };
  }


  function paintTypeOf(p) {
    const t = p && p.type;
    if (t == null) return '';
    if (typeof t === 'number') {
      return ({ 0: 'SOLID', 1: 'GRADIENT_LINEAR', 2: 'GRADIENT_RADIAL', 3: 'GRADIENT_ANGULAR', 4: 'GRADIENT_DIAMOND', 5: 'IMAGE', 6: 'EMOJI' })[t] || '';
    }
    return String(t).toUpperCase();
  }

  function readFigFills(fn, images, report) {
    const paints = fn.fillPaints || fn.fills || [];
    const fills = paints
      .filter(p => p && p.visible !== false)
      .map(p => mapPaint(p, images, report))
      .filter(Boolean);
    if (fills.length) return fills;
    // Older Figma frames store a single backgroundColor instead of fillPaints.
    const isContainer = fn.type === 'FRAME' || fn.type === 'SECTION' || fn.type === 'COMPONENT' || fn.type === 'SYMBOL' || fn.type === 'INSTANCE' || fn.type === 'COMPONENT_SET';
    if (isContainer && fn.backgroundEnabled !== false && fn.backgroundColor) {
      const a = fn.backgroundOpacity != null ? fn.backgroundOpacity
        : (fn.backgroundColor.a != null ? fn.backgroundColor.a : 1);
      if (a > 0.001) {
        return [{ type: 'solid', color: fcolor(fn.backgroundColor), opacity: a, token: null }];
      }
    }
    return [];
  }

  function readFigStroke(fn, images, report) {
    const paints = fn.strokePaints || fn.strokes || [];
    const sp = paints.find(p => p && p.visible !== false) || paints[0];
    let weight = fn.strokeWeight;
    if (weight == null && fn.strokeWeight == null && sp) weight = 1;
    if (!sp || !(weight > 0)) return null;
    const c = mapPaint(sp, images, report) || {};
    const cap = String(fn.strokeCap || 'NONE').toUpperCase();
    const join = String(fn.strokeJoin || 'MITER').toUpperCase();
    return {
      color: c.color || '#000000',
      opacity: sp.opacity == null ? 1 : sp.opacity,
      width: weight,
      align: String(fn.strokeAlign || 'CENTER').toLowerCase(),
      token: null,
      visible: true,
      cap: cap === 'ROUND' ? 'round' : cap === 'SQUARE' ? 'square' : 'butt',
      join: join === 'ROUND' ? 'round' : join === 'BEVEL' ? 'bevel' : 'miter',
      dash: (fn.dashPattern && fn.dashPattern.length) ? fn.dashPattern.slice() : null,
    };
  }

  function kiwiValueToJs(val, type) {
    if (!val) return type === 'color' ? '#888888' : type === 'number' ? 0 : type === 'boolean' ? false : '';
    if (val.colorValue) return M.rgbToHex(val.colorValue.r || 0, val.colorValue.g || 0, val.colorValue.b || 0);
    if (val.floatValue != null) return val.floatValue;
    if (val.boolValue != null) return val.boolValue;
    if (val.textValue != null) return val.textValue;
    if (val.alias && global.FigIO) return null;
    return null;
  }

  function bytesToB64(u8) {
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < u8.length; i += chunk) bin += String.fromCharCode.apply(null, u8.subarray(i, i + chunk));
    return btoa(bin);
  }

  // Figma sort positions are lexicographic keys — compare by code point
  // (locale collation scrambles punctuation and is locale-dependent).
  function posCmp(a, b) {
    const pa = a.parentIndex && a.parentIndex.position ? a.parentIndex.position : '';
    const pb = b.parentIndex && b.parentIndex.position ? b.parentIndex.position : '';
    return pa < pb ? -1 : pa > pb ? 1 : 0;
  }

  function mapNode(page, doc, parentId, fn, images, report, byId, blobs, sortKids) {
    let type;
    let probedGeo = null; // for unknown types: decoded geometry, if any
    switch (fn.type) {
      case 'FRAME': case 'SECTION': case 'SLIDE': case 'GROUP':
      case 'COMPONENT_SET': case 'BOOLEAN_OPERATION':
      case 'SYMBOL': case 'COMPONENT':
      case 'STICKY': case 'SHAPE_WITH_TEXT': case 'WIDGET': case 'STAMP':
      case 'MEDIA': case 'HIGHLIGHT': case 'SECTION_OVERLAY':
      case 'TABLE': case 'TABLE_CELL': case 'CODE_BLOCK':
      case 'ASSISTED_LAYOUT': case 'INTERACTIVE_SLIDE_ELEMENT':
      case 'WASHI_TAPE': case 'CONNECTOR': case 'MODULE':
        type = 'frame'; break;
      case 'ROUNDED_RECTANGLE': case 'RECTANGLE': type = 'rect'; break;
      case 'INSTANCE': type = 'instance'; break;
      case 'ELLIPSE': type = 'ellipse'; break;
      case 'LINE': type = 'line'; break;
      case 'TEXT': type = 'text'; break;
      case 'VECTOR': case 'STAR': case 'POLYGON': case 'ARC':
      case 'REGULAR_POLYGON': case 'STAR_SHAPE': type = 'vector'; break;
      case 'VARIABLE': case 'VARIABLE_SET': case 'VARIABLE_OVERRIDE': case 'SLICE':
        return null;
      default:
        // Unknown type: keep geometry if we can decode it, otherwise a frame
        // so children are not dropped (that is how pages imported at ~half).
        probedGeo = decodeVectorPath(fn, blobs);
        if (probedGeo) {
          type = 'vector';
        } else {
          report.skipped[fn.type] = (report.skipped[fn.type] || 0) + 1;
          type = 'frame';
        }
    }
    const n = M.makeNode(type);
    n.name = fn.name || n.name;
    const sz = readFigSize(fn);
    n.w = sz.w; n.h = type === 'line' && !(fn.size && fn.size.y > 0) ? Math.max(1, sz.h) : sz.h;
    applyFigTransform(n, fn.transform);
    n.visible = fn.visible !== false;
    if (fn.mask) n.mask = true;
    n.opacity = fn.opacity == null ? 1 : fn.opacity;
    n.blend = (fn.blendMode || 'NORMAL').toLowerCase();
    // constraints (MIN/CENTER/MAX/STRETCH/SCALE) + resizeToFit
    const conMap = { min: 'min', center: 'center', max: 'max', stretch: 'stretch', scale: 'scale' };
    n.constraints = {
      h: conMap[String(fn.horizontalConstraint || 'min').toLowerCase()] || 'min',
      v: conMap[String(fn.verticalConstraint || 'min').toLowerCase()] || 'min',
    };
    if (fn.resizeToFit) n.resizeToFit = true;

    // fills — fillPaints first, then the older frame backgroundColor fallback
    n.fills = readFigFills(fn, images, report);
    // stroke — kiwi omits default strokeWeight (1), so treat missing as 1 when a paint exists
    const stroke = readFigStroke(fn, images, report);
    if (stroke) n.stroke = stroke;
    // radius
    const radii = [
      g(fn, 'rectangleTopLeftCornerRadius', 'rectangleCornerRadii'),
      g(fn, 'rectangleTopRightCornerRadius', 'rectangleCornerRadii'),
      g(fn, 'rectangleBottomRightCornerRadius', 'rectangleCornerRadii'),
      g(fn, 'rectangleBottomLeftCornerRadius', 'rectangleCornerRadii'),
    ];
    if (Array.isArray(fn.rectangleCornerRadii)) {
      n.radius = [fn.rectangleCornerRadii[0] || 0, fn.rectangleCornerRadii[1] || 0, fn.rectangleCornerRadii[2] || 0, fn.rectangleCornerRadii[3] || 0];
    } else if (radii[0] != null || fn.cornerRadius) {
      const u = fn.cornerRadius || 0;
      n.radius = [
        radii[0] != null ? radii[0] : u,
        radii[1] != null ? radii[1] : u,
        radii[2] != null ? radii[2] : u,
        radii[3] != null ? radii[3] : u,
      ];
    }
    if (fn.cornerSmoothing != null) n.cornerSmooth = Math.max(0, Math.min(1, +fn.cornerSmoothing || 0));
    // effects
    n.shadows = (fn.effects || []).filter(e => e.type === 'DROP_SHADOW' && e.visible !== false).map(e => ({
      color: fcolor(e.color), opacity: (e.color ? e.color.a : 1), x: (e.offset && e.offset.x) || 0, y: (e.offset && e.offset.y) || 0,
      blur: e.radius || 0, spread: e.spread || 0, visible: true,
    }));
    const fgBlur = (fn.effects || []).find(e => e.type === 'FOREGROUND_BLUR' && e.visible !== false);
    if (fgBlur) n.blur = fgBlur.radius || 0;

    // vector geometry (real paths, not placeholders)
    if (type === 'vector') {
      const geo = probedGeo || decodeVectorPath(fn, blobs);
      if (geo) {
        n.path = geo.d;
        n.windingRule = geo.windingRule;
      } else if (!probedGeo) {
        report.warnings.push((fn.name || fn.type) + ' (' + fn.type + ') has no decodable path data');
      }
    }

    // auto layout (new + old field names)
    const sm = g(fn, 'stackMode');
    if (sm === 'HORIZONTAL' || sm === 'VERTICAL' || (fn.layoutMode === 'HORIZONTAL' || fn.layoutMode === 'VERTICAL')) {
      n.al = {
        dir: (sm || fn.layoutMode) === 'HORIZONTAL' ? 'h' : 'v',
        wrap: g(fn, 'stackWrap') === 'WRAP' || g(fn, 'layoutWrap') === 'WRAP',
        gap: tok0(g(fn, 'stackSpacing', 'itemSpacing', 'layoutSpacing')),
        gapCross: tok0(g(fn, 'stackCounterSpacing', 'counterAxisSpacing')),
        main: mapAlign(g(fn, 'stackJustify', 'stackPrimaryAxisAlignItems', 'layoutAlignItems'), 'MIN'),
        cross: mapAlign(g(fn, 'stackCounterAlign', 'stackCounterAxisAlignItems', 'layoutCounterAlignItems'), 'MIN'),
        reverse: !!fn.stackReverseZIndex,
      };
      // paddings
      const pl = g(fn, 'paddingLeft', 'stackPaddingLeft');
      const pr = g(fn, 'paddingRight', 'stackPaddingRight');
      const pt = g(fn, 'paddingTop', 'stackPaddingTop');
      const pb = g(fn, 'paddingBottom', 'stackPaddingBottom');
      const hpad = g(fn, 'stackHorizontalPadding');
      const vpad = g(fn, 'stackVerticalPadding');
      const base = g(fn, 'stackPadding', 'layoutPadding');
      if (pl != null || pr != null || pt != null || pb != null) {
        n.al.pad = [tok0(pt), tok0(pr), tok0(pb), tok0(pl)];
      } else if (hpad != null || vpad != null) {
        const l2 = hpad != null ? hpad : (base != null ? base : 0);
        const r2 = hpad != null ? hpad + (g(fn, 'stackPaddingRight') || 0) : (base != null ? base : 0);
        n.al.pad = [tok0(vpad), tok0(r2), tok0(vpad != null ? vpad + (g(fn, 'stackPaddingBottom') || 0) : (g(fn, 'stackPaddingBottom') || 0)), tok0(l2)];
      } else if (base != null) {
        n.al.pad = [tok0(base), tok0(base), tok0(base), tok0(base)];
      }
    }
    // item props
    const sps = g(fn, 'stackPrimarySizing', 'stackChildPrimarySizing');
    const scs = g(fn, 'stackCounterSizing', 'stackChildCrossSizing');
    const grow = g(fn, 'stackChildPrimaryGrow') || 0;
    if (sps || scs || grow || g(fn, 'stackPositioning') === 'ABSOLUTE' || g(fn, 'stackChildAlignSelf')) {
      n.als = {
        w: mapSizing(g(fn, 'stackChildPrimarySizing', 'stackPrimarySizing'), grow, n.x),
        h: mapSizing(g(fn, 'stackChildCrossSizing', 'stackCounterSizing'), 0, n.y),
        grow: grow || 0,
        align: mapAlignSelf(g(fn, 'stackChildAlignSelf')),
        absolute: g(fn, 'stackPositioning') === 'ABSOLUTE' || g(fn, 'stackPositioning') === 'ABSOLUTE_POSITION',
      };
      if (n.type === 'frame' && n.als.w === 'fixed' && n.als.h === 'fixed') { /* keep */ }
    }
    // min/max
    if (fn.minSize && fn.minSize.x != null) n.minW = fn.minSize.x;
    if (fn.minSize && fn.minSize.y != null) n.minH = fn.minSize.y;
    if (fn.maxSize && fn.maxSize.x != null) n.maxW = fn.maxSize.x;
    if (fn.maxSize && fn.maxSize.y != null) n.maxH = fn.maxSize.y;

    if (type === 'text') {
      const td = fn.textData || {};
      const st0 = (td.styleOverrideTable && td.styleOverrideTable[0]) || {};
      const fontName = fn.fontName || st0.fontName || ((td.fontMetaData && td.fontMetaData[0] && td.fontMetaData[0].key) || {});
      const fontSize = fn.fontSize != null ? fn.fontSize : (st0.fontSize != null ? st0.fontSize : 14);
      const fontStyle = (fontName && fontName.style) || '';
      const meta = (td.fontMetaData || []).find(m => m && m.key && fontName.family && m.key.family === fontName.family) || (td.fontMetaData && td.fontMetaData[0]);
      const stFills = st0.fillPaints || st0.fills;
      if ((!n.fills || !n.fills.length) && stFills && stFills.length) {
        n.fills = stFills.filter(p => p && p.visible !== false).map(p => mapPaint(p, images, report)).filter(Boolean);
      }
      n.text = {
        content: td.characters != null ? td.characters : 'Text',
        font: (fontName && fontName.family) || 'Inter',
        size: fontSize || 14,
        weight: parseWeight(fontStyle, (meta && meta.fontWeight) || fn.fontWeight || st0.fontWeight),
        italic: /italic/i.test(fontStyle),
        lineHeight: numToMul(fn.lineHeight || st0.lineHeight, fontSize || 14),
        letterSpacing: ((fn.letterSpacing && fn.letterSpacing.value) != null ? fn.letterSpacing.value : (st0.letterSpacing && st0.letterSpacing.value)) || 0,
        align: (fn.textAlignHorizontal || st0.textAlignHorizontal || 'LEFT').toLowerCase(),
        valign: (fn.textAlignVertical || st0.textAlignVertical || 'TOP').toLowerCase(),
        token: null,
      };
      const runs = figTextRuns(td, fn, st0, images, report);
      if (runs && runs.length > 1) n.text.runs = runs;
      const autoResize = fn.textAutoResize;
      // free text keeps its auto-resize mode in text.resize; auto-layout
      // items keep their item sizing (from stackChild sizing above). The
      // .fig enum has no WIDTH-only mode, so Figma's "auto width" text
      // imports as 'fixed' (documented deviation).
      n.text.resize = autoResize === 'WIDTH_AND_HEIGHT' ? 'auto' : autoResize === 'HEIGHT' ? 'auto-h' : 'fixed';
      const deco = (fn.textDecoration || '').toString().toLowerCase();
      n.text.underline = deco.includes('underline') || !!fn.underline;
      n.text.strike = deco.includes('strikethrough') || deco.includes('strike') || !!fn.strikethrough;
      const tc = (fn.textCase || fn.textTransform || 'ORIGINAL').toString().toUpperCase();
      n.text.textCase = tc === 'UPPER' ? 'upper' : tc === 'LOWER' ? 'lower' : tc === 'TITLE' || tc === 'SMALL_CAPS' ? (tc === 'SMALL_CAPS' ? 'small-caps' : 'title') : 'none';
      const ls = fn.listStyle || fn.textListOptions || null;
      n.text.list = (ls === 'UNORDERED' || ls === 'BULLET' || (ls && ls.type === 'UNORDERED')) ? 'bullet'
        : (ls === 'ORDERED' || ls === 'NUMBERED' || (ls && ls.type === 'ORDERED')) ? 'number' : 'none';
      n.text.paragraphSpacing = (fn.paragraphSpacing && (fn.paragraphSpacing.value != null ? fn.paragraphSpacing.value : fn.paragraphSpacing)) || 0;
      n.text.paragraphIndent = (fn.paragraphIndent && (fn.paragraphIndent.value != null ? fn.paragraphIndent.value : fn.paragraphIndent)) || 0;
      n.text.truncate = !!(fn.textTruncation || fn.truncate);
      n.text.maxLines = fn.maxLines || 1;
      if (n.als) {
        if (autoResize === 'WIDTH_AND_HEIGHT') { n.als.w = 'hug'; n.als.h = 'hug'; }
        else if (autoResize === 'HEIGHT') { n.als.h = 'hug'; n.als.w = 'fixed'; }
      }
      // text color from fills
      const tf = n.fills[0];
      if (tf && tf.type === 'solid') n.fills[0] = tf;
    }

    if (fn.type === 'GROUP' || fn.type === 'BOOLEAN_OPERATION' || fn.type === 'COMPONENT_SET') n.clips = false;
    if (fn.frameMaskDisabled) n.clips = false;
    if (fn.type === 'SECTION') n.section = true;
    if (fn.type === 'COMPONENT' || fn.type === 'SYMBOL') {
      n.isComponent = true;
      M.ensureDocShape(doc);
      // Each imported COMPONENT becomes a component set entry keyed by its
      // own id (main = self). Variant frames imported from Figma therefore
      // round-trip as their own sets — the variant grid is a documented
      // simplification, the source→instance binding is preserved.
      doc.components[n.id] = doc.components[n.id] || { id: n.id, name: n.name, main: n.id, variants: {} };
      doc.components[n.id].variants[n.name] = n.id;
    }
    if (fn.type === 'INSTANCE') {
      const sid = fn.overriddenSymbolID
        || (fn.symbolData && (fn.symbolData.symbolID || fn.symbolData.guid))
        || (fn.derivedSymbolData && (fn.derivedSymbolData.symbolID || fn.derivedSymbolData.guid));
      if (sid && sid.sessionID != null) n._figMainGuid = sid.sessionID + ':' + sid.localID;
    }
    M.attach(doc, page, parentId, n);
    report.nodes++;
    const rawRef = byId.get(gid(fn));
    if (rawRef) rawRef._pfid = n.id; // guid → arco id (for instance rebinding)
    // children — O(k) via the prebuilt map. The old getKids scanned every
    // node for every parent (O(n²)) and froze real files.
    const subKids = sortKids ? sortKids(gid(fn)) : [];
    for (const k of subKids) {
      if (k.type === 'VARIABLE' || k.type === 'VARIABLE_SET' || k.type === 'VARIABLE_OVERRIDE') continue;
      mapNode(page, doc, n.id, k, images, report, byId, blobs, sortKids);
    }
    return n;
  }

  function figTextRuns(td, fn, st0, images, report) {
    const chars = td && td.characters;
    const ids = td && td.characterStyleIDs;
    const table = (td && td.styleOverrideTable) || [];
    if (!chars || !ids || !ids.length || !table.length) return null;
    const styleOf = (id) => table[id] || st0 || fn;
    const runStyle = (st) => {
      const fontName = (st && st.fontName) || fn.fontName || {};
      const fill = ((st && (st.fillPaints || st.fills)) || [])[0];
      const paint = fill ? mapPaint(fill, images, report) : null;
      return {
        font: fontName.family,
        weight: parseWeight(fontName.style, st && st.fontWeight),
        size: st && st.fontSize,
        italic: /italic/i.test(fontName.style || ''),
        color: paint && paint.type === 'solid' ? paint.color : undefined,
        underline: st && String(st.textDecoration || '').toUpperCase().includes('UNDERLINE'),
        strike: st && String(st.textDecoration || '').toUpperCase().includes('STRIKE'),
      };
    };
    const runs = [];
    let i = 0;
    while (i < chars.length) {
      const id = ids[i] || 0;
      let j = i + 1;
      while (j < chars.length && (ids[j] || 0) === id) j++;
      const st = styleOf(id);
      const r = runStyle(st);
      r.text = chars.slice(i, j);
      runs.push(r);
      i = j;
    }
    return runs;
  }
  const tok0 = (v) => ({ n: typeof v === 'number' ? v : 0, tok: null });
  function mapAlign(v, def) {
    if (!v) return def === 'MIN' ? 'start' : 'start';
    switch (v) {
      case 'MIN': return 'start';
      case 'CENTER': return 'center';
      case 'MAX': return 'end';
      case 'SPACE_BETWEEN': return 'space-between';
      case 'SPACE_EVENLY': return 'space-evenly';
      default: return 'start';
    }
  }
  function mapAlignSelf(v) {
    switch (v) {
      case 'MIN': return 'start';
      case 'CENTER': return 'center';
      case 'MAX': return 'end';
      case 'STRETCH': return 'stretch';
      default: return 'auto';
    }
  }
  function mapSizing(v, grow, axisVal) {
    if (v === 'FIXED') return 'fixed';
    if (v === 'HUG' || v === 'RESIZE_TO_FIT' || v === 'RESIZE_TO_FIT_WITH_IMPLICIT_SIZE') return 'hug';
    if (v === 'FILL' || grow > 0) return 'fill';
    return 'fixed';
  }
  function numToMul(numObj, fontSize) {
    if (!numObj) return 1.2;
    const v = numObj.value;
    if (numObj.units === 'PIXELS') return v / (fontSize || 14);
    if (numObj.units === 'PERCENT') return v / 100;
    return v || 1.2;
  }
  function parseWeight(style, fontWeight) {
    if (fontWeight) return fontWeight;
    const s = (style || '').toLowerCase();
    if (s.includes('extrabold') || s.includes('extra bold')) return 800;
    if (s.includes('semibold') || s.includes('semi bold')) return 600;
    if (s.includes('extralight')) return 200;
    if (s.includes('light')) return 300;
    if (s.includes('medium')) return 500;
    if (s.includes('bold')) return 700;
    if (s.includes('thin')) return 100;
    return 400;
  }
  function lookupImage(images, hash) {
    if (!hash || !images) return null;
    let im = images.get(hash);
    if (!im) im = images.get(String(hash).toLowerCase());
    if (!im) return null;
    return im;
  }
  function paintHash(p) {
    const h = p && p.image && p.image.hash;
    if (!h) return null;
    if (typeof h === 'string') return h;
    if (h instanceof Uint8Array || ArrayBuffer.isView(h)) return u8ToHex(h);
    if (Array.isArray(h)) return u8ToHex(h);
    if (h.bytes) return u8ToHex(h.bytes);
    return null;
  }
  function mapPaint(p, images, report) {
    const kind = paintTypeOf(p);
    if (kind === 'SOLID') {
      return { type: 'solid', color: fcolor(p.color), opacity: p.opacity == null ? 1 : p.opacity, token: null };
    }
    if (kind === 'IMAGE') {
      const hash = paintHash(p);
      const im = lookupImage(images, hash);
      if (!im && hash) report.warnings.push('image hash ' + hash + ' not found in archive');
      return { type: 'image', src: (im && im.dataURL) || null, scaleMode: String(p.imageScaleMode || 'FILL').toLowerCase(), opacity: p.opacity == null ? 1 : p.opacity, hash, token: null };
    }
    if (kind === 'GRADIENT_LINEAR' || kind === 'GRADIENT_RADIAL' || kind === 'GRADIENT_ANGULAR' || kind === 'GRADIENT_DIAMOND') {
      const stops = (p.stops || p.gradientStops || []).map(s => ({
        color: fcolor(s.color),
        opacity: s.color && s.color.a != null ? s.color.a : 1,
        pos: s.position != null ? s.position : (s.pos != null ? s.pos : 0),
        token: null,
      }));
      return {
        type: kind === 'GRADIENT_RADIAL' ? 'radial' : 'linear',
        from: { x: 0, y: 0 }, to: { x: 1, y: kind === 'GRADIENT_LINEAR' ? 0 : 1 },
        stops: stops.length ? stops : [{ color: '#ffffff', opacity: 1, pos: 0 }, { color: '#000000', opacity: 1, pos: 1 }],
        opacity: p.opacity == null ? 1 : p.opacity, token: null,
      };
    }
    if (p && p.color) {
      return { type: 'solid', color: fcolor(p.color), opacity: p.opacity == null ? 1 : p.opacity, token: null };
    }
    return { type: 'solid', color: '#cccccc', opacity: 1, token: null };
  }
  function u8ToHex(u8) {
    if (!u8) return '';
    const arr = u8 instanceof Uint8Array ? u8 : Uint8Array.from(u8);
    return Array.from(arr.slice(0, 20)).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // Decode a node's vector geometry from its blob references into an SVG `d`
  // string. A vector may be made of several fillGeometry parts (each with its
  // own commandsBlob); we concatenate them so multi-part icons stay whole.
  // Falls back to the editable vectorNetwork blob when no commands exist.
  function decodeVectorPath(fn, blobs) {
    const F = global.FigIO;
    if (!F || !blobs) return null;
    const blobAt = (idx) => { const b = blobs[idx]; return b && b.bytes ? b.bytes : null; };
    let d = null;
    let windingRule = 'nonzero';
    const geos = [].concat(fn.fillGeometry || [], fn.strokeGeometry || []);
    for (const geo of geos) {
      const bytes = geo.commandsBlob != null ? blobAt(geo.commandsBlob) : null;
      if (!bytes) continue;
      const part = F.commandsBlobToPath(bytes);
      if (!part) continue;
      d = d ? d + ' ' + part : part;
      if (geo.windingRule === 'ODD' || geo.windingRule === 'EVENODD') windingRule = 'evenodd';
    }
    if (!d && fn.vectorData && fn.vectorData.vectorNetworkBlob != null) {
      const bytes = blobAt(fn.vectorData.vectorNetworkBlob);
      if (bytes) d = F.vectorNetworkBlobToPath(bytes);
    }
    return d ? { d, windingRule } : null;
  }

  // ================================================================ EXPORT
  let _exportCounter = 0;
  function exportFig(doc, opts = {}) {
    _exportCounter = 0;
    const next = () => ({ sessionID: 1, localID: ++_exportCounter });
    const out = [];
    // binary blobs (vector paths) referenced by numeric index
    const blobList = [];
    const addBlob = (u8) => { blobList.push({ bytes: u8 }); return blobList.length - 1; };
    const ctx = { addBlob, blobList };
    const docGuid = { sessionID: 0, localID: 0 };
    out.push({ guid: docGuid, phase: 'CREATED', type: 'DOCUMENT', name: 'Document' });
    const docVars = { modes: [], setGuids: [] };
    const pageGuids = [];

    // Pre-pass: node id → export guid, in exactly the order the emit below
    // assigns them (modes, sets, vars, pages, then tops depth-first), so an
    // INSTANCE can bind to its COMPONENT even when it precedes the component
    // in tree order.
    const guidOf = new Map();
    {
      let pre = 0;
      const pnext = () => ({ sessionID: 1, localID: ++pre });
      doc.vars.modes.forEach(() => pnext());
      for (const set of doc.vars.sets) { pnext(); for (const v of set.vars) pnext(); }
      doc.pages.forEach(() => pnext());
      const walk = (page, ids) => {
        for (const id of ids) {
          const n = page.nodes[id];
          if (!n) continue;
          guidOf.set(id, pnext());
          if (n.children.length) walk(page, n.children);
        }
      };
      for (const page of doc.pages) walk(page, page.tops);
    }

    // variables
    const modeGuids = {};
    doc.vars.modes.forEach((m, i) => { modeGuids[m.id] = next(); });
    for (const set of doc.vars.sets) {
      const sg = next();
      docVars.setGuids.push(sg);
      out.push({
        guid: sg, phase: 'CREATED', type: 'VARIABLE_SET', name: set.name,
        parentIndex: { guid: docGuid, position: String(docVars.setGuids.length).padStart(6, '0') },
        variableSetModes: doc.vars.modes.map(m => ({ id: modeGuids[m.id], name: m.name })),
      });
      let vi = 0;
      for (const v of set.vars) {
        const vg = next();
        const entries = doc.vars.modes.map(m => ({
          modeID: modeGuids[m.id],
          variableData: {
            dataType: figVarType(v.type),
            resolvedDataType: figVarType(v.type),
            value: jsValueToKiwi(v, m.id, doc),
          },
        }));
        out.push({
          guid: vg, phase: 'CREATED', type: 'VARIABLE', name: v.name,
          parentIndex: { guid: sg, position: String(vi).padStart(6, '0') },
          variableData: entries[0].variableData,
          variableDataValues: { entries },
        });
        vi++;
      }
    }

    // pages + nodes
    doc.pages.forEach((page, pi) => {
      const pg = next();
      pageGuids.push(pg);
      out.push({
        guid: pg, phase: 'CREATED', type: 'CANVAS', name: page.name,
        parentIndex: { guid: docGuid, position: String(pi).padStart(6, '0') },
      });
      emitTree(page, null, page.tops, out, pg, next, doc, docVars, ctx, guidOf);
    });

    // images
    const images = [];
    for (const page of doc.pages) for (const n of Object.values(page.nodes)) {
      for (const f of n.fills || []) {
        if (f.type === 'image' && f.src) {
          if (!f.hash) {
            let h = 2166136261;
            const s = f.src.slice(0, 4096);
            for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
            f.hash = ('00000000' + (h >>> 0).toString(16)).slice(-8) + '000000000000000000000000';
          }
          const b64 = f.src.split(',')[1];
          if (b64) images.push([f.hash, b64]);
        }
      }
    }
    const unique = new Map();
    for (const [h, b] of images) if (!unique.has(h)) unique.set(h, b);

    const message = {
      type: 'NODE_CHANGES', sessionID: 0, ackID: 0,
      nodeChanges: out,
      blobs: blobList,
    };
    const bytes = global.FigIO.writeFig({
      message,
      meta: { file_name: doc.name, last_editor: 'ARCO', version: 0 },
      thumbnail: opts.thumbnail ? u8FromB64(opts.thumbnail.split(',')[1]) : null,
      images: [...unique.entries()].map(([h, b]) => [h, u8FromB64(b)]),
      version: 101,
    });
    return bytes;
  }

  function emitTree(page, parentGuid, ids, out, topGuid, next, doc, docVars, ctx, guidOf) {
    let i = 0;
    for (const id of ids) {
      const n = page.nodes[id];
      if (!n) continue;
      const guid = next();
      const node = exportNode(page, n, parentGuid || topGuid, guid, next, doc, ctx, guidOf);
      node.parentIndex = { guid: parentGuid || topGuid, position: String(i).padStart(6, '0') };
      out.push(node);
      i++;
      if (n.children.length) emitTree(page, guid, n.children, out, topGuid, next, doc, docVars, ctx, guidOf);
    }
  }

  function exportNode(page, n, parentGuid, guid, next, doc, ctx, guidOf) {
    const out = { guid, phase: 'CREATED', name: n.name };
    const typeMap = { frame: 'FRAME', rect: 'RECTANGLE', ellipse: 'ELLIPSE', line: 'LINE', text: 'TEXT', vector: 'VECTOR', instance: 'INSTANCE' };
    // This oarco v101 schema has no COMPONENT NodeType — component masters
    // are the legacy SYMBOL type (which is also why the instance→master
    // reference field is overriddenSymbolID, not mainComponentGuid).
    out.type = (n.type === 'frame' && n.isComponent) ? 'SYMBOL' : (typeMap[n.type] || 'FRAME');
    out.size = { x: n.w, y: n.h };
    out.transform = figTransformFor(n);
    out.visible = n.visible;
    out.opacity = n.opacity;
    out.blendMode = (n.blend || 'normal').toUpperCase();
    const conUp = { min: 'MIN', center: 'CENTER', max: 'MAX', stretch: 'STRETCH', scale: 'SCALE' };
    if (n.constraints) {
      out.horizontalConstraint = conUp[n.constraints.h] || 'MIN';
      out.verticalConstraint = conUp[n.constraints.v] || 'MIN';
    }
    if (n.resizeToFit) out.resizeToFit = true;
    out.fillPaints = (n.fills || []).map(figPaint);
    if (n.stroke && n.stroke.visible && n.stroke.width > 0) {
      out.strokePaints = [figPaint({ type: 'solid', color: n.stroke.color, opacity: n.stroke.opacity })];
      out.strokeWeight = n.stroke.width;
      out.strokeAlign = (n.stroke.align || 'inside').toUpperCase();
    }
    // Figma's v101 renderer expects editable shape paints to reference binary
    // geometry. Layer structure and Fill values can still appear in the UI
    // without it, but the canvas imports blank (the exact failure caught by
    // test-fig-starter-roundtrip.js). Emit a local-space outline for every
    // paintable primitive, not only custom VECTOR nodes.
    if (ctx && global.FigIO && ['frame', 'instance', 'rect', 'ellipse'].includes(n.type)) {
      try {
        const w = Math.max(0.01, n.w || 0.01), h = Math.max(0.01, n.h || 0.01);
        let d;
        if (n.type === 'ellipse') {
          const k = 0.5522847498307936, cx = w / 2, cy = h / 2, ox = cx * k, oy = cy * k;
          d = `M ${cx} 0 C ${cx + ox} 0 ${w} ${cy - oy} ${w} ${cy} C ${w} ${cy + oy} ${cx + ox} ${h} ${cx} ${h} C ${cx - ox} ${h} 0 ${cy + oy} 0 ${cy} C 0 ${cy - oy} ${cx - ox} 0 ${cx} 0 Z`;
        } else {
          d = `M 0 0 L ${w} 0 L ${w} ${h} L 0 ${h} Z`;
        }
        const commands = global.FigIO.pathToCommandsBlob(d);
        if (commands && commands.length) {
          const blob = ctx.addBlob(commands);
          if (out.fillPaints.length) out.fillGeometry = [{ windingRule: 'NONZERO', commandsBlob: blob, styleID: 0 }];
          if (out.strokePaints && out.strokePaints.length) out.strokeGeometry = [{ windingRule: 'NONZERO', commandsBlob: blob, styleID: 0 }];
        }
      } catch (e) { /* keep export alive; round-trip test catches regressions */ }
    }
    if (n.type === 'vector' && n.path && ctx && global.FigIO) {
      try {
        const cmd = global.FigIO.pathToCommandsBlob(n.path);
        if (cmd && cmd.length) {
          out.fillGeometry = [{ windingRule: n.windingRule === 'evenodd' ? 'ODD' : 'NONZERO', commandsBlob: ctx.addBlob(cmd) }];
        }
        const vnet = global.FigIO.pathToVectorNetworkBlob(n.path, n.windingRule === 'evenodd');
        if (vnet && vnet.length) {
          out.vectorData = { vectorNetworkBlob: ctx.addBlob(vnet), normalizedSize: { x: n.w || 1, y: n.h || 1 } };
        }
      } catch (e) { /* unencodable path: vector exported without geometry */ }
    }
    if (n.type === 'instance' && n.componentId && guidOf) {
      // Bind the instance to its component. The v101 oarco schema has no
      // mainComponentGuid field, so the binding is carried in the legacy
      // overriddenSymbolID GUID (documented deviation): our importer re-binds
      // it; real Figma keeps the cloned subtree (visual parity) but sees the
      // instance as detached. Variant instances bind the variant frame.
      let srcId = n.componentId;
      const c = doc.components && doc.components[n.componentId];
      if (c && n.variant && c.variants[n.variant]) srcId = c.variants[n.variant];
      const cg = guidOf.get(srcId);
      if (cg) out.overriddenSymbolID = cg;
    }
    if (n.type === 'rect' || n.type === 'frame' || n.type === 'instance') {
      const r = n.radius;
      if (r.every(v => v === r[0]) && r[0] > 0) out.cornerRadius = r[0];
      if (n.cornerSmooth) out.cornerSmoothing = n.cornerSmooth;
      else if (r.some(v => v > 0)) {
        out.rectangleTopLeftCornerRadius = r[0];
        out.rectangleTopRightCornerRadius = r[1];
        out.rectangleBottomLeftCornerRadius = r[3];
        out.rectangleBottomRightCornerRadius = r[2];
        out.rectangleCornerRadiiIndependent = true;
      }
    }
    for (const s of n.shadows || []) {
      if (s.visible) out.effects = out.effects || [];
      if (s.visible) out.effects.push({
        type: 'DROP_SHADOW', color: { ...M.hexToRgb(s.color), a: s.opacity == null ? 1 : s.opacity },
        offset: { x: s.x, y: s.y }, radius: s.blur, spread: s.spread || 0, visible: true,
      });
    }
    if (n.type === 'frame' && n.fills.length) out.backgroundEnabled = true;

    if (n.al) {
      out.stackMode = n.al.dir === 'h' ? 'HORIZONTAL' : 'VERTICAL';
      out.stackSpacing = n.al.gap.n;
      const p = n.al.pad.map(t => t.n);
      const base = Math.min(...p);
      out.stackPadding = base;
      const horiz = n.al.dir === 'h';
      // horizontal padding → left/right; vertical → top/bottom
      const [t, r, b, l] = p;
      if (horiz) {
        out.stackHorizontalPadding = l;
        out.stackPaddingRight = Math.max(0, r - l);
        out.stackVerticalPadding = t;
        out.stackPaddingBottom = Math.max(0, b - t);
      } else {
        out.stackVerticalPadding = t;
        out.stackPaddingBottom = Math.max(0, b - t);
        out.stackHorizontalPadding = l;
        out.stackPaddingRight = Math.max(0, r - l);
      }
      out.stackJustify = { start: 'MIN', center: 'CENTER', end: 'MAX', 'space-between': 'SPACE_BETWEEN', 'space-evenly': 'SPACE_EVENLY' }[n.al.main] || 'MIN';
      out.stackCounterAlign = { start: 'MIN', center: 'CENTER', end: 'MAX', stretch: 'STRETCH' }[n.al.cross] || 'MIN';
      if (n.al.wrap) out.stackWrap = 'WRAP';
      if (n.al.gapCross && n.al.gapCross.n > 0) out.stackCounterSpacing = n.al.gapCross.n;
      // Container sizing and child sizing are different fields in Figma.
      // Missing these made fixed frames reopen as Hug and recompute height.
      const ownW = n.als && n.als.w ? n.als.w : 'fixed';
      const ownH = n.als && n.als.h ? n.als.h : 'fixed';
      const ownPrimary = n.al.dir === 'h' ? ownW : ownH;
      const ownCounter = n.al.dir === 'h' ? ownH : ownW;
      const figOwnSize = (mode) => mode === 'hug' ? 'RESIZE_TO_FIT' : 'FIXED';
      out.stackPrimarySizing = figOwnSize(ownPrimary);
      out.stackCounterSizing = figOwnSize(ownCounter);
    }
    if (n.als) {
      const parent = n.parent && page.nodes[n.parent];
      const pdir = parent && parent.al ? parent.al.dir : 'h';
      const primary = pdir === 'h' ? n.als.w : n.als.h;
      const counter = pdir === 'h' ? n.als.h : n.als.w;
      const figChildSize = (mode) => mode === 'hug' ? 'RESIZE_TO_FIT' : 'FIXED';
      if (n.type !== 'text') {
        out.stackChildPrimarySizing = figChildSize(primary);
        out.stackChildCrossSizing = figChildSize(counter);
      }
      if (primary === 'fill' || n.als.grow > 0) {
        out.stackChildPrimaryGrow = n.als.grow > 0 ? n.als.grow : 1;
      }
      if (n.als.absolute) out.stackPositioning = 'ABSOLUTE';
      if (counter === 'fill') out.stackChildAlignSelf = 'STRETCH';
      else if (n.als.align && n.als.align !== 'auto') out.stackChildAlignSelf = { start: 'MIN', center: 'CENTER', end: 'MAX', stretch: 'STRETCH' }[n.als.align] || 'MIN';
    }
    if (n.minW) out.minSize = { value: { x: n.minW, y: n.minH || 0 } };
    if (n.maxW) out.maxSize = { value: { x: n.maxW, y: n.maxH || 0 } };

    if (n.type === 'text' && n.text) {
      out.fontSize = n.text.size;
      out.fontName = { family: n.text.font || 'Inter', style: weightName(n.text.weight, n.text.italic), postscript: (n.text.font || 'Inter').replace(/\s+/g, '') + '-' + weightName(n.text.weight, n.text.italic) };
      const lh = n.text.lineHeight || 1.2;
      out.lineHeight = { value: lh * (n.text.size || 14), units: 'PIXELS' };
      out.letterSpacing = { value: n.text.letterSpacing || 0, units: 'PIXELS' };
      out.textAlignHorizontal = (n.text.align || 'left').toUpperCase();
      out.textData = { characters: n.text.content || '', layoutSize: { x: n.w, y: n.h } };
      // .fig enum: NONE | WIDTH_AND_HEIGHT | HEIGHT — no width-only value,
      // so 'auto-w' exports as NONE (documented deviation)
      const tr = (n.text && n.text.resize) || (n.als ? ((n.als.w === 'hug' && n.als.h === 'hug') ? 'auto' : n.als.h === 'hug' ? 'auto-h' : 'fixed') : 'fixed');
      out.textAutoResize = tr === 'auto' ? 'WIDTH_AND_HEIGHT' : tr === 'auto-h' ? 'HEIGHT' : 'NONE';
      if (n.text.underline) out.textDecoration = 'UNDERLINE';
      if (n.text.strike) out.textDecoration = (out.textDecoration ? out.textDecoration + '+' : '') + 'STRIKETHROUGH';
      if (n.text.textCase && n.text.textCase !== 'none') out.textCase = n.text.textCase === 'upper' ? 'UPPER' : n.text.textCase === 'lower' ? 'LOWER' : n.text.textCase === 'small-caps' ? 'SMALL_CAPS' : 'TITLE';
      if (n.text.list === 'bullet') out.listStyle = 'UNORDERED';
      if (n.text.list === 'number') out.listStyle = 'ORDERED';
      if (n.text.paragraphSpacing) out.paragraphSpacing = n.text.paragraphSpacing;
      if (n.text.paragraphIndent) out.paragraphIndent = n.text.paragraphIndent;
    }
    return out;
  }

  function figPaint(f) {
    if (!f) return null;
    if (f.type === 'solid') {
      const c = M.hexToRgb(f.color || '#000000');
      return { type: 'SOLID', color: { r: c.r, g: c.g, b: c.b, a: 1 }, opacity: f.opacity == null ? 1 : f.opacity, visible: true, blendMode: 'NORMAL' };
    }
    if (f.type === 'linear') {
      return {
        type: 'GRADIENT_LINEAR',
        stops: (f.stops || []).map(s => ({ color: { ...M.hexToRgb(s.color), a: s.opacity == null ? 1 : s.opacity }, position: s.pos ?? 0 })),
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        visible: true,
      };
    }
    if (f.type === 'radial') {
      return {
        type: 'GRADIENT_RADIAL',
        stops: (f.stops || []).map(s => ({ color: { ...M.hexToRgb(s.color), a: s.opacity == null ? 1 : s.opacity }, position: s.pos ?? 0 })),
        transform: { m00: 1, m01: 0, m02: 0, m10: 0, m11: 1, m12: 0 },
        opacity: f.opacity == null ? 1 : f.opacity,
        visible: f.visible !== false,
      };
    }
    if (f.type === 'image' && (f.hash || f.src)) {
      let hash = f.hash;
      if (!hash && f.src) {
        // Stable short hash so the image is packed into the .fig even when
        // the fill never went through an import.
        let h = 2166136261;
        const s = f.src.slice(0, 4096);
        for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
        hash = ('00000000' + (h >>> 0).toString(16)).slice(-8) + '000000000000000000000000';
        f.hash = hash;
      }
      return {
        type: 'IMAGE',
        image: { hash: b64Bytes(hash) },
        imageScaleMode: (f.scaleMode || 'fill').toUpperCase(),
        visible: true,
      };
    }
    return { type: 'SOLID', color: { r: 0.8, g: 0.8, b: 0.8, a: 1 }, opacity: 1, visible: true };
  }
  function b64Bytes(hex) {
    const out = new Uint8Array(Math.floor(hex.length / 2));
    for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
    return out;
  }
  function u8FromB64(b64) {
    const bin = atob(b64);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
  }
  function weightName(w, italic) {
    let base;
    switch (w) {
      case 100: base = 'Thin'; break;
      case 200: base = 'ExtraLight'; break;
      case 300: base = 'Light'; break;
      case 500: base = 'Medium'; break;
      case 600: base = 'SemiBold'; break;
      case 700: base = 'Bold'; break;
      case 800: base = 'ExtraBold'; break;
      default: base = 'Regular';
    }
    return italic ? base + ' Italic' : base;
  }
  function figVarType(type) {
    return { color: 'COLOR', number: 'FLOAT', string: 'STRING', boolean: 'BOOLEAN' }[type] || 'FLOAT';
  }
  function jsValueToKiwi(v, modeId, doc) {
    const val = v.values[modeId] != null ? v.values[modeId] : v.values[Object.keys(v.values)[0]];
    if (v.type === 'color') return { colorValue: { ...M.hexToRgb(val), a: 1 } };
    if (v.type === 'number') return { floatValue: val };
    if (v.type === 'boolean') return { boolValue: !!val };
    return { textValue: String(val) };
  }

  global.FigConv = { importFig, exportFig, bytesToB64, u8ToHex, applyFigTransform, figTransformFor };
})(window);
