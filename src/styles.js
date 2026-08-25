/* styles.js — Figma-style style libraries: named text styles & paint styles.
 *
 * doc.styles = { text: {id → style}, paint: {id → style} }
 * A node references a style via n.styleId (text) / n.fillStyleId (paint).
 * Creating a style captures the selected node's properties; applying copies
 * the style onto one or more nodes (the node then follows that style id).
 */
(function (global) {
  'use strict';
  const M = global.Model;

  const cloneFills = (fills) => (fills || []).map(f => ({ ...f, stops: f.stops ? f.stops.map(s => ({ ...s })) : undefined }));

  const S = {
    // ------------------------------------------------------------- lists
    textList(doc) { M.ensureDocShape(doc); return Object.values(doc.styles.text); },
    paintList(doc) { M.ensureDocShape(doc); return Object.values(doc.styles.paint); },
    getText(doc, id) { M.ensureDocShape(doc); return doc.styles.text[id] || null; },
    getPaint(doc, id) { M.ensureDocShape(doc); return doc.styles.paint[id] || null; },

    // ------------------------------------------------------------- create
    // capture from node n (text node) — also links n to the new style
    makeTextStyle(doc, name, n) {
      M.ensureDocShape(doc);
      const id = M.uid('ts-');
      const t = n && n.text ? n.text : null;
      doc.styles.text[id] = {
        id,
        name: name || ('Text style ' + (Object.keys(doc.styles.text).length + 1)),
        font: t ? t.font : 'Inter',
        size: t ? t.size : 16,
        weight: t ? t.weight : 400,
        italic: t ? !!t.italic : false,
        lineHeight: t ? t.lineHeight : 1.2,
        letterSpacing: t ? t.letterSpacing : 0,
      };
      if (n) n.styleId = id;
      return doc.styles.text[id];
    },
    makePaintStyle(doc, name, n) {
      M.ensureDocShape(doc);
      const id = M.uid('ps-');
      doc.styles.paint[id] = {
        id,
        name: name || ('Paint style ' + (Object.keys(doc.styles.paint).length + 1)),
        fills: cloneFills(n ? n.fills : [{ type: 'solid', color: '#d9d9d9', opacity: 1, token: null }]),
      };
      if (n) n.fillStyleId = id;
      return doc.styles.paint[id];
    },

    // ------------------------------------------------------------- apply
    applyTextStyle(doc, page, styleId, nodeIds) {
      const st = this.getText(doc, styleId);
      if (!st) return 0;
      let n = 0;
      for (const nid of nodeIds || []) {
        const node = page.nodes[nid];
        if (!node || node.type !== 'text' || !node.text) continue;
        node.text.font = st.font;
        node.text.size = st.size;
        node.text.weight = st.weight;
        node.text.italic = st.italic;
        node.text.lineHeight = st.lineHeight;
        node.text.letterSpacing = st.letterSpacing;
        node.styleId = styleId;
        n++;
      }
      return n;
    },
    applyPaintStyle(doc, page, styleId, nodeIds) {
      const st = this.getPaint(doc, styleId);
      if (!st) return 0;
      let n = 0;
      for (const nid of nodeIds || []) {
        const node = page.nodes[nid];
        if (!node) continue;
        node.fills = cloneFills(st.fills);
        node.fillStyleId = styleId;
        n++;
      }
      return n;
    },

    // ------------------------------------------------------------- edit
    renameTextStyle(doc, id, name) { const st = this.getText(doc, id); if (st && name) st.name = name; },
    renamePaintStyle(doc, id, name) { const st = this.getPaint(doc, id); if (st && name) st.name = name; },
    deleteTextStyle(doc, id) {
      M.ensureDocShape(doc);
      if (!doc.styles.text[id]) return false;
      delete doc.styles.text[id];
      // unlink nodes that pointed at it
      for (const p of doc.pages) for (const nid of Object.keys(p.nodes)) {
        const n = p.nodes[nid];
        if (n.styleId === id) n.styleId = null;
      }
      return true;
    },
    deletePaintStyle(doc, id) {
      M.ensureDocShape(doc);
      if (!doc.styles.paint[id]) return false;
      delete doc.styles.paint[id];
      for (const p of doc.pages) for (const nid of Object.keys(p.nodes)) {
        const n = p.nodes[nid];
        if (n.fillStyleId === id) n.fillStyleId = null;
      }
      return true;
    },
  };

  global.Styles = S;
})(window);
