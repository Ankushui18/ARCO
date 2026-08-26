/* rotate-interaction.js — Figma-style rotation interaction.
 *
 * Cursor-driven (no fixed dot). When pointer is outside the selection OBB
 * (and not over a resize handle/edge), the cursor becomes a rotate arrow
 * pointing in the direction of the nearest edge outward normal — 8
 * directions (0°, 45°, 90° ... 315°). Dragging anywhere in that zone starts
 * a rotate drag around the selection center. Shift snaps to 15°.
 *
 * Replaces the old "fixed white dot + connector 20px above the top edge"
 * model. Rotation start is detected by a generous OUTSIDE band around the
 * selection; the visible affordance is entirely the cursor.
 */
(function (global) {
  'use strict';

  // -------- 8 rotation cursors (circular arrow, hotspot at center 12,12).
  // We build them once at load.
  function rotateCursorSvg(angleDeg) {
    // A circular arc curving clockwise up the right side, ending at top
    // with an arrowhead. The <g> rotates by angleDeg so the tip points that way.
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">' +
      '<g transform="rotate(' + angleDeg + ' 12 12)">' +
      '<path d="M12 5 A7 7 0 1 1 6.8 7.2" fill="none" stroke="white" stroke-width="1.8" stroke-linecap="round"/>' +
      '<polygon points="12,3.5 9.5,7.5 14.5,7.5" fill="white" stroke="black" stroke-width="1" stroke-linejoin="round"/>' +
      '<path d="M12 5 A7 7 0 1 1 6.8 7.2" fill="none" stroke="black" stroke-width="0.5" stroke-linecap="round" opacity="0.9"/>' +
      '</g></svg>';
    return 'url("data:image/svg+xml;utf8,' + encodeURIComponent(svg) + '") 12 12, auto';
  }
  const ROTATE_CURSORS = [];
  for (let i = 0; i < 8; i++) ROTATE_CURSORS.push(rotateCursorSvg(i * 45));

  // -------- Geometry helpers (use World.screenCorners so we stay in sync
  // with the selection renderer).
  function screenCornersForSel(App) {
    const W = global.World;
    if (App.sel.length === 1) {
      const n = App.page.nodes[App.sel[0]];
      if (!n) return null;
      return W && W.screenCorners ? W.screenCorners(App.view, n) : null;
    }
    // multi: union AABB corners (axis-aligned).
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of App.sel) {
      const n = App.page.nodes[id];
      if (!n || !n._w) continue;
      const z = App.view.zoom, ox = App.view.ox, oy = App.view.oy;
      const b = n._w;
      x0 = Math.min(x0, b.x * z + ox); y0 = Math.min(y0, b.y * z + oy);
      x1 = Math.max(x1, (b.x + b.w) * z + ox); y1 = Math.max(y1, (b.y + b.h) * z + oy);
    }
    if (!isFinite(x0)) return null;
    return [{x:x0,y:y0},{x:x1,y:y0},{x:x1,y:y1},{x:x0,y:y1}];
  }

  // Distance from point to segment. Returns {dist, t, px, py}.
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx-ax, dy = by-ay;
    const l2 = dx*dx + dy*dy;
    let t = l2 > 0 ? ((px-ax)*dx + (py-ay)*dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const qx = ax + t*dx, qy = ay + t*dy;
    return { dist: Math.hypot(px-qx, py-qy), t, px: qx, py: qy };
  }

  // Signed distance of p to edge (a→b) along outward-pointing normal.
  // Positive = outside, negative = inside the convex OBB.
  function outwardSigned(px, py, a, b, center) {
    const ex = b.x-a.x, ey = b.y-a.y;
    const el = Math.hypot(ex,ey) || 1;
    let nx = ey/el, ny = -ex/el;
    const mx = (a.x+b.x)/2, my = (a.y+b.y)/2;
    if ((mx - center.x)*nx + (my - center.y)*ny < 0) { nx = -nx; ny = -ny; }
    return (px - mx)*nx + (py - my)*ny;
  }

  // Classify pointer (mx,my) in screen px against current selection:
  //   'resize-corner' / 'resize-edge' / 'rotate' / 'inside' / 'outside'
  // For 'rotate' also returns:
  //   dir      - 0..7 (cursor variant, matches ROTATE_CURSORS index)
  //   edgeIdx  - which edge the pointer is nearest (0..3: top,R,bot,L for single; always 0 for multi)
  //   center   - world-space center for rotation pivot
  function classify(App, mx, my) {
    const corners = screenCornersForSel(App);
    if (!corners) return { kind:'none' };
    const [c0,c1,c2,c3] = corners;
    const center = { x:(c0.x+c2.x)/2, y:(c0.y+c2.y)/2 };

    // 1) Corner handles (9px hit radius, same as before).
    const CORNER_R = 9;
    const cornerPts = [['nw',c0],['ne',c1],['se',c2],['sw',c3]];
    for (const [name,p] of cornerPts) {
      if (Math.abs(mx-p.x) <= CORNER_R && Math.abs(my-p.y) <= CORNER_R) {
        return { kind:'resize-corner', name };
      }
    }

    // 2) Edges: 5px band on the LINE (inside or outside). Returns resize.
    const edges = [['n',c0,c1],['e',c1,c2],['s',c2,c3],['w',c3,c0]];
    const EDGE_R = 5;
    for (const [name,a,b] of edges) {
      const d = segDist(mx,my,a.x,a.y,b.x,b.y);
      if (d.dist <= EDGE_R) return { kind:'resize-edge', name };
    }

    // 3) Outside band — Figma is a thin halo just outside the bounds
    // (help: "hover just outside one of the layer's bounds"). 40px was
    // swallowing Shift-clicks on a neighbouring section.
    const OUTER = 16, INNER_PAD = 2;
    let minSigned = Infinity;
    let nearestEdge = 0;
    let nearestEdgeSigned = 0;
    for (let i=0;i<4;i++) {
      const [name,a,b] = edges[i];
      const s = outwardSigned(mx,my,a,b,center);
      // also compute distance to the edge line (clamped to segment)
      const d = segDist(mx,my,a.x,a.y,b.x,b.y).dist;
      // "distance outside the shape" measured per-edge:
      // project p onto edge-line, outside the segment ends → corner-adjacent.
      // For nearest-edge selection, combine signed + segment-distance.
      const outsideMetric = s > 0 ? Math.max(s, d) : -s; // proxy
      if (s < minSigned) { minSigned = s; nearestEdge = i; nearestEdgeSigned = s; }
    }

    // More robust "near OBB" check: find closest point on OBB perimeter.
    let bestD = Infinity;
    let bestEdge = 0;
    let bestT = 0;
    for (let i=0;i<4;i++) {
      const [name,a,b] = edges[i];
      const r = segDist(mx,my,a.x,a.y,b.x,b.y);
      if (r.dist < bestD) { bestD = r.dist; bestEdge = i; bestT = r.t; }
    }
    // Signed distance via nearest-edge outward normal.
    const [na,nb] = edges[bestEdge].slice(1);
    const sNear = outwardSigned(mx,my,na,nb,center);

    if (bestD <= OUTER && sNear > -INNER_PAD && sNear >= 0) {
      // Pick rotate direction. 0=top(↑),1=top-right(↗),2=right(→)...
      // For OBB corners, direction follows the corner bisector (45°).
      // Determine if near a corner by bestT.
      let dir;
      if (bestT < 0.18) {
        // near start corner of this edge → diagonal (edge-1)
        dir = (bestEdge * 2 - 1 + 8) % 8;
      } else if (bestT > 0.82) {
        // near end corner → diagonal (edge+1 side)
        dir = (bestEdge * 2 + 1) % 8;
      } else {
        dir = (bestEdge * 2) % 8;
      }
      // dir maps: edge 0(top)→0(up), corner 0-1→7(nw), corner 0+1→1(ne) etc.
      // Actually for edges: n=0(↑=0°), e=2(→=90°), s=4(↓=180°), w=6(←=270°).
      // Corners between n&e (ne)=1(↗=45°), e&s (se)=3(↘=135°), s&w (sw)=5(↙=225°), w&n (nw)=7(↖=315°).
      // Our formula above: bestEdge 0 top: bestT<0.18 → corner w/n = (0*2-1+8)%8=7 (nw, ↖); bestT>0.82 → (0*2+1)%8=1 (ne, ↗). Good.
      // bestEdge 1 (e): t<0.18 → (2-1)=1 (ne, ↗); t>0.82 → 3 (se, ↘). Good.
      // World center (average of corners = OBB center).
      const z = App.view.zoom;
      // Convert screen center back to world for rotation pivot.
      const wcx = (center.x - App.view.ox) / z;
      const wcy = (center.y - App.view.oy) / z;
      return { kind:'rotate', dir, center:{x:wcx,y:wcy}, cursor: ROTATE_CURSORS[dir] };
    }

    // 4) Inside OBB → move.
    // Point-in-OBB: check that for each edge the signed distance (outward) is <= 0.
    let inside = true;
    for (let i=0;i<4;i++) {
      const [name,a,b] = edges[i];
      if (outwardSigned(mx,my,a,b,center) > 2) { inside = false; break; }
    }
    if (inside) return { kind:'inside' };
    return { kind:'outside' };
  }

  // -------- Patch App
  function install() {
    const App = global.App;
    if (!App || App._rotatePatched) return;
    App._rotatePatched = true;

    // Override handleAt: return resize/rotate hits from our classify.
    // Fall through to the previously-installed handleAt (which already
    // handles single-select rotate via the old fixed-dot code and the
    // p0-fixes multi-select rotate dot) for anything we don't recognize,
    // but our classify replaces the fixed-dot model entirely for the
    // outside-band rotate zone.
    const _handleAt = App.handleAt.bind(App);
    App.handleAt = function(e) {
      if (this.tool !== 'move' || this.sel.length < 1) return _handleAt(e);
      const rect = this.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const c = classify(this, mx, my);
      // Never steal a click that is on another object — Figma selects it
      // (or Shift-adds it). Rotate only happens on empty canvas.
      if (c.kind === 'rotate') {
        const under = this.hitTest(this.toWorld(e));
        if (under && !this.sel.includes(under.id)) return _handleAt(e);
      }
      if (c.kind === 'resize-corner') {
        // For multi-select, don't return a corner handle (we don't resize
        // the union AABB in multi-select mode — multi-resize is handled
        // elsewhere, if at all). Fall through so base handleAt (which
        // returns null for sel.length !== 1) can short-circuit.
        if (this.sel.length === 1) return { name:c.name, node: this.page.nodes[this.sel[0]]||null, kind:'resize' };
      }
      if (c.kind === 'resize-edge') {
        if (this.sel.length === 1) return { name:c.name, node: this.page.nodes[this.sel[0]]||null, kind:'resize' };
      }
      if (c.kind === 'rotate') {
        if (this.sel.length === 1) {
          const n = this.page.nodes[this.sel[0]];
          return { name:'rotate', node:n, kind:'rotate', center:c.center, dir:c.dir, cursor:c.cursor };
        } else {
          return { name:'rotate', kind:'rotate-multi', center:c.center, dir:c.dir, cursor:c.cursor };
        }
      }
      return _handleAt(e);
    };

    // Cursor update: set the cursor based on classify WITHOUT triggering
    // a full document redraw. We still fall through to _onMove for pen
    // tool / space-pan / marquee / etc., but suppress its markDirty for
    // pure hover/cursor changes when no drag is active.
    const _onMove = App.onMove.bind(App);
    App.onMove = function(e) {
      // Active drag: let the wrapped onMove handle everything; it sets
      // the 'grabbing' cursor and drives the drag loop.
      if (this._drag) return _onMove(e);

      const c = this.canvas;
      const rect = c.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;

      // Non-move tool (pen/hand/etc.) or space-pan: delegate.
      if (this.tool !== 'move' || this.space) return _onMove(e);

      if (this.sel.length) {
        const cls = classify(this, mx, my);
        if (cls.kind === 'resize-corner' || cls.kind === 'resize-edge') {
          c.style.cursor = cursorFor(cls.name);
          this.view._hoverRotate = false;
          return;
        }
        if (cls.kind === 'rotate') {
          c.style.cursor = cls.cursor;
          this.view._hoverRotate = false;
          return;
        }
        if (cls.kind === 'inside') {
          // When inside the selection OBB, still show I-beam if selection IS a text node,
          // or if the hovered node under the pointer is a text node.
          const onlySel = this.sel.length === 1 ? this.page.nodes[this.sel[0]] : null;
          if (onlySel && onlySel.type === 'text') c.style.cursor = 'text';
          else {
            const under = this.hitTest(this.toWorld(e));
            c.style.cursor = (under && under.type === 'text') ? 'text' : 'default';
          }
          this.view._hoverRotate = false;
          return;
        }
        // 'outside' with no selection nearby — fall through to hitTest
        // default cursor.
      }
      const hit = this.hitTest(this.toWorld(e));
      c.style.cursor = (hit && hit.type === 'text') ? 'text' : (hit ? 'default' : 'default');
    };

    // Make sure rotation drag starts work even when handleAt returns a
    // rotate hit anywhere in the outside band. The existing onDown code
    // already branches on h.kind === 'rotate' and h.kind === 'rotate-multi',
    // using h.center. Our classify() returns center already, but single-
    // select rotation code in onDown recomputes cx/cy from n._w. Patch
    // onDown to prefer h.center when present.
    const _onDown = App.onDown.bind(App);
    App.onDown = function(e) {
      if (e.button !== 0 || this.tool !== 'move') return _onDown(e);
      const under = this.hitTest(this.toWorld(e));
      if (under && !this.sel.includes(under.id)) return _onDown(e);
      const h = this.handleAt(e);
      if (h && (h.kind === 'rotate' || h.kind === 'rotate-multi')) {
        this.history.begin(this.doc);
        const start = this.toWorld(e);
        if (h.kind === 'rotate-multi') {
          this._drag = { kind:'rotate-multi', center:h.center, sa: Math.atan2(start.y-h.center.y,start.x-h.center.x), starts: this.sel.map(id=>({id, r: (this.page.nodes[id].rotation)||0 })) };
        } else {
          const n = h.node;
          n._rotLabel = true;
          this._drag = { kind:'rotate', node:n, startRot:n.rotation||0, cx:h.center.x, cy:h.center.y, sa: Math.atan2(start.y-h.center.y,start.x-h.center.x) };
        }
        e.preventDefault();
        return;
      }
      _onDown(e);
    };

    // Lightweight redraw that does NOT re-layout or repaint panels —
    // used on hover/cursor changes so we never flicker.
    function redrawLightOnly(A) {
      const c = A.canvas; if(!c) return;
      const ctx = A.ctx; if(!ctx) return;
      const rect = c.getBoundingClientRect();
      const v = A.view;
      const R = global.Renderer;
      R.drawPage(ctx, A.page, A.doc, { zoom:v.zoom, ox:v.ox, oy:v.oy, w:rect.width, h:rect.height, grid:v.grid, pixelPreview:v.pixelPreview, canvasColor:v.canvasColor });
      R.drawSelection(ctx, v, A.sel, A.page);
      if (A.marquee) R.drawMarquee(ctx, A.marquee);
      A.drawPenOverlay(ctx);
      R.drawSnapGuides(ctx, v, A._snapGuides);
      R.drawRulers(ctx, v, rect.width, rect.height);
      A.updateZoomLabel();
    }
    App._redrawHover = redrawLightOnly;
  }

  function cursorFor(h) {
    return { nw:'nwse-resize', se:'nwse-resize', ne:'nesw-resize', sw:'nesw-resize',
             n:'ns-resize', s:'ns-resize', e:'ew-resize', w:'ew-resize' }[h] || 'default';
  }

  if (document.readyState === 'complete') install();
  else window.addEventListener('load', install);
  // Also attempt immediately (core may already be loaded by script order)
  install();

  global.RotateInteraction = { classify, ROTATE_CURSORS };
})(window);
