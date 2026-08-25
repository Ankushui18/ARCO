/* svgexport.js — Figma-style SVG export: renders a node subtree to an
 * SVG string (pure JS over the laid-out model; no canvas needed).
 */
(function (global) {
  'use strict';
  const M = global.Model;
  const R = global.Renderer;

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  let gradSeq = 0;

  function fillSvg(f, doc) {
    if (!f || f.visible === false) return null;
    if (f.type === 'solid') {
      const c = R.resolvedColor(doc, f, '#000000');
      return { attr: `fill="${c.color}" fill-opacity="${c.opacity}"` };
    }
    if (f.type === 'linear') {
      gradSeq++;
      const id = 'pg' + gradSeq;
      const stops = (f.stops || []).map(s => {
        const c = R.resolvedColor(doc, s, '#000000');
        return `<stop offset="${Math.max(0, Math.min(1, s.pos ?? 0))}" stop-color="${c.color}" stop-opacity="${c.opacity}"/>`;
      }).join('');
      const defs = `<linearGradient id="${id}" x1="${f.from?.x ?? 0}" y1="${f.from?.y ?? 0}" x2="${f.to?.x ?? 1}" y2="${f.to?.y ?? 1}">${stops}</linearGradient>`;
      return { attr: `fill="url(#${id})"`, defs };
    }
    return { attr: 'fill="#cccccc" fill-opacity="0.6"' };
  }

  function nodeSvg(n, doc, page, out, defs, ind) {
    const L = n._l; if (!L || n.visible === false) return;
    const x = L.x, y = L.y, w = L.w, h = L.h;
    const rad = n.type === 'ellipse' ? null : (Array.isArray(n.radius) ? n.radius : n.radius ? [n.radius, n.radius, n.radius, n.radius] : [0, 0, 0, 0]);
    const clipId = (n.type === 'frame' || n.type === 'instance') && n.children?.length ? `c${n.id}` : null;
    const clip = clipId ? `<clipPath id="${clipId}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rad ? Math.max(0, Math.min(rad[0], w / 2, h / 2)) : 0}"/></clipPath>` : '';
    const st = n.stroke && n.stroke.visible !== false && n.stroke.width ? n.stroke : null;
    const stA = st ? (() => { const c = R.resolvedColor(doc, st, '#000000'); return `stroke="${c.color}" stroke-opacity="${c.opacity}" stroke-width="${st.width}"`; })() : '';
    let s = '';
    if (n.type === 'ellipse') {
      const f = n.fills?.[0]; const fa = f ? fillSvg(f, doc) : null;
      s += `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" ${fa?.attr || ''} ${stA}/>`;
    } else if (n.type === 'line') {
      s += `<line x1="${x}" y1="${y + h / 2}" x2="${x + w}" y2="${y + h / 2}" ${stA || `stroke="#333" stroke-width="1"`}/>`;
      if (n.arrowEnd) {
        const len = Math.max(10, (st?.width || 1) * 5);
        const a = Math.PI * 26 / 180;
        const ex = x + w, ey = y + h / 2;
        const sa = stA || `stroke="#333" stroke-width="1"`;
        s += `<line x1="${ex}" y1="${ey}" x2="${ex - len * Math.cos(a)}" y2="${ey - len * Math.sin(a)}" ${sa}/>`;
        s += `<line x1="${ex}" y1="${ey}" x2="${ex - len * Math.cos(a)}" y2="${ey + len * Math.sin(a)}" ${sa}/>`;
      }
    } else if (n.type === 'vector') {
      if (n.path) {
        const f = n.fills?.find(f2 => f2.visible !== false);
        const fa = f ? fillSvg(f, doc) : null;
        const rule = n.windingRule === 'evenodd' ? ' fill-rule="evenodd"' : ' fill-rule="nonzero"';
        s += `<g transform="translate(${x} ${y})"><path d="${n.path}" ${fa ? fa.attr : 'fill="none"'}${rule}${st ? ' ' + stA : ''}/></g>`;
        if (fa?.defs) defs.push(fa.defs);
      } else {
        s += `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#787882" stroke-opacity="0.5" stroke-dasharray="4 3"/>`;
      }
    } else if (n.type === 'text') {
      const t = n.text || {};
      const c = R.resolvedColor(doc, (n.fills && n.fills[0]) || t, '#111111');
      const wgt = t.weight >= 600 ? 'font-weight="700"' : t.weight ? `font-weight="${t.weight}"` : '';
      const lines = String(t.content || '').split('\n');
      const lh = (t.lineHeight && t.lineHeight !== 1) ? t.size * t.lineHeight : t.size * 1.25;
      const vy = y + (t.valign === 'middle' ? (h - lines.length * lh) / 2 + lh * 0.85 : t.valign === 'bottom' ? h - lh * 0.15 : lh * 0.85);
      s += lines.map((ln, i) => `<text x="${x + 1}" y="${vy + i * lh}" font-family="${esc(t.font || 'Inter')},Helvetica,Arial,sans-serif" font-size="${t.size || 14}" ${wgt} ${t.italic ? 'font-style="italic"' : ''} fill="${c.color}" fill-opacity="${c.opacity}">${esc(ln)}</text>`).join('');
    } else {
      const f = n.fills?.find(f2 => f2.visible !== false);
      const fa = f ? fillSvg(f, doc) : null;
      if ((n.type === 'frame' || n.type === 'instance') && !f && !st) s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="#3a3a3a" stroke-opacity="0.4"/>`;
      else s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rad ? Math.max(0, Math.min(rad[0], w / 2, h / 2)) : 0}" ${fa?.attr || 'fill="none"'} ${stA}/>`;
      if (fa?.defs) defs.push(fa.defs);
    }
    if (clip) defs.push(clip);
    out.push(`${'  '.repeat(ind)}<!-- ${n.type} "${esc(n.name)}" -->`);
    if (s) out.push(`${'  '.repeat(ind)}${s}`);
    if (n.children?.length) {
      const maskKid = n.children.map(id => page.nodes[id]).find(k => k && k.mask);
      out.push(`${'  '.repeat(ind)}<g${clipId ? ` clip-path="url(#${clipId})"` : ''}>`);
      if (maskKid) {
        nodeSvg(maskKid, doc, page, out, defs, ind + 1);
        out.push(`${'  '.repeat(ind + 1)}<g clip-path="${maskClipPath(maskKid)}">`);
        for (const cid of n.children) { const c = page.nodes[cid]; if (c && c !== maskKid) nodeSvg(c, doc, page, out, defs, ind + 2); }
        out.push(`${'  '.repeat(ind + 1)}</g>`);
      } else {
        for (const cid of n.children) { const c = page.nodes[cid]; if (c) nodeSvg(c, doc, page, out, defs, ind + 1); }
      }
      out.push(`${'  '.repeat(ind)}</g>`);
    }
  }
  function maskClipPath(k) {
    const L = k._l;
    if (k.type === 'ellipse') return `url(#m${k.id})`;
    return `url(#m${k.id})`;
  }

  function renderNode(doc, page, n, opts = {}) {
    gradSeq = 0;
    const out = [], defs = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    M.forEachNode(page, n, (c) => {
      if (!c._l || c.visible === false) return;
      minX = Math.min(minX, c._l.x); minY = Math.min(minY, c._l.y);
      maxX = Math.max(maxX, c._l.x + c._l.w); maxY = Math.max(maxY, c._l.y + c._l.h);
    });
    if (!isFinite(minX)) { minX = n.x; minY = n.y; maxX = n.x + n.w; maxY = n.y + n.h; }
    const PAD = 0;
    const W = Math.max(1, Math.ceil(maxX - minX + PAD * 2)), H = Math.max(1, Math.ceil(maxY - minY + PAD * 2));
    // mask clip paths
    M.forEachNode(page, n, (c) => {
      if (c.mask && c._l) {
        if (c.type === 'ellipse') defs.push(`<clipPath id="m${c.id}"><ellipse cx="${c._l.x + c._l.w / 2}" cy="${c._l.y + c._l.h / 2}" rx="${c._l.w / 2}" ry="${c._l.h / 2}"/></clipPath>`);
        else defs.push(`<clipPath id="m${c.id}"><rect x="${c._l.x}" y="${c._l.y}" width="${c._l.w}" height="${c._l.h}"/></clipPath>`);
      }
    });
    nodeSvg(n, doc, page, out, defs, 0);
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${minX - PAD} ${minY - PAD} ${W} ${H}">\n${defs.length ? '  <defs>' + defs.join('') + '</defs>\n' : ''}${out.join('\n')}\n</svg>`;
  }

  global.SvgExport = { renderNode, esc };
})(window);
