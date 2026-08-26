/* arrange.js — align & distribute operations on a selection (Figma's
 * right-side toolbar): align edges/centers to the selection bounds, and
 * distribute items evenly by center.
 */
(function (global) {
  'use strict';

  const A = {
    // union bounds of the given nodes (page coordinates)
    boxOf(n) {
      return n._w || { x: n.x, y: n.y, w: n.w, h: n.h };
    },
    bounds(page, ids) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const id of ids || []) {
        const n = page.nodes[id];
        if (!n) continue;
        const b = this.boxOf(n);
        x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
        x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
      }
      if (!isFinite(x0)) return null;
      return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    },

    // kind: left | hcenter | right | top | vcenter | bottom
    // Figma: one object aligns to its parent; multiple align to each other.
    align(page, ids, kind) {
      let b = this.bounds(page, ids);
      if (!b) return false;
      if ((ids || []).length === 1) {
        const n = page.nodes[ids[0]];
        const parent = n && n.parent ? page.nodes[n.parent] : null;
        if (parent) b = this.boxOf(parent);
      }
      for (const id of ids || []) {
        const n = page.nodes[id];
        if (!n) continue;
        const bb = this.boxOf(n);
        const dx = n.x - bb.x, dy = n.y - bb.y;
        if (kind === 'left') n.x = b.x + dx;
        else if (kind === 'right') n.x = b.x + b.w - bb.w + dx;
        else if (kind === 'hcenter') n.x = b.x + (b.w - bb.w) / 2 + dx;
        else if (kind === 'top') n.y = b.y + dy;
        else if (kind === 'bottom') n.y = b.y + b.h - bb.h + dy;
        else if (kind === 'vcenter') n.y = b.y + (b.h - bb.h) / 2 + dy;
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
