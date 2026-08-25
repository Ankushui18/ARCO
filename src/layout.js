/* layout.js — Penfig auto-layout engine.
 *
 * Places children in PARENT-LOCAL coordinates and writes n.x/n.y for flow
 * children (AL-placed). n.x/n.y for manually-placed children are the
 * stored authoritative value and are NOT clobbered. World geometry
 * (_wt/_wc/_w) is computed top-down afterwards by World.computePage in a
 * SINGLE pass — that is the only place transforms compose. Render,
 * selection, hit-test and resize all consume World-computed geometry;
 * layout does not compute world coordinates.
 *
 * Single deterministic pipeline:
 *   Measure → Distribute → Place → World.computePage (OBB/corners/affine)
 */
(function (global) {
  'use strict';

  const M = global.Model;
  const num = (t) => {
    if (t && typeof t === 'object') return typeof t.tokValue === 'number' ? t.tokValue : (typeof t.n === 'number' ? t.n : 0);
    return typeof t === 'number' ? t : 0;
  };
  const clamp = (v, min, max) => {
    if (min != null && v < min) v = min;
    if (max != null && v > max) v = max;
    return v;
  };
  // A node is hug-sized on an axis if: it has als.hug, it's an AL container with
  // no explicit size, OR it's a text node with auto-resize on that axis.
  function isHugW(n) {
    if (n.al && (!n.w || n.w < 1)) return true;
    if (n.als && n.als.w === 'hug') return true;
    if (n.type === 'text') {
      const r = (n.text && n.text.resize) || 'auto';
      return r === 'auto' || r === 'auto-w';
    }
    return !n.w || n.w < 1;
  }
  function isHugH(n) {
    if (n.al && (!n.h || n.h < 1)) return true;
    if (n.als && n.als.h === 'hug') return true;
    if (n.type === 'text') {
      const r = (n.text && n.text.resize) || 'auto';
      return r === 'auto' || r === 'auto-h';
    }
    return !n.h || n.h < 1;
  }

  function layoutPage(page) {
    for (const key of Object.keys(page.nodes)) {
      const n = page.nodes[key];
      if (n) { delete n._measured; delete n._l; delete n._w; delete n._wt; delete n._wc; }
    }
    // Tops: stored n.x,n.y are page coordinates (page = identity parent).
    for (const tid of page.tops) {
      const t = page.nodes[tid];
      if (!t) continue;
      const m = measureNode(page, t);
      let pw = t.w, ph = t.h;
      if (isHugW(t) || !pw || pw < 1) pw = m.w;
      if (isHugH(t) || !ph || ph < 1) ph = m.h;
      layoutNode(page, t, t.x, t.y, Math.max(1, pw), Math.max(1, ph));
    }
    if (global.World) global.World.computePage(page);
  }

  // ---- measure
  function measureNode(page, n) {
    if (n._measured) return n._measured;
    let w, h;
    if (n.type === 'text') {
      const m = global.Renderer ? global.Renderer.measureText(n) : { w: Math.max(1, n.w || 20), h: Math.max(1, n.h || 16) };
      w = m.w; h = m.h;
    } else if (n.al) {
      const r = measureStack(page, n);
      w = r.w; h = r.h;
    } else {
      w = n.w; h = n.h;
    }
    // If author didn't set size (hug) on a non-text/non-AL node, use union of children.
    if ((!w || w<1) && n.children && n.children.length) {
      w = 0;
      for (const cid of n.children) {
        const c = page.nodes[cid]; if (!c) continue;
        const cm = measureNode(page, c);
        w = Math.max(w, c.x + cm.w);
        if (!h || h<1) {} // h computed below
      }
    }
    if ((!h || h<1) && n.children && n.children.length) {
      h = 0;
      for (const cid of n.children) {
        const c = page.nodes[cid]; if (!c) continue;
        const cm = measureNode(page, c);
        h = Math.max(h, c.y + cm.h);
      }
    }
    w = clamp(w, n.minW, n.maxW);
    h = clamp(h, n.minH, n.maxH);
    n._measured = { w: Math.max(1, w||1), h: Math.max(1, h||1) };
    return n._measured;
  }

  function visibleFlowKids(page, n) {
    return M.kids(page, n).filter(k => k.visible !== false && !(k.als && k.als.absolute));
  }

  function measureStack(page, n) {
    const al = n.al;
    const kids = visibleFlowKids(page, n);
    const horizontal = al.dir === 'h';
    const gap = num(al.gap), gapC = num(al.gapCross);
    const padT = num(al.pad[0]), padR = num(al.pad[1]), padB = num(al.pad[2]), padL = num(al.pad[3]);
    // Pre-measure children first.
    kids.forEach(k => measureNode(page, k));
    const items = kids.map(k => {
      const mm = k._measured;
      const sw = k.als ? (horizontal ? k.als.w : k.als.h) : 'fixed';
      const sh = k.als ? (horizontal ? k.als.h : k.als.w) : 'fixed';
      return {
        k, sw, sh,
        natMain: sw === 'fixed' ? (horizontal ? k.w : k.h) : mm[horizontal ? 'w' : 'h'],
        natCross: sh === 'fixed' ? (horizontal ? k.h : k.w) : mm[horizontal ? 'h' : 'w'],
      };
    });
    // Determine container size (hug if no explicit size, else fixed).
    let cw = n.w, ch = n.h;
    if (!cw || cw < 1) {
      if (horizontal) cw = items.reduce((s,it)=>s+it.natMain,0) + Math.max(0,items.length-1)*gap + padL+padR;
      else cw = Math.max(1, ...items.map(i=>i.natCross)) + padL+padR;
    }
    if (!ch || ch < 1) {
      if (!horizontal) ch = items.reduce((s,it)=>s+it.natMain,0) + Math.max(0,items.length-1)*gap + padT+padB;
      else ch = Math.max(1, ...items.map(i=>i.natCross)) + padT+padB;
    }
    let main, cross;
    if (al.wrap) {
      const trackMax = horizontal ? Math.max(1, cw - padL - padR) : Infinity;
      let lineMain = 0, lineCross = 0, cnt = 0, bestMain = 0, bestCross = 0;
      for (const it of items) {
        const add = (cnt ? gap : 0) + it.natMain;
        if (cnt && isFinite(trackMax) && lineMain + add > trackMax) {
          bestMain = Math.max(bestMain, lineMain);
          bestCross = Math.max(bestCross, lineCross);
          lineMain = it.natMain; lineCross = it.natCross; cnt = 1;
        } else { lineMain += add; lineCross = Math.max(lineCross, it.natCross); cnt++; }
      }
      if (cnt) { bestMain = Math.max(bestMain, lineMain); bestCross = Math.max(bestCross, lineCross); }
      const lines = countLines(items, gap, trackMax);
      main = bestMain; cross = bestCross + Math.max(0, lines-1)*gapC;
    } else {
      main = items.reduce((s,it)=>s+it.natMain,0) + Math.max(0,items.length-1)*gap;
      // Cross axis (non-wrap): use the MAX child cross size, not SUM.
      cross = items.reduce((s,it)=>Math.max(s, it.natCross), 0);
    }
    // Adjust hug size if content exceeds fixed.
    if (!n.w || n.w < 1) cw = (horizontal ? padL+main+padR : padL+cross+padR);
    if (!n.h || n.h < 1) ch = (horizontal ? padT+cross+padB : padT+main+padB);
    n._cSize = { w: cw, h: ch };
    return { w: cw, h: ch };
  }

  function countLines(items, gap, trackMax) {
    if (!isFinite(trackMax)) return 1;
    let lines = 1, used = 0;
    for (const it of items) {
      const add = (used ? gap : 0) + it.natMain;
      if (used && used + add > trackMax) { lines++; used = it.natMain; }
      else used += add;
    }
    return lines;
  }

  // ---- place
  function layoutNode(page, n, lx, ly, pw, ph) {
    // (lx,ly) = position in PARENT-LOCAL content space. For tops (parent=null)
    // this equals world space. For children of AL frames lx/ly include padding.
    // For children of manual frames, lx/ly = n.x/n.y (stored parent-local).
    //
    // CONTRACT: n.x/n.y/n.w/n.h are the AUTHORITATIVE stored values and are
    // only mutated here when (a) the node is a flow child of an auto-layout
    // container (lx/ly come from the distributor), or (b) hug sizing updates
    // n.w/n.h from measurement. We never clobber stored positions for
    // manually-placed children or for absolute AL children (those keep their
    // authored offsets in content-space; _l records the padded position).
    n._l = { x: lx, y: ly, w: pw, h: ph };
    const parent = n.parent ? page.nodes[n.parent] : null;
    const inAL = parent && parent.al;
    const isFlowAL = inAL && n.als && !n.als.absolute;
    if (isFlowAL) { n.x = lx; n.y = ly; n.w = pw; n.h = ph; }
    else {
      // hug-sized nodes (e.g. text with auto-resize) get w/h from measurement
      if (pw && pw > 0) n.w = pw;
      if (ph && ph > 0) n.h = ph;
    }
    if (!n.al) {
      for (const k of M.kids(page, n)) {
        if (k.visible === false) continue;
        const r = measureNode(page, k);
        let cw = k.w, ch = k.h;
        const hugW = isHugW(k), hugH = isHugH(k);
        if (hugW) cw = r.w;
        if (hugH) ch = r.h;
        layoutNode(page, k, k.x, k.y, Math.max(1, cw), Math.max(1, ch));
      }
      return;
    }
    // If n is an AL container but was called with zero size (hug), use measured size.
    if ((!pw || pw < 1) || (!ph || ph < 1)) {
      const m = measureNode(page, n);
      if (!pw || pw < 1) pw = m.w;
      if (!ph || ph < 1) ph = m.h;
      n._l = { x: lx, y: ly, w: pw, h: ph };
      n.w = pw; n.h = ph;
    }
    const al = n.al;
    const gap = num(al.gap), gapC = num(al.gapCross);
    const padT = num(al.pad[0]), padR = num(al.pad[1]), padB = num(al.pad[2]), padL = num(al.pad[3]);
    const horizontal = al.dir === 'h';
    // For auto-layout, n's content box is its own size (pw,ph) in parent-local space.
    const contentW = Math.max(0, pw - padL - padR);
    const contentH = Math.max(0, ph - padT - padB);
    const cMain = horizontal ? contentW : contentH;
    const cCross = horizontal ? contentH : contentW;

    const kids = visibleFlowKids(page, n);
    kids.forEach(k => measureNode(page, k));
    const items = kids.map(k => buildItem(page, k, horizontal));

    if (al.wrap && items.length) layoutWrapped(page, n, items, { gap, gapC, padL, padT, horizontal, cMain, cCross, al, lx, ly });
    else layoutSingle(page, n, items, { gap, padL, padT, horizontal, cMain, cCross, al, lx, ly });

    // Recurse into ALL remaining children (flow children were already
    // placed above via placeItem -> layoutNode; absolute children and any
    // manually-positioned children still need their subtrees processed).
    for (const k of M.kids(page, n)) {
      if (k.visible === false) continue;
      if (k._l) {
        // already placed by distributor (flow child) — but still need to
        // recurse into its children in case it is a non-AL container that
        // wasn't recursed into during placeItem. Since placeItem always
        // goes through layoutNode, children of flow items were already
        // processed; skip to avoid double-layout.
        continue;
      }
      if (k.als && k.als.absolute) {
        const r = measureNode(page, k);
        // n.x/n.y for absolute children is authored content-relative;
        // we pass lx/ly = padded position in parent-local space and DO
        // NOT overwrite k.x/k.y.
        const absLx = padL + k.x, absLy = padT + k.y;
        k.w = r.w; k.h = r.h;
        layoutNode(page, k, absLx, absLy, Math.max(1, r.w), Math.max(1, r.h));
      } else {
        // Manual child of an AL container (shouldn't normally happen, but
        // be robust): place at its authored parent-local offset.
        const r = measureNode(page, k);
        let cw = k.w, ch = k.h;
        if (isHugW(k)) cw = r.w;
        if (isHugH(k)) ch = r.h;
        layoutNode(page, k, k.x, k.y, Math.max(1, cw), Math.max(1, ch));
      }
    }
  }

  function buildItem(page, k, horizontal) {
    const mm = k._measured;
    const sw = k.als ? (horizontal ? k.als.w : k.als.h) : 'fixed';
    const sh = k.als ? (horizontal ? k.als.h : k.als.w) : 'fixed';
    return {
      k, sw, sh,
      grow: (k.als && k.als.grow > 0) ? k.als.grow : (sw === 'fill' ? 1 : 0),
      natMain: sw === 'fill' ? 0 : (sw === 'fixed' ? (horizontal ? k.w : k.h) : mm[horizontal ? 'w' : 'h']),
      natCross: sh === 'fixed' ? (horizontal ? k.h : k.w) : mm[horizontal ? 'h' : 'w'],
    };
  }

  function distributeMain(items, cMain, gap) {
    const n = items.length;
    const used = items.reduce((s,it)=>s+it.natMain,0) + Math.max(0,n-1)*gap;
    const fills = items.filter(it=>it.sw==='fill');
    const tg = fills.reduce((s,it)=>s+Math.max(it.grow,1e-4),0);
    const avail = Math.max(0, cMain - used);
    for (const it of items) {
      it.placedMain = it.sw==='fill' ? (fills.length ? avail*Math.max(it.grow,1e-4)/tg : 0) : it.natMain;
    }
  }
  function effAlign(k, al) {
    return (k.als && k.als.align && k.als.align !== 'auto') ? k.als.align : al.cross;
  }
  function itCross(it, cCross) { return it.sh === 'fill' ? cCross : it.natCross; }

  function layoutSingle(page, n, items, c) {
    const { gap, padL, padT, horizontal, cMain, cCross, al } = c;
    distributeMain(items, cMain, gap);
    for (const it of items) it.placedCross = itCross(it, cCross);
    const nn = items.length;
    const totalMain = items.reduce((s,it)=>s+it.placedMain,0);
    const gaps = Math.max(0,nn-1)*gap;
    const positions = [];
    let cur = 0, step = 0;
    if (al.main === 'center') cur = (cMain - (totalMain+gaps))/2;
    else if (al.main === 'end') cur = cMain - (totalMain+gaps);
    else if (al.main === 'space-evenly') { step = nn>0 ? (cMain-totalMain)/(nn+1) : 0; cur = step; }
    items.forEach((it,i)=>{
      const a = effAlign(it.k, al);
      const stretched = it.sh==='fill' || a==='stretch';
      const cross = stretched ? cCross : it.placedCross;
      const cp = stretched ? 0 : a==='center' ? (cCross-cross)/2 : a==='end' ? cCross-cross : 0;
      let lx,ly;
      if (horizontal) { lx=padL+cur; ly=padT+cp; }
      else { lx=padL+cp; ly=padT+cur; }
      placeItem(page, it, lx, ly, it.placedMain, cross);
      if (al.main === 'space-between') cur += it.placedMain + (i<nn-1 ? gap + (cMain-totalMain-gaps)/Math.max(1,nn-1) : 0);
      else if (al.main === 'space-evenly') cur += it.placedMain + step + gap;
      else cur += it.placedMain + gap;
    });
  }

  function layoutWrapped(page, n, items, c) {
    const { gap, gapC, padL, padT, horizontal, cMain, cCross, al } = c;
    distributeMain(items, cMain, gap);
    for (const it of items) it.placedCross = itCross(it, cCross);
    const lines = [];
    let line = [], used = 0;
    for (const it of items) {
      const add = (line.length?gap:0) + it.placedMain;
      if (line.length && used+add > cMain) { lines.push(line); line=[it]; used=it.placedMain; }
      else { line.push(it); used += add; }
    }
    if (line.length) lines.push(line);
    const lc = lines.map(L=>Math.max(0,...L.map(it=>it.placedCross)));
    const totalCross = lc.reduce((s,x)=>s+x,0) + (lines.length-1)*gapC;
    let cc = 0;
    if (al.cross==='center') cc = (cCross-totalCross)/2;
    else if (al.cross==='end') cc = cCross-totalCross;
    lines.forEach((L,li)=>{
      const tCross = lc[li];
      const lm = L.reduce((s,it)=>s+it.placedMain,0) + (L.length-1)*gap;
      let cur = 0;
      if (al.main==='center') cur = (cMain-lm)/2;
      else if (al.main==='end') cur = cMain-lm;
      for (const it of L) {
        const a = effAlign(it.k, al);
        const stretched = it.sh==='fill' || a==='stretch';
        const cross = stretched ? tCross : it.placedCross;
        const cp = stretched ? 0 : a==='center' ? (tCross-cross)/2 : a==='end' ? tCross-cross : 0;
        let lx,ly;
        if (horizontal) { lx=padL+cur; ly=padT+cc+cp; }
        else { lx=padL+cc+cp; ly=padT+cur; }
        placeItem(page, it, lx, ly, it.placedMain, cross);
        cur += it.placedMain + gap;
      }
      cc += tCross + gapC;
    });
  }

  function placeItem(page, it, lx, ly, w, h) {
    const k = it.k;
    // lx,ly are already parent-local (pad + cur / padT+cc+cp).
    layoutNode(page, k, lx, ly, Math.max(0.01, w), Math.max(0.01, h));
  }

  function applyConstraints(page, frame, oldW, oldH) {
    if (!frame || frame.al) return;
    const dw = frame.w - oldW, dh = frame.h - oldH;
    if (!dw && !dh) return;
    const rx = oldW>0 ? frame.w/oldW : 1, ry = oldH>0 ? frame.h/oldH : 1;
    for (const cid of frame.children) {
      const k = page.nodes[cid]; if (!k) continue;
      if (k.als && k.als.absolute) continue;
      const c = k.constraints || {h:'min', v:'min'};
      if (c.h==='max') k.x += dw;
      else if (c.h==='center') k.x += dw/2;
      else if (c.h==='stretch') k.w += dw;
      else if (c.h==='scale') { k.x *= rx; k.w *= rx; }
      if (c.v==='max') k.y += dh;
      else if (c.v==='center') k.y += dh/2;
      else if (c.v==='stretch') k.h += dh;
      else if (c.v==='scale') { k.y *= ry; k.h *= ry; }
    }
  }

  function resizeToFit(page, frame, pad = 0) {
    if (!frame) return null;
    if (frame.al) {
      // Clear forced size so next measure uses hug.
      frame.w = 0; frame.h = 0;
      delete frame._measured;
      const m = measureNode(page, frame);
      frame.w = Math.max(1, m.w + pad*2); frame.h = Math.max(1, m.h + pad*2);
    } else {
      let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
      for (const cid of frame.children) {
        const k = page.nodes[cid]; if (!k) continue;
        x0=Math.min(x0,k.x); y0=Math.min(y0,k.y);
        x1=Math.max(x1,k.x+k.w); y1=Math.max(y1,k.y+k.h);
      }
      if (!isFinite(x0)) return null;
      frame.w = Math.max(1, x1-x0 + pad*2); frame.h = Math.max(1, y1-y0 + pad*2);
    }
    return { w: frame.w, h: frame.h };
  }

  global.Layout = { layoutPage, measure: measureNode, applyConstraints, resizeToFit };
})(window);
