/* layout.js — Penfig auto-layout engine.
 *
 * ⚠️ Deliberately NOT CSS flexbox: this is a self-contained layout engine
 * (measure → distribute → place), written from scratch for the canvas
 * renderer. It computes exact x/y/w/h for every node; the renderer places
 * children with absolute coordinates. No CSS layout is involved at all.
 *
 * Figma-parity features:
 *   • direction (horizontal / vertical)
 *   • wrap + independent cross-axis gap
 *   • 4 independent paddings
 *   • gap between items
 *   • primary axis: start / center / end / space-between / space-evenly
 *   • cross axis:   start / center / end / stretch (per item: align-self)
 *   • item sizing per axis: fixed / hug / fill (grow weight)
 *   • min/max size clamping
 *   • absolutely positioned items (stored x/y, skip flow)
 *   • frames without auto layout keep manual child positions
 */
(function (global) {
  'use strict';

  const M = global.Model;
  // numeric token field {n, tok} or plain number
  const num = (t) => {
    if (t && typeof t === 'object') return typeof t.tokValue === 'number' ? t.tokValue : (typeof t.n === 'number' ? t.n : 0);
    return typeof t === 'number' ? t : 0;
  };

  // ------------------------------------------------------------- entry
  function layoutPage(page) {
    for (const key of Object.keys(page.nodes)) delete page.nodes[key]._measured;
    for (const tid of page.tops) {
      const t = page.nodes[tid];
      if (!t) continue;
      t._res = { w: t.w, h: t.h };
      layoutNode(page, t, t.x, t.y);
    }
  }

  // ------------------------------------------------------------- measure
  // Natural (hug) size of a node.
  function measure(page, n) {
    if (n._measured) return n._measured;
    let w, h;
    if (n.type === 'text') {
      const m = global.Renderer ? global.Renderer.measureText(n) : { w: n.w, h: n.h };
      w = m.w; h = m.h;
    } else if (n.al) {
      const r = measureStack(page, n);
      w = r.w; h = r.h;
    } else { w = n.w; h = n.h; }
    w = clamp(w, n.minW, n.maxW);
    h = clamp(h, n.minH, n.maxH);
    n._measured = { w: Math.max(1, w), h: Math.max(1, h) };
    return n._measured;
  }
  const clamp = (v, min, max) => {
    if (min) v = Math.max(v, min);
    if (max != null) v = Math.min(v, max);
    return v;
  };

  function visibleFlowKids(page, n) {
    return M.kids(page, n).filter(k => k.visible !== false && !(k.als && k.als.absolute));
  }

  // Natural size of an auto-layout container.
  function measureStack(page, n) {
    const al = n.al;
    const kids = visibleFlowKids(page, n);
    const horizontal = al.dir === 'h';
    const gap = num(al.gap), gapC = num(al.gapCross);
    const padT = num(al.pad[0]), padR = num(al.pad[1]), padB = num(al.pad[2]), padL = num(al.pad[3]);
    const items = kids.map(k => {
      const mm = measure(page, k);
      const sw = k.als ? (horizontal ? k.als.w : k.als.h) : 'fixed';
      const sh = k.als ? (horizontal ? k.als.h : k.als.w) : 'fixed';
      return {
        main: sw === 'fixed' ? (horizontal ? k.w : k.h) : mm[horizontal ? 'w' : 'h'],
        cross: sh === 'fixed' ? (horizontal ? k.h : k.w) : mm[horizontal ? 'h' : 'w'],
      };
    });
    let main, cross;
    if (al.wrap) {
      const trackMax = horizontal ? (n.w || 0) - padL - padR : Infinity;
      let lineMain = 0, lineCross = 0, cnt = 0;
      let bestMain = 0, bestCross = 0;
      for (const it of items) {
        const add = (cnt ? gap : 0) + it.main;
        if (cnt && isFinite(trackMax) && lineMain + add > trackMax) {
          bestMain = Math.max(bestMain, lineMain);
          bestCross = Math.max(bestCross, lineCross);
          lineMain = it.main; lineCross = it.cross; cnt = 1;
        } else { lineMain += add; lineCross = Math.max(lineCross, it.cross); cnt++; }
      }
      if (cnt) { bestMain = Math.max(bestMain, lineMain); bestCross = Math.max(bestCross, lineCross); }
      const lines = countLines(items, gap, trackMax);
      main = bestMain;
      cross = bestCross + Math.max(0, lines - 1) * gapC;
    } else {
      main = items.reduce((s, it) => s + it.main, 0) + Math.max(0, items.length - 1) * gap;
      cross = items.reduce((s, it) => s + it.cross, 0) + Math.max(0, items.length - 1) * gapC;
    }
    return horizontal
      ? { w: padL + main + padR, h: padT + cross + padB }
      : { w: padL + cross + padR, h: padT + main + padB };
  }

  function countLines(items, gap, trackMax) {
    if (!isFinite(trackMax)) return 1;
    let lines = 1, used = 0;
    for (const it of items) {
      const add = (used ? gap : 0) + it.main;
      if (used && used + add > trackMax) { lines++; used = it.main; }
      else used += add;
    }
    return lines;
  }

  // ------------------------------------------------------------- place
  function layoutNode(page, n, px, py) {
    const r = n._res;
    n._l = { x: px, y: py, w: r.w, h: r.h };
    if (!n.al) {
      for (const k of M.kids(page, n)) {
        if (k.visible === false) continue;
        k._res = { w: k.w, h: k.h };
        layoutNode(page, k, px + k.x, py + k.y);
      }
      return;
    }
    const al = n.al;
    const gap = num(al.gap), gapC = num(al.gapCross);
    const padT = num(al.pad[0]), padR = num(al.pad[1]), padB = num(al.pad[2]), padL = num(al.pad[3]);
    const horizontal = al.dir === 'h';
    const contentW = Math.max(0, r.w - padL - padR);
    const contentH = Math.max(0, r.h - padT - padB);
    const containerMain = horizontal ? contentW : contentH;
    const containerCross = horizontal ? contentH : contentW;

    const items = visibleFlowKids(page, n).map(k => buildItem(page, k, horizontal));

    if (al.wrap && items.length) layoutWrapped(page, n, items, { gap, gapC, padL, padT, horizontal, containerMain, containerCross, al, px, py });
    else layoutSingle(page, n, items, { gap, padL, padT, horizontal, containerMain, containerCross, al, px, py });

    for (const k of M.kids(page, n)) {
      if (k.visible === false) continue;
      if (k.als && k.als.absolute) {
        k._res = { w: k.w, h: k.h };
        layoutNode(page, k, px + padL + k.x, py + padT + k.y);
      }
    }
  }

  function buildItem(page, k, horizontal) {
    const mm = measure(page, k);
    const sw = k.als ? (horizontal ? k.als.w : k.als.h) : 'fixed';
    const sh = k.als ? (horizontal ? k.als.h : k.als.w) : 'fixed';
    return {
      k, sw, sh,
      grow: (k.als && k.als.grow > 0) ? k.als.grow : (sw === 'fill' ? 1 : 0),
      natMain: sw === 'fixed' ? (horizontal ? k.w : k.h) : mm[horizontal ? 'w' : 'h'],
      natCross: sh === 'fixed' ? (horizontal ? k.h : k.w) : mm[horizontal ? 'h' : 'w'],
    };
  }

  // main-axis distribution: fixed & hug keep natural size; fill items share
  // the remaining space weighted by grow.
  function distributeMain(items, containerMain, gap) {
    const n = items.length;
    const used = items.reduce((s, it) => s + (it.sw === 'fill' ? 0 : it.natMain), 0) + Math.max(0, n - 1) * gap;
    const fills = items.filter(it => it.sw === 'fill');
    const totalGrow = fills.reduce((s, it) => s + Math.max(it.grow, 1e-4), 0);
    const avail = Math.max(0, containerMain - used);
    for (const it of items) {
      it.placedMain = it.sw === 'fill' ? (fills.length ? avail * (Math.max(it.grow, 1e-4) / totalGrow) : 0) : it.natMain;
    }
  }

  function effAlign(k, al) {
    return (k.als && k.als.align && k.als.align !== 'auto') ? k.als.align : al.cross;
  }

  // ------------------------------------------------------------- single line
  function layoutSingle(page, n, items, c) {
    const { gap, padL, padT, horizontal, containerMain, containerCross, al, px, py } = c;
    distributeMain(items, containerMain, gap);
    for (const it of items) it.placedCross = itCrossSize(it, containerCross);

    const nn = items.length;
    const totalMain = items.reduce((s, it) => s + it.placedMain, 0);
    const gaps = Math.max(0, nn - 1) * gap;
    const free = Math.max(0, containerMain - totalMain - gaps);
    const pos = [];
    if (nn === 0) { /* none */ }
    else if (al.main === 'center') {
      let cur = (containerMain - (totalMain + gaps)) / 2;
      for (const it of items) { pos.push(cur); cur += it.placedMain + gap; }
    } else if (al.main === 'end') {
      let cur = containerMain - (totalMain + gaps);
      for (const it of items) { pos.push(cur); cur += it.placedMain + gap; }
    } else if (al.main === 'space-between') {
      const step = nn > 1 ? free / (nn - 1) : 0;
      let cur = 0;
      for (const it of items) { pos.push(cur); cur += it.placedMain + step; }
    } else if (al.main === 'space-evenly') {
      const step = free / (nn + 1);
      let cur = step;
      for (const it of items) { pos.push(cur); cur += it.placedMain + step; }
    } else { // start
      let cur = 0;
      for (const it of items) { pos.push(cur); cur += it.placedMain + gap; }
    }

    items.forEach((it, i) => {
      const a = effAlign(it.k, al);
      const stretched = it.sh === 'fill' || a === 'stretch';
      const crossPos = stretched ? 0
        : a === 'center' ? (containerCross - it.placedCross) / 2
        : a === 'end' ? containerCross - it.placedCross
        : 0;
      if (horizontal) placeItem(page, it, px + padL + pos[i], py + padT + crossPos, it.placedMain, stretched ? containerCross : it.placedCross);
      else placeItem(page, it, px + padL + crossPos, py + padT + pos[i], stretched ? containerCross : it.placedCross, it.placedMain);
    });
  }

  // ------------------------------------------------------------- wrap
  function layoutWrapped(page, n, items, c) {
    const { gap, gapC, padL, padT, horizontal, containerMain, containerCross, al, px, py } = c;
    distributeMain(items, containerMain, gap);
    for (const it of items) it.placedCross = itCrossSize(it, containerCross);

    // greedy packing
    const lines = [];
    let line = [], used = 0;
    for (const it of items) {
      const add = (line.length ? gap : 0) + it.placedMain;
      if (line.length && used + add > containerMain) { lines.push(line); line = [it]; used = it.placedMain; }
      else { line.push(it); used += add; }
    }
    if (line.length) lines.push(line);

    const lineCrosses = lines.map(L => Math.max(0, ...L.map(it => it.placedCross)));
    const totalCross = lineCrosses.reduce((s, x) => s + x, 0) + (lines.length - 1) * gapC;
    let curCross = 0;
    if (al.cross === 'center') curCross = (containerCross - totalCross) / 2;
    else if (al.cross === 'end') curCross = containerCross - totalCross;

    lines.forEach((L, li) => {
      const lineMain = L.reduce((s, it) => s + it.placedMain, 0) + (L.length - 1) * gap;
      let cur;
      if (al.main === 'center') cur = (containerMain - lineMain) / 2;
      else if (al.main === 'end') cur = containerMain - lineMain;
      else cur = 0;
      for (const it of L) {
        const a = effAlign(it.k, al);
        const stretched = it.sh === 'fill' || a === 'stretch';
        const trackCross = lineCrosses[li];
        const crossPos = stretched ? 0
          : a === 'center' ? (trackCross - it.placedCross) / 2
          : a === 'end' ? trackCross - it.placedCross
          : 0;
        if (horizontal) placeItem(page, it, px + padL + cur, py + padT + curCross + crossPos, it.placedMain, stretched ? containerCross : it.placedCross);
        else placeItem(page, it, px + padL + curCross + crossPos, py + padT + cur, stretched ? containerCross : it.placedCross, it.placedMain);
        cur += it.placedMain + gap;
      }
      curCross += lineCrosses[li] + gapC;
    });
  }

  function itCrossSize(it, containerCross) {
    if (it.sh === 'fill') return containerCross;
    return it.natCross;
  }

  function placeItem(page, it, wx, wy, w, h) {
    const k = it.k;
    const parent = k.parent ? page.nodes[k.parent] : null;
    k._res = { w: Math.max(0.01, w), h: Math.max(0.01, h) };
    if (parent && parent._l) {
      // keep stored coordinates relative to the parent (Figma behavior)
      k.x = wx - parent._l.x;
      k.y = wy - parent._l.y;
    }
    layoutNode(page, k, wx, wy);
  }

  // ------------------------------------------------------------- constraints
  // Figma constraints: how a child of a NON-auto-layout frame reacts when the
  // parent resizes. Called with the parent's previous size before the resize
  // is applied to the renderer.
  //   min     keep distance from the start edge (default)
  //   max     keep distance from the end edge
  //   center  stay centered in the parent
  //   stretch keep both edges attached (size changes)
  //   scale   scale position + size proportionally
  function applyConstraints(page, frame, oldW, oldH) {
    if (!frame || frame.al) return;
    const dw = frame.w - oldW, dh = frame.h - oldH;
    if (!dw && !dh) return;
    const rx = oldW > 0 ? frame.w / oldW : 1, ry = oldH > 0 ? frame.h / oldH : 1;
    for (const cid of frame.children) {
      const k = page.nodes[cid];
      if (!k) continue;
      if (k.als && k.als.absolute) continue; // absolutely positioned items don't move
      const c = k.constraints || { h: 'min', v: 'min' };
      if (dw) {
        if (c.h === 'max') k.x += dw;
        else if (c.h === 'center') k.x += dw / 2;
        else if (c.h === 'stretch') k.w += dw;
        else if (c.h === 'scale') k.w *= rx;
      }
      if (dh) {
        if (c.v === 'max') k.y += dh;
        else if (c.v === 'center') k.y += dh / 2;
        else if (c.v === 'stretch') k.h += dh;
        else if (c.v === 'scale') k.h *= ry;
      }
    }
  }

  // Resize-to-fit ("resize to fit content"): shrink-wrap the frame to its
  // children. Manual frames → union of children bounds; auto-layout frames →
  // the engine's natural (hug) size.
  function resizeToFit(page, frame, pad = 0) {
    if (!frame) return null;
    if (frame.al) {
      const m = measure(page, frame);
      frame.w = Math.max(1, m.w); frame.h = Math.max(1, m.h);
    } else {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const cid of frame.children) {
        const k = page.nodes[cid];
        if (!k) continue;
        x0 = Math.min(x0, k.x); y0 = Math.min(y0, k.y);
        x1 = Math.max(x1, k.x + k.w); y1 = Math.max(y1, k.y + k.h);
      }
      if (!isFinite(x0)) return null;
      frame.w = Math.max(1, x1 - x0 + pad * 2);
      frame.h = Math.max(1, y1 - y0 + pad * 2);
    }
    return { w: frame.w, h: frame.h };
  }

  global.Layout = { layoutPage, measure, num, applyConstraints, resizeToFit };
})(window);
