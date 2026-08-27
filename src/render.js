/* render.js — Penfig canvas renderer.
 *
 * Coordinate model (SINGLE SOURCE OF TRUTH — keep in sync with world.js):
 *   n.x, n.y     — parent-local position (where Layout places children).
 *   n.w, n.h     — size in LOCAL content space.
 *   n._wt        — [a,b,c,d,e,f] local(0..w,0..h) → WORLD affine (World.js).
 *   n._wc[4]     — 4 WORLD corners [tl,tr,br,bl] after rotate/flip.
 *   n._w         — {x,y,w,h} axis-aligned WORLD bounding box.
 *   n._l         — {x,y,w,h} parent-local placed box (mirror of n.x/y/w/h).
 *
 * The canvas transform stack in drawNode applies the EXACT same sequence
 * as World.localToParent — that is how render geometry and interaction
 * geometry stay aligned. If you change one, change the other.
 *
 *   ctx.translate(n.x, n.y)
 *   if (rot|flip) { ctx.translate(w/2,h/2); rotate(r); scale(fh,fv); translate(-w/2,-h/2); }
 *
 * Selection/hit-test/resize/snap consume n._wc projected to screen via
 * World.screenCorners(view, n). No independent "selection math".
 */
(function (global) {
  'use strict';

  // Transient editor state. Kept outside the document so it is never saved,
  // exported, cloned, or included in undo snapshots.
  let editingTextId = null;
  function setEditingText(id) { editingTextId = id || null; }

  const M = global.Model;
  const imgCache = new Map();

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
    // Use the Fonts manager's canonical stack if available so Google Fonts
    // are picked up; otherwise a sensible system fallback.
    if (global.Fonts && global.Fonts.stack) return global.Fonts.stack(fam);
    return `"${fam}", Inter, -apple-system, 'Helvetica Neue', Arial, sans-serif`;
  }
  function fontSpec(n, scale = 1, override) {
    const t = n.text || {};
    const o = override || {};
    const weight = o.weight != null ? o.weight : (t.weight || 400);
    const sz = Math.max(1, (o.size != null ? o.size : t.size) * scale);
    const italic = o.italic != null ? (o.italic ? 'italic ' : '') : (t.italic ? 'italic ' : '');
    const ff = o.font || fontStack(n);
    return `${italic}${weight} ${sz}px ${ff}`;
  }
  // Apply per-run styles to ctx (font, fillStyle). Used by rich text renderer.
  function applyRunStyle(ctx, run, n, doc) {
    const t = n.text || {};
    ctx.font = fontSpec(n, 1, run);
    try { ctx.letterSpacing = ((run.letterSpacing != null ? run.letterSpacing : t.letterSpacing) || 0) + 'px'; } catch(e){}
    let col;
    if (run.color) col = run.color;
    else {
      const fill = n.fills && n.fills[0];
      const { color, opacity } = resolvedColor(doc, fill || { color: '#ffffff' }, '#ffffff');
      ctx.globalAlpha = (ctx.globalAlphaBase ?? 1) * (n.opacity == null ? 1 : n.opacity) * (fill && fill.opacity != null ? fill.opacity : 1) * (run.opacity != null ? run.opacity : 1);
      ctx.fillStyle = M.rgbaCss(color, opacity);
      return;
    }
    const op = run.opacity != null ? run.opacity : ((n.fills && n.fills[0] && n.fills[0].opacity != null) ? n.fills[0].opacity : 1);
    ctx.fillStyle = M.rgbaCss(col, op);
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
    for (const rawLine of String(text || '').split('\n')) {
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
  // Text wrap width in LOCAL content space.
  function textBoxWidth(n) {
    if (n.als) return n.als.w === 'hug' ? 0 : n.w;
    const r = (n.text && n.text.resize) || 'fixed';
    return (r === 'auto' || r === 'auto-w') ? 0 : n.w;
  }
  function measureText(n, boxW) {
    if (global.TextEngine && global.TextEngine.measure) return global.TextEngine.measure(n, boxW);
    const t = n.text || {};
    const ctx = textCtx();
    ctx.font = fontSpec(n);
    const size = t.size || 14;
    const lhMul = (typeof t.lineHeight === 'number' && t.lineHeight > 0) ? t.lineHeight : 1.2;
    const lineH = size * lhMul;
    const cw = (boxW == null) ? textBoxWidth(n) : boxW;
    const lines = wrapText(ctx, t.content || '', fontSpec(n), cw > 0 ? cw - 2 : 0, t.letterSpacing);
    let w = 0;
    for (const l of lines) w = Math.max(w, ctx.measureText(l).width);
    return { w: Math.max(1, Math.ceil(w)), h: Math.max(1, Math.ceil(lines.length * lineH)), lines, lineH };
  }
  function setTextCtx(c) { _ctx = c; }
  function textLines(n, boxW) {
    if (global.TextEngine && global.TextEngine.textLines) return global.TextEngine.textLines(n, boxW);
    const t = n.text || {};
    const ctx = textCtx();
    ctx.font = fontSpec(n);
    const size = t.size || 14;
    const lhMul = (typeof t.lineHeight === 'number' && t.lineHeight > 0) ? t.lineHeight : 1.2;
    const lines = wrapText(ctx, t.content || '', fontSpec(n), boxW > 0 ? boxW : 0, t.letterSpacing);
    return { lines, lineH: size * lhMul };
  }

  // ------------------------------------------------------------- colors
  function resolvedColor(doc, field, fallback) {
    if (!field) return { color: fallback, opacity: 1 };
    let color = field.color || fallback;
    if (field.token && global.Tokens) {
      const v = global.Tokens.getValue(doc, field.token);
      if (v && typeof v === 'string' && v.startsWith('#')) color = v;
    }
    return { color: M.normHex(color), opacity: field.opacity == null ? 1 : field.opacity };
  }

  // ------------------------------------------------------------- paths
  function roundedPath(ctx, x, y, w, h, r) {
    if (global.RadiusFigma && global.RadiusFigma.path) {
      if (global.RadiusFigma.path(ctx, x, y, w, h, r, ctx._cornerSmooth || 0)) return;
    }
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

  function applyStrokeStyle(ctx, stroke) {
    ctx.lineCap = (stroke && stroke.cap) || 'butt';
    ctx.lineJoin = (stroke && stroke.join) || 'miter';
    if (stroke && stroke.dash && stroke.dash.length) ctx.setLineDash(stroke.dash);
    else ctx.setLineDash([]);
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
        const cx = x + (f.from?.x ?? 0.5) * w, cy = y + (f.from?.y ?? 0.5) * h;
        const tx = x + (f.to?.x ?? 0.5) * w, ty = y + (f.to?.y ?? 0.5) * h;
        const r = f.r != null ? f.r * Math.max(w, h) : Math.hypot(w, h) / 2;
        const g = ctx.createRadialGradient(cx, cy, 0, tx, ty, r);
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
          // Crop rect in normalized source coords (0..1). Default full image.
          const crop = f.crop && f.crop.w > 0 && f.crop.h > 0
            ? { x: Math.max(0, Math.min(1, f.crop.x)), y: Math.max(0, Math.min(1, f.crop.y)),
                w: Math.max(0.01, Math.min(1, f.crop.w)), h: Math.max(0.01, Math.min(1, f.crop.h)) }
            : { x: 0, y: 0, w: 1, h: 1 };
          // Source pixel sub-rectangle inside the image.
          const sx = crop.x * iw, sy = crop.y * ih;
          const sw = crop.w * iw, sh = crop.h * ih;
          if (f.scaleMode === 'fit') {
            // Fit: scale so the whole crop rect is visible inside the box.
            const s = Math.min(w / sw, h / sh);
            const dw = sw * s, dh = sh * s;
            ctx.drawImage(img, sx, sy, sw, sh, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
          } else if (f.scaleMode === 'tile') {
            // Tile: tile the cropped source rect across the box.
            const tw = (f.tileScale || 1) * sw, th = (f.tileScale || 1) * sh;
            for (let yy = y; yy < y + h; yy += th) for (let xx = x; xx < x + w; xx += tw) ctx.drawImage(img, sx, sy, sw, sh, xx, yy, tw, th);
          } else { // fill / crop
            // Fill: cover-fit the crop rect to the box (cropping overflow).
            const s = Math.max(w / sw, h / sh);
            const dw = sw * s, dh = sh * s;
            ctx.drawImage(img, sx, sy, sw, sh, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
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

  function drawStroke(ctx, x, y, w, h, r, stroke, doc) {
    if (!stroke || !stroke.visible) return;
    const { color, opacity } = resolvedColor(doc, stroke, '#000000');
    const wt = stroke.width || 0;
    if (wt <= 0) return;
    ctx.save();
    ctx.globalAlpha = opacity * (ctx.globalAlphaBase ?? 1);
    ctx.strokeStyle = M.rgbaCss(color, 1);
    ctx.lineWidth = wt;
    applyStrokeStyle(ctx, stroke);
    let ox = x, oy = y, ow = w, oh = h;
    if (stroke.align === 'outside') {
      ox -= wt; oy -= wt; ow += wt * 2; oh += wt * 2;
      roundedPath(ctx, ox, oy, ow, oh, r);
      ctx.stroke();
    } else if (stroke.align === 'inside') {
      ctx.save();
      roundedPath(ctx, x, y, w, h, r);
      ctx.clip();
      roundedPath(ctx, x - wt/2, y - wt/2, w + wt, h + wt, r);
      ctx.stroke();
      ctx.restore();
    } else {
      roundedPath(ctx, x - wt/2, y - wt/2, w + wt, h + wt, r);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.restore();
  }

  function drawShadows(ctx, x, y, w, h, r, shadows, doc) {
    for (const s of shadows || []) {
      if (!s.visible) continue;
      const { color, opacity } = resolvedColor(doc, s, '#000000');
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

  function drawVector(ctx, n, doc, x, y, w, h) {
    const d = n.path;
    if (d && typeof Path2D !== 'undefined') {
      try {
        const p = new Path2D(d);
        const rule = n.windingRule === 'evenodd' ? 'evenodd' : 'nonzero';
        ctx.save();
        ctx.translate(x, y);
        const pw = n.pathW || w, ph = n.pathH || h;
        if (pw > 0 && ph > 0) ctx.scale(w / pw, h / ph);
        const fill = (n.fills || []).find(f => f && f.visible !== false);
        if (fill) {
          if (fill.type === 'solid') {
            const { color, opacity } = resolvedColor(doc, fill, '#000000');
            ctx.globalAlpha = (ctx.globalAlphaBase ?? 1) * opacity;
            ctx.fillStyle = M.rgbaCss(color, 1);
            ctx.fill(p, rule);
          } else if (fill.type === 'linear') {
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
              const iw = img.naturalWidth, ih = img.naturalHeight;
              const crop = fill.crop && fill.crop.w > 0 && fill.crop.h > 0
                ? { x: Math.max(0, Math.min(1, fill.crop.x)), y: Math.max(0, Math.min(1, fill.crop.y)),
                    w: Math.max(0.01, Math.min(1, fill.crop.w)), h: Math.max(0.01, Math.min(1, fill.crop.h)) }
                : { x: 0, y: 0, w: 1, h: 1 };
              const sx = crop.x * iw, sy = crop.y * ih;
              const sw = crop.w * iw, sh = crop.h * ih;
              if (fill.scaleMode === 'fit') {
                const s = Math.min(pw / sw, ph / sh);
                const dw = sw * s, dh = sh * s;
                ctx.drawImage(img, sx, sy, sw, sh, (pw - dw) / 2, (ph - dh) / 2, dw, dh);
              } else if (fill.scaleMode === 'tile') {
                const tw = (fill.tileScale || 1) * sw, th = (fill.tileScale || 1) * sh;
                for (let yy = 0; yy < ph; yy += th) for (let xx = 0; xx < pw; xx += tw) ctx.drawImage(img, sx, sy, sw, sh, xx, yy, tw, th);
              } else {
                const s = Math.max(pw / sw, ph / sh);
                const dw = sw * s, dh = sh * s;
                ctx.drawImage(img, sx, sy, sw, sh, (pw - dw) / 2, (ph - dh) / 2, dw, dh);
              }
              ctx.restore();
            }
          }
        }
        if (n.stroke && n.stroke.visible && n.stroke.width > 0) {
          const { color, opacity } = resolvedColor(doc, n.stroke, '#000000');
          ctx.globalAlpha = (ctx.globalAlphaBase ?? 1) * (n.stroke.opacity == null ? 1 : n.stroke.opacity);
          ctx.strokeStyle = M.rgbaCss(color, 1);
          ctx.lineWidth = n.stroke.width;
          applyStrokeStyle(ctx, n.stroke);
          ctx.stroke(p);
          ctx.setLineDash([]);
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
  // Called with the canvas already in the PARENT's content space (i.e. for
  // tops, ctx is in page/world space; for children, their parent's transform
  // stack has already been applied). n.x/n.y are parent-local, which is what
  // we translate to.
  function drawNode(ctx, page, n, doc) {
    if (n.visible === false) return;
    const w = n.w, h = n.h;
    const lx = n.x, ly = n.y;
    const rot = n.rotation || 0;
    ctx._cornerSmooth = n.cornerSmooth || 0;

    ctx.save();
    ctx.globalAlphaBase = (ctx.globalAlphaBase ?? 1) * (n.opacity == null ? 1 : n.opacity);
    if (n.blend && n.blend !== 'normal' && ctx.globalCompositeOperation !== undefined) {
      const map = { multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken', lighten: 'lighten', 'color-dodge': 'color-dodge', 'color-burn': 'color-burn', 'hard-light': 'hard-light', 'soft-light': 'soft-light', difference: 'difference', exclusion: 'exclusion', hue: 'hue', saturation: 'saturation', color: 'color', luminosity: 'luminosity' };
      if (map[n.blend]) ctx.globalCompositeOperation = map[n.blend];
    }

    // Local transform: translate to top-left corner in parent space, then
    // rotate/flip AROUND center so children inherit. drawPaints/etc use (0,0)
    // top-left of the local box.
    ctx.translate(lx, ly);
    if (rot || n.flipH || n.flipV) {
      ctx.translate(w/2, h/2);
      if (rot) ctx.rotate(rot);
      if (n.flipH || n.flipV) ctx.scale(n.flipH ? -1 : 1, n.flipV ? -1 : 1);
      ctx.translate(-w/2, -h/2);
    }
    // Now (0,0) = top-left of local content; children draw at (k.x,k.y).

    if (n.type === 'frame' || n.type === 'instance') {
      // Effects belong behind the frame plate. Previously the inspector let
      // users add a shadow to a frame but this branch never painted it.
      drawShadows(ctx, 0, 0, w, h, n.radius, n.shadows, doc);

      // A frame's own fill always respects its corner radius. `clips` only
      // controls descendants; it must not decide whether the frame plate is
      // rounded. Keep this local clip separate from the descendant clip.
      ctx.save();
      roundedPath(ctx, 0, 0, w, h, n.radius);
      ctx.clip();
      if (n.section && !n.fills.length) {
        ctx.fillStyle = '#efeff1';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#d5d5da';
        ctx.lineWidth = 1;
        ctx.strokeRect(0.5, 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
      }
      drawPaints(ctx, 0, 0, w, h, n.fills || [], doc);
      ctx.restore();
      // Figma frames have no automatic outline. Transparent frames stay truly
      // transparent; the editor selection overlay provides discoverability.
      if (n.stroke && n.stroke.visible) drawStroke(ctx, 0, 0, w, h, n.radius, n.stroke, doc);
      if (n.grid && n.grid.visible !== false) drawGrid(ctx, 0, 0, w, h, n.grid);
    } else if (n.type === 'rect') {
      drawShadows(ctx, 0, 0, w, h, n.radius, n.shadows, doc);
      roundedPath(ctx, 0, 0, w, h, n.radius);
      ctx.save(); ctx.clip();
      drawPaints(ctx, 0, 0, w, h, n.fills, doc);
      ctx.restore();
      drawStroke(ctx, 0, 0, w, h, n.radius, n.stroke, doc);
    } else if (n.type === 'ellipse') {
      drawShadows(ctx, 0, 0, w, h, null, n.shadows, doc);
      const sweep = n.arcSweep == null ? 360 : n.arcSweep;
      const start = ((n.arcStart || 0) * Math.PI) / 180;
      const end = start + (sweep * Math.PI) / 180;
      const inner = Math.max(0, Math.min(0.95, n.innerRadius || 0));
      const ccw = sweep < 0;
      ctx.beginPath();
      if (inner > 0.001) {
        ctx.ellipse(w/2, h/2, w/2, h/2, 0, start, end, ccw);
        ctx.ellipse(w/2, h/2, w/2 * inner, h/2 * inner, 0, end, start, !ccw);
        ctx.closePath();
      } else if (Math.abs(sweep) < 359.5) {
        ctx.moveTo(w/2, h/2);
        ctx.ellipse(w/2, h/2, w/2, h/2, 0, start, end, ccw);
        ctx.closePath();
      } else {
        ctx.ellipse(w/2, h/2, w/2, h/2, 0, 0, Math.PI * 2);
      }
      ctx.save(); ctx.clip();
      drawPaints(ctx, 0, 0, w, h, n.fills, doc);
      ctx.restore();
      if (n.stroke && n.stroke.visible) {
        const { color, opacity } = resolvedColor(doc, n.stroke, '#000000');
        ctx.save();
        ctx.globalAlpha = opacity * (ctx.globalAlphaBase ?? 1);
        ctx.strokeStyle = M.rgbaCss(color, 1);
        ctx.lineWidth = n.stroke.width || 0;
        applyStrokeStyle(ctx, n.stroke);
        const rx = Math.max(0.5, w/2 - (n.stroke.width || 0)/2);
        const ry = Math.max(0.5, h/2 - (n.stroke.width || 0)/2);
        ctx.beginPath();
        if (inner > 0.001) {
          ctx.ellipse(w/2, h/2, rx, ry, 0, start, end, ccw);
          ctx.ellipse(w/2, h/2, rx * inner, ry * inner, 0, end, start, !ccw);
        } else if (Math.abs(sweep) < 359.5) {
          ctx.ellipse(w/2, h/2, rx, ry, 0, start, end, ccw);
        } else {
          ctx.ellipse(w/2, h/2, rx, ry, 0, 0, Math.PI * 2);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
    } else if (n.type === 'line') {
      const lineWidth = Math.max(0, Number(n.stroke && n.stroke.width) || 0);
      if (!n.stroke || n.stroke.visible === false || lineWidth <= 0) {
        ctx.restore();
        return;
      }
      ctx.save();
      const { color, opacity } = resolvedColor(doc, n.stroke, '#000000');
      ctx.globalAlpha = opacity * (ctx.globalAlphaBase ?? 1);
      ctx.strokeStyle = M.rgbaCss(color, 1);
      ctx.lineWidth = lineWidth;
      applyStrokeStyle(ctx, n.stroke);
      ctx.beginPath();
      ctx.moveTo(0, h/2);
      ctx.lineTo(w, h/2);
      ctx.stroke();
      if (n.arrowEnd) {
        const len = Math.max(10, lineWidth * 5);
        const a = Math.PI * 26 / 180;
        ctx.beginPath();
        ctx.moveTo(w, h/2);
        ctx.lineTo(w - len * Math.cos(a), h/2 - len * Math.sin(a));
        ctx.moveTo(w, h/2);
        ctx.lineTo(w - len * Math.cos(-a), h/2 - len * Math.sin(-a));
        ctx.stroke();
      }
      if (n.arrowStart) {
        const len = Math.max(10, lineWidth * 5);
        const a = Math.PI * 26 / 180;
        ctx.beginPath();
        ctx.moveTo(0, h/2);
        ctx.lineTo(len * Math.cos(a), h/2 - len * Math.sin(a));
        ctx.moveTo(0, h/2);
        ctx.lineTo(len * Math.cos(-a), h/2 - len * Math.sin(-a));
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.restore();
    } else if (n.type === 'text') {
      drawText(ctx, n, doc, w, h);
    } else if (n.type === 'vector') {
      drawVector(ctx, n, doc, 0, 0, w, h);
    }

    // `Clip content` applies to descendants, not to the frame's own paint.
    if ((n.type === 'frame' || n.type === 'instance') && n.clips) {
      roundedPath(ctx, 0, 0, w, h, n.radius);
      ctx.clip();
    }

    // Children — draw in same local transform so they inherit rotate/flip.
    if (n.type === 'frame' || n.type === 'rect' || n.type === 'ellipse' || n.type === 'instance') {
      const maskKid = M.kids(page, n).find(k => k.mask);
      if (maskKid) {
        drawNode(ctx, page, maskKid, doc);
        ctx.save();
        if (maskKid.type === 'ellipse') {
          ctx.beginPath();
          ctx.ellipse(maskKid.x + maskKid.w/2, maskKid.y + maskKid.h/2, maskKid.w/2, maskKid.h/2, 0, 0, Math.PI * 2);
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

  // Layout grid (columns/rows) inside a frame — LOCAL coords.
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

  function drawText(ctx, n, doc, w, h) {
    // The DOM textarea is the single source of pixels while inline editing.
    // Painting the canvas copy as well creates the doubled-text artifact.
    //
    // IMPORTANT: keep this guard before delegating to TextEngine.  The old
    // order delegated first, making this renderer-level contract unreachable
    // whenever the richer text engine was installed.  That was the source of
    // the canvas + textarea double-paint visible while editing.
    if (n.id === editingTextId) return;
    if (global.TextEngine && global.TextEngine.draw) return global.TextEngine.draw(ctx, n, doc, w, h);
    const t = n.text || {};
    ctx.save();
    ctx.globalAlpha = (ctx.globalAlphaBase ?? 1) * (n.opacity == null ? 1 : n.opacity);
    const fill = n.fills && n.fills[0];
    const { color, opacity } = resolvedColor(doc, fill || { color: '#ffffff' }, '#ffffff');
    ctx.fillStyle = M.rgbaCss(color, opacity);
    ctx.font = fontSpec(n);
    try { ctx.letterSpacing = (t.letterSpacing || 0) + 'px'; } catch (e) { }
    const size = t.size || 14;
    const lhMul = (typeof t.lineHeight === 'number' && t.lineHeight > 0) ? t.lineHeight : 1.2;
    const lineH = size * lhMul;

    // Build effective runs array (rich text)
    // If n.text.runs exists, it is an array of {text, font?, weight?, size?, color?, italic?, underline?, strike?}
    // Otherwise fall back to single run from n.text.content
    const runs = Array.isArray(t.runs) && t.runs.length
      ? t.runs
      : [{ text: String(t.content || ''), color: null }];

    // Flatten runs into per-line structures (handling \n)
    const plain = runs.map(r => r.text || '').join('');
    const baseW = textBoxWidth(n);
    // For rich text we measure the entire line text for wrap
    const { lines: wrappedLines } = textLines(n, baseW);

    // Compute runs per line — split runs by line boundaries
    const lineRuns = [];
    {
      let runIdx = 0, runOff = 0, chars = 0;
      for (const line of wrappedLines){
        let remaining = line.length;
        const lr = [];
        while (remaining > 0 && runIdx < runs.length){
          const r = runs[runIdx];
          const avail = (r.text||'').length - runOff;
          const take = Math.min(avail, remaining);
          lr.push({ text: (r.text||'').substr(runOff, take), run: r });
          runOff += take; remaining -= take; chars += take;
          if (runOff >= (r.text||'').length){ runIdx++; runOff = 0; }
        }
        lineRuns.push(lr);
      }
    }

    const totalH = lineRuns.length * lineH;
    let top = 0;
    if (t.valign === 'middle') top = Math.max(0, (h - totalH) / 2);
    else if (t.valign === 'bottom') top = Math.max(0, h - totalH);
    ctx.textBaseline = 'alphabetic';

    lineRuns.forEach((lr, i) => {
      const y = top + i * lineH + lineH * 0.82;
      // Measure line total for alignment
      let totalW = 0;
      const segWidths = [];
      for (const seg of lr){
        applyRunStyle(ctx, seg.run, n, doc);
        const w = ctx.measureText(seg.text).width;
        segWidths.push(w); totalW += w;
      }
      // Restore base font for total width fallback
      ctx.font = fontSpec(n);
      let tx = 0;
      if (t.align === 'center') tx = (w - totalW) / 2;
      else if (t.align === 'right') tx = w - totalW;
      // Draw each segment
      for (let si=0; si<lr.length; si++){
        const seg = lr[si];
        applyRunStyle(ctx, seg.run, n, doc);
        ctx.fillText(seg.text, tx, y);
        // underline / strike
        if (seg.run.underline || seg.run.strike){
          const sw = Math.max(1, (seg.run.size||size)*0.07);
          ctx.save();
          ctx.strokeStyle = ctx.fillStyle;
          ctx.lineWidth = sw;
          ctx.beginPath();
          const yy = seg.run.underline ? y + 2 : y - size*0.3;
          ctx.moveTo(tx, yy); ctx.lineTo(tx+segWidths[si], yy);
          ctx.stroke();
          ctx.restore();
        }
        tx += segWidths[si];
      }
    });
    try { ctx.letterSpacing = '0px'; } catch (e) { }
    ctx.restore();
  }

  // ------------------------------------------------------------- page paint
  function drawPage(ctx, page, doc, view) {
    // Always start from a clean identity-then-DPR transform. The previous
    // frame may have left ctx in the world-transform state (translate+scale),
    // so clearRect/fillRect here must operate in device-pixel CSS space.
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Reset all state that drawNode / shadows / strokes may have dirtied.
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.setLineDash([]);
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
    ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    ctx.lineCap = 'butt'; ctx.lineJoin = 'miter'; ctx.lineWidth = 1;
    ctx.font = '12px Inter, sans-serif';
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';

    const zoom = view.zoom;

    // Canvas background — color comes from view.canvasColor (View menu).
    // Figma defaults to neutral gray; users can switch to black/white/custom.
    // Do NOT clearRect first — on GPU-accelerated canvases that can cause a
    // 1-frame transparent flash ("flicker") before fillRect paints. A full
    // opaque fillRect alone covers the previous frame completely.
    const canvasColor = view.canvasColor || '#383838';
    ctx.fillStyle = canvasColor;
    ctx.strokeStyle = canvasColor;
    ctx.fillRect(0, 0, view.w, view.h);

    // Pixel grid: only drawn when pixelPreview is on AND zoom ≥ 800%.
    // Color chosen to be visible on both dark and light canvas.
    if (view.pixelPreview === true && zoom >= 8) {
      const step = Math.max(1, Math.round(zoom));
      // Pick grid color by perceived brightness of the canvas bg.
      const isDark = canvasColor.length >= 7
        ? (parseInt(canvasColor.slice(1,3),16) + parseInt(canvasColor.slice(3,5),16) + parseInt(canvasColor.slice(5,7),16)) / 3 < 140
        : true;
      ctx.fillStyle = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)';
      const startX = ((view.ox % step) + step) % step;
      const startY = ((view.oy % step) + step) % step;
      for (let gx = startX; gx < view.w; gx += step) {
        ctx.fillRect(Math.round(gx) - 0.5, 0, 1, view.h);
      }
      for (let gy = startY; gy < view.h; gy += step) {
        ctx.fillRect(0, Math.round(gy) - 0.5, view.w, 1);
      }
    }

    // User grid (togglable) is drawn in screen space here BEFORE we
    // enter the world transform, so lines are always 1px crisp.
    if (view.grid) drawGridLines(ctx, view);

    // Enter world space.
    ctx.save();
    ctx.translate(view.ox, view.oy);
    ctx.scale(zoom, zoom);
    ctx._zoom = zoom;
    // Reset state after scale so strokes/fills are clean.
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0;
    for (const tid of page.tops) {
      const t = page.nodes[tid];
      if (t) drawNode(ctx, page, t, doc);
    }
    ctx.restore();

    // Frame name labels (screen space, projected from world AABB top-left).
    if (zoom >= 0.35) {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = `11px Inter, 'Helvetica Neue', Arial, sans-serif`;
      ctx.fillStyle = 'rgba(220,220,230,0.75)';
      ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
      const mark = (n) => {
        if (n.type === 'frame' && n._w && n.visible !== false && !n.parent) {
          const sx = n._w.x * zoom + view.ox;
          const sy = n._w.y * zoom + view.oy - 14;
          if (sx > -200 && sx < view.w + 200 && sy > -20 && sy < view.h + 200) {
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
    ctx._zoom = scale;
    for (const tid of page.tops) {
      const t = page.nodes[tid];
      if (t) drawNode(ctx, page, t, doc);
    }
    return c;
  }

  function pageBounds(page) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, any = false;
    for (const tid of page.tops) {
      const t = page.nodes[tid];
      if (!t || !t._w) continue;
      any = true;
      x0 = Math.min(x0, t._w.x); y0 = Math.min(y0, t._w.y);
      x1 = Math.max(x1, t._w.x + t._w.w); y1 = Math.max(y1, t._w.y + t._w.h);
    }
    if (!any) return { x: 0, y: 0, w: 800, h: 600 };
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  }

  function selectionBounds(page, ids) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, any = false;
    for (const id of ids) {
      const n = page.nodes[id];
      if (!n || !n._w) continue;
      any = true;
      x0 = Math.min(x0, n._w.x); y0 = Math.min(y0, n._w.y);
      x1 = Math.max(x1, n._w.x + n._w.w); y1 = Math.max(y1, n._w.y + n._w.h);
    }
    return any ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }

  // ------------------------------------------------------------- selection overlay (screen space)
  // Selection overlay drawn in SCREEN space. Single: OBB outline + 4 corner
  // handles + size pill (+ rotation angle label during rotate drag).
  // Multi: dashed AABB + 4 corner handles + count badge.
  // Rotation is cursor-driven (no visible dot); see rotate-interaction.js.
  // Compute single-select screen geometry from the SAME world corners
  // used by hit-test and resize. Returns null if node has no resolved
  // geometry yet (first frame, hidden).
  function singleSelGeom(view, n) {
    const W = global.World;
    if (W && W.screenCorners) {
      const corners = W.screenCorners(view, n);
      if (corners) return { corners };
    }
    // Fallback: use _w AABB projected through view
    if (!n._w) return null;
    const z = view.zoom, ox = view.ox, oy = view.oy;
    const b = n._w;
    const corners = [
      {x:b.x*z+ox,y:b.y*z+oy}, {x:(b.x+b.w)*z+ox,y:b.y*z+oy},
      {x:(b.x+b.w)*z+ox,y:(b.y+b.h)*z+oy}, {x:b.x*z+ox,y:(b.y+b.h)*z+oy},
    ];
    return { corners };
  }
  function outwardNormal(a, b, center) {
    const ex = b.x-a.x, ey = b.y-a.y;
    const el = Math.hypot(ex,ey) || 1;
    let nx = ey/el, ny = -ex/el; // CW-ordered edge → outward points this way
    const mx = (a.x+b.x)/2, my = (a.y+b.y)/2;
    if ((mx-center.x)*nx + (my-center.y)*ny < 0) { nx=-nx; ny=-ny; }
    return { nx, ny };
  }
  function drawHandle(ctx, p, hs) {
    ctx.beginPath();
    ctx.rect(p.x - hs/2 + 0.5, p.y - hs/2 + 0.5, hs, hs);
    ctx.fill(); ctx.stroke();
  }

  function drawSelection(ctx, view, ids, page, moving) {
    if (!ids.length) return;
    const FIGMA_BLUE = '#0d99ff';
    ctx.save();
    // Screen-space overlay: reset the world transform but preserve the
    // device-pixel-ratio scale installed by resizeCanvas, so CSS-pixel
    // coordinates (clientX - rect.left) map correctly.
    const dpr = (window.devicePixelRatio) || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Reset all state so nothing leaks from drawPage into overlay.
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    ctx.fillStyle = FIGMA_BLUE; ctx.strokeStyle = FIGMA_BLUE;
    ctx.lineWidth = 1; ctx.lineCap = 'butt'; ctx.lineJoin = 'miter';
    ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
    ctx.font = '10px Inter, -apple-system, Arial, sans-serif';

    const rects = [];
    for (const id of ids) {
      const n = page.nodes[id];
      if (!n) continue;
      const g = singleSelGeom(view, n);
      if (!g) continue;
      const bb = M.obbAabb(g.corners);
      rects.push({ node: n, corners: g.corners, bb });
    }
    if (!rects.length) { ctx.restore(); return; }

    // Union AABB in screen space
    const union = rects.reduce((a, r) => {
      const b = r.bb;
      const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
      const x2 = Math.max(a.x+a.w, b.x+b.w), y2 = Math.max(a.y+a.h, b.y+b.h);
      return { x, y, w: x2-x, h: y2-y };
    }, { x: Infinity, y: Infinity, w: 0, h: 0 });

    if (rects.length === 1) {
      const { node, corners } = rects[0];
      const [c0,c1,c2,c3] = corners;
      const mid = (a,b) => ({x:(a.x+b.x)/2, y:(a.y+b.y)/2});
      const center = { x:(c0.x+c2.x)/2, y:(c0.y+c2.y)/2 };
      const topMid = mid(c0,c1), botMid = mid(c2,c3);

      // OBB outline (1px Figma blue)
      ctx.strokeStyle = FIGMA_BLUE;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(c0.x, c0.y);
      ctx.lineTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y); ctx.lineTo(c3.x, c3.y);
      ctx.closePath(); ctx.stroke();

      // 4 CORNER HANDLES — edge midpoints stay as invisible hit zones.
      // (Resize along one axis still works because handleAt detects edge
      // zones; we just don't paint edge squares.)
      ctx.fillStyle = '#fff'; ctx.strokeStyle = FIGMA_BLUE; ctx.lineWidth = 1;
      for (const p of [c0, c1, c2, c3]) drawHandle(ctx, p, 5);

      // Size pill — blue rounded rect below the outward-bottom edge.
      const nBot = outwardNormal(c2, c3, center);
      const label = `${Math.round(node.w)} × ${Math.round(node.h)}`;
      const lw = ctx.measureText(label).width;
      const padX = 7, bh = 18, bw = lw + padX*2;
      let anchor = botMid; let nx2 = nBot.nx, ny2 = nBot.ny;
      if (ny2 < -0.3) { anchor = topMid; const fl = outwardNormal(c0,c1,center); nx2=fl.nx; ny2=fl.ny; }
      const GAP = 8;
      let bx = anchor.x - bw/2 + nx2*GAP;
      let by = anchor.y - bh/2 + ny2*GAP;
      const vw = view.w||9999, vh = view.h||9999;
      if (bx + bw > vw - 8) bx = vw - bw - 8;
      if (bx < 8) bx = 8;
      if (by + bh > vh - 8) by = vh - bh - 8;
      if (by < 28) by = 28;
      ctx.fillStyle = FIGMA_BLUE;
      roundRectPath(ctx, bx, by, bw, bh, 3); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(label, bx + bw/2, by + bh/2 + 0.5);

      if (node._rotLabel) {
        // Rotation angle label — shown during rotate drag, anchored just
        // above the selection top so it's visible without a rotate dot.
        const at = `${(M.toFigmaDeg ? M.toFigmaDeg(node.rotation) : Math.round((node.rotation||0)*180/Math.PI))}°`;
        const aw = ctx.measureText(at).width;
        const lx = center.x;
        const ly = topMid.y - 14;
        ctx.fillStyle = '#1e1e1e';
        roundRectPath(ctx, lx - aw/2 - 6, ly - 10, aw + 12, 16, 3); ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(at, lx, ly - 2);
      }
      ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
    } else {
      // Multi-selection: dashed AABB, 4 corner handles, count badge.
      // Rotation is cursor-driven (rotate-interaction.js), no dot drawn.
      ctx.strokeStyle = FIGMA_BLUE; ctx.lineWidth = 1;
      ctx.setLineDash([4,3]);
      ctx.strokeRect(union.x+0.5, union.y+0.5, union.w-1, union.h-1);
      ctx.setLineDash([]);
      const label = `${ids.length} selected`;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = FIGMA_BLUE;
      ctx.fillRect(union.x, union.y - 18, tw + 10, 16);
      ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle';
      ctx.fillText(label, union.x + 5, union.y - 10);
      const u = union;
      // 4 corners only
      const pts = [
        [u.x, u.y], [u.x+u.w, u.y], [u.x+u.w, u.y+u.h], [u.x, u.y+u.h],
      ];
      ctx.fillStyle = '#fff'; ctx.strokeStyle = FIGMA_BLUE; ctx.lineWidth = 1;
      for (const [px,py] of pts) drawHandle(ctx, {x:px,y:py}, 5);
      ctx.textBaseline = 'alphabetic';
    }
    ctx.restore();
  }
  function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.lineTo(x+w-r, y);
    ctx.quadraticCurveTo(x+w, y, x+w, y+r);
    ctx.lineTo(x+w, y+h-r);
    ctx.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
    ctx.lineTo(x+r, y+h);
    ctx.quadraticCurveTo(x, y+h, x, y+h-r);
    ctx.lineTo(x, y+r);
    ctx.quadraticCurveTo(x, y, x+r, y);
    ctx.closePath();
  }

  function drawMarquee(ctx, rect) {
    if (!rect) return;
    ctx.save();
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = 'rgba(13,153,255,0.08)';
    ctx.strokeStyle = 'rgba(13,153,255,0.8)';
    ctx.lineWidth = 1;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.w - 1, rect.h - 1);
    ctx.restore();
  }

  function drawHover(ctx, view, node) {
    if (!node || node.visible === false) return;
    const W = global.World;
    const corners = W && W.screenCorners ? W.screenCorners(view, node) : null;
    if (!corners || corners.length !== 4) return;
    ctx.save();
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = .72;
    ctx.strokeStyle = '#0d99ff';
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath(); ctx.stroke();
    ctx.restore();
  }

  function drawDevMeasure(ctx, view, page, doc, selIds) {
    const sel = selIds.map(id => page.nodes[id]).filter(Boolean);
    if (!sel.length) return;
    const zoom = view.zoom;
    ctx.save();
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = '11px Inter, sans-serif';
    ctx.textBaseline = 'middle';
    const label = (txt, x, y) => {
      const wpx = ctx.measureText(txt).width + 8;
      ctx.fillStyle = '#0d99ff';
      ctx.fillRect(x - wpx/2, y - 8, wpx, 16);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.fillText(txt, x, y + 0.5);
      ctx.textAlign = 'start';
    };
    const line = (a, b) => { ctx.strokeStyle = 'rgba(13,153,255,0.8)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); };
    for (const n of sel) {
      const bb = n._w;
      if (!bb) continue;
      const tl = { x: bb.x*zoom + view.ox, y: bb.y*zoom + view.oy };
      const br = { x: (bb.x+bb.w)*zoom + view.ox, y: (bb.y+bb.h)*zoom + view.oy };
      const midX = (tl.x+br.x)/2, midY = (tl.y+br.y)/2;
      line({ x: tl.x, y: tl.y - 24 }, { x: br.x, y: tl.y - 24 });
      label(Math.round(n.w)+'', midX, tl.y - 24);
      line({ x: tl.x - 24, y: tl.y }, { x: tl.x - 24, y: br.y });
      label(Math.round(n.h)+'', tl.x - 24, midY);
      label('x '+Math.round(n._w.x)+'  y '+Math.round(n._w.y), midX, br.y + 22);
    }
    ctx.restore();
  }

  // ------------------------------------------------------------- view chrome
  function rulerStep(zoom) {
    const steps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000];
    for (const s of steps) if (s * zoom >= 60) return s;
    return 10000;
  }
  function drawRulers(ctx, view, w, h) {
    if (!view.rulers) return;
    const RULER = 22, z = view.zoom, ox = view.ox, oy = view.oy;
    ctx.save();
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Dark-theme ruler chrome (matches #2c2c2c panels)
    ctx.fillStyle = '#2c2c2c';
    ctx.fillRect(0, 0, w, RULER);
    ctx.fillRect(0, RULER, RULER, h - RULER);
    ctx.fillRect(0, 0, RULER, RULER);
    ctx.strokeStyle = '#1a1a1a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0.5, RULER + 0.5); ctx.lineTo(w, RULER + 0.5);
    ctx.moveTo(RULER + 0.5, 0.5); ctx.lineTo(RULER + 0.5, h);
    ctx.stroke();
    const step = rulerStep(z);
    const sub = step / 5;
    ctx.font = '9px Inter, "Helvetica Neue", Arial, sans-serif';
    ctx.fillStyle = '#8a8a93';
    ctx.strokeStyle = '#555';
    ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    let i0 = Math.ceil((-ox/z)/sub - 1e-9);
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
    let j0 = Math.ceil((-oy/z)/sub - 1e-9);
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
    if (ox > RULER + 2 && ox < w) {
      ctx.beginPath(); ctx.moveTo(ox, RULER + 1); ctx.lineTo(ox - 4, RULER + 7); ctx.lineTo(ox + 4, RULER + 7); ctx.closePath(); ctx.fill();
    }
    if (oy > RULER + 2 && oy < h) {
      ctx.beginPath(); ctx.moveTo(RULER + 1, oy); ctx.lineTo(RULER + 7, oy - 4); ctx.lineTo(RULER + 7, oy + 4); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
  }
  function drawSnapGuides(ctx, view, guides) {
    if (!guides || !guides.length) return;
    ctx.save();
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(view.ox, view.oy);
    ctx.scale(view.zoom, view.zoom);
    ctx.strokeStyle = '#f24ce0';
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
    const i0 = Math.ceil((-ox/z)/step - 1e-9), i1 = Math.floor((w-ox)/z/step + 1e-9);
    const j0 = Math.ceil((-oy/z)/step - 1e-9), j1 = Math.floor((h-oy)/z/step + 1e-9);
    ctx.save();
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
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
    drawPage, drawSelection, drawHover, drawMarquee, drawNode, drawDevMeasure, drawGrid,
    setEditingText,
    measureText, textLines, fontSpec, textBoxWidth, setTextCtx,
    drawPaints, drawStroke, drawShadows,
    renderRegion, pageBounds, selectionBounds,
    resolvedColor, imgFor,
    drawRulers, drawSnapGuides, drawGridLines, rulerStep,
    applyStrokeStyle,
  };
})(window);
