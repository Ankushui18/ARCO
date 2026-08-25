/* tokens.js — Penfig design tokens (Figma-style variables with modes).
 *
 * Model (mirrors Figma's .fig VARIABLE_SET / VARIABLE nodes):
 *   doc.vars = {
 *     modes: [{id, name}],          // e.g. Light / Dark
 *     defaultMode: modeId,
 *     sets: [{ id, name, vars: [{
 *        id, name,                  // "color/brand/primary"
 *        type: 'color'|'number'|'string'|'boolean',
 *        values: { [modeId]: value }
 *     }] }]
 *   }
 *
 * References live on nodes:
 *   fill/stroke/text:  { ..., token: varId }
 *   numeric fields:    { n: number, tok: varId|null }  (radius, gap, paddings…)
 *
 * `bake(doc, modeId)` writes resolved values into `*Value` fields so the
 * layout engine & renderer can stay token-agnostic.
 */
(function (global) {
  'use strict';

  const M = global.Model;
  let _idx = null;    // Map varId → {var, set}
  let _idxDoc = null; // doc object the index was built for (index is PER-DOC —
                      // a stale cross-doc index would silently break token
                      // resolution after importing a second .fig)

  function rebuildIndex(doc) {
    _idx = new Map();
    for (const set of doc.vars.sets) {
      for (const v of set.vars) _idx.set(v.id, { v, set });
    }
    _idxDoc = doc;
  }
  function find(doc, varId) {
    if (!_idx || _idxDoc !== doc) rebuildIndex(doc);
    return _idx.get(varId) || null;
  }

  function addMode(doc, name) {
    const m = { id: M.uid('m-'), name: name || ('Mode ' + (doc.vars.modes.length + 1)) };
    doc.vars.modes.push(m);
    for (const set of doc.vars.sets) for (const v of set.vars) {
      if (v.values[m.id] == null) v.values[m.id] = sampleValue(v);
    }
    return m;
  }
  function removeMode(doc, modeId) {
    if (doc.vars.modes.length <= 1) return;
    doc.vars.modes = doc.vars.modes.filter(m => m.id !== modeId);
    for (const set of doc.vars.sets) for (const v of set.vars) delete v.values[modeId];
    if (doc.vars.defaultMode === modeId) doc.vars.defaultMode = doc.vars.modes[0].id;
  }
  function renameMode(doc, modeId, name) {
    const m = doc.vars.modes.find(x => x.id === modeId);
    if (m) m.name = name;
  }
  function sampleValue(v) {
    const k = Object.keys(v.values)[0];
    if (v.type === 'color') return v.values[k] || '#888888';
    if (v.type === 'number') return typeof v.values[k] === 'number' ? v.values[k] : 0;
    return v.values[k] != null ? v.values[k] : (v.type === 'boolean' ? true : '');
  }
  function sampleDefault(type) {
    if (type === 'color') return '#0d99ff';
    if (type === 'number') return 8;
    if (type === 'boolean') return true;
    return 'text';
  }

  function addSet(doc, name) {
    const s = { id: M.uid('set-'), name: name || ('Set ' + (doc.vars.sets.length + 1)), vars: [] };
    doc.vars.sets.push(s);
    return s;
  }
  function addVar(doc, setId, partial) {
    const set = doc.vars.sets.find(s => s.id === setId) || addSet(doc, (partial && partial.name) ? (partial.name.split('/')[0] || 'Set') : 'Set');
    const v = {
      id: M.uid('var-'),
      name: (partial && partial.name) || ('token-' + set.vars.length),
      type: (partial && partial.type) || 'color',
      values: {},
    };
    for (const m of doc.vars.modes) {
      const from = partial && partial.values;
      v.values[m.id] = from ? (from[m.id] != null ? from[m.id] : from[Object.keys(from)[0]] != null ? from[Object.keys(from)[0]] : sampleDefault(v.type)) : sampleDefault(v.type);
    }
    set.vars.push(v);
    rebuildIndex(doc);
    return v;
  }
  function removeVar(doc, varId) {
    // capture a literal fallback so aliases pointing at the removed variable
    // don't dangle (Figma breaks the reference; we freeze the last value)
    const fallback = getValue(doc, varId, doc.vars.defaultMode);
    for (const set of doc.vars.sets) {
      for (const v of set.vars) {
        for (const mid of Object.keys(v.values)) {
          const raw = v.values[mid];
          if (isAlias(raw) && raw.alias === varId) v.values[mid] = fallback != null ? fallback : sampleDefault(v.type);
        }
      }
    }
    for (const set of doc.vars.sets) set.vars = set.vars.filter(v => v.id !== varId);
    rebuildIndex(doc);
  }
  // point a variable's value in a mode at another variable (alias).
  // null/undefined clears the alias (keeps the stored literal).
  function setAlias(doc, varId, targetVarId, modeId) {
    const f = find(doc, varId);
    if (!f) return false;
    const mid = modeId || doc.vars.defaultMode;
    if (targetVarId) {
      const t = find(doc, targetVarId);
      if (!t || t.v.type !== f.v.type) return false; // same-type references only
      f.v.values[mid] = { alias: targetVarId };
    } else {
      // clear: restore the target's literal value if we can see it
      const cur = f.v.values[mid];
      if (isAlias(cur)) f.v.values[mid] = getValue(doc, cur.alias, mid) != null ? getValue(doc, cur.alias, mid) : sampleDefault(f.v.type);
    }
    rebuildIndex(doc);
    return true;
  }
  function renameVar(doc, varId, name) {
    const f = find(doc, varId);
    if (f) f.v.name = name;
  }

  // resolved value in a given mode (falls back to default mode).
  // A value may be an ALIAS: { alias: otherVarId } — resolved recursively
  // (Figma variables can reference other variables). Cycle-guarded.
  function isAlias(val) { return val && typeof val === 'object' && typeof val.alias === 'string'; }
  function aliasTarget(doc, varId, modeId) {
    const f = find(doc, varId);
    if (!f) return null;
    const v = f.v;
    const mid = modeId && v.values[modeId] != null ? modeId : doc.vars.defaultMode;
    const raw = v.values[mid] != null ? v.values[mid] : v.values[Object.keys(v.values)[0]];
    return isAlias(raw) ? raw.alias : null;
  }
  function resolveRaw(doc, varId, modeId, seen) {
    const f = find(doc, varId);
    if (!f) return undefined;
    const v = f.v;
    const mid = modeId && v.values[modeId] != null ? modeId : doc.vars.defaultMode;
    const raw = v.values[mid] != null ? v.values[mid] : v.values[Object.keys(v.values)[0]];
    if (isAlias(raw)) {
      if (seen.has(raw.alias)) return undefined; // alias cycle → treat as broken
      seen.add(raw.alias);
      return resolveRaw(doc, raw.alias, modeId, seen);
    }
    return raw;
  }
  function getValue(doc, varId, modeId) {
    const r = resolveRaw(doc, varId, modeId, new Set([varId]));
    return r === undefined ? null : r;
  }
  // full "set/var" label (used for W3C "{ref}" and CSS var() rendering)
  function varLabel(doc, varId) {
    const f = find(doc, varId);
    if (!f) return null;
    return (f.set.name ? f.set.name + '/' : '') + f.v.name;
  }

  // ------------------------------------------------------------- bake
  function bakeNum(doc, f, mid) {
    if (!f || typeof f !== 'object' || !('n' in f)) return;
    f.tokValue = f.tok ? (typeof getValue(doc, f.tok, mid) === 'number' ? getValue(doc, f.tok, mid) : f.n) : f.n;
  }
  function bake(doc, page, modeId) {
    const mid = modeId || doc.vars.defaultMode;
    const walk = (n) => {
      for (const f of n.fills || []) {
        if (f.token) f._resolved = getValue(doc, f.token, mid);
        if (f.stops) for (const s of f.stops) if (s.token) s._resolved = getValue(doc, s.token, mid);
      }
      if (n.stroke && n.stroke.token) n.stroke._resolved = getValue(doc, n.stroke.token, mid);
      if (n.text && n.text.token) n.text._resolved = getValue(doc, n.text.token, mid);
      if (n.al) {
        bakeNum(doc, n.al.gap, mid);
        bakeNum(doc, n.al.gapCross, mid);
        for (const p of n.al.pad) bakeNum(doc, p, mid);
      }
      if (n.radiusTok) n.radiusValue = getValue(doc, n.radiusTok, mid);
      for (const cid of n.children) { const c = page.nodes[cid]; if (c) walk(c); }
    };
    for (const tid of page.tops) { const t = page.nodes[tid]; if (t) walk(t); }
  }

  // ------------------------------------------------------------- apply tokens
  function applyColorToken(doc, page, ids, tokenId, modeId) {
    for (const id of ids) {
      const n = page.nodes[id];
      if (!n) continue;
      if (n.fills.length) {
        n.fills[0].token = tokenId || null;
        if (tokenId) { const v = getValue(doc, tokenId, modeId); if (typeof v === 'string') n.fills[0].color = v; }
      }
      if (n.stroke) {
        n.stroke.token = tokenId || null;
        if (tokenId) { const v = getValue(doc, tokenId, modeId); if (typeof v === 'string') n.stroke.color = v; }
      }
      if (n.text) n.text.token = tokenId || null;
    }
  }
  function applyNumberToken(doc, page, ids, field, tokenId, modeId) {
    for (const id of ids) {
      const n = page.nodes[id];
      if (!n) continue;
      const setTok = (f) => {
        if (!f || typeof f !== 'object') return;
        f.tok = tokenId || null;
        if (tokenId) { const v = getValue(doc, tokenId, modeId); if (typeof v === 'number') f.n = v; }
      };
      if (field === 'gap' && n.al) setTok(n.al.gap);
      if (field === 'gapCross' && n.al) setTok(n.al.gapCross);
      if (field.startsWith('pad') && n.al) {
        const i = field === 'padT' ? 0 : field === 'padR' ? 1 : field === 'padB' ? 2 : 3;
        setTok(n.al.pad[i]);
      }
      if (field === 'radius') {
        n.radiusTok = tokenId || null;
        if (tokenId) { const v = getValue(doc, tokenId, modeId); if (typeof v === 'number') n.radius = [v, v, v, v]; }
      }
    }
  }

  // ------------------------------------------------------------- exports
  function exportW3C(doc) {
    const out = {};
    out.$schema = 'https://design-tokens.github.io/community-group/format/schema.json';
    out.$description = 'Exported from ' + doc.name + ' (Penfig)';
    for (const set of doc.vars.sets) {
      let bucket = out;
      const parts = set.name.split('/').filter(Boolean);
      for (const p of parts) { bucket[p] = bucket[p] || {}; bucket = bucket[p]; }
      for (const v of set.vars) {
        const dv = v.values[doc.vars.defaultMode];
        let value = dv != null ? dv : Object.values(v.values)[0];
        let desc = v.type + ' variable — modes: ' + doc.vars.modes.map(m => m.name).join(', ');
        if (isAlias(value)) { // W3C reference syntax: "{set/varName}"
          const target = varLabel(doc, value.alias);
          if (target) { value = '{' + target + '}'; desc = v.type + ' variable (alias) → ' + target; }
        }
        bucket[v.name] = {
          $type: v.type === 'color' ? 'color' : v.type === 'number' ? (v.unit ? 'dimension' : 'number') : v.type === 'boolean' ? 'boolean' : 'string',
          $value: value,
          $description: desc,
        };
      }
    }
    return out;
  }
  function exportCSS(doc, modeId) {
    const mid = modeId || doc.vars.defaultMode;
    const modeName = ((doc.vars.modes.find(m => m.id === mid) || { name: 'mode' }).name).toLowerCase().replace(/\s+/g, '-');
    let css = '/* Penfig tokens — ' + doc.name + ' — mode: ' + modeName + ' */\n';
    css += doc.vars.modes.length > 1 ? ':root[data-mode="' + modeName + '"], :root {\n' : ':root {\n';
    for (const set of doc.vars.sets) {
      css += '  /* ' + set.name + ' */\n';
      for (const v of set.vars) {
        const name = '--' + (set.name + '/' + v.name).replace(/[^a-zA-Z0-9/]/g, '-');
        const val = v.values[mid] != null ? v.values[mid] : v.values[Object.keys(v.values)[0]];
        if (isAlias(val)) {
          const target = varLabel(doc, val.alias);
          const targetName = '--' + (target || 'missing').replace(/[^a-zA-Z0-9/]/g, '-');
          css += '  ' + name + ': var(' + targetName + ');' + (target ? ' /* alias → ' + target + ' */' : '') + '\n';
          continue;
        }
        css += '  ' + name + ': ' + val + ';\n';
      }
    }
    css += '}\n';
    return css;
  }
  function importW3C(doc, json, modeId) {
    let imported = 0;
    const target = modeId || doc.vars.defaultMode;
    const walk = (obj, path) => {
      for (const [k, v] of Object.entries(obj)) {
        if (k.startsWith('$')) continue;
        const p = path ? path + '/' + k : k;
        if (v && typeof v === 'object' && '$value' in v) {
          const set = doc.vars.sets.find(s => s.name === (path || '')) || (path ? addSet(doc, path) : addSet(doc, 'Imported'));
          const type = v.$type === 'color' ? 'color'
            : (v.$type === 'number' || v.$type === 'dimension' || typeof v.$value === 'number') ? 'number'
            : (typeof v.$value === 'boolean') ? 'boolean' : 'string';
          addVar(doc, set.id, { name: p, type, values: { [target]: v.$value } });
          imported++;
        } else if (v && typeof v === 'object') {
          walk(v, p);
        }
      }
    };
    walk(json, '');
    rebuildIndex(doc);
    return imported;
  }

  function colorVarList(doc) {
    const out = [];
    for (const set of doc.vars.sets) for (const v of set.vars) if (v.type === 'color') out.push({ id: v.id, label: (set.name ? set.name + '/' : '') + v.name, value: v.values[doc.vars.defaultMode] });
    return out;
  }
  function numberVarList(doc) {
    const out = [];
    for (const set of doc.vars.sets) for (const v of set.vars) if (v.type === 'number') out.push({ id: v.id, label: (set.name ? set.name + '/' : '') + v.name, value: v.values[doc.vars.defaultMode] });
    return out;
  }

  global.Tokens = {
    rebuildIndex, find, getValue, bake,
    addMode, removeMode, renameMode,
    addSet, addVar, removeVar, renameVar,
    applyColorToken, applyNumberToken,
    exportW3C, exportCSS, importW3C,
    colorVarList, numberVarList,
    isAlias, aliasTarget, varLabel, setAlias,
  };
})(window);
