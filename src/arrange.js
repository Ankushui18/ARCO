/* arrange.js — align & distribute operations on a selection (Figma's
 * right-side toolbar): align edges/centers to the selection bounds, and
 * distribute items evenly by center.
 */
(function (global) {
  'use strict';

  const A = {
    // union bounds of the given nodes (page coordinates)
    bounds(page, ids) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const id of ids || []) {
        const n = page.nodes[id];
        if (!n) continue;
        x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y);
        x1 = Math.max(x1, n.x + n.w); y1 = Math.max(y1, n.y + n.h);
      }
      if (!isFinite(x0)) return null;
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    },

    // kind: left | hcenter | right | top | vcenter | bottom
    align(page, ids, kind) {
      const b = this.bounds(page, ids);
      if (!b) return false;
      for (const id of ids || []) {
        const n = page.nodes[id];
        if (!n) continue;
        if (kind === 'left') n.x = b.x;
        else if (kind === 'right') n.x = b.x + b.w - n.w;
        else if (kind === 'hcenter') n.x = b.x + (b.w - n.w) / 2;
        else if (kind === 'top') n.y = b.y;
        else if (kind === 'bottom') n.y = b.y + b.h - n.h;
        else if (kind === 'vcenter') n.y = b.y + (b.h - n.h) / 2;
      }
      return true;
    },

    // axis: 'h' distributes by horizontal center, 'v' by vertical center.
    // First/last (extremes) stay put; the middle items are spread evenly.
    distribute(page, ids, axis) {
      const ns = (ids || []).map(id => page.nodes[id]).filter(Boolean);
      if (ns.length < 3) return false;
      const ctr = (n) => (axis === 'h' ? n.x + n.w / 2 : n.y + n.h / 2);
      ns.sort((p, q) => ctr(p) - ctr(q));
      const c0 = ctr(ns[0]);
      const c1 = ctr(ns[ns.length - 1]);
      if (c1 <= c0) return false;
      const step = (c1 - c0) / (ns.length - 1);
      ns.forEach((n, i) => {
        if (i === 0 || i === ns.length - 1) return;
        const c = c0 + step * i;
        if (axis === 'h') n.x = c - n.w / 2; else n.y = c - n.h / 2;
      });
      return true;
    },
  };

  global.Arrange = A;
})(window);
