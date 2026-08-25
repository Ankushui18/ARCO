/* pen.js — Penfig vector engine (spec §6/§8): the path node model used by the
 * Pen tool and node editor. Pure functions — no DOM — so the whole engine is
 * unit-testable headlessly.
 *
 * Node model (pen nodes, in whatever coordinate space the caller uses):
 *   { x, y,                    // point position
 *     type: 'corner' | 'smooth',
 *     hsx, hsy,                // OUTGOING handle (toward the NEXT point), relative
 *     htx, hty }               // INCOMING handle (toward the PREVIOUS point), relative
 * A corner node has hsx/htx === null (or 0 — normalized to null).
 *
 * Paths are stored in the scene graph as SVG `d` strings (scene-local coords),
 * which figlib already round-trips through real .fig kiwi blobs. This module
 * converts between pen-node lists and `d`, and provides the node operations
 * from the spec: move / add / delete / join / split / convert corner ↔ smooth,
 * independent & mirrored handles (handles are always independent per side;
 * 'smooth' conversion mirrors, corner clears).
 */
(function (global) {
  'use strict';
  const F = () => global.FigIO;
  const EPS = 1e-6;
  const near = (a, b) => Math.abs(a - b) < EPS;
  const num = (v, dp) => {
    const r = Math.round(v * 100) / 100;
    return (r === 0 ? 0 : r);
  };

  function cornerNode(x, y) {
    return { x, y, type: 'corner', hsx: null, hsy: null, htx: null, hty: null };
  }
  function hasOut(n) { return n.hsx != null; }
  function hasIn(n) { return n.htx != null; }

  // ------------------------------------------------------------- serialize
  // pen nodes + closed flag → SVG d (in the nodes' own coordinate space)
  function nodesToD(nodes, closed) {
    if (!nodes.length) return '';
    let d = 'M ' + num(nodes[0].x) + ' ' + num(nodes[0].y);
    for (let i = 1; i < nodes.length; i++) {
      const a = nodes[i - 1], b = nodes[i];
      if (hasOut(a) || hasIn(b)) {
        const c1x = a.x + (hasOut(a) ? a.hsx : 0), c1y = a.y + (hasOut(a) ? a.hsy : 0);
        const c2x = b.x + (hasIn(b) ? b.htx : 0), c2y = b.y + (hasIn(b) ? b.hty : 0);
        d += ' C ' + num(c1x) + ' ' + num(c1y) + ' ' + num(c2x) + ' ' + num(c2y) + ' ' + num(b.x) + ' ' + num(b.y);
      } else {
        d += ' L ' + num(b.x) + ' ' + num(b.y);
      }
    }
    if (closed && nodes.length > 1) {
      // closing segment: last → first with their respective handles
      const a = nodes[nodes.length - 1], b = nodes[0];
      if (hasOut(a) || hasIn(b)) {
        const c1x = a.x + (hasOut(a) ? a.hsx : 0), c1y = a.y + (hasOut(a) ? a.hsy : 0);
        const c2x = b.x + (hasIn(b) ? b.htx : 0), c2y = b.y + (hasIn(b) ? b.hty : 0);
        d += ' C ' + num(c1x) + ' ' + num(c1y) + ' ' + num(c2x) + ' ' + num(c2y) + ' ' + num(b.x) + ' ' + num(b.y);
      }
      d += ' Z';
    }
    return d;
  }

  // SVG d → { subpaths: [ { nodes, closed } ] } (absolute coords of the d space)
  function dToNodes(d) {
    const parsed = F().parsePath(d || '');
    const out = [];
    for (const sp of parsed) {
      const nodes = [Object.assign(cornerNode(sp.start[0], sp.start[1]))];
      for (const seg of sp.segs) {
        if (seg.t === 'L') {
          nodes.push(cornerNode(seg.x, seg.y));
        } else if (seg.t === 'C') {
          const prev = nodes[nodes.length - 1];
          const n = cornerNode(seg.x, seg.y);
          n.type = 'smooth';
          n.htx = seg.x2 - seg.x; n.hty = seg.y2 - seg.y;   // incoming handle
          nodes.push(n);
          // the outgoing handle belongs to the node BEFORE this segment — it
          // is only ever set here, so an L segment before/after stays an L
          // on re-serialization (round-trip stability).
          if (!hasOut(prev)) {
            prev.type = 'smooth';
            prev.hsx = seg.x1 - prev.x; prev.hsy = seg.y1 - prev.y;
          }
        }
      }
      // normalize: a 'smooth' node with zero handles is a corner
      for (const n of nodes) if (n.type === 'smooth' && (!hasOut(n) && !hasIn(n))) { n.type = 'corner'; n.hsx = n.hsy = n.htx = n.hty = null; }
      out.push({ nodes, closed: !!sp.closed });
    }
    return { subpaths: out };
  }

  function bboxOf(nodes) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const eat = (x, y) => { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); };
    for (const n of nodes) {
      eat(n.x, n.y);
      if (hasOut(n)) eat(n.x + n.hsx, n.y + n.hsy);
      if (hasIn(n)) eat(n.x + n.htx, n.y + n.hty);
    }
    if (!isFinite(x0)) return { x: 0, y: 0, w: 0, h: 0 };
    return { x: x0, y: y0, w: Math.max(0.01, x1 - x0), h: Math.max(0.01, y1 - y0) };
  }

  // ------------------------------------------------------------- hit tests
  function nodeAt(nodes, p, tol) {
    for (let i = 0; i < nodes.length; i++) {
      if (Math.hypot(nodes[i].x - p.x, nodes[i].y - p.y) <= (tol || 6)) return i;
    }
    return -1;
  }
  function handleAt(nodes, p, tol) {
    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i];
      if (hasOut(n) && Math.hypot(n.x + n.hsx - p.x, n.y + n.hsy - p.y) <= (tol || 6)) return { i, side: 'out' };
      if (hasIn(n) && Math.hypot(n.x + n.htx - p.x, n.y + n.hty - p.y) <= (tol || 6)) return { i, side: 'in' };
    }
    return null;
  }
  // { i, t, point } on segment i→i+1 (i = -1 for the closing segment when closed)
  function segPointAt(nodes, p, closed) {
    const pts = nodes;
    const n = pts.length;
    let best = null;
    const testSeg = (a, b, idx) => {
      const d = distToSeg(p, a, b);
      if (!best || d.dist < best.dist) best = { i: idx, t: d.t, point: { x: d.x, y: d.y }, dist: d.dist };
    };
    for (let i = 0; i < n - 1; i++) testSeg(pts[i], pts[i + 1], i);
    if (closed && n > 2) testSeg(pts[n - 1], pts[0], -1);
    return best;
  }
  function distToSeg(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2 : 0;
    t = Math.max(0, Math.min(1, t));
    const x = a.x + t * dx, y = a.y + t * dy;
    return { x, y, t, dist: Math.hypot(p.x - x, p.y - y) };
  }

  // ------------------------------------------------------------- node ops
  function insertAt(nodes, idx, point) {
    const n = cornerNode(point.x, point.y);
    nodes.splice(idx, 0, n);
    return idx;
  }
  function removeAt(nodes, idx, closed) {
    const min = closed ? 3 : 2;
    if (nodes.length <= min) return false;
    nodes.splice(idx, 1);
    return true;
  }
  // convert one node (or all, when idx === null): 'corner' clears handles,
  // 'smooth' creates mirrored handles from the neighbors (tangent = avg of the
  // two neighbor directions).
  function convert(nodes, idx, mode, closed) {
    const list = idx == null ? nodes : [nodes[idx]];
    const nn = nodes.length;
    for (const n of list) {
      const i = nodes.indexOf(n);
      if (mode === 'corner') {
        n.type = 'corner'; n.hsx = n.hsy = n.htx = n.hty = null;
      } else {
        const prev = nodes[(i - 1 + nn) % nn];
        const next = nodes[(i + 1) % nn];
        const v1 = [prev.x - n.x, prev.y - n.y];   // toward previous
        const v2 = [next.x - n.x, next.y - n.y];   // toward next
        // mirrored handles, length ≈ half the distance to the neighbor:
        // incoming = (v1 − v2)/4, outgoing = −incoming
        const ix = (v1[0] - v2[0]) / 4, iy = (v1[1] - v2[1]) / 4;
        n.type = 'smooth';
        n.htx = ix; n.hty = iy; n.hsx = -ix; n.hsy = -iy;
      }
    }
    return true;
  }
  // split an open subpath at node idx → [left, right] (two open subpaths)
  function splitAt(nodes, idx) {
    if (idx <= 0 || idx >= nodes.length - 1) return null;
    const left = nodes.slice(0, idx + 1);
    const right = nodes.slice(idx);
    // break the handles at the seam
    const l = left[left.length - 1], r = right[0];
    l.type = 'corner'; l.hsx = l.hsy = null;
    r.type = 'corner'; r.htx = r.hty = null;
    return [left, right];
  }
  function canJoin(a, b, eps) {
    if (!a || !b || a.length < 1 || b.length < 1) return false;
    const e = eps || 2;
    const endA = a[a.length - 1], startB = b[0];
    return Math.hypot(endA.x - startB.x, endA.y - startB.y) <= e;
  }
  // join two subpaths whose seam endpoints coincide (end of a → start of b)
  function joinSubpaths(a, b, eps) {
    if (!canJoin(a, b, eps)) return null;
    const out = a.concat(b.slice(1));
    // clear seam handles for a clean corner join
    const i = a.length - 1;
    out[i].hsx = out[i].hsy = null;
    out[i + 1].htx = out[i + 1].hty = null;
    if (out[i].type === 'smooth' && !hasOut(out[i])) out[i].type = 'corner';
    return out;
  }

  // ------------------------------------------------------------- pencil
  // Ramer–Douglas–Peucker polyline simplification
  function rdp(points, eps) {
    if (!points || points.length < 3) return (points || []).slice();
    const keep = new Array(points.length).fill(false);
    keep[0] = keep[points.length - 1] = true;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
      const [s, e] = stack.pop();
      const a = points[s], b = points[e];
      let maxD = -1, maxI = -1;
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      for (let i = s + 1; i < e; i++) {
        const d = Math.abs(dy * points[i].x - dx * points[i].y + b.x * a.y - b.y * a.x) / len;
        if (d > maxD) { maxD = d; maxI = i; }
      }
      if (maxD > (eps || 1)) {
        keep[maxI] = true;
        stack.push([s, maxI], [maxI, e]);
      }
    }
    return points.filter((_, i) => keep[i]);
  }
  // freehand points → smooth d: quadratic-through-midpoints converted to cubics
  function smoothD(points) {
    if (!points.length) return '';
    if (points.length < 3) return nodesToD(points.map(p => cornerNode(p.x, p.y)), false);
    let d = 'M ' + num(points[0].x) + ' ' + num(points[0].y);
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    let prev = points[0];
    for (let i = 1; i < points.length - 1; i++) {
      const m = mid(points[i], points[i + 1]);
      const c1x = prev.x + (2 / 3) * (points[i].x - prev.x);
      const c1y = prev.y + (2 / 3) * (points[i].y - prev.y);
      const c2x = m.x + (2 / 3) * (points[i].x - m.x);
      const c2y = m.y + (2 / 3) * (points[i].y - m.y);
      d += ' C ' + num(c1x) + ' ' + num(c1y) + ' ' + num(c2x) + ' ' + num(c2y) + ' ' + num(m.x) + ' ' + num(m.y);
      prev = points[i];
    }
    d += ' L ' + num(points[points.length - 1].x) + ' ' + num(points[points.length - 1].y);
    return d;
  }

  // ------------------------------------------------------------- commit
  // pen subpath (world coords) → scene vector node fields (local coords)
  function subpathToNodeFields(sp) {
    const bb = bboxOf(sp.nodes);
    const nodes = sp.nodes.map(n => ({
      x: n.x - bb.x, y: n.y - bb.y, type: n.type,
      hsx: n.hsx, hsy: n.hsy, htx: n.htx, hty: n.hty,
    }));
    return {
      x: bb.x, y: bb.y, w: bb.w, h: bb.h,
      path: nodesToD(nodes, sp.closed),
    };
  }

  global.Pen = {
    EPS, cornerNode, hasOut, hasIn,
    nodesToD, dToNodes, bboxOf,
    nodeAt, handleAt, segPointAt, distToSeg,
    insertAt, removeAt, convert, splitAt, canJoin, joinSubpaths,
    rdp, smoothD, subpathToNodeFields,
  };
})(typeof window !== 'undefined' ? window : globalThis);
