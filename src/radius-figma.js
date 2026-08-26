/* radius-figma.js — corner radius + smoothing like Figma.
 * https://help.figma.com/hc/en-us/articles/360050986854-Adjust-corner-radius-and-smoothing
 *
 * Figma: one radius field · Independent corners · canvas circle handles
 * (drag = all, ⌥ = one) · smoothing 0–100% (iOS = 60%) · frames/rects
 * · not lines/ellipses/text · instances stay uniform.
 *
 * Smoothing path: Figma blog / MartinRGB / figma-squircle.
 */
(function (global) {
  'use strict';

  function ready(fn) {
    if (typeof document === 'undefined') return;
    if (document.readyState === 'complete') return fn();
    window.addEventListener('load', fn, { once: true });
  }

  function toRad(d) { return (d * Math.PI) / 180; }
  function n4(v) { return Math.round(v * 10000) / 10000; }

  function cornerParams(R, smoothing, budget) {
    R = Math.max(0, R || 0);
    if (R < 1e-6) return { a: 0, b: 0, c: 0, d: 0, p: 0, arc: 0, R: 0 };
    let s = Math.max(0, Math.min(1, smoothing || 0));
    let p = (1 + s) * R;
    if (budget == null || !isFinite(budget)) budget = Infinity;
    const maxS = budget / R - 1;
    if (isFinite(maxS)) s = Math.min(s, Math.max(0, maxS));
    p = Math.min(p, budget);
    const arcMeasure = 90 * (1 - s);
    const arc = Math.sin(toRad(arcMeasure / 2)) * R * Math.SQRT2;
    const angleAlpha = (90 - arcMeasure) / 2;
    const p3p4 = R * Math.tan(toRad(angleAlpha / 2));
    const angleBeta = 45 * s;
    const c = p3p4 * Math.cos(toRad(angleBeta));
    const d = c * Math.tan(toRad(angleBeta));
    let b = (p - arc - c - d) / 3;
    let a = 2 * b;
    if (!isFinite(a) || a < 0) { a = 0; b = 0; }
    return { a, b, c, d, p, arc, R };
  }

  function clampRadii(w, h, r) {
    const out = [
      Math.max(0, r[0] || 0), Math.max(0, r[1] || 0),
      Math.max(0, r[2] || 0), Math.max(0, r[3] || 0),
    ];
    const halfW = w / 2, halfH = h / 2;
    for (let i = 0; i < 4; i++) out[i] = Math.min(out[i], halfW, halfH);
    if (out[0] + out[1] > w) { const t = w / (out[0] + out[1]); out[0] *= t; out[1] *= t; }
    if (out[3] + out[2] > w) { const t = w / (out[3] + out[2]); out[3] *= t; out[2] *= t; }
    if (out[0] + out[3] > h) { const t = h / (out[0] + out[3]); out[0] *= t; out[3] *= t; }
    if (out[1] + out[2] > h) { const t = h / (out[1] + out[2]); out[1] *= t; out[2] *= t; }
    return out;
  }

  function svgPath(w, h, radii, smooth) {
    const r = clampRadii(w, h, radii || [0, 0, 0, 0]);
    const s = Math.max(0, Math.min(1, smooth || 0));
    const budget = Math.min(w, h) / 2;
    const tl = cornerParams(r[0], s, budget);
    const tr = cornerParams(r[1], s, budget);
    const br = cornerParams(r[2], s, budget);
    const bl = cornerParams(r[3], s, budget);
    let d = 'M ' + n4(w - tr.p) + ' 0';
    if (tr.R) {
      d += ' C ' + n4(w - tr.p + tr.a) + ' 0 ' + n4(w - tr.p + tr.a + tr.b) + ' 0 ' + n4(w - tr.p + tr.a + tr.b + tr.c) + ' ' + n4(tr.d);
      d += ' A ' + n4(tr.R) + ' ' + n4(tr.R) + ' 0 0 1 ' + n4(w - tr.p + tr.a + tr.b + tr.c + tr.arc) + ' ' + n4(tr.d + tr.arc);
      d += ' C ' + n4(w - tr.p + tr.a + tr.b + tr.c + tr.arc + tr.d) + ' ' + n4(tr.d + tr.arc + tr.c) + ' ' +
        n4(w - tr.p + tr.a + tr.b + tr.c + tr.arc + tr.d) + ' ' + n4(tr.d + tr.arc + tr.b + tr.c) + ' ' + n4(w) + ' ' + n4(tr.p);
    } else d += ' L ' + n4(w) + ' 0';
    d += ' L ' + n4(w) + ' ' + n4(h - br.p);
    if (br.R) {
      d += ' C ' + n4(w) + ' ' + n4(h - br.p + br.a) + ' ' + n4(w) + ' ' + n4(h - br.p + br.a + br.b) + ' ' + n4(w - br.d) + ' ' + n4(h - br.p + br.a + br.b + br.c);
      d += ' A ' + n4(br.R) + ' ' + n4(br.R) + ' 0 0 1 ' + n4(w - br.d - br.arc) + ' ' + n4(h - br.p + br.a + br.b + br.c + br.arc);
      d += ' C ' + n4(w - br.d - br.arc - br.c) + ' ' + n4(h - br.p + br.a + br.b + br.c + br.arc + br.d) + ' ' +
        n4(w - br.d - br.arc - br.b - br.c) + ' ' + n4(h - br.p + br.a + br.b + br.c + br.arc + br.d) + ' ' + n4(w - br.p) + ' ' + n4(h);
    } else d += ' L ' + n4(w) + ' ' + n4(h);
    d += ' L ' + n4(bl.p) + ' ' + n4(h);
    if (bl.R) {
      d += ' C ' + n4(bl.p - bl.a) + ' ' + n4(h) + ' ' + n4(bl.p - bl.a - bl.b) + ' ' + n4(h) + ' ' + n4(bl.p - bl.a - bl.b - bl.c) + ' ' + n4(h - bl.d);
      d += ' A ' + n4(bl.R) + ' ' + n4(bl.R) + ' 0 0 1 ' + n4(bl.p - bl.a - bl.b - bl.c - bl.arc) + ' ' + n4(h - bl.d - bl.arc);
      d += ' C ' + n4(bl.p - bl.a - bl.b - bl.c - bl.arc - bl.d) + ' ' + n4(h - bl.d - bl.arc - bl.c) + ' ' +
        n4(bl.p - bl.a - bl.b - bl.c - bl.arc - bl.d) + ' ' + n4(h - bl.d - bl.arc - bl.b - bl.c) + ' ' + n4(0) + ' ' + n4(h - bl.p);
    } else d += ' L 0 ' + n4(h);
    d += ' L 0 ' + n4(tl.p);
    if (tl.R) {
      d += ' C 0 ' + n4(tl.p - tl.a) + ' 0 ' + n4(tl.p - tl.a - tl.b) + ' ' + n4(tl.d) + ' ' + n4(tl.p - tl.a - tl.b - tl.c);
      d += ' A ' + n4(tl.R) + ' ' + n4(tl.R) + ' 0 0 1 ' + n4(tl.d + tl.arc) + ' ' + n4(tl.p - tl.a - tl.b - tl.c - tl.arc);
      d += ' C ' + n4(tl.d + tl.arc + tl.c) + ' ' + n4(tl.p - tl.a - tl.b - tl.c - tl.arc - tl.d) + ' ' +
        n4(tl.d + tl.arc + tl.b + tl.c) + ' ' + n4(tl.p - tl.a - tl.b - tl.c - tl.arc - tl.d) + ' ' + n4(tl.p) + ' 0';
    } else d += ' L 0 0';
    d += ' Z';
    return d;
  }

  function svgArc(ctx, x1, y1, rx, ry, phiDeg, fa, fs, x2, y2) {
    if (!(rx > 0) || !(ry > 0)) { ctx.lineTo(x2, y2); return; }
    const phi = toRad(phiDeg || 0);
    const cos = Math.cos(phi), sin = Math.sin(phi);
    const dx = (x1 - x2) / 2, dy = (y1 - y2) / 2;
    const x1p = cos * dx + sin * dy, y1p = -sin * dx + cos * dy;
    let rx2 = rx * rx, ry2 = ry * ry, x1p2 = x1p * x1p, y1p2 = y1p * y1p;
    const lam = x1p2 / rx2 + y1p2 / ry2;
    if (lam > 1) {
      const k = Math.sqrt(lam);
      rx *= k; ry *= k; rx2 = rx * rx; ry2 = ry * ry;
    }
    const sign = fa === fs ? -1 : 1;
    let sq = (rx2 * ry2 - rx2 * y1p2 - ry2 * x1p2) / (rx2 * y1p2 + ry2 * x1p2);
    sq = Math.max(0, sq);
    const coef = sign * Math.sqrt(sq);
    const cxp = coef * (rx * y1p) / ry;
    const cyp = coef * -(ry * x1p) / rx;
    const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
    const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
    const ux = (x1p - cxp) / rx, uy = (y1p - cyp) / ry;
    const vx = (-x1p - cxp) / rx, vy = (-y1p - cyp) / ry;
    const theta = Math.atan2(uy, ux);
    let dtheta = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
    if (!fs && dtheta > 0) dtheta -= Math.PI * 2;
    if (fs && dtheta < 0) dtheta += Math.PI * 2;
    ctx.ellipse(cx, cy, rx, ry, phi, theta, theta + dtheta, !fs);
  }

  function replay(ctx, d, ox, oy) {
    const parts = String(d).match(/[MLCAZ][^MLCAZ]*/gi) || [];
    let cx = ox, cy = oy;
    ctx.beginPath();
    for (let i = 0; i < parts.length; i++) {
      const t = parts[i][0];
      const nums = parts[i].slice(1).trim().split(/[\s,]+/).filter(Boolean).map(Number);
      if (t === 'M') { cx = nums[0] + ox; cy = nums[1] + oy; ctx.moveTo(cx, cy); }
      else if (t === 'L') { cx = nums[0] + ox; cy = nums[1] + oy; ctx.lineTo(cx, cy); }
      else if (t === 'C') {
        ctx.bezierCurveTo(nums[0] + ox, nums[1] + oy, nums[2] + ox, nums[3] + oy, nums[4] + ox, nums[5] + oy);
        cx = nums[4] + ox; cy = nums[5] + oy;
      } else if (t === 'A') {
        svgArc(ctx, cx, cy, nums[0], nums[1], nums[2], nums[3], nums[4], nums[5] + ox, nums[6] + oy);
        cx = nums[5] + ox; cy = nums[6] + oy;
      } else if (t === 'Z' || t === 'z') ctx.closePath();
    }
  }

  function applyPath(ctx, x, y, w, h, radii, smooth) {
    const s = Math.max(0, Math.min(1, smooth || 0));
    if (s < 0.001) return false;
    replay(ctx, svgPath(w, h, radii, s), x, y);
    return true;
  }

  function supportsRadius(n) {
    if (!n) return false;
    if (n.type === 'line' || n.type === 'text' || n.type === 'ellipse') return false;
    return n.type === 'frame' || n.type === 'rect' || n.type === 'instance'
      || n.shape === 'polygon' || n.shape === 'star' || n.shape === 'triangle'
      || n.type === 'vector';
  }

  function isInstance(n) { return n && n.type === 'instance'; }

  function linked(n) {
    if (n.radiusIndependent) return false;
    const r = n.radius || [0, 0, 0, 0];
    return r.every((v) => v === r[0]);
  }

  global.RadiusFigma = { cornerParams, clampRadii, svgPath, supportsRadius, path: applyPath };

  ready(function () {
    const App = global.App;
    const P = global.Panels;
    const R = global.Renderer;
    const Wd = global.World;
    if (!App) return;

    function ensureRadius(n) {
      if (!n.radius || n.radius.length !== 4) n.radius = [0, 0, 0, 0];
      if (n.cornerSmooth == null) n.cornerSmooth = 0;
    }

    if (P && P.refreshInspector) {
      const _ri = P.refreshInspector.bind(P);
      P.refreshInspector = function () {
        _ri();
        const el = document.getElementById('ed-right');
        if (!el || !App.page || !App.sel || App.sel.length !== 1) return;
        const n = App.page.nodes[App.sel[0]];
        const old = el.querySelector('.radius-row');
        if (!supportsRadius(n)) { if (old) old.style.display = 'none'; return; }
        ensureRadius(n);
        if (old) old.style.display = 'none';
        const host = el.querySelector('.ins-tab-content') || el;
        if (host.querySelector('[data-act="rad-all"]') || host.querySelector('[data-radx]')) return;
        const inst = isInstance(n);
        const isLink = inst || linked(n);
        const r = n.radius;
        const sm = Math.round((n.cornerSmooth || 0) * 100);
        const sec = document.createElement('section');
        sec.className = 'ins-sec pf-rad-sec';
        sec.innerHTML =
          '<div class="ins-head"><span>Corner radius</span>' +
            (inst ? '' : '<button type="button" class="ed-btn sm" data-act="rad-ind" title="Independent corners">' +
              (isLink ? 'Independent' : 'Uniform') + '</button>') +
          '</div>' +
          (isLink
            ? '<div class="ins-grid g2"><label>Radius</label><input type="number" min="0" step="1" data-act="rad-all" value="' + Math.round(r[0] || 0) + '"></div>'
            : '<div class="pf-rad-grid">' +
                '<input type="number" min="0" data-radx="0" title="Top left" value="' + Math.round(r[0] || 0) + '">' +
                '<input type="number" min="0" data-radx="1" title="Top right" value="' + Math.round(r[1] || 0) + '">' +
                '<input type="number" min="0" data-radx="3" title="Bottom left" value="' + Math.round(r[3] || 0) + '">' +
                '<input type="number" min="0" data-radx="2" title="Bottom right" value="' + Math.round(r[2] || 0) + '">' +
              '</div>') +
          '<div class="ins-row pf-smooth-row"><label>Smoothing</label>' +
            '<input type="range" min="0" max="100" data-act="rad-smooth" value="' + sm + '">' +
            '<span class="ins-val" data-act="rad-smv">' + sm + '%</span>' +
            '<button type="button" class="ed-btn sm" data-act="rad-ios" title="iOS default 60%">iOS</button>' +
          '</div>';
        const pos = host.querySelector('.ins-sec');
        if (pos) pos.after(sec); else host.insertBefore(sec, host.firstChild);

        function commit(fn) {
          App.history.begin(App.doc); fn(); App.history.end(App.doc); App.markDirty();
        }
        const all = sec.querySelector('[data-act="rad-all"]');
        if (all) all.addEventListener('change', () => {
          const v = Math.max(0, parseFloat(all.value) || 0);
          commit(() => { n.radius = [v, v, v, v]; });
        });
        sec.querySelectorAll('[data-radx]').forEach((inp) => {
          inp.addEventListener('change', () => {
            const i = +inp.dataset.radx;
            const v = Math.max(0, parseFloat(inp.value) || 0);
            commit(() => { n.radiusIndependent = true; n.radius[i] = v; });
          });
        });
        const ind = sec.querySelector('[data-act="rad-ind"]');
        if (ind) ind.onclick = () => {
          commit(() => {
            if (linked(n) && !n.radiusIndependent) n.radiusIndependent = true;
            else {
              n.radiusIndependent = false;
              const v = n.radius[0] || 0;
              n.radius = [v, v, v, v];
            }
          });
          P.refreshInspector();
        };
        const smInp = sec.querySelector('[data-act="rad-smooth"]');
        const smLab = sec.querySelector('[data-act="rad-smv"]');
        if (smInp) smInp.addEventListener('input', () => {
          const v = Math.max(0, Math.min(100, +smInp.value || 0));
          if (smLab) smLab.textContent = v + '%';
          commit(() => { n.cornerSmooth = v / 100; });
        });
        const ios = sec.querySelector('[data-act="rad-ios"]');
        if (ios) ios.onclick = () => { commit(() => { n.cornerSmooth = 0.6; }); P.refreshInspector(); };
      };
    }

    function handleLocals(n) {
      const w = n.w || 0, h = n.h || 0;
      const r = n.radius || [0, 0, 0, 0];
      const t = (i) => Math.max(10, Math.min(r[i] || 12, Math.min(w, h) * 0.4));
      return [
        { i: 0, x: t(0), y: t(0) },
        { i: 1, x: w - t(1), y: t(1) },
        { i: 2, x: w - t(2), y: h - t(2) },
        { i: 3, x: t(3), y: h - t(3) },
      ];
    }

    function handleScreens(n, view) {
      if (!n._wt || !Wd) return [];
      return handleLocals(n).map((h) => {
        const p = Wd.transformPoint(n._wt, h.x, h.y);
        return { i: h.i, x: p.x * view.zoom + view.ox, y: p.y * view.zoom + view.oy };
      });
    }

    function hitRadius(e) {
      if (App.tool !== 'move' || !App.sel || App.sel.length !== 1) return null;
      const n = App.page.nodes[App.sel[0]];
      if (!n || n.locked) return null;
      if (n.type !== 'frame' && n.type !== 'rect' && n.type !== 'instance') return null;
      const rect = App.canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      for (const h of handleScreens(n, App.view)) {
        if (Math.hypot(mx - h.x, my - h.y) <= 8) return { n, i: h.i };
      }
      return null;
    }

    function radiusFromLocal(n, i, lx, ly) {
      const w = n.w || 0, h = n.h || 0;
      if (i === 0) return Math.max(0, Math.min((lx + ly) / 2, w / 2, h / 2));
      if (i === 1) return Math.max(0, Math.min(((w - lx) + ly) / 2, w / 2, h / 2));
      if (i === 2) return Math.max(0, Math.min(((w - lx) + (h - ly)) / 2, w / 2, h / 2));
      return Math.max(0, Math.min((lx + (h - ly)) / 2, w / 2, h / 2));
    }

    const _onDown = App.onDown && App.onDown.bind(App);
    App.onDown = function (e) {
      if (e.button === 0 && this.tool === 'move') {
        const hit = hitRadius(e);
        if (hit) {
          this.history.begin(this.doc);
          this._drag = { kind: 'radius', node: hit.n, i: hit.i, all: !e.altKey && linked(hit.n) };
          e.preventDefault();
          return;
        }
      }
      return _onDown ? _onDown(e) : undefined;
    };

    const _onMove = App.onMove && App.onMove.bind(App);
    App.onMove = function (e) {
      const d = this._drag;
      if (d && d.kind === 'radius') {
        const n = d.node;
        const world = this.toWorld(e);
        const lp = (Wd && n._wt) ? Wd.worldToLocal(n, world.x, world.y) : null;
        if (!lp) return;
        let v = radiusFromLocal(n, d.i, lp.x, lp.y);
        v = e.shiftKey ? Math.round(v / 10) * 10 : Math.round(v);
        ensureRadius(n);
        if (d.all) n.radius = [v, v, v, v];
        else { n.radiusIndependent = true; n.radius[d.i] = v; }
        this.status('Radius  ' + Math.round(v));
        this.markDirty();
        return;
      }
      if (!this._drag && this.tool === 'move' && this.canvas && hitRadius(e)) {
        this.canvas.style.cursor = 'pointer';
      }
      return _onMove ? _onMove(e) : undefined;
    };

    const _onUp = App.onUp && App.onUp.bind(App);
    App.onUp = function (e) {
      if (this._drag && this._drag.kind === 'radius') {
        this.history.end(this.doc);
        this._drag = null;
        if (P.refreshInspector) P.refreshInspector();
        this.markDirty();
        return;
      }
      if (_onUp) _onUp(e);
    };

    const _ds = R && R.drawSelection && R.drawSelection.bind(R);
    if (_ds) {
      R.drawSelection = function (ctx, view, ids, page, moving) {
        _ds(ctx, view, ids, page, moving);
        if (!ids || ids.length !== 1) return;
        const n = page.nodes[ids[0]];
        if (!n || (n.type !== 'frame' && n.type !== 'rect' && n.type !== 'instance')) return;
        const hs = handleScreens(n, view);
        if (!hs.length) return;
        const dpr = window.devicePixelRatio || 1;
        ctx.save();
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        for (const h of hs) {
          ctx.beginPath();
          ctx.arc(h.x, h.y, 4.5, 0, Math.PI * 2);
          ctx.fillStyle = '#fff';
          ctx.fill();
          ctx.strokeStyle = '#0d99ff';
          ctx.lineWidth = 1.25;
          ctx.stroke();
        }
        ctx.restore();
      };
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
