/* text-engine.js — Figma-accurate text layout + paint.
 *
 * Owns letter case, lists, links, truncation, paragraph metrics,
 * justify, hanging lists/quotes, and the extra type settings that
 * canvas 2D can actually honor. Renderer.measureText / textLines /
 * drawText delegate here when present.
 */
(function (global) {
  'use strict';

  const WEIGHTS = [
    { n: 100, name: 'Thin' },
    { n: 200, name: 'Extra Light' },
    { n: 300, name: 'Light' },
    { n: 400, name: 'Regular' },
    { n: 500, name: 'Medium' },
    { n: 600, name: 'Semi Bold' },
    { n: 700, name: 'Bold' },
    { n: 800, name: 'Extra Bold' },
    { n: 900, name: 'Black' },
  ];

  const ICON_FONTS = [
    { name: 'Material Symbols Outlined', kind: 'symbols' },
    { name: 'Material Symbols Rounded', kind: 'symbols' },
    { name: 'Material Symbols Sharp', kind: 'symbols' },
    { name: 'Material Icons', kind: 'icons' },
    { name: 'Material Icons Outlined', kind: 'icons' },
    { name: 'Material Icons Round', kind: 'icons' },
  ];

  const POPULAR = [
    'Inter', 'Roboto', 'Open Sans', 'Poppins', 'Montserrat', 'Lato',
    'Playfair Display', 'Source Sans 3', 'DM Sans', 'Work Sans',
  ];

  const VARIABLE = [
    'Inter', 'Roboto', 'Source Sans 3', 'Outfit', 'Manrope',
    'Plus Jakarta Sans', 'Work Sans', 'Oswald', 'Raleway',
  ];

  const ICON_GLYPHS = [
    'home', 'search', 'settings', 'menu', 'close', 'check', 'add', 'remove',
    'edit', 'delete', 'favorite', 'star', 'person', 'mail', 'lock', 'visibility',
    'arrow_back', 'arrow_forward', 'chevron_left', 'chevron_right', 'expand_more',
    'notifications', 'share', 'download', 'upload', 'image', 'photo', 'camera',
    'play_arrow', 'pause', 'stop', 'volume_up', 'mic', 'call', 'chat', 'send',
    'calendar_today', 'schedule', 'place', 'map', 'link', 'content_copy',
    'info', 'warning', 'error', 'help', 'done', 'more_vert', 'more_horiz',
    'filter_list', 'sort', 'refresh', 'sync', 'cloud', 'folder', 'description',
    'shopping_cart', 'credit_card', 'payments', 'language', 'public', 'login',
    'logout', 'account_circle', 'dashboard', 'analytics', 'bolt', 'light_mode',
    'dark_mode', 'palette', 'brush', 'format_bold', 'format_italic', 'title',
  ];

  function defaults(t) {
    if (!t) t = {};
    if (t.lineHeightUnit == null) t.lineHeightUnit = 'auto';
    if (t.textCase == null) t.textCase = 'none';
    if (t.list == null) t.list = 'none';
    if (t.listSpacing == null) t.listSpacing = 0;
    if (t.paragraphSpacing == null) t.paragraphSpacing = 0;
    if (t.paragraphIndent == null) t.paragraphIndent = 0;
    if (t.hangingLists == null) t.hangingLists = false;
    if (t.hangingQuotes == null) t.hangingQuotes = false;
    if (t.truncate == null) t.truncate = false;
    if (t.maxLines == null) t.maxLines = 1;
    if (t.wrapStyle == null) t.wrapStyle = 'standard';
    if (t.verticalTrim == null) t.verticalTrim = false;
    if (t.underline == null) t.underline = false;
    if (t.strike == null) t.strike = false;
    if (t.underlineStyle == null) t.underlineStyle = 'solid';
    if (t.underlineOffset == null) t.underlineOffset = 0;
    if (!t.ot) t.ot = { liga: true, dlig: false, calt: true, kern: true };
    if (!Array.isArray(t.links)) t.links = [];
    return t;
  }

  function weightName(n) {
    const w = WEIGHTS.find((x) => x.n === +n);
    return w ? w.name : String(n || 400);
  }

  function nearestWeight(n) {
    const v = +n || 400;
    let best = WEIGHTS[3], d = 1e9;
    for (const w of WEIGHTS) {
      const dd = Math.abs(w.n - v);
      if (dd < d) { best = w; d = dd; }
    }
    return best.n;
  }

  function applyCase(s, mode) {
    const t = String(s == null ? '' : s);
    if (mode === 'upper') return t.toUpperCase();
    if (mode === 'lower') return t.toLowerCase();
    if (mode === 'title') {
      return t.replace(/[A-Za-z\u00C0-\u024F][A-Za-z\u00C0-\u024F']*/g, (w) =>
        w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
    }
    return t;
  }

  function lineHeightPx(t) {
    const size = t.size || 16;
    const unit = t.lineHeightUnit || 'auto';
    if (unit === 'auto' || t.lineHeight == null) return size * 1.2;
    if (unit === 'pixels') return Math.max(1, +t.lineHeight || size);
    const mul = +t.lineHeight;
    return size * (mul > 0 ? mul : 1.2);
  }

  function boxWidth(n, override) {
    if (override != null) return override;
    if (n.als) return n.als.w === 'hug' ? 0 : n.w;
    const r = (n.text && n.text.resize) || 'fixed';
    return (r === 'auto' || r === 'auto-w') ? 0 : n.w;
  }

  function fontSpec(n, scale) {
    if (global.Renderer && global.Renderer.fontSpec) return global.Renderer.fontSpec(n, scale || 1);
    const t = n.text || {};
    return `${t.italic ? 'italic ' : ''}${t.weight || 400} ${Math.max(1, (t.size || 16) * (scale || 1))}px "${t.font || 'Inter'}", sans-serif`;
  }

  let _ctx = null;
  function ctx2d() {
    if (!_ctx) _ctx = document.createElement('canvas').getContext('2d');
    return _ctx;
  }

  function applyCanvasType(ctx, n) {
    const t = defaults(n.text || {});
    ctx.font = fontSpec(n);
    try { ctx.letterSpacing = (t.letterSpacing || 0) + 'px'; } catch (e) {}
    try {
      if (ctx.fontVariantCaps !== undefined) {
        ctx.fontVariantCaps = (t.textCase === 'small-caps' || (t.ot && t.ot.smcp)) ? 'small-caps' : 'normal';
      }
    } catch (e) {}
    try { if (ctx.fontKerning !== undefined) ctx.fontKerning = (t.ot && t.ot.kern === false) ? 'none' : 'normal'; } catch (e) {}
  }

  function measureW(ctx, s) {
    return ctx.measureText(s || '').width;
  }

  function roman(n) {
    const map = [
      [10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i'],
    ];
    let x = Math.max(1, n | 0), out = '';
    for (const [v, s] of map) while (x >= v) { out += s; x -= v; }
    return out;
  }

  function alpha(n) {
    let x = Math.max(1, n | 0), out = '';
    while (x > 0) { x--; out = String.fromCharCode(97 + (x % 26)) + out; x = Math.floor(x / 26); }
    return out;
  }

  function markerFor(style, level, index) {
    const lv = ((level % 5) + 5) % 5;
    if (style === 'bullet') return '•';
    if (lv === 0) return index + '.';
    if (lv === 1) return alpha(index) + '.';
    if (lv === 2) return roman(index) + '.';
    if (lv === 3) return index + ')';
    return alpha(index) + ')';
  }

  function splitParas(content) {
    return String(content == null ? '' : content).split('\n');
  }

  function indentOf(line) {
    let i = 0;
    while (i < line.length && line[i] === '\t') i++;
    return Math.min(5, i);
  }

  function stripIndent(line) {
    return String(line || '').replace(/^\t+/, '');
  }

  function wrapLine(ctx, text, width, style) {
    if (width <= 0 || !text) return [text || ''];
    const words = String(text).split(/(\s+)/);
    const out = [];
    let line = '';
    for (const w of words) {
      const test = line + w;
      if (measureW(ctx, test) > width && line) {
        out.push(line.trimEnd());
        line = w.startsWith(' ') ? '' : w;
      } else line = test;
    }
    out.push(line.trimEnd());

    if (style === 'pretty' && out.length >= 2) {
      const last = out[out.length - 1].trim();
      const prev = out[out.length - 2];
      if (last && !/\s/.test(last) && prev.trim().split(/\s+/).length >= 3) {
        const parts = prev.trimEnd().split(/(\s+)/);
        let cut = parts.length;
        for (let i = parts.length - 1; i >= 0; i--) {
          if (!/^\s+$/.test(parts[i]) && parts[i]) { cut = i; break; }
        }
        const moved = parts.slice(cut).join('');
        const keep = parts.slice(0, cut).join('').trimEnd();
        if (keep && measureW(ctx, (moved + ' ' + last).trim()) <= width) {
          out[out.length - 2] = keep;
          out[out.length - 1] = (moved + ' ' + last).trim();
        }
      }
    }
    return out;
  }

  function wrapBalanced(ctx, text, width) {
    if (width <= 0) return [text || ''];
    const standard = wrapLine(ctx, text, width, 'standard');
    if (standard.length <= 1) return standard;
    let lo = width * 0.55, hi = width, best = standard;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2;
      const lines = wrapLine(ctx, text, mid, 'standard');
      if (lines.length === standard.length) { best = lines; hi = mid; }
      else lo = mid;
    }
    return best;
  }

  function layout(n, boxW) {
    const t = defaults(n.text || {});
    const ctx = ctx2d();
    applyCanvasType(ctx, n);
    const size = t.size || 16;
    const lineH = lineHeightPx(t);
    const wrapW = boxWidth(n, boxW);
    const listOn = t.list === 'bullet' || t.list === 'number';
    const paras = splitParas(t.content || '');
    const displayed = paras.map((p) => applyCase(stripIndent(p), t.textCase === 'small-caps' ? 'none' : t.textCase));
    const indents = paras.map(indentOf);

    const counters = [0, 0, 0, 0, 0];
    const lines = [];
    let y = 0;
    let maxW = 0;
    let charAt = 0;

    for (let pi = 0; pi < paras.length; pi++) {
      const raw = paras[pi];
      const indent = indents[pi];
      const body = displayed[pi];
      const hangingQ = t.hangingQuotes && /^["“”']/.test(body);
      let marker = '';
      let markerW = 0;
      if (listOn) {
        counters[indent] = (counters[indent] || 0) + 1;
        for (let k = indent + 1; k < 5; k++) counters[k] = 0;
        marker = markerFor(t.list, indent, counters[indent]);
        markerW = measureW(ctx, marker + '  ');
      }
      const indentPx = indent * size * 1.2;
      const hangList = listOn && t.hangingLists;
      const leftPad = (hangList ? 0 : markerW) + (hangingQ ? 0 : 0) + indentPx;
      const avail = wrapW > 0 ? Math.max(8, wrapW - leftPad - (t.paragraphIndent && pi === 0 || (pi > 0) ? 0 : 0) - (pi === 0 || true ? (t.paragraphIndent || 0) : 0)) : 0;
      const firstIndent = (t.paragraphIndent || 0);
      const style = wrapW > 0 ? t.wrapStyle : 'standard';
      const wrapped = wrapW > 0
        ? (style === 'balance' ? wrapBalanced(ctx, body, Math.max(8, avail - firstIndent)) : wrapLine(ctx, body, Math.max(8, avail - firstIndent), style))
        : [body];

      for (let li = 0; li < wrapped.length; li++) {
        const text = wrapped[li];
        const extraIndent = li === 0 ? firstIndent : 0;
        const xText = leftPad + extraIndent;
        const tw = measureW(ctx, text);
        const fullW = xText + tw + (hangList ? markerW : 0);
        maxW = Math.max(maxW, fullW);
        lines.push({
          text,
          raw: li === 0 ? stripIndent(raw) : '',
          para: pi,
          lineInPara: li,
          indent,
          marker: li === 0 ? marker : '',
          markerW,
          hangList,
          hangingQ: hangingQ && li === 0,
          x: xText,
          width: tw,
          y,
          start: charAt,
          end: charAt + text.length,
        });
        y += lineH;
        if (listOn && t.listSpacing) y += t.listSpacing;
      }
      charAt += (raw ? stripIndent(raw).length : 0) + 1;
      if (pi < paras.length - 1) y += (t.paragraphSpacing || 0);
    }

    if (t.truncate && t.maxLines > 0 && lines.length > t.maxLines) {
      const keep = lines.slice(0, t.maxLines);
      const last = keep[keep.length - 1];
      if (last) {
        let s = last.text;
        while (s.length && measureW(ctx, s + '…') > Math.max(last.width, 12)) s = s.slice(0, -1);
        last.text = (s || last.text).replace(/\s+$/, '') + '…';
        last.width = measureW(ctx, last.text);
        last.truncated = true;
      }
      lines.length = 0;
      Array.prototype.push.apply(lines, keep);
      y = 0;
      for (let i = 0; i < lines.length; i++) {
        lines[i].y = y;
        y += lineH;
        if (listOn && t.listSpacing) y += t.listSpacing;
      }
    }

    if (t.verticalTrim && lines.length) {
      const trim = Math.max(0, lineH - size) * 0.45;
      y = Math.max(size, y - trim * 2);
    }

    return {
      lines,
      lineH,
      w: Math.max(1, Math.ceil(maxW)),
      h: Math.max(1, Math.ceil(y || lineH)),
      size,
      t,
    };
  }

  function measure(n, boxW) {
    const L = layout(n, boxW);
    return { w: L.w, h: L.h, lines: L.lines.map((l) => l.text), lineH: L.lineH, layout: L };
  }

  function textLines(n, boxW) {
    const L = layout(n, boxW);
    return { lines: L.lines.map((l) => l.text), lineH: L.lineH, layout: L };
  }

  function linkAtChar(t, index) {
    const links = (t && t.links) || [];
    for (const l of links) {
      if (index >= l.start && index < l.end) return l;
    }
    return null;
  }

  function drawDeco(ctx, x0, x1, y, size, kind, style, offset) {
    const sw = Math.max(1, size * 0.07);
    ctx.save();
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = sw;
    if (style === 'dotted') ctx.setLineDash([sw, sw * 1.6]);
    else if (style === 'wavy') ctx.setLineDash([sw * 2, sw]);
    else ctx.setLineDash([]);
    ctx.beginPath();
    const yy = kind === 'strike' ? y - size * 0.3 : y + 2 + (offset || 0);
    ctx.moveTo(x0, yy);
    ctx.lineTo(x1, yy);
    ctx.stroke();
    ctx.restore();
  }

  function justifyGaps(ctx, text, target) {
    const parts = String(text).split(/(\s+)/);
    const words = [];
    for (const p of parts) {
      if (!p) continue;
      if (/^\s+$/.test(p)) {
        if (words.length) words[words.length - 1].space = (words[words.length - 1].space || 0) + measureW(ctx, p);
      } else words.push({ text: p, w: measureW(ctx, p), space: 0 });
    }
    if (words.length < 2) return null;
    let used = 0;
    for (const w of words) used += w.w + (w.space || 0);
    const extra = target - used;
    if (extra <= 0.5) return null;
    const each = extra / (words.length - 1);
    for (let i = 0; i < words.length - 1; i++) words[i].space = (words[i].space || 0) + each;
    return words;
  }

  function draw(ctx, n, doc, w, h) {
    const R = global.Renderer;
    if (R && typeof R._editingTextId === 'function' && R._editingTextId() === n.id) return;
    // Fallback: Renderer.setEditingText stores privately; drawText already
    // returns early when editing. We still skip if App says so.
    if (global.App && global.App._textEdit && global.App._textEdit.n === n) return;

    const t = defaults(n.text || {});
    const L = layout(n, boxWidth(n));
    const M = global.Model;
    ctx.save();
    ctx.globalAlpha = (ctx.globalAlphaBase ?? 1) * (n.opacity == null ? 1 : n.opacity);
    applyCanvasType(ctx, n);
    const fill = n.fills && n.fills[0];
    let color = '#111111', opacity = 1;
    if (R && R.resolvedColor) {
      const c = R.resolvedColor(doc, fill || { color: '#111111' }, '#111111');
      color = c.color; opacity = c.opacity;
    } else if (fill && fill.color) color = fill.color;
    ctx.fillStyle = M && M.rgbaCss ? M.rgbaCss(color, opacity) : color;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'start';

    const totalH = L.h;
    let top = 0;
    const canValign = (t.resize || 'fixed') === 'fixed';
    if (canValign && t.valign === 'middle') top = Math.max(0, (h - totalH) / 2);
    else if (canValign && t.valign === 'bottom') top = Math.max(0, h - totalH);

    const content = String(t.content || '');
    // Map display-line character offsets back onto the source string so
    // links (stored against source) still underline after wrap/case.
    let srcCursor = 0;

    for (let i = 0; i < L.lines.length; i++) {
      const ln = L.lines[i];
      const baseline = top + ln.y + L.lineH * 0.82;
      let tx = ln.x;
      if (t.align === 'center') tx = ln.x + Math.max(0, (w - ln.x - ln.width) / 2);
      else if (t.align === 'right') tx = Math.max(ln.x, w - ln.width);
      const lastInPara = (i === L.lines.length - 1) || L.lines[i + 1].para !== ln.para;
      const doJustify = t.align === 'justify' && !lastInPara && boxWidth(n) > 0;

      if (ln.marker) {
        const mx = ln.hangList ? (ln.x - ln.markerW) : (ln.x - ln.markerW);
        ctx.fillText(ln.marker, Math.max(-ln.markerW, mx), baseline);
      }
      if (ln.hangingQ && ln.text) {
        const q = ln.text[0];
        const qw = measureW(ctx, q);
        ctx.fillText(q, tx - qw, baseline);
      }

      const drawStr = ln.hangingQ ? ln.text.slice(1) : ln.text;
      const gaps = doJustify ? justifyGaps(ctx, drawStr, Math.max(8, w - tx)) : null;
      if (gaps) {
        let x = tx;
        for (const g of gaps) {
          ctx.fillText(g.text, x, baseline);
          x += g.w + (g.space || 0);
        }
      } else {
        ctx.fillText(drawStr, ln.hangingQ ? tx : tx, baseline);
      }

      const decoU = t.underline || (t.links && t.links.length);
      const decoS = t.strike;
      if (decoU || decoS) {
        const x1 = tx + (gaps ? Math.max(ln.width, w - tx) : measureW(ctx, drawStr));
        if (t.underline) drawDeco(ctx, tx, x1, baseline, L.size, 'underline', t.underlineStyle, t.underlineOffset);
        if (t.strike) drawDeco(ctx, tx, x1, baseline, L.size, 'strike', 'solid', 0);
        if (t.links && t.links.length && !t.underline) {
          // Underline only the linked slice of this visual line.
          const lineStart = srcCursor;
          const lineEnd = srcCursor + (ln.raw || ln.text).length;
          for (const link of t.links) {
            const a = Math.max(link.start, lineStart);
            const b = Math.min(link.end, lineEnd);
            if (b <= a) continue;
            const pre = applyCase((content.slice(lineStart, a)), t.textCase === 'small-caps' ? 'none' : t.textCase);
            const mid = applyCase(content.slice(a, b), t.textCase === 'small-caps' ? 'none' : t.textCase);
            const x0 = tx + measureW(ctx, pre);
            drawDeco(ctx, x0, x0 + measureW(ctx, mid), baseline, L.size, 'underline', 'solid', 0);
          }
        }
      }
      srcCursor += (ln.raw ? ln.raw.length : ln.text.length);
      if (lastInPara) srcCursor += 1; // newline
    }

    try { ctx.letterSpacing = '0px'; } catch (e) {}
    ctx.restore();
  }

  function hitLink(n, localX, localY) {
    const t = n && n.text;
    if (!t || !t.links || !t.links.length) return null;
    const L = layout(n, boxWidth(n));
    const canValign = (t.resize || 'fixed') === 'fixed';
    let top = 0;
    if (canValign && t.valign === 'middle') top = Math.max(0, ((n.h || 0) - L.h) / 2);
    else if (canValign && t.valign === 'bottom') top = Math.max(0, (n.h || 0) - L.h);
    for (const ln of L.lines) {
      if (localY < top + ln.y || localY > top + ln.y + L.lineH) continue;
      let tx = ln.x;
      if (t.align === 'center') tx = ln.x + Math.max(0, ((n.w || 0) - ln.x - ln.width) / 2);
      else if (t.align === 'right') tx = Math.max(ln.x, (n.w || 0) - ln.width);
      if (localX < tx || localX > tx + ln.width) continue;
      const ctx = ctx2d();
      applyCanvasType(ctx, n);
      const rel = localX - tx;
      let acc = 0, idx = 0;
      const s = ln.text || '';
      for (; idx < s.length; idx++) {
        const w = measureW(ctx, s[idx]);
        if (acc + w / 2 >= rel) break;
        acc += w;
      }
      const sourceIndex = (ln.start || 0) + idx;
      return linkAtChar(t, sourceIndex);
    }
    return null;
  }

  function setLink(t, start, end, href) {
    defaults(t);
    const a = Math.min(start, end), b = Math.max(start, end);
    if (b <= a) return;
    t.links = (t.links || []).filter((l) => l.end <= a || l.start >= b);
    const url = String(href || '').trim();
    if (url) t.links.push({ start: a, end: b, href: url });
    t.links.sort((x, y) => x.start - y.start);
  }

  function cssFeatures(t) {
    defaults(t);
    const ot = t.ot || {};
    const feats = [];
    feats.push((ot.liga === false ? '"liga" 0' : '"liga" 1'));
    if (ot.dlig) feats.push('"dlig" 1');
    feats.push((ot.calt === false ? '"calt" 0' : '"calt" 1'));
    if (ot.smcp || t.textCase === 'small-caps') feats.push('"smcp" 1');
    if (ot.tnum) feats.push('"tnum" 1');
    if (ot.onum) feats.push('"onum" 1');
    if (ot.frac) feats.push('"frac" 1');
    if (ot.sups) feats.push('"sups" 1');
    if (ot.subs) feats.push('"subs" 1');
    if (ot.ss01) feats.push('"ss01" 1');
    if (ot.ss02) feats.push('"ss02" 1');
    if (ot.ss03) feats.push('"ss03" 1');
    return feats.join(', ');
  }

  function cssTransform(t) {
    defaults(t);
    if (t.textCase === 'upper') return 'uppercase';
    if (t.textCase === 'lower') return 'lowercase';
    if (t.textCase === 'title') return 'capitalize';
    return 'none';
  }

  function featureCss(t) {
    defaults(t);
    return {
      fontFeatureSettings: cssFeatures(t),
      fontVariantLigatures: (t.ot && t.ot.liga === false) ? 'none' : 'common-ligatures',
      fontVariantCaps: (t.textCase === 'small-caps' || (t.ot && t.ot.smcp)) ? 'small-caps' : 'normal',
      fontVariantNumeric: (t.ot && t.ot.tnum) ? 'tabular-nums' : ((t.ot && t.ot.onum) ? 'oldstyle-nums' : 'normal'),
      textTransform: cssTransform(t),
      textDecoration: [t.underline ? 'underline' : '', t.strike ? 'line-through' : ''].filter(Boolean).join(' ') || 'none',
      fontKerning: (t.ot && t.ot.kern === false) ? 'none' : 'normal',
    };
  }

  function isIconFont(name) {
    const n = (name || '').toLowerCase();
    return ICON_FONTS.some((f) => f.name.toLowerCase() === n) || /material (icons|symbols)|font awesome|icon/i.test(name || '');
  }

  function loadIconFont(name) {
    const map = {
      'Material Symbols Outlined': 'https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,100..700,0..1,-50..200&display=swap',
      'Material Symbols Rounded': 'https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@24,100..700,0..1,-50..200&display=swap',
      'Material Symbols Sharp': 'https://fonts.googleapis.com/css2?family=Material+Symbols+Sharp:opsz,wght,FILL,GRAD@24,100..700,0..1,-50..200&display=swap',
      'Material Icons': 'https://fonts.googleapis.com/icon?family=Material+Icons',
      'Material Icons Outlined': 'https://fonts.googleapis.com/icon?family=Material+Icons+Outlined',
      'Material Icons Round': 'https://fonts.googleapis.com/icon?family=Material+Icons+Round',
    };
    const href = map[name];
    if (!href) return Promise.resolve();
    const id = 'pf-iconfont-' + name.replace(/\s+/g, '-');
    if (document.getElementById(id)) return Promise.resolve();
    return new Promise((resolve) => {
      const link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      link.href = href;
      link.onload = () => resolve();
      link.onerror = () => resolve();
      document.head.appendChild(link);
    });
  }

  function captureStyle(t) {
    t = defaults(t || {});
    return {
      font: t.font,
      size: t.size,
      weight: t.weight,
      italic: !!t.italic,
      lineHeight: t.lineHeight,
      lineHeightUnit: t.lineHeightUnit,
      letterSpacing: t.letterSpacing,
      underline: !!t.underline,
      strike: !!t.strike,
      textCase: t.textCase,
      list: t.list,
      listSpacing: t.listSpacing,
      paragraphSpacing: t.paragraphSpacing,
      paragraphIndent: t.paragraphIndent,
      hangingLists: !!t.hangingLists,
      hangingQuotes: !!t.hangingQuotes,
      truncate: !!t.truncate,
      maxLines: t.maxLines,
      wrapStyle: t.wrapStyle,
      ot: Object.assign({}, t.ot || {}),
    };
  }

  function applyStyleFields(t, st) {
    if (!t || !st) return;
    const keys = [
      'font', 'size', 'weight', 'italic', 'lineHeight', 'lineHeightUnit',
      'letterSpacing', 'underline', 'strike', 'textCase', 'list', 'listSpacing',
      'paragraphSpacing', 'paragraphIndent', 'hangingLists', 'hangingQuotes',
      'truncate', 'maxLines', 'wrapStyle',
    ];
    for (const k of keys) if (st[k] != null) t[k] = st[k];
    if (st.ot) t.ot = Object.assign({}, t.ot || {}, st.ot);
  }

  function bumpSize(t, dir) {
    const steps = [8, 10, 11, 12, 13, 14, 16, 18, 20, 24, 32, 40, 48, 64, 80, 96];
    const cur = t.size || 16;
    if (dir > 0) {
      const next = steps.find((s) => s > cur);
      t.size = next != null ? next : Math.min(300, cur + 2);
    } else {
      let prev = steps[0];
      for (const s of steps) { if (s < cur) prev = s; }
      t.size = cur <= steps[0] ? Math.max(4, cur - 1) : prev;
    }
  }

  function bumpWeight(t, dir) {
    const i = WEIGHTS.findIndex((w) => w.n === nearestWeight(t.weight));
    const j = Math.max(0, Math.min(WEIGHTS.length - 1, i + (dir > 0 ? 1 : -1)));
    t.weight = WEIGHTS[j].n;
  }

  global.TextEngine = {
    defaults, layout, measure, textLines, draw, hitLink, setLink,
    applyCase, lineHeightPx, weightName, nearestWeight, WEIGHTS,
    ICON_FONTS, ICON_GLYPHS, POPULAR, VARIABLE, isIconFont, loadIconFont,
    featureCss, cssFeatures, captureStyle, applyStyleFields,
    bumpSize, bumpWeight, markerFor, indentOf, splitParas,
    boxWidth, fontSpec,
  };
})(window);
