/* eco.js — Figma-ecosystem helpers: named versions, comments,
 * prototyping navigation, dev-mode code generation.
 */
(function (global) {
  'use strict';
  const M = global.Model;

  // ============================================================ versions
  const Versions = {
    list(doc) { M.ensureDocShape(doc); return doc.versions; },
    add(doc, name) {
      M.ensureDocShape(doc);
      const v = {
        id: M.uid('ver-'),
        name: name || ('Version ' + (doc.versions.length + 1)),
        at: Date.now(),
        snap: M.snapshot(doc),
      };
      doc.versions.unshift(v);
      if (doc.versions.length > 30) doc.versions.length = 30;
      return v;
    },
    restore(doc, id) {
      M.ensureDocShape(doc);
      const v = doc.versions.find(x => x.id === id);
      if (!v) return false;
      // The version list is history metadata, not part of the document state:
      // a version's snapshot predates its own entry, so restoring must keep
      // the current list or every restore would wipe the history (bug caught
      // by the P0 acceptance matrix).
      const kept = doc.versions.slice();
      M.restore(doc, v.snap);
      doc.versions = kept;
      return true;
    },
    remove(doc, id) { M.ensureDocShape(doc); doc.versions = doc.versions.filter(v => v.id !== id); },
  };

  // ============================================================ comments
  const Comments = {
    listFor(doc, pageId) {
      M.ensureDocShape(doc);
      return doc.comments.filter(c => c.pageId === pageId);
    },
    add(doc, pageId, x, y, text, author) {
      M.ensureDocShape(doc);
      const c = { id: M.uid('cm-'), pageId, x, y, text, author: author || 'You', at: Date.now(), resolved: false };
      doc.comments.push(c);
      return c;
    },
    resolve(doc, id, val) {
      const c = doc.comments.find(x => x.id === id);
      if (c) c.resolved = val;
    },
    remove(doc, id) { M.ensureDocShape(doc); doc.comments = doc.comments.filter(c => c.id !== id); },
  };

  // ============================================================ prototyping
  const Proto = {
    add(n, it) {
      n.interactions = n.interactions || [];
      n.interactions.push(Object.assign({ on: 'click', to: null, kind: 'node', anim: 'none' }, it));
    },
    remove(n, i) { (n.interactions || []).splice(i, 1); },
    // where does a click on node n go? returns {page, node} or null
    destination(doc, n) {
      const it = (n.interactions || [])[0];
      if (!it || !it.to) return null;
      if (it.kind === 'page') {
        const p = doc.pages.find(pp => pp.id === it.to) || doc.pages[0];
        const first = p.tops.length ? p.nodes[p.tops[0]] : null;
        return first ? { page: p, node: first } : null;
      }
      for (const p of doc.pages) if (p.nodes[it.to]) return { page: p, node: p.nodes[it.to] };
      return null;
    },
    // all top-level "screens" of a page (for the present-mode start list)
    screens(doc, page) {
      const out = [];
      for (const tid of page.tops) { const n = page.nodes[tid]; if (n) out.push(n); }
      return out;
    },
  };

  // ============================================================ dev-mode codegen
  const hex = (f, fallback) => {
    if (!f) return fallback;
    if (f.type === 'solid') return f.color || fallback;
    if (f.type === 'linear') {
      const s = (f.stops || []).map(st => st.color + ' ' + Math.round((st.pos || 0) * 100) + '%').join(', ');
      return 'linear-gradient(135deg, ' + (s || 'transparent') + ')';
    }
    return fallback;
  };
  const radiusCss = (n) => {
    if (!n.radius) return null;
    const [tl, tr, br, bl] = n.radius;
    if (tl === tr && tr === br && br === bl) return tl ? tl + 'px' : null;
    if (tl === br && tr === bl) return [tl, tr, br, bl].map(v => v + 'px').join(' ');
    return null;
  };
  function cssBlock(n, page, cls, indent) {
    const pad2 = '  '.repeat(indent);
    const out = [];
    out.push('.' + cls + ' {');
    const decl = (k, v) => { if (v != null && v !== '') out.push(pad2 + '  ' + k + ': ' + v); };
    decl('position', 'relative');
    if (n._l || n.w) {
      decl('width', Math.round(n.w) + 'px');
      decl('height', Math.round(n.h) + 'px');
    }
    if (n.type === 'text') {
      const t = n.text || {};
      decl('font-family', '"' + (t.font || 'Inter') + '", sans-serif');
      decl('font-size', (t.size || 14) + 'px');
      decl('font-weight', t.weight || 400);
      if (t.italic) decl('font-style', 'italic');
      decl('line-height', t.lineHeight || 1.2);
      if (t.letterSpacing) decl('letter-spacing', t.letterSpacing + 'px');
      decl('color', hex(n.fills && n.fills[0], '#1e1e1e'));
      if (t.align && t.align !== 'left') decl('text-align', t.align);
    } else {
      const bg = n.fills && n.fills[0];
      decl('background', bg ? hex(bg, 'transparent') : 'transparent');
      const r = radiusCss(n);
      decl('border-radius', r);
      if (n.stroke && n.stroke.width > 0) decl('border', n.stroke.width + 'px solid ' + (n.stroke.color || '#000') + (n.stroke.align === 'inside' ? '' : ''));
      if (n.opacity != null && n.opacity < 1) decl('opacity', Math.round(n.opacity * 100) / 100);
      if ((n.shadows || []).length) {
        const sh = n.shadows.filter(s => s.visible !== false).map(s =>
          [s.x || 0, s.y || 0].join(' ') + ' ' + (s.blur || 0) + 'px ' + (s.spread ? s.spread + 'px ' : '') + 'rgba(' +
          hexRgb(s.color || '#000', s.opacity == null ? 0.25 : s.opacity) + ')').join(', ');
        decl('box-shadow', sh);
      }
      if (n.al) {
        decl('display', 'flex');
        decl('flex-direction', n.al.dir === 'h' ? 'row' : 'column');
        const gap = numAl(n.al.gap); if (gap) decl('gap', gap + 'px');
        const p = n.al.pad.map(numAl);
        if (p.some(v => v)) decl('padding', p.join(' ') + 'px');
        decl('align-items', { start: 'flex-start', center: 'center', end: 'flex-end', stretch: 'stretch' }[n.al.cross] || 'flex-start');
        decl('justify-content', { start: 'flex-start', center: 'center', end: 'flex-end', 'space-between': 'space-between', 'space-evenly': 'space-evenly' }[n.al.main] || 'flex-start');
        if (n.al.wrap) decl('flex-wrap', 'wrap');
      }
      if (n.clips) decl('overflow', 'hidden');
    }
    out.push(pad2 + '}');
    for (const cid of n.children) {
      const k = page.nodes[cid];
      if (!k) continue;
      const c2 = (k.name || 'node').toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + short(k.id);
      out.push(cssBlock(k, page, c2, indent + 1));
    }
    return out.join('\n');
  }
  const numAl = (f) => (f && typeof f === 'object') ? (f.tokValue != null ? f.tokValue : f.n) : (typeof f === 'number' ? f : 0);
  const short = (id) => String(id).slice(-4);
  function hexRgb(h, a) {
    const m = M.normHex(h).replace('#', '');
    return [parseInt(m.slice(0, 2), 16), parseInt(m.slice(2, 4), 16), parseInt(m.slice(4, 6), 16)].join(',') + ',' + (a == null ? 1 : a);
  }
  function htmlBlock(n, page, indent) {
    const pad2 = '  '.repeat(indent);
    const tag = n.type === 'text' ? 'p' : n.type === 'ellipse' ? 'div' : 'div';
    const style = [];
    const L = n._l || { x: n.x, y: n.y, w: n.w, h: n.h };
    if (n.type === 'text') {
      const t = n.text || {};
      style.push('font-family:"' + (t.font || 'Inter') + '",sans-serif', 'font-size:' + (t.size || 14) + 'px', 'font-weight:' + (t.weight || 400));
      style.push('color:' + hex(n.fills && n.fills[0], '#1e1e1e'));
    } else {
      style.push('width:' + Math.round(L.w) + 'px', 'height:' + Math.round(L.h) + 'px');
      const bg = n.fills && n.fills[0];
      style.push('background:' + (bg ? hex(bg, 'transparent') : 'transparent'));
      const r = radiusCss(n); if (r) style.push('border-radius:' + r);
      if (n.type === 'ellipse') style.push('border-radius:50%');
    }
    if (n.type !== 'text') {
      style.push('position:absolute', 'left:' + Math.round(L.x) + 'px', 'top:' + Math.round(L.y) + 'px');
    }
    const attrs = n.type === 'text' ? '' : ' style="' + style.join(';') + '"';
    const label = n.type === 'text' ? escapeHtml((n.text && n.text.content) || 'Text') : '';
    let out = pad2 + '<' + tag + attrs + '>' + label;
    if (n.children.length) {
      out += '\n';
      for (const cid of n.children) { const k = page.nodes[cid]; if (k) out += htmlBlock(k, page, indent + 1) + '\n'; }
      out += pad2 + '</' + tag + '>';
    } else if (tag === 'div' && !label) out += '/>';
    else out += '</' + tag + '>';
    return out;
  }
  function escapeHtml(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  const CodeGen = {
    css(doc, page, n) { return cssBlock(n, page, short(n.id) + '-' + (n.name || 'node').toLowerCase().replace(/[^a-z0-9]+/g, '-'), 0); },
    html(doc, page, n) { return htmlBlock(n, page, 0); },
  };

  // ============================================================ dev annotations
  const Annotations = {
    list(doc) { M.ensureDocShape(doc); return doc.annotations; },
    listFor(doc, nodeId) { return this.list(doc).filter(a => a.nodeId === nodeId); },
    add(doc, nodeId, text, author) {
      M.ensureDocShape(doc);
      const a = { id: M.uid('an-'), nodeId, text: String(text == null ? '' : text), author: author || 'You', at: Date.now() };
      doc.annotations.push(a);
      return a;
    },
    remove(doc, id) { M.ensureDocShape(doc); doc.annotations = doc.annotations.filter(a => a.id !== id); },
  };

  global.Eco = { Versions, Comments, Proto, CodeGen, Annotations };
})(window);
