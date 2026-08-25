/* render.js — Penfig canvas renderer.
 *
 * All geometry comes from the layout engine (Layout.layoutPage); this module
 * only paints with absolute coordinates — no CSS layout anywhere.
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
    return `'$fam', Inter, 'Helvetica Neue', Arial, sans-serif`;
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
  // Wrap constraint for a text node's rendering/measure: 0 = no wrap (hug
  // width), otherwise wrap at the box width. Pure (no canvas) → testable.
  function textBoxWidth(n) {
    if (n.als) return n.als.w === 'hug' ? 0 : n.w; // auto-layout item sizing wins
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
    // boxW == null/undefined → derive the constraint (als item sizing or the
    // node's resize mode); an explicit value (0 = no wrap) overrides.
    const cw = boxW == null ? textBoxWidth(n) : boxW;
    const lines = wrapText(ctx, t.content || '', fontSpec(n), cw > 0 ? cw - 2 : 0, t.letterSpacing);
    let w = 0;
    for (const l of lines) w = Math.max(w, ctx.measureText(l).width);
    return { w: Math.max(1, Math.ceil(w)), h: Math.max(1, Math.ceil(lines.length * lineH)), lines, lineH };
  }
  // test hook: install a measurement context (headless environments have no
  // canvas 2d context — linkedom returns null)
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
    // field: {color, opacity, token} — token is a variable id
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
          } else {
            ctx.drawImage(img, x, y, w, h);
          }
          ctx.restore();
        } else {
          // placeholder while loading
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
    let ox = x, oy = y, ow = w, oh = h;
    if (stroke.align === 'inside') { ctx.translate(wt / 2, wt / 2); ctx.scale(1, 1); }
    if (stroke.align === 'outside') { ox -= wt / 2; oy -= wt / 2; ow += wt; oh += wt; }
    else { ox -= wt / 2; oy -= wt / 2; ow += wt; oh += wt; }
    roundedPath(ctx, ox, oy, ow, oh, r);
    ctx.stroke();
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
      ctx.fillStyle = 'rgba(0,0,0,0.004)'; // triggers shadow paint
      const spread = s.spread || 0;
      roundedPath(ctx, x - spread, y - spread, w + spread * 2, h + spread * 2, r);
      ctx.fill();
      ctx.restore();
    }
  }

  // vector node: real path geometry (imported from .fig blobs or edited),
  // painted in local coordinates (the path bbox ≈ node size) then translated.
  function drawVector(ctx, n, doc, x, y, w, h) {
    const d = n.path;
    if (d && typeof Path2D !== 'undefined') {
      try {
        const p = new Path2D(d);
        const rule = n.windingRule === 'evenodd' ? 'evenodd' : 'nonzero';
        ctx.save();
        ctx.translate(x, y);
        const fill = (n.fills || []).find(f => f && f.visible !== false);
        if (fill) {
          if (fill.type === 'solid') {
            const { color, opacity } = resolvedColor(doc, fill, '#000000');
            ctx.globalAlpha = (ctx.globalAlphaBase ?? 1) * opacity;
            ctx.fillStyle = M.rgbaCss(color, 1);
            ctx.fill(p, rule);
          } else if (fill.type === 'linear') {
            const g = ctx.createLinearGradient((fill.from?.x ?? 0) * w, (fill.from?.y ?? 0) * h, (fill.to?.x ?? 1) * w, (fill.to?.y ?? 1) * h);
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
              const iw = img.naturalWidth, ih = img.naturalHeight;
              ctx.globalAlpha = (ctx.globalAlphaBase ?? 1) * (fill.opacity == null ? 1 : fill.opacity);
              ctx.save();
              ctx.clip(p, rule);
              let dw = w, dh = h, dx = 0, dy = 0;
              if (fill.scaleMode === 'fit') { const s = Math.min(w / iw, h / ih); dw = iw * s; dh = ih * s; dx = (w - dw) / 2; dy = (h - dh) / 2; }
              else if (fill.scaleMode === 'fill') { const s = Math.max(w / iw, h / ih); dw = iw * s; dh = ih * s; dx = (w - dw) / 2; dy = (h - dh) / 2; }
              ctx.drawImage(img, dx, dy, dw, dh);
              ctx.restore();
            }
          }
        }
        if (n.stroke && n.stroke.visible && n.stroke.width > 0) {
          const { color, opacity } = resolvedColor(doc, n.stroke, '#000000');
          ctx.globalAlpha = (ctx.globalAlphaBase ?? 1) * (n.stroke.opacity == null ? 1 : n.stroke.opacity);
          ctx.strokeStyle = M.rgbaCss(color, 1);
          ctx.lineWidth = n.stroke.width;
          ctx.stroke(p);
        }
        ctx.restore();
        return;
      } catch (e) { /* fall through to placeholder below */ }
    }
    // no path data (or no Path2D support): dashed placeholder keeps the slot
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
    const L = n._l;
    if (!L || n.visible === false) return;
    const { x, y, w, h } = L;

    ctx.save();
    ctx.globalAlphaBase = (ctx.globalAlphaBase ?? 1) * (n.opacity == null ? 1 : n.opacity);
    if (n.blend && n.blend !== 'normal' && ctx.globalCompositeOperation !== undefined) {
      const map = { multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten', 'color-dodge': 'color-dodge', 'color-burn': 'color-burn', 'hard-light': 'hard-light', 'soft-light': 'soft-light', difference: 'difference', exclusion: 'exclusion', hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'luminosity' };
      if (map[n.blend]) ctx.globalCompositeOperation = map[n.blend];
    }

    // clip frames/instances to their bounds
    if ((n.type === 'frame' || n.type === 'instance') && n.clips) {
      roundedPath(ctx, x, y, w, h, n.radius);
      ctx.clip();
    }

    if (n.type === 'frame' || n.type === 'instance') {
      if (n.section && !n.fills.length) {
        // Figma-style section: flat gray surface + thin border
        ctx.fillStyle = '#efeff1';
        ctx.fillRect(x, y, w, h);
        ctx.strokeStyle = '#d5d5da';
        ctx.lineWidth = 1;
        ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
      } else {
        // subtle bg when no fills (Figma frames are transparent but visible on canvas)
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
        ctx.beginPath();
        ctx.ellipse(x + w / 2, y + h / 2, Math.max(0.5, w / 2 - (n.stroke.width || 0) / 2), Math.max(0.5, h / 2 - (n.stroke.width || 0) / 2), 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    } else if (n.type === 'line') {
      ctx.save();
      const { color, opacity } = resolvedColor(n.stroke, '#000000');
      ctx.globalAlpha = opacity * (ctx.globalAlphaBase ?? 1);
      ctx.strokeStyle = M.rgbaCss(color, 1);
      ctx.lineWidth = n.stroke.width || 1;
      ctx.beginPath();
      ctx.moveTo(x, y + h / 2);
      ctx.lineTo(x + w, y + h / 2);
      ctx.stroke();
      if (n.arrowEnd) {
        // arrowhead at the end of the line (Figma-style, sized to the stroke)
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
      ctx.restore();
    } else if (n.type === 'text') {
      drawText(ctx, page, n, doc);
    } else if (n.type === 'vector') {
      drawVector(ctx, n, doc, x, y, w, h);
    }

    // children (frames with al get their positions from layout)
    if (n.type === 'frame' || n.type === 'rect' || n.type === 'ellipse' || n.type === 'instance') {
      const maskKid = M.kids(page, n).find(k => k.mask);
      if (maskKid) {
        // mask: draw the mask itself, then clip its siblings to its shape
        drawNode(ctx, page, maskKid, doc);
        ctx.save();
        const ML = maskKid._l;
        if (maskKid.type === 'ellipse') {
          ctx.beginPath();
          ctx.ellipse(ML.x + ML.w / 2, ML.y + ML.h / 2, ML.w / 2, ML.h / 2, 0, 0, Math.PI * 2);
          ctx.clip();
        } else {
          roundedPath(ctx, ML.x, ML.y, ML.w, ML.h, maskKid.radius);
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

  // layout grid (columns / rows) inside a frame
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
    const L = n._l;
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
    let top = L.y;
    if (t.valign === 'middle') top = L.y + Math.max(0, (L.h - totalH) / 2);
    else if (t.valign === 'bottom') top = L.y + Math.max(0, L.h - totalH);
    ctx.textBaseline = 'alphabetic';
    lines.forEach((line, i) => {
      let tx = L.x;
      const lw = ctx.measureText(line).width;
      if (t.align === 'center') tx = L.x + (L.w - lw) / 2;
      else if (t.align === 'right') tx = L.x + L.w - lw;
      // baseline ≈ top + ascent
      ctx.fillText(line, tx, top + i * lineH + lineH * 0.82);
    });
    try { ctx.letterSpacing = '0px'; } catch (e) { }
    ctx.restore();
  }

  // ------------------------------------------------------------- page paint
  function drawPage(ctx, page, doc, view) {
    // view: {zoom, ox, oy, w, h} screen size
    ctx.save();
    ctx.clearRect(0, 0, view.w, view.h);
    // dot grid
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
    // frame name labels (screen-space-ish, scaled font)
    ctx.restore();
    if (zoom >= 0.35) {
      ctx.save();
      ctx.font = `${11}px Inter, 'Helvetica Neue', Arial, sans-serif`;
      ctx.fillStyle = 'rgba(60,60,70,0.85)';
      const mark = (n) => {
        if (n.type === 'frame' && n._l && n.visible !== false && !n.parent) {
          const sx = n._l.x * zoom + view.ox;
          const sy = n._l.y * zoom + view.oy;
          if (sx > -200 && sx < view.w + 200 && sy > -200 && sy < view.h + 200) {
            ctx.fillText(n.name, sx, sy - 8);
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
    const visit = (n) => {
      if (!n._l || n.visible === false) return;
      any = true;
      x0 = Math.min(x0, n._l.x); y0 = Math.min(y0, n._l.y);
      x1 = Math.max(x1, n._l.x + n._l.w); y1 = Math.max(y1, n._l.y + n._l.h);
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
      x0 = Math.min(x0, n._l.x); y0 = Math.min(y0, n._l.y);
      x1 = Math.max(x1, n._l.x + n._l.w); y1 = Math.max(y1, n._l.y + n._l.h);
    }
    return any ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }

  // ------------------------------------------------------------- selection overlay
  function drawSelection(ctx, view, ids, page, moving) {
    if (!ids.length) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const selRects = [];
    for (const id of ids) {
      const n = page.nodes[id];
      if (!n || !n._l) continue;
      const { x, y, w, h } = n._l;
      selRects.push([x * view.zoom + view.ox, y * view.zoom + view.oy, w * view.zoom, h * view.zoom]);
    }
    const union = selRects.reduce((a, r) => [
      Math.min(a[0], r[0]), Math.min(a[1], r[1]),
      Math.max(a[0] + a[2], r[0] + r[2]) - Math.min(a[0], r[0]),
      Math.max(a[1] + a[3], r[1] + r[3]) - Math.min(a[1], r[1]),
    ], [Infinity, Infinity, 0, 0]);
    ctx.strokeStyle = '#0d99ff';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(union[0] - 0.5, union[1] - 0.5, union[2], union[3]);
    // handles on single selection
    if (ids.length === 1) {
      const r = selRects[0];
      const hs = 7;
      const pts = [
        [r[0], r[1]], [r[0] + r[2] / 2, r[1]], [r[0] + r[2], r[1]],
        [r[0] + r[2], r[1] + r[3] / 2], [r[0] + r[2], r[1] + r[3]],
        [r[0] + r[2] / 2, r[1] + r[3]], [r[0], r[1] + r[3]], [r[0], r[1] + r[3] / 2],
      ];
      for (const [px, py] of pts) {
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#0d99ff';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.rect(px - hs / 2, py - hs / 2, hs, hs);
        ctx.fill(); ctx.stroke();
      }
      // size label
      ctx.font = '11px Inter, Arial, sans-serif';
      const label = `${Math.round(union[2])} × ${Math.round(union[3])}`;
      const tw = ctx.measureText(label).width;
      const lx = union[0] + union[2] / 2 - tw / 2;
      const ly = union[1] + union[3] + 14;
      ctx.fillStyle = '#fff';
      ctx.fillRect(lx - 6, ly - 9, tw + 12, 18);
      ctx.fillStyle = '#0d99ff';
      ctx.fillRect(lx - 6, ly - 9, tw + 12, 1.5);
      ctx.fillStyle = '#333';
      ctx.fillText(label, lx, ly + 4);
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

  // dev mode: dimension lines around the selection + distances to parent edges
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
      const tl = toS({ x: L.x, y: L.y }), br = toS({ x: L.x + L.w, y: L.y + L.h });
      const midX = (tl.x + br.x) / 2, midY = (tl.y + br.y) / 2;
      // width (top) & height (left)
      line({ x: tl.x, y: tl.y - 24 }, { x: br.x, y: tl.y - 24 });
      label(Math.round(L.w) + '', midX, tl.y - 24);
      line({ x: tl.x - 24, y: tl.y }, { x: tl.x - 24, y: br.y });
      label(Math.round(L.h) + '', tl.x - 24, midY);
      // position badge
      label('x ' + Math.round(L.x) + '  y ' + Math.round(L.y), midX, br.y + 22);
      // distances to parent edges (Figma-style spacing indicators)
      const parent = n.parent ? page.nodes[n.parent] : null;
      if (parent && parent._l) {
        const P = parent._l;
        const a = toS({ x: L.x + L.w / 2, y: P.y }), b = toS({ x: L.x + L.w / 2, y: L.y });
        if (b.y - a.y > 14) { line(a, b); label(Math.round(L.y - P.y) + '', (a.x + b.x) / 2, (a.y + b.y) / 2); }
        const c = toS({ x: L.x + L.w, y: L.y + L.h / 2 }), d = toS({ x: P.x + P.w, y: L.y + L.h / 2 });
        if (d.x - c.x > 14) { line(c, d); label(Math.round(P.x + P.w - (L.x + L.w)) + '', (c.x + d.x) / 2, (c.y + d.y) / 2); }
      }
    }
    ctx.restore();
  }

  // ---- view chrome: rulers, line grid, smart-guide lines (screen/world space)
  // 1-2-5 ruler step: smallest 1/2/5·10^k such that step*zoom >= 60 px
  function rulerStep(zoom) {
    const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
    for (const s of steps) if (s * zoom >= 60) return s;
    return 10000;
  }
  // Top + left rulers with adaptive 1-2-5 ticks, labels, origin marker.
  // Draws in plain screen px; the bands are opaque (canvas bg #f5f5f6).
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
    // top ruler: world x at screen sx is (sx - ox) / z
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    let i0 = Math.ceil((-ox / z) / sub - 1e-9);
    for (let i = i0; ; i++) {
      const v = i * sub;
      const sx = v * z + ox;
      if (sx > w - 1) break;
      if (sx < RULER) continue; // corner box
      const major = ((i % 5) + 5) % 5 === 0;
      ctx.beginPath();
      ctx.moveTo(sx + 0.5, RULER); ctx.lineTo(sx + 0.5, RULER - (major ? 7 : 4));
      ctx.stroke();
      if (major) ctx.fillText(String(Math.round(v)), sx + 3, RULER - 1);
    }
    // left ruler: world y at screen sy is (sy - oy) / z
    ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    let j0 = Math.ceil((-oy / z) / sub - 1e-9);
    for (let j = j0; ; j++) {
      const v = j * sub;
      const sy = v * z + oy;
      if (sy > h - 1) break;
      if (sy < RULER) continue; // corner box
      const major = ((j % 5) + 5) % 5 === 0;
      ctx.beginPath();
      ctx.moveTo(RULER, sy + 0.5); ctx.lineTo(RULER - (major ? 7 : 4), sy + 0.5);
      ctx.stroke();
      if (major) ctx.fillText(String(Math.round(v)), RULER + 3, sy + 1);
    }
    // origin (0,0) markers
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
  // Magenta alignment lines while a drag is snapping (world-space guide
  // rects: {axis:'x'|'y', at, from, to}).
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
  // Optional line grid under content (view.grid = minor step in world px).
  // View-only chrome: exports never see it.
  function drawGridLines(ctx, view) {
    const step = view.grid;
    if (!step || !(step > 0)) return;
    const z = view.zoom, ox = view.ox, oy = view.oy, w = view.w, h = view.h;
    if (step * z < 4) return; // too dense to be readable
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
  };
})(window);
