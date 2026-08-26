/* boolean.js — Penfig vector operations on REAL geometry (spec §7–8):
 * union / subtract / intersect / exclude, flatten, offset & outline stroke,
 * plus the §7 regular shapes (polygon / star / triangle).
 *
 * Deliberately NOT a visual/raster hack: everything is exact vector math.
 *
 * Boolean pipeline:
 *   1. flatten every path curve into polylines (de Casteljau, tol 0.25 px)
 *   2. split every edge at all edge intersections (incl. collinear overlaps)
 *   3. keep a split edge iff its two sides differ in region membership
 *      (even-odd or nonzero, per input windingRule) — the classic parity
 *      test that handles holes and self-intersections for free
 *   4. trace kept edges into loops → new path `d`
 *
 * Caveat (documented): results are polylines — boolean output flattens the
 * input curves. That is real geometry, just not curve-preserving (Figma's
 * booleans keep the original arcs; that requires arc-aware clipping).
 */
(function (global) {
  'use strict';
  const F = () => global.FigIO;
  const r2 = (v) => Math.round(v * 100) / 100;
  const EPS = 1e-6;

  // ------------------------------------------------------------- flatten
  // de Casteljau subdivision of one cubic until it is flat vs `tol`
  function flattenCubic(p0, p1, p2, p3, out, tol) {
    // flatness: max distance of control points from the chord
    const chord = Math.hypot(p3[0] - p0[0], p3[1] - p0[1]);
    const d1 = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]);
    const d2 = Math.hypot(p2[0] - p3[0], p2[1] - p3[1]);
    if (Math.max(d1, d2) <= tol || Math.max(d1 * d1, d2 * d2) < 1e-12) {
      out.push([p3[0], p3[1]]);
      return;
    }
    if (chord < 1e-9 && d1 + d2 < tol) { out.push([p3[0], p3[1]]); return; }
    const mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const a = mid(p0, p1), b = mid(p1, p2), c = mid(p2, p3);
    const d = mid(a, b), e = mid(b, c), f = mid(d, e);
    // tol stays constant: subdivision alone shrinks the control-point
    // distance ~4× per level, so this always terminates
    flattenCubic(p0, a, d, f, out, tol);
    flattenCubic(f, e, c, p3, out, tol);
  }
  // one parsed subpath → { pts, closed, area }
  function subpathToLoop(sp, tol) {
    const pts = [[sp.start[0], sp.start[1]]];
    let cur = [sp.start[0], sp.start[1]];
    for (const s of sp.segs) {
      if (s.t === 'L') { cur = [s.x, s.y]; pts.push(cur); }
      else { flattenCubic(cur, [s.x1, s.y1], [s.x2, s.y2], [s.x, s.y], pts, tol); cur = [s.x, s.y]; }
    }
    if (sp.closed && pts.length > 1) {
      const f = pts[0], l = pts[pts.length - 1];
      if (Math.hypot(f[0] - l[0], f[1] - l[1]) > EPS) pts.push([f[0], f[1]]);
    }
    return { pts, closed: !!sp.closed, area: polyArea(pts) };
  }
  // path d → list of loops (closed subpaths = polygons; open kept with closed:false)
  function flattenPath(d, tol) {
    const t = tol == null ? 0.25 : tol;
    const loops = [];
    for (const sp of F().parsePath(d || '')) if (sp.segs.length) loops.push(subpathToLoop(sp, t));
    return loops;
  }
  function polyArea(pts) {
    let a = 0;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      a += p[0] * q[1] - q[0] * p[1];
    }
    return a / 2;
  }

  // ------------------------------------------------------------- point in poly
  // even-odd or nonzero (winding), for one loop
  function pip(x, y, pts, rule) {
    const n = pts.length;
    if (n < 3) return false;
    if (rule === 'nonzero') {
      let wind = 0;
      for (let i = 0; i < n; i++) {
        const a = pts[i], b = pts[(i + 1) % n];
        if (a[1] <= y) { if (b[1] > y && cross(a, b, [x, y]) > 0) wind++; }
        else if (b[1] <= y && cross(a, b, [x, y]) < 0) wind--;
      }
      return wind !== 0;
    }
    let inside = false;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      if ((a[1] > y) !== (b[1] > y)) {
        const xInt = (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0];
        if (x < xInt) inside = !inside;
      }
    }
    return inside;
  }
  function cross(a, b, p) { return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]); }
  // signed winding number of one (simple, closed) loop
  function winding(x, y, pts) {
    let wind = 0;
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % n];
      if (a[1] <= y) { if (b[1] > y && cross(a, b, [x, y]) > 0) wind++; }
      else if (b[1] <= y && cross(a, b, [x, y]) < 0) wind--;
    }
    return wind;
  }
  // membership in a multi-loop path. evenodd: odd number of containing loops
  // (a reversed/wound hole counts OUT — ORing the loops would be wrong);
  // nonzero: sum of signed winding numbers != 0
  function inLoops(x, y, loops, rule) {
    if (rule === 'nonzero') {
      let w = 0;
      for (const L of loops) if (L.closed) w += winding(x, y, L.pts);
      return w !== 0;
    }
    let cnt = 0;
    for (const L of loops) if (L.closed && pip(x, y, L.pts, 'evenodd')) cnt++;
    return cnt % 2 === 1;
  }

  // ------------------------------------------------------------- edge splitting
  // segment a→b vs c→d: returns {t, u} in [0,1] of the (unique) intersection or
  // null; for collinear overlap it returns the projected parameter set
  function segSolve(a, b, c, d) {
    const r = [b[0] - a[0], b[1] - a[1]], s = [d[0] - c[0], d[1] - c[1]];
    const denom = r[0] * s[1] - r[1] * s[0];
    if (Math.abs(denom) < EPS) {
      // parallel: collinear overlap → project endpoints
      if (Math.abs(cross(a, b, c)) > 1e-9) return null;
      const len2 = r[0] * r[0] + r[1] * r[1] || 1;
      const tOf = (p) => Math.max(0, Math.min(1, ((p[0] - a[0]) * r[0] + (p[1] - a[1]) * r[1]) / len2));
      const uOf = (p) => {
        const len2s = s[0] * s[0] + s[1] * s[1] || 1;
        return Math.max(0, Math.min(1, ((p[0] - c[0]) * s[0] + (p[1] - c[1]) * s[1]) / len2s));
      };
      const ts = [tOf(c), tOf(d)].filter(t => t > EPS && t < 1 - EPS);
      const us = [uOf(a), uOf(b)].filter(u => u > EPS && u < 1 - EPS);
      return { ts, us };
    }
    const t = ((c[0] - a[0]) * s[1] - (c[1] - a[1]) * s[0]) / denom;
    const u = ((c[0] - a[0]) * r[1] - (c[1] - a[1]) * r[0]) / denom;
    if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return null;
    return { t: Math.max(0, Math.min(1, t)), u: Math.max(0, Math.min(1, u)) };
  }
  // all closed loops → set of directed, split, deduped edges
  function splitEdges(loops) {
    // raw edges: {a, b, li (loop index)} — closed loops only
    const raw = [];
    loops.forEach((L, li) => {
      if (!L.closed || L.pts.length < 3) return;
      for (let i = 0; i < L.pts.length; i++) raw.push({ a: L.pts[i], b: L.pts[(i + 1) % L.pts.length], li, i });
    });
    const m = raw.length;
    const extra = raw.map(() => new Set()); // per-edge interior split params
    for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) {
      const e1 = raw[i], e2 = raw[j];
      const r = segSolve(e1.a, e1.b, e2.a, e2.b);
      if (!r) continue;
      if (r.t != null) {
        if (r.t > EPS && r.t < 1 - EPS) extra[i].add(r.t);
        if (r.u > EPS && r.u < 1 - EPS) extra[j].add(r.u);
      } else if (r.ts) {
        for (const t of r.ts) extra[i].add(t);
        for (const u of r.us) extra[j].add(u);
      }
    }
    // emit sub-edges
    const seen = new Set();
    const segs = [];
    raw.forEach((e, i) => {
      const ts = [0, ...[...extra[i]].sort((x, y) => x - y), 1];
      for (let k = 0; k < ts.length - 1; k++) {
        const t0 = ts[k], t1 = ts[k + 1];
        if (t1 - t0 < 1e-9) continue;
        const a = [e.a[0] + (e.b[0] - e.a[0]) * t0, e.a[1] + (e.b[1] - e.a[1]) * t0];
        const b = [e.a[0] + (e.b[0] - e.a[0]) * t1, e.a[1] + (e.b[1] - e.a[1]) * t1];
        const ka = KEY(a), kb = KEY(b);
        if (ka === kb) continue;
        const key = ka + '|' + kb;
        if (seen.has(key)) continue; // exact directed duplicate (coincident shared edge, same direction)
        seen.add(key);
        segs.push({ a, b, ka, kb });
      }
    });
    return segs;
  }
  const KEY = (p) => r2(p[0]) + ',' + r2(p[1]);

  // ------------------------------------------------------------- booleans
  // ops: union | subtract | intersect | exclude
  // dbg (optional callback {segs, kept, region}) — internal instrumentation
  function booleanLoops(A, ruleA, B, ruleB, op, dbg) {
    const testA = (x, y) => inLoops(x, y, A, ruleA);
    const testB = (x, y) => inLoops(x, y, B, ruleB);
    const region = (x, y) => {
      const a = testA(x, y), b = testB(x, y);
      return op === 'union' ? (a || b) : op === 'intersect' ? (a && b) : op === 'subtract' ? (a && !b) : (a !== b);
    };
    const segs = splitEdges(A.concat(B));
    const kept = [];
    for (const s of segs) {
      const mx = (s.a[0] + s.b[0]) / 2, my = (s.a[1] + s.b[1]) / 2;
      const dx = s.b[0] - s.a[0], dy = s.b[1] - s.a[1];
      const len = Math.hypot(dx, dy) || 1;
      const eps = Math.max(1e-4, 1e-3 * len);
      // left normal
      const nx = -dy / len, ny = dx / len;
      const L = region(mx - nx * eps, my - ny * eps);
      const R = region(mx + nx * eps, my + ny * eps);
      if (L === R) continue;
      // re-orient so the region lies on the LEFT — this is what makes the
      // kept edges chain into proper (CCW outer / CW hole) boundary loops
      const k = (!L && R) ? { a: s.b, b: s.a, ka: s.kb, kb: s.ka } : s;
      kept.push(k);
    }
    if (dbg) dbg({ segs, kept, region });
    return traceLoops(kept);
  }
  function traceLoops(segs) {
    const outMap = new Map();
    segs.forEach((s, i) => {
      if (!outMap.has(s.ka)) outMap.set(s.ka, []);
      outMap.get(s.ka).push(i);
    });
    const used = new Array(segs.length).fill(false);
    const loops = [];
    for (let i = 0; i < segs.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      const start = segs[i].ka;
      const pts = [segs[i].a, segs[i].b];
      let cur = segs[i].kb;
      let guard = 0;
      while (cur !== start && guard++ < segs.length + 4) {
        const opts = (outMap.get(cur) || []).filter(j => !used[j]);
        if (!opts.length) break; // dangling (degenerate) — start fresh loop next
        used[opts[0]] = true;
        pts.push(segs[opts[0]].b);
        cur = segs[opts[0]].kb;
      }
      // drop a trailing duplicate of the start point
      const last = pts[pts.length - 1], first = pts[0];
      if (KEY(last) === KEY(first)) pts.pop();
      if (pts.length >= 3) loops.push({ pts, closed: true, area: polyArea(pts) });
    }
    return loops;
  }
  function loopsToD(loops) {
    let d = '';
    for (const L of loops) {
      if (L.pts.length < 3) continue;
      d += (d ? ' ' : '') + 'M ' + r2(L.pts[0][0]) + ' ' + r2(L.pts[0][1]);
      for (let i = 1; i < L.pts.length; i++) d += ' L ' + r2(L.pts[i][0]) + ' ' + r2(L.pts[i][1]);
      d += ' Z';
    }
    return d;
  }

  // ------------------------------------------------------------- public: d-level
  // translate every coordinate of a path (paths are node-local; ops work in one space)
  function translateD(d, dx, dy) {
    if (!dx && !dy) return d;
    const out = [];
    for (const sp of F().parsePath(d)) {
      out.push({
        start: [sp.start[0] + dx, sp.start[1] + dy],
        closed: sp.closed,
        segs: sp.segs.map(s => s.t === 'L'
          ? { t: 'L', x: s.x + dx, y: s.y + dy }
          : { t: 'C', x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy, x: s.x + dx, y: s.y + dy }),
      });
    }
    return F().subpathsToD(out);
  }
  // combine items [{d, rule, x, y}] (node-local paths with world offsets) with op
  function combine(op, items) {
    if (!items || items.length < 2) return null;
    let A = flattenPath(translateD(items[0].d, items[0].x || 0, items[0].y || 0));
    let ruleA = items[0].rule || 'evenodd';
    for (let k = 1; k < items.length; k++) {
      const B = flattenPath(translateD(items[k].d, items[k].x || 0, items[k].y || 0));
      A = booleanLoops(A, ruleA, B, items[k].rule || 'evenodd', op);
      ruleA = 'evenodd'; // folded intermediate results are plain parity regions
    }
    return loopsToD(A);
  }
  // area of a path's region (even-odd semantics) — exact, for tests/UX
  function polygonArea(d, rule) {
    const loops = flattenPath(d, 0.25).filter(L => L.closed);
    let total = 0;
    for (let i = 0; i < loops.length; i++) {
      const L = loops[i];
      // sample: midpoint of the longest edge
      let bi = 0, bl = -1;
      for (let j = 0; j < L.pts.length; j++) {
        const a = L.pts[j], b = L.pts[(j + 1) % L.pts.length];
        const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
        if (l > bl) { bl = l; bi = j; }
      }
      const a = L.pts[bi], b = L.pts[(bi + 1) % L.pts.length];
      const sx = (a[0] + b[0]) / 2, sy = (a[1] + b[1]) / 2;
      let depth = 0;
      for (let j = 0; j < loops.length; j++) if (j !== i && pip(sx, sy, loops[j].pts, 'evenodd')) depth++;
      total += (depth % 2 === 0 ? 1 : -1) * Math.abs(L.area);
    }
    return Math.abs(total);
  }

  // ------------------------------------------------------------- offset / outline
  // offset one closed loop by d (CCW loop → +d is outward). miter join with
  // limit; round joins approximate arcs with polyline segments.
  function offsetLoop(pts, d, opts) {
    const o = Object.assign({ miter: 2, round: false }, opts || {});
    let P = pts.map(p => [p[0], p[1]]);
    // flattenPath() appends a duplicate of the start point at the end of closed
    // loops; a zero-length edge would break the miter join at the first vertex
    P = P.filter((p, i) => !i || Math.hypot(p[0] - P[i - 1][0], p[1] - P[i - 1][1]) > 1e-6);
    while (P.length > 1 && Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]) <= 1e-6) P.pop();
    if (polyArea(P) < 0) P = P.slice().reverse(); // normalize CCW
    const n = P.length;
    if (n < 3) return P;
    const out = [];
    const norm = (i) => {
      const a = P[(i - 1 + n) % n], b = P[i], c = P[(i + 1) % n];
      let v = [b[0] - a[0], b[1] - a[1]], w = [c[0] - b[0], c[1] - b[1]];
      const lv = Math.hypot(v[0], v[1]) || 1, lw = Math.hypot(w[0], w[1]) || 1;
      v = [v[0] / lv, v[1] / lv]; w = [w[0] / lw, w[1] / lw];
      let nx = -(v[1] + w[1]) / 2, ny = (v[0] + w[0]) / 2; // average of left normals (CCW → outward)
      const ln = Math.hypot(nx, ny) || 1;
      return { nx: nx / ln, ny: ny / ln };
    };
    const crossP = (a, b) => a[0] * b[1] - a[1] * b[0];
    // line-line intersection of e_prev (through p0 with dir r) and e_cur
    const lineInt = (p, r, q, s) => {
      const den = crossP(r, s);
      if (Math.abs(den) < EPS) return null;
      const t = crossP([q[0] - p[0], q[1] - p[1]], s) / den;
      return [p[0] + r[0] * t, p[1] + r[1] * t];
    };
    for (let i = 0; i < n; i++) {
      const a = P[(i - 1 + n) % n], b = P[i], c = P[(i + 1) % n];
      const r = [b[0] - a[0], b[1] - a[1]];
      const s = [c[0] - b[0], c[1] - b[1]];
      const lv = Math.hypot(r[0], r[1]) || 1, lw = Math.hypot(s[0], s[1]) || 1;
      const rv = [r[0] / lv, r[1] / lv], sv = [s[0] / lw, s[1] / lw];
      // scene coordinates are Y-down: for a positive-shoelace loop the
      // interior is on the RIGHT of each directed edge, so the outward
      // normal is the "right" normal (dy, −dx). P is normalized positive-
      // shoelace, so a positive turn (cross > 0) = convex corner.
      // A round join only rounds the side the offset opens up: convex
      // corners round on outward offsets (d > 0); reflex corners round on
      // inward offsets (d < 0). The other side stays a sharp miter point —
      // that is what a real stroke join does.
      const convex = r[0] * s[1] - r[1] * s[0] > 0;
      const useRound = o.round && (convex ? d > 0 : d < 0);
      const nr = [rv[1], -rv[0]], ns = [sv[1], -sv[0]];
      const oA = [a[0] + nr[0] * d, a[1] + nr[1] * d];
      const oB = [b[0] + nr[0] * d, b[1] + nr[1] * d];
      const oC = [b[0] + ns[0] * d, b[1] + ns[1] * d];
      // miter point = intersection of the two offset lines (oA + t·r) × (oC + u·s)
      const p1 = lineInt(oA, rv, oC, sv);
      if (p1) {
        const dist = Math.hypot(p1[0] - b[0], p1[1] - b[1]);
        if (d !== 0 && dist > Math.abs(d) * o.miter + EPS && !useRound) {
          // miter too long → bevel
          out.push(oB, oC);
        } else if (useRound && d !== 0) {
          // round: arc from oB to oC around b at radius |d|
          const rad = Math.abs(d);
          const a0 = Math.atan2(oB[1] - b[1], oB[0] - b[0]);
          const a1 = Math.atan2(oC[1] - b[1], oC[0] - b[0]);
          let sweep = a1 - a0;
          while (sweep <= -Math.PI) sweep += 2 * Math.PI;
          while (sweep > Math.PI) sweep -= 2 * Math.PI;
          const steps = Math.max(2, Math.ceil(Math.abs(sweep) / (Math.PI / 8)));
          out.push(oB); // arc start (end of the previous offset edge)
          for (let k = 1; k < steps; k++) {
            const ang = a0 + sweep * (k / steps);
            out.push([b[0] + Math.cos(ang) * rad, b[1] + Math.sin(ang) * rad]);
          }
          out.push(oC);
        } else {
          out.push(p1);
        }
      } else {
        out.push(oB, oC); // parallel (degenerate) → bevel
      }
    }
    // dedupe consecutive duplicates
    const clean = [];
    for (const p of out) {
      const q = clean[clean.length - 1];
      if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6) clean.push(p);
    }
    while (clean.length > 1 && Math.hypot(clean[0][0] - clean[clean.length - 1][0], clean[0][1] - clean[clean.length - 1][1]) <= 1e-6) clean.pop();
    return clean;
  }
  // outline a stroked path: fills = stroke color, stroke removed.
  // align: center → |±w/2|; inside → edge..−w; outside → edge..+w
  // join: 'round' (Figma default) | 'miter'
  function outlineStroke(d, width, align, join) {
    const rounds = (join || 'round') === 'round';
    const loops = flattenPath(d, 0.25).filter(L => L.closed);
    if (!loops.length) return null;
    const out = [];
    const w2 = Math.max(0, width) / 2;
    for (const L of loops) {
      let outer, inner;
      if (align === 'inside') { outer = L.pts; inner = offsetLoop(L.pts, -Math.max(0, width), { miter: 2, round: rounds }); }
      else if (align === 'outside') { outer = offsetLoop(L.pts, Math.max(0, width), { miter: 2, round: rounds }); inner = L.pts; }
      else { outer = offsetLoop(L.pts, w2, { miter: 2, round: rounds }); inner = offsetLoop(L.pts, -w2, { miter: 2, round: rounds }); }
      out.push({ pts: outer, closed: true, area: polyArea(outer) });
      if (inner.length >= 3) {
        const hole = inner.slice().reverse(); // opposite orientation = hole
        out.push({ pts: hole, closed: true, area: polyArea(hole) });
      }
    }
    return loopsToD(out);
  }
  // offset every closed subpath by `dist` (+ = outward), optionally outline both sides
  function offsetD(d, dist, opts) {
    const loops = flattenPath(d, 0.25);
    const out = [];
    for (const L of loops) {
      if (!L.closed) continue; // open subpaths: no fill to offset (documented)
      out.push({ pts: offsetLoop(L.pts, dist, opts), closed: true, area: 0 });
    }
    return loopsToD(out);
  }

  // ------------------------------------------------------------- flatten (Figma)
  // merge many local paths (with world offsets) into ONE path in world space
  function flatten(items) {
    const sub = [];
    for (const it of items) {
      for (const sp of F().parsePath(translateD(it.d, it.x || 0, it.y || 0))) sub.push(sp);
    }
    const d = F().subpathsToD(sub);
    return d || null;
  }

  // ------------------------------------------------------------- shapes (§7)
  // regular polygon / star whose bounding box is exactly (0,0,w,h) — the
  // path's bbox must equal the node's bbox so handles, hit-testing and
  // resize line up (Figma invariant). First vertex at top (−90°); star
  // inner radius = 0.382 (golden ratio, Figma-like).
  function shapePts(kind, count, w, h, ratio) {
    const n = kind === 'star' ? count * 2 : Math.max(3, count || 6);
    const rI = (typeof ratio === 'number' && ratio > 0 && ratio < 1) ? ratio : 0.382;
    const pts = [];
    for (let i = 0; i < n; i++) {
      const ang = -Math.PI / 2 + (i * 2 * Math.PI) / n;
      const rr = kind === 'star' && i % 2 === 1 ? rI : 1;
      pts.push([Math.cos(ang) * rr, Math.sin(ang) * rr]);
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); }
    const sx = x1 === x0 ? 1 : w / (x1 - x0), sy = y1 === y0 ? 1 : h / (y1 - y0);
    return pts.map(p => [(p[0] - x0) * sx, (p[1] - y0) * sy]);
  }
  function shapeD(kind, count, w, h, ratio) {
    const pts = shapePts(kind, count, w, h, ratio);
    let d = 'M ' + r2(pts[0][0]) + ' ' + r2(pts[0][1]);
    for (let i = 1; i < pts.length; i++) d += ' L ' + r2(pts[i][0]) + ' ' + r2(pts[i][1]);
    return d + ' Z';
  }

  global.Booleans = {
    flattenPath, subpathToLoop, polyArea, pip, inLoops,
    booleanLoops, traceLoops, loopsToD,
    translateD, combine, polygonArea,
    offsetLoop, offsetD, outlineStroke,
    flatten, shapePts, shapeD,
  };
})(typeof window !== 'undefined' ? window : globalThis);
