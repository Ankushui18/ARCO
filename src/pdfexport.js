/* pdfexport.js — minimal pure-JS PDF export (no canvas, no libraries).
 *
 * Writes a spec-valid PDF 1.4 page: white background, then the node tree as
 * vector graphics — rects (rounded or not), ellipses (4-arc Bézier), lines,
 * and text on the 14 standard fonts (Helvetica family). Fills use the node's
 * first solid paint (gradients approximate to their first stop); children are
 * positioned with accumulated parent offsets, matching the model's relative
 * coordinates. Non-Latin1 text characters are replaced with "?" so the
 * content-stream /Length byte math stays exact under WinAnsiEncoding.
 */
(function (global) {
  'use strict';

  const K = 0.5523; // Bézier circle-arc constant
  const r3 = (v) => (Math.round(v * 1000) / 1000).toString();

  const esc = (s) => String(s)
    .replace(/[^\x20-\x7e\x80-\xff]/g, '?')          // keep latin1 (byte-safe)
    .replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');

  const hex2rgb = (h) => {
    h = String(h || '#000000').replace('#', '');
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) h = '000000';
    return [
      (parseInt(h.slice(0, 2), 16) / 255).toFixed(3),
      (parseInt(h.slice(2, 4), 16) / 255).toFixed(3),
      (parseInt(h.slice(4, 6), 16) / 255).toFixed(3),
    ];
  };

  const firstColor = (f) => {
    if (!f) return null;
    if (f.type === 'solid') return f.color || null;
    if ((f.type === 'linear' || f.type === 'radial') && f.stops && f.stops.length) return f.stops[0].color;
    return null;
  };

  // rounded-rect path in PDF coords. Canvas box (x, y, w, h) with y DOWN;
  // pdfY(top) = H - y. radii: [tl, tr, br, bl] in canvas corners.
  function roundRect(x, y, w, h, radii, H, out) {
    const [tl, tr, br, bl] = radii || [0, 0, 0, 0];
    const Y = (cy) => H - cy;                       // canvas y (top-down) → pdf y
    // start at top edge, just right of the TL arc (canvas coords)
    out.push(r3(x + Math.min(tl, w / 2)), r3(Y(y)), 'm');
    // top edge
    out.push(r3(x + w - Math.min(tr, w / 2)), r3(Y(y)), 'l');
    // TR arc (center canvas (x+w-tr, y+tr))
    const trr = Math.min(tr, w / 2, h / 2);
    out.push('c',
      r3(x + w), r3(Y(y)),
      r3(x + w), r3(Y(y + trr * (1 - K))),
      r3(x + w), r3(Y(y + trr)));
    // right edge
    out.push(r3(x + w), r3(Y(y + h - Math.min(br, h / 2))), 'l');
    // BR arc
    const brr = Math.min(br, w / 2, h / 2);
    out.push('c',
      r3(x + w), r3(Y(y + h)),
      r3(x + w - brr * (1 - K)), r3(Y(y + h)),
      r3(x + w - brr), r3(Y(y + h)));
    // bottom edge
    out.push(r3(x + Math.min(bl, w / 2)), r3(Y(y + h)), 'l');
    // BL arc
    const blr = Math.min(bl, w / 2, h / 2);
    out.push('c',
      r3(x), r3(Y(y + h)),
      r3(x), r3(Y(y + h - blr * (1 - K))),
      r3(x), r3(Y(y + h - blr)));
    // left edge
    out.push(r3(x), r3(Y(y + Math.min(tl, h / 2))), 'l');
    // TL arc
    const tlr = Math.min(tl, w / 2, h / 2);
    out.push('c',
      r3(x), r3(Y(y)),
      r3(x + tlr * (1 - K)), r3(Y(y)),
      r3(x + tlr), r3(Y(y)));
    out.push('h');
  }

  function ellipsePath(cx, cyTop, rx, ry, H, out) {
    const cy = H - (cyTop + ry); // pdf center
    out.push('m', r3(cx + rx), r3(cy));
    out.push('c', r3(cx + rx), r3(cy + ry * K), r3(cx + rx * K), r3(cy + ry), r3(cx), r3(cy + ry));
    out.push('c', r3(cx - rx * K), r3(cy + ry), r3(cx - rx), r3(cy + ry * K), r3(cx - rx), r3(cy));
    out.push('c', r3(cx - rx), r3(cy - ry * K), r3(cx - rx * K), r3(cy - ry), r3(cx), r3(cy - ry));
    out.push('c', r3(cx + rx * K), r3(cy - ry), r3(cx + rx), r3(cy - ry * K), r3(cx + rx), r3(cy));
    out.push('h');
  }

  function textOps(n, x, yTop, H, out) {
    const t = n.text;
    const hex = firstColor((n.fills || [])[0]) || '#1e1e1e';
    const [r, g, b] = hex2rgb(hex);
    const size = t.size || 16;
    const font = (t.weight >= 700 ? (t.italic ? '/F4' : '/F2') : (t.italic ? '/F3' : '/F1'));
    const lh = (t.lineHeight || 1.2) * size;
    const lines = String(t.content || '').split('\n');
    const approxW = (s) => s.length * size * 0.5; // same ratio as Renderer.measureText
    lines.forEach((ln, i) => {
      let tx = x;
      if (t.align === 'center') tx = x - approxW(ln) / 2;
      else if (t.align === 'right') tx = x - approxW(ln);
      const baseline = H - (yTop + i * lh + size * 0.8);
      out.push('BT', `${font} ${r3(size)} Tf`, `${r3(tx)} ${r3(baseline)} Td`, `(${esc(ln)}) Tj`, 'ET');
    });
  }

  // vector node → PDF path operators (M m / L l / C c / close h).
  // Path coords are node-local; canvas (x+lx, y+ly) → pdf (x+lx, H - y - ly).
  function vectorPathOps(n, x, y, H, out) {
    const F = global.FigIO;
    if (!F || typeof F.parsePath !== 'function') return false;
    let sps;
    try { sps = F.parsePath(n.path); } catch (e) { return false; }
    const Y = (ly) => H - y - ly;
    for (const sp of sps) {
      if (!sp.segs.length) continue;
      out.push(r3(x + sp.start[0]), r3(Y(sp.start[1])), 'm');
      for (const s of sp.segs) {
        if (s.t === 'L') out.push(r3(x + s.x), r3(Y(s.y)), 'l');
        else out.push('c', r3(x + s.x1), r3(Y(s.y1)), r3(x + s.x2), r3(Y(s.y2)), r3(x + s.x), r3(Y(s.y)));
      }
      out.push('h');
    }
    return true;
  }

  function renderNode(n, page, H, out, ox, oy) {
    if (!n.visible) return;
    const x = ox + n.x, y = oy + n.y, w = n.w, h = n.h;
    const fillHex = firstColor((n.fills || [])[0]);
    const st = n.stroke && n.stroke.visible ? n.stroke : null;

    if (n.type === 'vector' && n.path) {
      if (vectorPathOps(n, x, y, H, out)) {
        if (fillHex) { const [r, g, b] = hex2rgb(fillHex); out.push(r, g, b, 'rg'); out.push('f'); }
        if (st && st.width > 0) { const [r, g, b] = hex2rgb(st.color); out.push(r, g, b, 'RG', r3(st.width), 'w'); out.push('S'); }
      }
      return;
    }

    if (n.type === 'rect' || n.type === 'frame') {
      const rad = n.type === 'rect' ? n.radius : [0, 0, 0, 0];
      const path = () => {
        const maxR = Math.max(0, ...rad);
        if (maxR > 0) roundRect(x, y, w, h, rad, H, out);
        else out.push(r3(x), r3(H - y - h), r3(w), r3(h), 're');
      };
      if (fillHex && n.type === 'rect') { const [r, g, b] = hex2rgb(fillHex); out.push(r, g, b, 'rg'); path(); out.push('f'); }
      if (fillHex && n.type === 'frame') { const [r, g, b] = hex2rgb(fillHex); out.push(r, g, b, 'rg'); path(); out.push('f'); }
      if (st && st.width > 0) {
        const [r, g, b] = hex2rgb(st.color);
        out.push(r, g, b, 'RG', r3(st.width), 'w'); path(); out.push('S');
      }
    } else if (n.type === 'ellipse') {
      ellipsePath(x + w / 2, y, w / 2, h / 2, H, out);
      if (fillHex) { const [r, g, b] = hex2rgb(fillHex); out.push(r, g, b, 'rg'); out.push('f'); }
      if (st && st.width > 0) { const [r, g, b] = hex2rgb(st.color); out.push(r, g, b, 'RG', r3(st.width), 'w'); out.push('S'); }
    } else if (n.type === 'line') {
      const [r, g, b] = hex2rgb(st ? st.color : '#000000');
      out.push(r, g, b, 'RG', r3(st && st.width ? st.width : 1), 'w',
        r3(x), r3(H - y - h / 2), 'm', r3(x + w), r3(H - y - h / 2), 'l', 'S');
      if (n.arrowEnd) {
        const len = Math.max(10, (st && st.width ? st.width : 1) * 5);
        const a = Math.PI * 26 / 180;
        const ex = x + w, ey = H - y - h / 2;
        out.push(r3(ex), r3(ey), 'm', r3(ex - len * Math.cos(a)), r3(ey - len * Math.sin(a)), 'l', 'S');
        out.push(r3(ex), r3(ey), 'm', r3(ex - len * Math.cos(a)), r3(ey + len * Math.sin(a)), 'l', 'S');
      }
    } else if (n.type === 'text' && n.text) {
      textOps(n, x, y, H, out);
    }
    // children (coordinates relative to this node)
    if (n.children) for (const cid of n.children) {
      const k = page.nodes[cid];
      if (k) renderNode(k, page, H, out, x, y);
    }
  }

  const PdfExport = {
    // render one top-level node (or a whole page) to PDF.
    // renderNode(doc, page, node) → { pdf, width, height }
    renderNode(doc, page, node) {
      return PdfExport._render(page, [node], { width: 0, height: 0 });
    },
    renderPage(doc, page) {
      const tops = (page.tops || []).map(id => page.nodes[id]).filter(Boolean);
      return PdfExport._render(page, tops, { width: 0, height: 0 });
    },

    _render(page, tops, _o) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const box = (n) => { x0 = Math.min(x0, n.x); y0 = Math.min(y0, n.y); x1 = Math.max(x1, n.x + n.w); y1 = Math.max(y1, n.y + n.h); };
      const walk = (n) => { box(n); for (const cid of n.children || []) { const k = page.nodes[cid]; if (k) walk(k); } };
      tops.forEach(walk);
      if (!isFinite(x0)) { x0 = 0; y0 = 0; x1 = 800; y1 = 600; }
      const W = Math.max(1, x1 - x0), H = Math.max(1, y1 - y0);

      const out = [];
      out.push('1 1 1 rg', r3(0), r3(0), r3(W), r3(H), 're', 'f'); // white bg
      for (const t of tops) renderNode(t, page, H, out, -x0, -y0);

      return { pdf: buildPdf(out.join(' '), W, H), width: W, height: H };
    },
  };

  function buildPdf(content, W, H) {
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${r3(W)} ${r3(H)}] /Resources << /Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R /F4 7 0 R >> >> /Contents 8 0 R >>`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-BoldOblique /Encoding /WinAnsiEncoding >>',
      null, // 8: content stream
    ];
    let pdf = '%PDF-1.4\n';
    const offsets = [];
    objects.forEach((o, i) => {
      offsets.push(pdf.length);
      if (o === null) {
        pdf += `${i + 1} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`;
      } else {
        pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
      }
    });
    const xrefPos = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) pdf += String(off).padStart(10, '0') + ' 00000 n \n';
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
    return pdf;
  }

  global.PdfExport = PdfExport;
})(window);
