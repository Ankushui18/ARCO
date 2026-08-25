/* world.js — world-transform computation.
 *
 * SINGLE SOURCE OF TRUTH for geometry.
 *
 * Every module that needs to know where a node lives in world or screen
 * space must go through the functions in this file. The canvas renderer's
 * transform stack (drawNode) applies the EX SAME sequence of transforms
 * (see drawNode in render.js — keep them in lockstep). Do NOT introduce
 * parallel "layout-space" or "selection-space" coordinate systems.
 *
 * After layoutPage + computePage run, each node carries:
 *   n.x, n.y     — parent-local position (authoritative stored value).
 *   n.w, n.h     — size in local content space.
 *   n._wt        — [a,b,c,d,e,f] local(0..w,0..h) → WORLD affine.
 *   n._wc[4]     — 4 WORLD corners [tl,tr,br,bl] after rotate/flip.
 *   n._w         — axis-aligned WORLD bbox enclosing _wc.
 *   n._l         — {x,y,w,h} parent-local placed box (mirrors n.x/y/w/h
 *                  for layout-placed flow children; kept for callers
 *                  that expect it — never used as world geometry).
 *
 * Render, selection, hit-test, resize, snap, marquee, and smart guides
 * all consume n._wt / n._wc / n._w — no independent math.
 */
(function (global) {
  'use strict';

  // --- 2D affine primitives (column-vectors, M·v) ---
  function mul(A, B) {
    return [
      A[0]*B[0] + A[2]*B[1],
      A[1]*B[0] + A[3]*B[1],
      A[0]*B[2] + A[2]*B[3],
      A[1]*B[2] + A[3]*B[3],
      A[0]*B[4] + A[2]*B[5] + A[4],
      A[1]*B[4] + A[3]*B[5] + A[5],
    ];
  }
  function T(tx,ty){return[1,0,0,1,tx,ty];}
  function R(r){const c=Math.cos(r),s=Math.sin(r);return[c,s,-s,c,0,0];}
  function S(sx,sy){return[sx,0,0,sy,0,0];}
  function I(){return[1,0,0,1,0,0];}
  function transformPoint(M,x,y){return{x:M[0]*x+M[2]*y+M[4],y:M[1]*x+M[3]*y+M[5]};}
  function invert(M){
    const [a,b,c,d,e,f]=M;
    const det = a*d - b*c;
    if (Math.abs(det) < 1e-12) return I();
    const ix=d/det, iy=-b/det, jx=-c/det, jy=a/det;
    return [ix,iy,jx,jy, -(ix*e+jx*f), -(iy*e+jy*f)];
  }

  // Local→parent transform. MUST match the sequence applied by drawNode
  // in render.js exactly:
  //   ctx.translate(n.x, n.y);
  //   if (rot|flip) { ctx.translate(w/2,h/2); ctx.rotate(r); ctx.scale(fh,fv); ctx.translate(-w/2,-h/2); }
  // i.e.  M = T(n.x,n.y) · T(w/2,h/2) · R(r) · S(fh,fv) · T(-w/2,-h/2)
  function localToParent(n) {
    const w = n.w||0, h = n.h||0;
    const rot = n.rotation||0;
    const fh = n.flipH ? -1 : 1, fv = n.flipV ? -1 : 1;
    let m = T(n.x||0, n.y||0);
    if (rot || n.flipH || n.flipV) {
      m = mul(m, T(w/2, h/2));
      if (rot) m = mul(m, R(rot));
      if (n.flipH || n.flipV) m = mul(m, S(fh, fv));
      m = mul(m, T(-w/2, -h/2));
    }
    return m;
  }

  function computePage(page) {
    function visit(n, parentWT) {
      const lp = localToParent(n);
      const wt = parentWT ? mul(parentWT, lp) : lp;
      n._wt = wt;
      // Place parent-local box cache (legacy consumers; NOT world coords
      // for rotated parents — use _w/_wc for world geometry).
      n._l = { x: n.x||0, y: n.y||0, w: n.w||0, h: n.h||0 };
      const w = n.w||0, h = n.h||0;
      const cs = [
        transformPoint(wt,0,0), transformPoint(wt,w,0),
        transformPoint(wt,w,h), transformPoint(wt,0,h),
      ];
      n._wc = cs;
      let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;
      for (const p of cs) { x0=Math.min(x0,p.x); y0=Math.min(y0,p.y); x1=Math.max(x1,p.x); y1=Math.max(y1,p.y); }
      n._w = { x:x0, y:y0, w:Math.max(0,x1-x0), h:Math.max(0,y1-y0) };
      const kids = n.children || [];
      for (const cid of kids) {
        const k = page.nodes[cid];
        if (k) visit(k, wt);
      }
    }
    for (const tid of (page.tops||[])) {
      const t = page.nodes[tid];
      if (t) visit(t, null);
    }
  }

  // Invert n._wt → map WORLD point (wx,wy) to node's local content (0..w,0..h).
  function worldToLocal(n, wx, wy) {
    const T2 = n._wt;
    if (!T2) return null;
    const inv = invert(T2);
    return { x: inv[0]*wx + inv[2]*wy + inv[4], y: inv[1]*wx + inv[3]*wy + inv[5] };
  }

  // Convenience: world center of a node (midpoint of _wc diagonal, same
  // as local w/2,h/2 projected through _wt).
  function worldCenter(n) {
    if (n._wt) return transformPoint(n._wt, (n.w||0)/2, (n.h||0)/2);
    const b = n._w || {x:n.x||0,y:n.y||0,w:n.w||0,h:n.h||0};
    return {x:b.x+b.w/2, y:b.y+b.h/2};
  }

  // World → screen projection (single place to apply view transform).
  function worldToScreen(view, p) {
    const z = view.zoom;
    return { x: p.x*z + view.ox, y: p.y*z + view.oy };
  }
  function screenCorners(view, n) {
    if (!n._wc) return null;
    return n._wc.map(p => worldToScreen(view, p));
  }

  global.World = {
    mul, T, R, S, I, invert,
    transformPoint, localToParent, worldToLocal,
    computePage, worldCenter,
    worldToScreen, screenCorners,
  };
})(window);
