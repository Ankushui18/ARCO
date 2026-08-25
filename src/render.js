/* render.js — Penfig canvas renderer.
 *
 * All geometry comes from the layout engine (Layout.layoutPage); after layout,
 * every node has n._l = {x,y,w,h} in WORLD (page) coordinates and n.x/n.y in
 * PARENT-LOCAL coordinates. drawNode paints in parent-local space and applies
 * the node's own translate → rotate → flip via canvas transforms, so children
 * automatically inherit rotation/flip. Selection/hit-testing uses OBB math
 * in Model (pointInObb / rotatedCorners / obbAabb).
 *
 * The same drawing code powers the editor, PNG export, and dashboard thumbs.
 */
(function (global) {
  'use strict';

  const M = global.Model;
  const imgCache = new Map();   // dataURL → HTMLImageElement

  function imgFor(src) {
    if (!src) return null;
    if (imgCache.has(src)) return imgCache.get(src);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => { img._ready = true; };
    img.src = src;
    imgCache.set(src, img);
    return img;
  }

  function fontStack(n) {
    const t = n.text || {};
    const fam = (t.font || 'Inter').replace(/^["']|["']$/g, '');
    return `'${fam}', Inter, 'Helvetica Neue', Arial, sans-serif`;
  }
  function fontSpec(n, scale = 1) {
    const t = n.text || {};
    const italic = t.italic ? 'italic ' : '';
    return `${italic}${t.weight || 400} ${Math.max(1, t.size * scale)}px ${fontStack(n)}`;
  }

  // ------------------------------------------------------------- text metrics
  let _ctx = null;
  function textCtx() {
    if (!_ctx) _ctx = document.createElement('canvas').getContext('2d');
    return _ctx;
  }
  function wrapText(ctx, text, font, width, ls) {
    ctx.font = font;
    const setLS = () => { try { ctx.letterSpacing = (ls || 0) + 'px'; } catch (e) { } };
    setLS();
    const out = [];
    for (const rawLine of text.split('\n')) {
      if (width <= 0 || rawLine === '') { out.push(rawLine); continue; }
      const words = rawLine.split(/(\s+)/);
      let line = '';
      for (const w of words) {
        const test = line + w;
        const ww = ctx.measureText(test).width;
        if (ww > width && line) { out.push(line.trimEnd()); line = w.startsWith(' ') ? '' : w; }
        else line = test;
      }
      out.push(line.trimEnd());
    }
    try { ctx.letterSpacing = '0px'; } catch (e) { }
    return out;
  }
  function textBoxWidth(n) {
    if (n.als) return n.als.w === 'hug' ? 0 : n.w;
    const r = (n.text && n.text.resize) || 'fixed';
    return (r === 'auto' || r === 'auto-w') ? 0 : n.w;
  }
  function measureText(n, boxW) {
    const t = n.text || {};
    const ctx = textCtx();
    ctx.font = fontSpec(n);
    const size = t.size || 14;
    const lh = (typeof t.lineHeight === 'number' && t.lineHeight > 0) ? t.lineHeight : 1.2;
    const lineH = size * lh;
    const cw = boxW == null ? textBoxWidth(n) : boxW;
    const lines = wrapText(ctx, t.content || '', fontSpec(n), cw > 0 ? cw - 2 : 0, t.letterSpacing);
    let w = 0;
    for (const l of lines) w = Math.max(w, ctx.measureText(l).width);
    return { w: Math.max(1, Math.ceil(w)), h: Math.max(1, Math.ceil(lines.length * lineH)), lines, lineH };
  }
  function setTextCtx(c) { _ctx = c; }
  function textLines(n, boxW) {
    const t = n.text || {};
    const ctx = textCtx();
    ctx.font = fontSpec(n);
    const size = t.size || 14;
    const lh = (typeof t.lineHeight === 'number' && t.lineHeight > 0) ? t.lineHeight : 1.2;
    const lines = wrapText(ctx, t.content || '', fontSpec(n), boxW > 0 ? boxW : 0, t.letterSpacing);
    return { lines, lineH: size * lh };
  }

  // ------------------------------------------------------------- colors
  function resolvedColor(doc, field, fallback) {
    if (!field) return { color: fallback, opacity: 1 };
    let color = field.color || fallback;
    if (field.token) {
      const v = global.Tokens ? global.Tokens.getValue(doc, field.token) : null;
      if (v && typeof v === 'string' && v.startsWith('#')) color = v;
    }
    return { color: M.normHex(color), opacity: field.opacity == null ? 1 : field.opacity };
  }
  function numToken(doc, field, fallback) {
    if (field && typeof field === 'object') {
      if (field.tok) {
        const v = global.Tokens ? global.Tokens.getValue(doc, field.tok) : null;
        if (typeof v === 'number' && isFinite(v)) return v;
      }
      return typeof field.n === 'number' ? field.n : 0;
    }
    return typeof field === 'number' ? field : (fallback || 0);
  }

  // ------------------------------------------------------------- paths
  function roundedPath(ctx, x, y, w, h, r) {
    const [tl, tr, br, bl] = r || [0, 0, 0, 0];
    const rr = (v) => Math.max(0, Math.min(v, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + rr(tl), y);
    ctx.lineTo(x + w - rr(tr), y);
    ctx.arcTo(x + w, y, x + w, y + rr(tr), rr(tr));
    ctx.lineTo(x + w, y + h - rr(br));
    ctx.arcTo(x + w, y + h, x + w - rr(br), y + h, rr(br));
    ctx.lineTo(x + rr(bl), y + h);
    ctx.arcTo(x, y + h, x, y + h - rr(bl), rr(bl));
    ctx.lineTo(x, y + rr(tl));
    ctx.arcTo(x, y, x + rr(tl), y, rr(tl));
    ctx.closePath();
  }

  // Apply stroke dash/cap/join state to ctx and return a restore thunk.
  function applyStrokeStyle(ctx, stroke) {
    const cap = stroke && stroke.cap ? stroke.cap : 'butt';
    const join = stroke && stroke.join ? stroke.join : 'miter';
    const dash = stroke && stroke.dash && stroke.dash.length ? stroke.dash : null;
    ctx.lineCap = cap;
    ctx.lineJoin = join;
    if (dash) ctx.setLineDash(dash);
    return () => { if (dash) ctx.setLineDash([]); };
  }

  function drawPaints(ctx, x, y, w, h, fills, doc) {
    for (const f of fills) {
      if (!f || f.visible === false) continue;
      if (f.type === 'solid') {
        const { color, opacity } = resolvedColor(doc, f, '#000000');
        ctx.globalAlpha = (ctx.globalAlphaBase ?? 1) * opacity;
        ctx.fillStyle = M.rgbaCss(color, 1);
        ctx.fillRect(x, y, w, h);
      } else if (f.type === 'linear') {
        const g = ctx.createLinearGradient(x + (f.from?.x ?? 0) * w, y + (f.from?.y ?? 0) * h, x + (f.to?.x ?? 1) * w, y + (f.to?.y ?? 1) * h);
        for (const s of f.stops || []) {
          const { color, opacity } = resolvedColor(doc, s, '#000000');
          g.addColorStop(Math.max(0, Math.min(1, s.pos ?? 0)), M.rgbaCss(color, opacity));
        }
        ctx.globalAlpha = (ctx.globalAlphaBase ?? 1) * (f.opacity == null ? 1 : f.opacity);
        ctx.fillStyle = g;
        ctx.fillRect(x, y, w, h);
      } else if (f.type === 'radial') {
        const fx = x + (f.from?.x ?? 0.5) * w, fy = y + (f.from?.y ?? 0.5) * h;
        const tx = x + (f.to?.x ?? 0.5) * w, ty = y + (f.to?.y ?? 0.5) * h;
        const r = f.r != null ? f.r * Math.max(w, h) : Math.hypot(w, h) / 2;
        const g = ctx.createRadialGradient(fx, fy, 0, tx, ty, r);
        for (const s of f.stops || []) {
          const { color, opacity } = resolvedColor(doc, s, '#000000');
          g.addColorStop(Math.max(0, Math.min(1, s.pos ?? 0)), M.rgbaCss(color, opacity));
        }
        ctx.globalAlpha = (ctx.globalAlphaBase ?? 1) * (f.opacity == null ? 1 : f.opacity);
        ctx.fillStyle = g;
        ctx.fillRect(x, y, w, h);
      } else if (f.type === 'image') {
        const img = imgFor(f.src);
        if (img && img._ready && img.naturalWidth) {
          const iw = img.naturalWidth, ih = img.naturalHeight;
          ctx.globalAlpha = (ctx.globalAlphaBase ?? 1) * (f.opacity == null ? 1 : f.opacity);
          ctx.save();
          ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
          if (f.scaleMode === 'fit') {
            const s = Math.min(w / iw, h / ih);
            ctx.drawImage(img, x + (w - iw * s) / 2, y + (h - ih * s) / 2, iw * s, ih * s);
          } else if (f.scaleMode === 'fill') {
            const s = Math.max(w / iw, h / ih);
            ctx.drawImage(img, x + (w - iw * s) / 2, y + (h - ih * s) / 2, iw * s, ih * s);
          } else if (f.scaleMode === 'tile') {
            const tw = (f.tileScale || 1) * iw, th = (f.tileScale || 1) * ih;
            for (let yy = y; yy < y + h; yy += th) for (let xx = x; xx < x + w; xx += tw) ctx.drawImage(img, xx, yy, tw, th);
          } else {
            ctx.drawImage(img, x, y, w, h);
          }
          ctx.restore();
        } else {
          ctx.globalAlpha = (ctx.globalAlphaBase ?? 1);
          ctx.fillStyle = '#e5e5e5';
          ctx.fillRect(x, y, w, h);
          ctx.strokeStyle = '#bbb';
          ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        }
      }
    }
    ctx.globalAlpha = ctx.globalAlphaBase ?? 1;
  }

  function drawStroke(ctx, x, y, w, h, r, stroke) {
    if (!stroke || !stroke.visible) return;
    const { color, opacity } = resolvedColor({ color: stroke.color, opacity: stroke.opacity, token: stroke.token }, stroke, '#000000');
    const wt = stroke.width || 0;
    if (wt <= 0) return;
    ctx.save();
    ctx.globalAlpha = opacity * (ctx.globalAlphaBase ?? 1);
    ctx.strokeStyle = M.rgbaCss(color, 1);
    ctx.lineWidth = wt;
    const rss = applyStrokeStyle(ctx, stroke);
    let ox = x, oy = y, ow = w, oh = h;
    if (stroke.align === 'outside') {
      ox -= wt; oy -= wt; ow += wt * 2; oh += wt * 2;
    } else if (stroke.align === 'inside') {
      ctx.save();
      roundedPath(ctx, x, y, w, h, r);
      ctx.clip();
      ox -= wt / 2; oy -= wt / 2; ow += wt; oh += wt;
    } else {
      ox -= wt / 2; oy -= wt / 2; ow += wt; oh += wt;
    }
    roundedPath(ctx, ox, oy, ow, oh, r);
    ctx.stroke();
    rss();
    if (stroke.align === 'inside') ctx.restore();
    ctx.restore();
  }

  function drawShadows(ctx, x, y, w, h, r, shadows) {
    for (const s of shadows || []) {
      if (!s.visible) continue;
      const { color, opacity } = resolvedColor(s, '#000000');
      ctx.save();
      ctx.shadowColor = M.rgbaCss(color, (s.opacity == null ? 1 : s.opacity) * opacity);
      ctx.shadowBlur = (s.blur || 0);
      ctx.shadowOffsetX = s.x || 0;
      ctx.shadowOffsetY = s.y || 0;
      ctx.fillStyle = 'rgba(0,0,0,0.004)';
      const spread = s.spread || 0;
      roundedPath(ctx, x - spread, y - spread, w + spread * 2, h + spread * 2, r);
      ctx.fill();
      ctx.restore();
    }
  }

  // vector node: real path geometry (painted in local coords — caller already
  // translated/rotated/flipped us; no extra translate here).
  function drawVector(ctx, n, doc, x, y, w, h) {
    const d = n.path;
    if (d && typeof Path2D !== 'undefined') {
      try {
        const p = new Path2D(d);
        const rule = n.windingRule === 'evenodd' ? 'evenodd' : 'nonzero';
        ctx.save();
        ctx.translate(x, y);
        // normalize path to box (paths from pen/boolean live in [0..w,0..h])
        ctx.scale(w / (n.pathW || w || 1), h / (n.pathH || h || 1));
        const fill = (n.fills || []).find(f => f && f.visible !== false);
        if (fill) {
          if (fill.type === 'solid') {
            const { color, opacity } = resolvedColor(doc, fill, '#000000');
            ctx.globalAlpha = (ctx.globalAlphaBase ?? 1) * opacity;
            ctx.fillStyle = M.rgbaCss(color, 1);
            ctx.fill(p, rule);
          } else if (fill.type === 'linear') {
            const pw = n.pathW || w || 1, ph = n.pathH || h || 1;
            const g = ctx.createLinearGradient((fill.from?.x ?? 0) * pw, (fill.from?.y ?? 0) * ph, (fill.to?.x ?? 1) * pw, (fill.to?.y ?? 1) * ph);
            for (const s of fill.stops || []) {
              const { color, opacity } = resolvedColor(doc, s, '#000000');
              g.addColorStop(Math.max(0, Math.min(1, s.pos ?? 0)), M.rgbaCss(color, opacity));
            }
            ctx.globalAlpha = (ctx.globalAlphaBase ?? 1) * (fill.opacity == null ? 1 : fill.opacity);
            ctx.fillStyle = g;
            ctx.fill(p, rule);
          } else if (fill.type === 'image') {
            const img = imgFor(fill.src);
            if (img && img._ready && img.naturalWidth) {
              ctx.globalAlpha = (ctx.globalAlphaBase ?? 1) * (fill.opacity == null ? 1 : fill.opacity);
              ctx.save();
              ctx.clip(p, rule);
              ctx.drawImage(img, 0, 0, n.pathW || w, n.pathH || h);
              ctx.restore();
            }
          }
        }
        if (n.stroke && n.stroke.visible && n.stroke.width > 0) {
          const { color, opacity } = resolvedColor(doc, n.stroke, '#000000');
          ctx.globalAlpha = (ctx.globalAlphaBase ?? 1) * (n.stroke.opacity == null ? 1 : n.stroke.opacity);
          ctx.strokeStyle = M.rgbaCss(color, 1);
          ctx.lineWidth = n.stroke.width;
          const rss = applyStrokeStyle(ctx, n.stroke);
          ctx.stroke(p);
          rss();
        }
        ctx.restore();
        return;
      } catch (e) { /* fall through */ }
    }
    ctx.save();
    ctx.globalAlpha = (ctx.globalAlphaBase ?? 1);
    roundedPath(ctx, x, y, w, h, [4, 4, 4, 4]);
    ctx.fillStyle = 'rgba(120,120,130,0.10)';
    ctx.fill();
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = 'rgba(120,120,130,0.55)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  // ------------------------------------------------------------- node paint
  function drawNode(ctx, page, n, doc) {
    if (n.visible === false) return;
    const w = n._l ? n._l.w : n.w, h = n._l ? n._l.h : n.h;
    const lx = n.x, ly = n.y;
    const rot = n.rotation || 0;

    ctx.save();
    ctx.globalAlphaBase = (ctx.globalAlphaBase ?? 1) * (n.opacity == null ? 1 : n.opacity);
    if (n.blend && n.blend !== 'normal' && ctx.globalCompositeOperation !== undefined) {
      const map = { multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten', 'color-dodge': 'color-dodge', 'color-burn': 'color-burn', 'hard-light': 'hard-light', 'soft-light': 'soft-light', difference: 'difference', exclusion: 'exclusion', hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'luminosity' };
      if (map[n.blend]) ctx.globalCompositeOperation = map[n.blend];
    }

    // Local transform: translate to pos → rotate around center → flip →
    // rebase origin to top-left so fills/strokes use (0,0,w,h) local coords.
    ctx.translate(lx + w / 2, ly + h / 2);
    if (rot) ctx.rotate(rot);
    if (n.flipH || n.flipV) ctx.scale(n.flipH ? -1 : 1, n.flipV ? -1 : 1);
    ctx.translate(-w / 2, -h / 2);

    const x = 0, y = 0;

    if ((n.type === 'frame' || n.type === 'instance') && n.clips) {
      roundedPath(ctx, x, y, w, h, n.radius);
      ctx.clip();
    }

    if (n.type === 'frame' || n.type === 'instance') {
      if (n.section && !n.fills.length) {
        ctx.fillStyle = '#efeff1';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = '#d5d5da';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
      } else {
        if (!n.fills.length) { ctx.globalAlpha = (ctx.globalAlphaBase ?? 1); ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fillRect(x, y, w, h); ctx.globalAlpha = ctx.globalAlphaBase; }
      }
      drawPaints(ctx, x, y, w, h, n.fills, doc);
      if (n.grid && n.grid.visible !== false) drawGrid(ctx, x, y, w, h, n.grid);
    } else if (n.type === 'rect') {
      drawShadows(ctx, x, y, w, h, n.radius, n.shadows);
      roundedPath(ctx, x, y, w, h, n.radius);
      ctx.save(); ctx.clip();
      drawPaints(ctx, x, y, w, h, n.fills, doc);
      ctx.restore();
      drawStroke(ctx, x, y, w, h, n.radius, n.stroke);
    } else if (n.type === 'ellipse') {
      drawShadows(ctx, x, y, w, h, null, n.shadows);
      ctx.beginPath();
      ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      ctx.save(); ctx.clip();
      drawPaints(ctx, x, y, w, h, n.fills, doc);
      ctx.restore();
      if (n.stroke && n.stroke.visible) {
        const { color, opacity } = resolvedColor(n.stroke, '#000000');
        ctx.save();
        ctx.globalAlpha = opacity * (ctx.globalAlphaBase ?? 1);
        ctx.strokeStyle = M.rgbaCss(color, 1);
        ctx.lineWidth = n.stroke.width || 0;
        const rss = applyStrokeStyle(ctx, n.stroke);
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, Math.max(0.5, w / 2 - (n.stroke.width || 0) / 2), Math.max(0.5, h / 2 - (n.stroke.width || 0) / 2), 0, 0, Math.PI * 2);
        ctx.stroke();
        rss();
        ctx.restore();
      }
    } else if (n.type === 'line') {
      ctx.save();
      const { color, opacity } = resolvedColor(n.stroke, '#000000');
      ctx.globalAlpha = opacity * (ctx.globalAlphaBase ?? 1);
      ctx.strokeStyle = M.rgbaCss(color, 1);
      ctx.lineWidth = n.stroke.width || 1;
      const rss = applyStrokeStyle(ctx, n.stroke);
      ctx.beginPath();
      ctx.moveTo(x, y + h / 2);
      ctx.lineTo(x + w, y + h / 2);
      ctx.stroke();
      if (n.arrowEnd) {
        const len = Math.max(10, (n.stroke.width || 1) * 5);
        const a = Math.PI * 26 / 180;
        const ex = x + w, ey = y + h / 2;
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - len * Math.cos(a), ey - len * Math.sin(a));
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex - len * Math.cos(-a), ey - len * Math.sin(-a));
        ctx.stroke();
      }
      rss();
      ctx.restore();
    } else if (n.type === 'text') {
      drawText(ctx, page, n, doc);
    } else if (n.type === 'vector') {
      drawVector(ctx, n, doc, x, y, w, h);
    }

    // children (k.x,k.y are parent-local; we're in n's local space).
    if (n.type === 'frame' || n.type === 'rect' || n.type === 'ellipse' || n.type === 'instance') {
      const maskKid = M.kids(page, n).find(k => k.mask);
      if (maskKid) {
        drawNode(ctx, page, maskKid, doc);
        ctx.save();
        if (maskKid.type === 'ellipse') {
          ctx.beginPath();
          ctx.ellipse(maskKid.x + maskKid.w / 2, maskKid.y + maskKid.h / 2, maskKid.w / 2, maskKid.h / 2, 0, 0, Math.PI * 2);
          ctx.clip();
        } else {
          roundedPath(ctx, maskKid.x, maskKid.y, maskKid.w, maskKid.h, maskKid.radius);
          ctx.clip();
        }
        for (const k of M.kids(page, n)) if (k !== maskKid) drawNode(ctx, page, k, doc);
        ctx.restore();
      } else {
        for (const k of M.kids(page, n)) drawNode(ctx, page, k, doc);
      }
    }
    ctx.restore();
  }

  // layout grid (columns / rows) inside a frame — local coords
  function drawGrid(ctx, x, y, w, h, grid) {
    const count = Math.max(1, grid.count || 1);
    const gap = grid.gap || 8, off = grid.offset || 0;
    ctx.save();
    ctx.strokeStyle = 'rgba(13,153,255,0.35)';
    ctx.lineWidth = 1 / (ctx._zoom || 1);
    if (grid.kind === 'rows') {
      const unit = (h - off * 2 - (count - 1) * gap) / count;
      for (let i = 0; i <= count; i++) {
        const yy = y + off + i * (unit + gap);
        ctx.beginPath(); ctx.moveTo(x, yy); ctx.lineTo(x + w, yy); ctx.stroke();
      }
    } else {
      const unit = (w - off * 2 - (count - 1) * gap) / count;
      for (let i = 0; i <= count; i++) {
        const xx = x + off + i * (unit + gap);
        ctx.beginPath(); ctx.moveTo(xx, y); ctx.lineTo(xx, y + h); ctx.stroke();
      }
    }
    ctx.restore();
  }

  function drawText(ctx, page, n, doc) {
    const w = n._l ? n._l.w : n.w, h = n._l ? n._l.h : n.h;
    const t = n.text || {};
    ctx.save();
    ctx.globalAlpha = (ctx.globalAlphaBase ?? 1) * (n.opacity == null ? 1 : n.opacity);
    const fill = n.fills[0];
    const { color, opacity } = resolvedColor(doc, fill || { color: '#1e1e1e' }, '#1e1e1e');
    ctx.fillStyle = M.rgbaCss(color, opacity);
    ctx.font = fontSpec(n);
    try { ctx.letterSpacing = (t.letterSpacing || 0) + 'px'; } catch (e) { }
    const size = t.size || 14;
    const lhMul = (typeof t.lineHeight === 'number' && t.lineHeight > 0) ? t.lineHeight : 1.2;
    const lineH = size * lhMul;
    const { lines } = textLines(n, textBoxWidth(n));
    const totalH = lines.length * lineH;
    let top = 0;
    if (t.valign === 'middle') top = Math.max(0, (h - totalH) / 2);
    else if (t.valign === 'bottom') top = Math.max(0, h - totalH);
    ctx.textBaseline = 'alphabetic';
    lines.forEach((line, i) => {
      let tx = 0;
      const lw = ctx.measureText(line).width;
      if (t.align === 'center') tx = (w - lw) / 2;
      else if (t.align === 'right') tx = w - lw;
      ctx.fillText(line, tx, top + i * lineH + lineH * 0.82);
    });
    try { ctx.letterSpacing = '0px'; } catch (e) { }
    ctx.restore();
  }

  // ------------------------------------------------------------- page paint
  function drawPage(ctx, page, doc, view) {
    ctx.save();
    ctx.clearRect(0, 0, view.w, view.h);
    const zoom = view.zoom;
    const gridStep = 24 * zoom;
    if (gridStep > 7) {
      ctx.fillStyle = 'rgba(0,0,0,0.14)';
      const startX = ((view.ox % gridStep) + gridStep) % gridStep;
      const startY = ((view.oy % gridStep) + gridStep) % gridStep;
      for (let gx = startX; gx < view.w; gx += gridStep) {
        for (let gy = startY; gy < view.h; gy += gridStep) {
          ctx.fillRect(gx, gy, 1, 1);
        }
      }
    }
    if (view.grid) drawGridLines(ctx, view);
    ctx.translate(view.ox, view.oy);
    ctx.scale(zoom, zoom);
    for (const tid of page.tops) {
      const t = page.nodes[tid];
      if (t) drawNode(ctx, page, t, doc);
    }
    ctx.restore();
    // frame name labels (screen space)
    if (zoom >= 0.35) {
      ctx.save();
      ctx.font = `11px Inter, 'Helvetica Neue', Arial, sans-serif`;
      ctx.fillStyle = 'rgba(60,60,70,0.85)';
      const mark = (n) => {
        if (n.type === 'frame' && n._l && n.visible !== false && !n.parent) {
          // project world center of top edge to screen
          const corners = M.rotatedCorners(n, n._l.x, n._l.y, n._l.w, n._l.h);
          // find the topmost corner average
          let topY = Infinity, topCx = 0;
          for (const c of corners) if (c.y < topY) { topY = c.y; topCx = c.x; }
          // use top-center of AABB for label anchor when not rotated
          const ax = n._l.x + n._l.w / 2, ay = n._l.y;
          const sx = ax * zoom + view.ox;
          const sy = ay * zoom + view.oy - 8;
          if (sx > -200 && sx < view.w + 200 && sy > -200 && sy < view.h + 200) {
            ctx.fillText(n.name, sx, sy);
          }
        }
        for (const k of M.kids(page, n)) mark(k);
      };
      for (const tid of page.tops) { const t = page.nodes[tid]; if (t) mark(t); }
      ctx.restore();
    }
  }

  // ------------------------------------------------------------- export
  function renderRegion(page, doc, bounds, scale, opts = {}) {
    const pad = opts.pad || 0;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil((bounds.w + pad * 2) * scale));
    c.height = Math.max(1, Math.ceil((bounds.h + pad * 2) * scale));
    const ctx = c.getContext('2d');
    if (opts.background !== false) {
      ctx.fillStyle = opts.background || 'transparent';
      if (opts.background) ctx.fillRect(0, 0, c.width, c.height);
    }
    ctx.scale(scale, scale);
    ctx.translate(-bounds.x + pad, -bounds.y + pad);
    for (const tid of page.tops) {
      const t = page.nodes[tid];
      if (t) drawNode(ctx, page, t, doc);
    }
    return c;
  }

  function pageBounds(page) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, any = false;
    const addN = (n) => {
      if (!n._l || n.visible === false) return;
      any = true;
      if (n.rotation || n.flipH || n.flipV) {
        const cs = M.rotatedCorners(n, n._l.x, n._l.y, n._l.w, n._l.h);
        for (const p of cs) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
      } else {
        x0 = Math.min(x0, n._l.x); y0 = Math.min(y0, n._l.y);
        x1 = Math.max(x1, n._l.x + n._l.w); y1 = Math.max(y1, n._l.y + n._l.h);
      }
    };
    const visit = (n) => {
      addN(n);
      for (const cid of n.children) { const k = page.nodes[cid]; if (k) visit(k); }
    };
    for (const tid of page.tops) { const t = page.nodes[tid]; if (t) visit(t); }
    if (!any) return { x: 0, y: 0, w: 800, h: 600 };
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  function selectionBounds(page, ids) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, any = false;
    for (const id of ids) {
      const n = page.nodes[id];
      if (!n || !n._l) continue;
      any = true;
      if (n.rotation || n.flipH || n.flipV) {
        const cs = M.rotatedCorners(n, n._l.x, n._l.y, n._l.w, n._l.h);
        for (const p of cs) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
      } else {
        x0 = Math.min(x0, n._l.x); y0 = Math.min(y0, n._l.y);
        x1 = Math.max(x1, n._l.x + n._l.w); y1 = Math.max(y1, n._l.y + n._l.h);
      }
    }
    return any ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }

  // ------------------------------------------------------------- selection overlay
  function drawSelection(ctx, view, ids, page, moving) {
    if (!ids.length) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const z = view.zoom;
    // Build per-node screen rectangles (AABB for rotated nodes) and compute union.
    const rects = [];
    for (const id of ids) {
      const n = page.nodes[id];
      if (!n || !n._l) continue;
      const corners = M.rotatedCorners(n, n._l.x, n._l.y, n._l.w, n._l.h).map(p => ({ x: p.x * z + view.ox, y: p.y * z + view.oy }));
      const bb = M.obbAabb(corners);
      rects.push({ node: n, corners, bb });
    }
    if (!rects.length) { ctx.restore(); return; }
    const union = rects.reduce((a, r) => {
      const b = r.bb;
      return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x), h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y) };
    }, { x: Infinity, y: Infinity, w: 0, h: 0 });

    // Single selection → draw rotated OBB outline (Figma-style).
    if (rects.length === 1) {
      const { node, corners } = rects[0];
      ctx.strokeStyle = '#0d99ff';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(corners[0].x, corners[0].y);
      for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
      ctx.closePath();
      ctx.stroke();
      // 8 resize handles at corners + edge midpoints (in screen/rotated space)
      const hs = 7;
      const pts = [corners[0], { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 }, corners[1], { x: (corners[1].x + corners[2].x) / 2, y: (corners[1].y + corners[2].y) / 2 }, corners[2], { x: (corners[2].x + corners[3].x) / 2, y: (corners[2].y + corners[3].y) / 2 }, corners[3], { x: (corners[3].x + corners[0].x) / 2, y: (corners[3].y + corners[0].y) / 2 }];
      const handleNames = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#0d99ff';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.rect(p.x - hs / 2, p.y - hs / 2, hs, hs);
        ctx.fill(); ctx.stroke();
      }
      // Rotate handle: small circle above the top edge midpoint.
      const midTop = { x: (corners[0].x + corners[1].x) / 2, y: (corners[0].y + corners[1].y) / 2 };
      const rot = node.rotation || 0;
      // offset 20px outward along the edge's outward normal (top edge goes from c0 to c1, outward is -90° from edge direction)
      const ex = corners[1].x - corners[0].x, ey = corners[1].y - corners[0].y;
      const elen = Math.hypot(ex, ey) || 1;
      const nx = -ey / elen, ny = ex / elen; // normal pointing "up" in rotated space
      const rh = { x: midTop.x + nx * 22, y: midTop.y + ny * 22 };
      ctx.strokeStyle = '#0d99ff';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(midTop.x, midTop.y);
      ctx.lineTo(rh.x, rh.y);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(rh.x, rh.y, 5, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      // size label at bottom-center
      ctx.font = '11px Inter, Arial, sans-serif';
      const label = `${Math.round(node._l.w)} × ${Math.round(node._l.h)}`;
      if (node.rotation) label; // could add angle but keep it simple
      const lw = ctx.measureText(label).width;
      const midBot = { x: (corners[2].x + corners[3].x) / 2, y: (corners[2].y + corners[3].y) / 2 };
      ctx.fillStyle = '#fff';
      ctx.fillRect(midBot.x - lw / 2 - 6, midBot.y + 8, lw + 12, 18);
      ctx.fillStyle = '#0d99ff';
      ctx.fillRect(midBot.x - lw / 2 - 6, midBot.y + 8, lw + 12, 1.5);
      ctx.fillStyle = '#333';
      ctx.textAlign = 'center';
      ctx.fillText(label, midBot.x, midBot.y + 21);
      ctx.textAlign = 'start';
      // rotation tooltip: show angle near rotate handle when rotating
      if (node._rotLabel) {
        ctx.font = '11px Inter, Arial, sans-serif';
        const at = `${Math.round(node.rotation * 180 / Math.PI)}°`;
        const aw = ctx.measureText(at).width;
        ctx.fillStyle = '#1e1e1e';
        ctx.fillRect(rh.x - aw / 2 - 6, rh.y - 22, aw + 12, 16);
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center';
        ctx.fillText(at, rh.x, rh.y - 10);
        ctx.textAlign = 'start';
      }
    } else {
      // multi-selection: draw single AABB outline only (handles added in P0 multi-select task)
      ctx.strokeStyle = '#0d99ff';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(union.x - 0.5, union.y - 0.5, union.w, union.h);
      ctx.setLineDash([]);
      // label with count
      ctx.font = '11px Inter, Arial, sans-serif';
      const label = `${ids.length} selected`;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(13,153,255,0.95)';
      ctx.fillRect(union.x, union.y - 20, tw + 10, 18);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, union.x + 5, union.y - 7);
    }
    ctx.restore();
  }

  function drawMarquee(ctx, rect) {
    if (!rect) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = 'rgba(13,153,255,0.08)';
    ctx.strokeStyle = 'rgba(13,153,255,0.8)';
    ctx.lineWidth = 1;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w, rect.h);
    ctx.restore();
  }

  // dev mode: dimension lines around the selection
  function drawDevMeasure(ctx, view, page, doc, selIds) {
    const sel = selIds.map(id => page.nodes[id]).filter(Boolean);
    if (!sel.length) return;
    const zoom = view.zoom;
    const toS = (p) => ({ x: p.x * zoom + view.ox, y: p.y * zoom + view.oy });
    ctx.save();
    ctx.font = '11px Inter, sans-serif';
    ctx.textBaseline = 'middle';
    const label = (txt, x, y) => {
      const wpx = ctx.measureText(txt).width + 8;
      ctx.fillStyle = '#0d99ff';
      ctx.fillRect(x - wpx / 2, y - 8, wpx, 16);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(txt, x, y + 0.5);
      ctx.textAlign = 'start';
    };
    const line = (a, b) => { ctx.strokeStyle = 'rgba(13,153,255,0.8)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };
    for (const n of sel) {
      const L = n._l;
      if (!L) continue;
      const bb = M.obbAabb(M.rotatedCorners(n, L.x, L.y, L.w, L.h).map(p => toS(p)));
      const tl = { x: bb.x, y: bb.y }, br = { x: bb.x + bb.w, y: bb.y + bb.h };
      const midX = (tl.x + br.x) / 2, midY = (tl.y + br.y) / 2;
      line({ x: tl.x, y: tl.y - 24 }, { x: br.x, y: tl.y - 24 });
      label(Math.round(L.w) + '', midX, tl.y - 24);
      line({ x: tl.x - 24, y: tl.y }, { x: tl.x - 24, y: br.y });
      label(Math.round(L.h) + '', tl.x - 24, midY);
      label('x ' + Math.round(L.x) + '  y ' + Math.round(L.y), midX, br.y + 22);
    }
    ctx.restore();
  }

  // ---- view chrome: rulers, grid, smart guides
  function rulerStep(zoom) {
    const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
    for (const s of steps) if (s * zoom >= 60) return s;
    return 10000;
  }
  function drawRulers(ctx, view, w, h) {
    if (!view.rulers) return;
    const RULER = 22, z = view.zoom, ox = view.ox, oy = view.oy;
    ctx.save();
    ctx.fillStyle = '#f5f5f6';
    ctx.fillRect(0, 0, w, RULER);
    ctx.fillRect(0, RULER, RULER, h - RULER);
    ctx.fillRect(0, 0, RULER, RULER);
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0.5, RULER + 0.5); ctx.lineTo(w, RULER + 0.5);
    ctx.moveTo(RULER + 0.5, 0.5); ctx.lineTo(RULER + 0.5, h);
    ctx.stroke();
    const step = rulerStep(z);
    const sub = step / 5;
    ctx.font = '9px Inter, "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = '#8a8a93';
    ctx.strokeStyle = '#b9b9c0';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    let i0 = Math.ceil((-ox / z) / sub - 1e-9);
    for (let i = i0; ; i++) {
      const v = i * sub;
      const sx = v * z + ox;
      if (sx > w - 1) break;
      if (sx < RULER) continue;
      const major = ((i % 5) + 5) % 5 === 0;
      ctx.beginPath();
      ctx.moveTo(sx + 0.5, RULER); ctx.lineTo(sx + 0.5, RULER - (major ? 7 : 4));
      ctx.stroke();
      if (major) ctx.fillText(String(Math.round(v)), sx + 3, RULER - 1);
    }
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    let j0 = Math.ceil((-oy / z) / sub - 1e-9);
    for (let j = j0; ; j++) {
      const v = j * sub;
      const sy = v * z + oy;
      if (sy > h - 1) break;
      if (sy < RULER) continue;
      const major = ((j % 5) + 5) % 5 === 0;
      ctx.beginPath();
      ctx.moveTo(RULER, sy + 0.5); ctx.lineTo(RULER - (major ? 7 : 4), sy + 0.5);
      ctx.stroke();
      if (major) ctx.fillText(String(Math.round(v)), RULER + 3, sy + 1);
    }
    ctx.fillStyle = '#5a5a63';
    const oxS = ox, oyS = oy;
    if (oxS > RULER + 2 && oxS < w) {
      ctx.beginPath(); ctx.moveTo(oxS, RULER + 1); ctx.lineTo(oxS - 4, RULER + 7); ctx.lineTo(oxS + 4, RULER + 7); ctx.closePath(); ctx.fill();
    }
    if (oyS > RULER + 2 && oyS < h) {
      ctx.beginPath(); ctx.moveTo(RULER + 1, oyS); ctx.lineTo(RULER + 7, oyS - 4); ctx.lineTo(RULER + 7, oyS + 4); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  function drawSnapGuides(ctx, view, guides) {
    if (!guides || !guides.length) return;
    ctx.save();
    ctx.translate(view.ox, view.oy);
    ctx.scale(view.zoom, view.zoom);
    ctx.strokeStyle = '#eb1478';
    ctx.lineWidth = 1 / view.zoom;
    for (const g of guides) {
      ctx.beginPath();
      if (g.axis === 'x') { ctx.moveTo(g.at, g.from); ctx.lineTo(g.at, g.to); }
      else { ctx.moveTo(g.from, g.at); ctx.lineTo(g.to, g.at); }
      ctx.stroke();
    }
    ctx.restore();
  }
  function drawGridLines(ctx, view) {
    const step = view.grid;
    if (!step || !(step > 0)) return;
    const z = view.zoom, ox = view.ox, oy = view.oy, w = view.w, h = view.h;
    if (step * z < 4) return;
    const i0 = Math.ceil((-ox / z) / step - 1e-9), i1 = Math.floor((w - ox) / z / step + 1e-9);
    const j0 = Math.ceil((-oy / z) / step - 1e-9), j1 = Math.floor((h - oy) / z / step + 1e-9);
    ctx.save();
    ctx.lineWidth = 1;
    for (let i = i0; i <= i1; i++) {
      const sx = i * step * z + ox;
      ctx.strokeStyle = ((i % 5) + 5) % 5 === 0 ? 'rgba(120,120,150,0.4)' : 'rgba(120,120,150,0.16)';
      ctx.beginPath(); ctx.moveTo(sx + 0.5, 0); ctx.lineTo(sx + 0.5, h); ctx.stroke();
    }
    for (let j = j0; j <= j1; j++) {
      const sy = j * step * z + oy;
      ctx.strokeStyle = ((j % 5) + 5) % 5 === 0 ? 'rgba(120,120,150,0.4)' : 'rgba(120,120,150,0.16)';
      ctx.beginPath(); ctx.moveTo(0, sy + 0.5); ctx.lineTo(w, sy + 0.5); ctx.stroke();
    }
    ctx.restore();
  }

  global.Renderer = {
    drawPage, drawSelection, drawMarquee, drawNode, drawDevMeasure, drawGrid,
    measureText, textLines, fontSpec, textBoxWidth, setTextCtx,
    drawPaints, drawStroke, drawShadows,
    renderRegion, pageBounds, selectionBounds,
    resolvedColor, numToken, imgFor,
    drawRulers, drawSnapGuides, drawGridLines, rulerStep,
    applyStrokeStyle,
  };
})(window);
