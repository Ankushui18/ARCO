/* components.js — Figma-style components, instances & variants.
 *
 * doc.components[setId] = {
 *   id: setId, name: setName,
 *   main: frameId,                       // default variant frame
 *   variants: { [variantName]: frameId } // includes main under its own name
 * }
 *
 * Instance = node type 'instance' with componentId (setId) + variant (name).
 * Its children are a fresh clone of the source variant's subtree (Figma
 * stores flat clones too). updateInstance() re-clones but preserves text
 * overrides (matched by depth-first slot path).
 */
(function (global) {
  'use strict';
  const M = global.Model;

  const C = {
    list(doc) {
      M.ensureDocShape(doc);
      const out = [];
      for (const [setId, c] of Object.entries(doc.components)) out.push({ id: setId, ...c });
      return out;
    },
    get(doc, setId) { return (doc.components || {})[setId] || null; },

    // ------------------------------------------------------------- make
    makeComponent(doc, page, frameId, name) {
      M.ensureDocShape(doc);
      const n = page.nodes[frameId];
      if (!n || n.type !== 'frame') return null;
      n.isComponent = true;
      if (name) n.name = name;
      const existing = doc.components[n.id];
      const c = existing || { id: n.id, name: n.name, main: n.id, variants: {} };
      c.main = c.main || n.id;
      if (!c.variants[n.name]) c.variants[n.name] = n.id;
      doc.components[n.id] = c;
      return c;
    },

    // clone the component frame as a sibling variant
    addVariant(doc, page, frameId, variantName) {
      const c = this.get(doc, frameId);
      if (!c) return null;
      const src = page.nodes[c.main];
      if (!src || !variantName) return null;
      const clone = M.deepClone(page, src, true, page);
      clone.name = variantName;
      clone.isComponent = true;
      clone.x = src.x + src.w + 40;
      clone.y = src.y;
      const srcParent = src.parent;
      M.attach(doc, page, srcParent, clone);
      c.variants[variantName] = clone.id;
      return clone;
    },

    // ------------------------------------------------------------- source
    sourceFor(doc, page, compId, variantName) {
      const c = this.get(doc, compId);
      if (!c) return null;
      const pageOf = (id) => { for (const p of doc.pages) if (p.nodes[id]) return p; return null; };
      const vid = variantName ? c.variants[variantName] : null;
      const id = vid || c.main;
      const p2 = pageOf(id);
      if (!p2) return null;
      return { page: p2, node: p2.nodes[id], set: c };
    },

    // ------------------------------------------------------------- props
    // Component props are bound by NODE NAME (documented simplification of
    // Figma's explicit binding): a text prop sets the content of the first
    // text child (depth-first) whose name matches the prop name; a bool prop
    // toggles that child's visibility. Defaults live on the set definition.
    propsOf(doc, compId) {
      const c = this.get(doc, compId);
      return (c && c.props) || [];
    },
    addProp(doc, compId, prop) {
      const c = this.get(doc, compId);
      if (!c || !prop || !prop.name) return null;
      c.props = c.props || [];
      const p = { name: String(prop.name), type: prop.type === 'text' ? 'text' : 'bool', def: prop.type === 'text' ? String(prop.def == null ? '' : prop.def) : !!prop.def };
      if (!c.props.some(x => x.name === p.name)) c.props.push(p);
      return p;
    },
    removeProp(doc, compId, name) {
      const c = this.get(doc, compId);
      if (!c || !c.props) return;
      c.props = c.props.filter(p => p.name !== name);
    },
    // find the first (depth-first) descendant of root named `name`
    _findByName(page, root, name) {
      for (const cid of root.children) {
        const k = page.nodes[cid];
        if (!k) continue;
        if (k.name === name) return k;
        const d = this._findByName(page, k, name);
        if (d) return d;
      }
      return null;
    },
    // srcDoc: where the component set (and its prop definitions) lives —
    // the current doc for local components, the library file's doc otherwise.
    applyProps(doc, page, inst, srcDoc) {
      const set = this.get(srcDoc || doc, inst.componentId);
      if (!set || !set.props) return;
      inst.props = inst.props || {};
      for (const p of set.props) {
        if (p.name in inst.props) continue; // keep explicit instance values
        inst.props[p.name] = p.def;
      }
      for (const p of set.props) this._applyOne(page, inst, p.name, inst.props[p.name]);
    },
    _applyOne(page, inst, name, value) {
      const target = this._findByName(page, inst, name);
      if (!target) return;
      if (target.type === 'text' && target.text) target.text.content = String(value == null ? '' : value);
      target.visible = value !== false && value !== '';
    },
    setInstanceProp(doc, page, instId, name, value) {
      const inst = page.nodes[instId];
      if (!inst || !inst.componentId) return false;
      inst.props = inst.props || {};
      inst.props[name] = value;
      this._applyOne(page, inst, name, value);
      return true;
    },

    // ------------------------------------------------------------- instances
    makeInstance(doc, page, compId, variantName, x, y) {
      const src = this.sourceFor(doc, page, compId, variantName);
      if (!src) return null;
      const s = src.node;
      const inst = M.makeNode('instance', { name: s.name + ' instance' });
      inst.componentId = compId;
      inst.variant = variantName || null;
      inst.w = s.w; inst.h = s.h;
      inst.x = x != null ? x : s.x + 40;
      inst.y = y != null ? y : s.y + 40;
      inst.fills = [];
      inst.clips = true;
      M.attach(doc, page, null, inst);
      this._cloneKids(doc, src.page, page, s, inst);
      this._recordSrcTexts(src.page, s, inst);
      this.applyProps(doc, page, inst);
      return inst;
    },

    _cloneKids(doc, srcPage, dstPage, srcNode, dstNode) {
      for (const cid of srcNode.children) {
        const k = srcPage.nodes[cid];
        if (!k) continue;
        const c = M.deepClone(srcPage, k, true, dstPage);
        M.attach(doc, dstPage, dstNode.id, c);
      }
    },

    // depth-first slot path, e.g. "0.2.1"
    _slotPaths(page, n) {
      const out = [];
      const walk = (node, path) => {
        for (let i = 0; i < node.children.length; i++) {
          const k = page.nodes[node.children[i]];
          if (!k) continue;
          const p = path ? path + '.' + i : String(i);
          out.push({ path: p, node: k });
          walk(k, p);
        }
      };
      walk(n, '');
      return out;
    },

    // snapshot of the source's text per slot path, recorded on the instance
    // at every sync so updates can tell "user edited this" (override) from
    // "the source changed" (flow through) — Figma-style update semantics.
    _recordSrcTexts(srcPage, srcNode, inst) {
      const m = {};
      for (const { path, node } of this._slotPaths(srcPage, srcNode)) {
        if (node.type === 'text') m[path] = node.text.content;
      }
      if (inst) inst._srcTexts = m;
      return m;
    },

    // shared re-clone core for local + library instances.
    // src = { page, node, libraryDoc } — libraryDoc holds the set def (props).
    _reclone(doc, page, inst, src) {
      const srcTexts = this._recordSrcTexts(src.page, src.node, null);
      // text overrides = texts the user changed since the last sync
      const oldSrc = inst._srcTexts || {};
      const overrides = new Map();
      for (const { path, node } of this._slotPaths(page, inst)) {
        if (node.type === 'text' && oldSrc[path] != null && node.text.content !== oldSrc[path]) overrides.set(path, node.text.content);
      }
      // detach old children
      for (const cid of inst.children.slice()) M.detach(page, page.nodes[cid]);
      inst.children = [];
      inst.w = src.node.w; inst.h = src.node.h;
      this._cloneKids(doc, src.page, page, src.node, inst);
      // re-apply overrides
      for (const { path, node } of this._slotPaths(page, inst)) {
        if (node.type === 'text' && overrides.has(path)) node.text.content = overrides.get(path);
      }
      inst._srcTexts = srcTexts;
      // instance props survive updates (explicit values re-applied last)
      this.applyProps(doc, page, inst, src.libraryDoc || doc);
      return true;
    },

    // re-clone children from the (possibly new) variant; keep text overrides
    updateInstance(doc, page, instId) {
      const inst = page.nodes[instId];
      if (!inst || !inst.componentId) return false;
      const src = this.sourceFor(doc, page, inst.componentId, inst.variant);
      if (!src) return false;
      inst.name = src.node.name + ' instance';
      return this._reclone(doc, page, inst, { page: src.page, node: src.node });
    },

    // routes to the library update path for library instances
    updateAny(doc, page, instId) {
      const inst = page.nodes[instId];
      if (!inst || !inst.componentId) return false;
      if (inst.libraryFileId && this.Libraries) return this.Libraries.updateInstance(doc, page, instId);
      return this.updateInstance(doc, page, instId);
    },

    instancesOf(doc, compId) {
      const out = [];
      for (const p of doc.pages) for (const id of Object.keys(p.nodes)) {
        const n = p.nodes[id];
        if (n.componentId === compId) out.push(n);
      }
      return out;
    },

    renameComponent(doc, setId, name) {
      const c = this.get(doc, setId);
      if (!c) return;
      c.name = name;
    },

    deleteComponent(doc, page, compId) {
      const c = this.get(doc, compId);
      if (!c) return false;
      const ids = new Set([c.main, ...Object.values(c.variants)]);
      for (const p of doc.pages) for (const id of [...ids]) {
        if (p.nodes[id]) M.detach(p, p.nodes[id]);
      }
      // orphan the instances (they keep their cloned content as plain frames)
      for (const inst of this.instancesOf(doc, compId)) {
        inst.type = 'frame';
        inst.componentId = null;
        inst.variant = null;
      }
      delete doc.components[compId];
      return true;
    },
  };

  // ============================================================ shared libraries
  // Figma's team libraries are a cloud feature; Penfig's equivalent links
  // OTHER LOCAL FILES as libraries (the Assets tab manages the links).
  // Library instances remember libraryFileId; updates re-clone from the
  // source file, which is read live from the local store, so editing the
  // source file and hitting "update" flows changes through — Figma-style.
  const Libraries = {
    list(doc) { M.ensureDocShape(doc); return doc.libraries || []; },

    link(doc, fileId) {
      M.ensureDocShape(doc);
      const file = M.store.get(fileId);
      if (!file || !file.doc) return null;
      M.ensureDocShape(file.doc);
      doc.libraries = doc.libraries || [];
      if (doc.libraries.some(l => l.fileId === fileId)) return doc.libraries.find(l => l.fileId === fileId);
      const entry = { fileId, name: file.name, at: Date.now() };
      doc.libraries.push(entry);
      return entry;
    },

    unlink(doc, fileId) {
      M.ensureDocShape(doc);
      doc.libraries = (doc.libraries || []).filter(l => l.fileId !== fileId);
    },

    // components of a linked file, with the LIVE source page (for cloning)
    componentsOf(doc, fileId) {
      const file = M.store.get(fileId);
      if (!file || !file.doc) return [];
      M.ensureDocShape(file.doc);
      const out = [];
      const pageOf = (id) => { for (const p of file.doc.pages) if (p.nodes[id]) return p; return null; };
      for (const [setId, c] of Object.entries(file.doc.components || {})) {
        const ids = [c.main, ...Object.values(c.variants || {})];
        const page = ids.map(pageOf).find(Boolean);
        if (!page) continue;
        const main = page.nodes[c.main] || page.nodes[ids.find(id => page.nodes[id])];
        if (!main) continue;
        out.push({ id: setId, name: c.name, main: main.id, variants: c.variants || {}, set: c, page });
      }
      return out;
    },

    sourceFor(doc, compId, libraryFileId) {
      const found = this.componentsOf(doc, libraryFileId).find(c => c.id === compId);
      if (!found) return null;
      return { page: found.page, node: found.page.nodes[found.main], set: found.set, libraryDoc: M.store.get(libraryFileId).doc, library: true };
    },

    makeInstance(doc, page, fileId, compId, x, y) {
      const src = this.sourceFor(doc, compId, fileId);
      if (!src) return null;
      const s = src.node;
      const inst = M.makeNode('instance', { name: (src.set.name || 'Library') + ' instance' });
      inst.componentId = compId;
      inst.libraryFileId = fileId;
      inst.variant = null;
      inst.w = s.w; inst.h = s.h;
      inst.x = x != null ? x : s.x + 40;
      inst.y = y != null ? y : s.y + 40;
      inst.fills = [];
      inst.clips = true;
      M.attach(doc, page, null, inst);
      C._cloneKids(doc, src.page, page, s, inst);
      C._recordSrcTexts(src.page, s, inst);
      C.applyProps(doc, page, inst, src.libraryDoc);
      return inst;
    },

    // re-clone from the (possibly edited) source file — text overrides and
    // prop values on the instance survive
    updateInstance(doc, page, instId) {
      const inst = page.nodes[instId];
      if (!inst || !inst.componentId) return false;
      const src = this.sourceFor(doc, inst.componentId, inst.libraryFileId);
      if (!src) return false; // source file was deleted
      return C._reclone(doc, page, inst, src);
    },

    instancesOf(doc, fileId) {
      const out = [];
      for (const p of doc.pages) for (const id of Object.keys(p.nodes)) {
        const n = p.nodes[id];
        if (n.libraryFileId === fileId) out.push(n);
      }
      return out;
    },

    updateAll(doc, fileId) {
      let n = 0;
      for (const p of doc.pages) {
        const ids = Object.keys(p.nodes).filter(id => p.nodes[id].libraryFileId === fileId);
        for (const id of ids) {
          if (this.updateInstance(doc, p, id)) n++;
        }
      }
      return n;
    },
  };

  C.Libraries = Libraries;
  global.Components = C;
  global.Libraries = Libraries;
})(window);
