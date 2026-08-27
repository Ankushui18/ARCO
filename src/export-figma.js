/* export-figma.js — Figma Design-panel Export + better PNG/SVG/.fig.
 *
 * Figma: each layer has export settings (format, scale, suffix).
 * Export writes only that layer's pixels, not overlapping siblings.
 */
(function (global) {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'complete') return fn();
    window.addEventListener('load', fn, { once: true });
  }

  function saveBlob(blob, name) {
    if (global.PenfigSave && global.PenfigSave.saveBlob) return global.PenfigSave.saveBlob(blob, name);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    return Promise.resolve('anchor');
  }

  function safeName(n) {
    return String((n && n.name) || 'export').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'export';
  }

  function worldBox(n) {
    if (n && n._w && isFinite(n._w.w)) return n._w;
    return { x: n.x || 0, y: n.y || 0, w: n.w || 1, h: n.h || 1 };
  }

  function defaultExports() {
    return [{ format: 'png', scale: 1, suffix: '', contentsOnly: true, background: '' }];
  }

  function ensureExports(n) {
    if (!n.exports || !n.exports.length) n.exports = defaultExports();
    return n.exports;
  }

  function applyWt(ctx, n) {
    const m = n._wt;
    if (m && m.length >= 6) ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    else ctx.translate((n._w && n._w.x) || n.x || 0, (n._w && n._w.y) || n.y || 0);
  }

  function drawLocal(ctx, page, n, doc) {
    const ghost = Object.create(n);
    ghost.x = 0;
    ghost.y = 0;
    ghost.rotation = 0;
    ghost.flipH = false;
    ghost.flipV = false;
    global.Renderer.drawNode(ctx, page, ghost, doc);
  }

  function renderNodePng(page, doc, n, scale, opts) {
    opts = opts || {};
    const b = worldBox(n);
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil(Math.max(1, b.w) * scale));
    c.height = Math.max(1, Math.ceil(Math.max(1, b.h) * scale));
    const ctx = c.getContext('2d');
    if (opts.background) {
      ctx.fillStyle = opts.background;
      ctx.fillRect(0, 0, c.width, c.height);
    }
    ctx.save();
    ctx.scale(scale, scale);
    ctx.translate(-b.x, -b.y);
    applyWt(ctx, n);
    drawLocal(ctx, page, n, doc);
    ctx.restore();
    return c;
  }

  function canvasToBlob(c, format, quality) {
    return new Promise((resolve, reject) => {
      const mime = format === 'jpg' || format === 'jpeg' ? 'image/jpeg' : 'image/png';
      if (c.toBlob) {
        c.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Encode failed')), mime, quality || 0.92);
      } else {
        try {
          const url = c.toDataURL(mime, quality || 0.92);
          const bin = atob(url.split(',')[1] || '');
          const u8 = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
          resolve(new Blob([u8], { type: mime }));
        } catch (e) { reject(e); }
      }
    });
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function betterSvg(doc, page, n) {
    const R = global.Renderer;
    let gid = 0;
    const defs = [];
    const out = [];

    function fillAttr(f) {
      if (!f || f.visible === false) return { attr: 'fill="none"' };
      if (f.type === 'solid') {
        const c = R.resolvedColor(doc, f, '#000000');
        return { attr: 'fill="' + c.color + '" fill-opacity="' + c.opacity + '"' };
      }
      if (f.type === 'linear') {
        const id = 'g' + (++gid);
        const stops = (f.stops || []).map((s) => {
          const c = R.resolvedColor(doc, s, '#000000');
          return '<stop offset="' + Math.max(0, Math.min(1, s.pos ?? 0)) + '" stop-color="' + c.color + '" stop-opacity="' + c.opacity + '"/>';
        }).join('');
        defs.push('<linearGradient id="' + id + '" x1="' + (f.from?.x ?? 0) + '" y1="' + (f.from?.y ?? 0) + '" x2="' + (f.to?.x ?? 1) + '" y2="' + (f.to?.y ?? 1) + '">' + stops + '</linearGradient>');
        return { attr: 'fill="url(#' + id + ')"' };
      }
      if (f.type === 'image' && f.src) {
        const id = 'im' + (++gid);
        defs.push('<pattern id="' + id + '" width="100%" height="100%" patternUnits="objectBoundingBox"><image href="' + f.src + '" width="1" height="1" preserveAspectRatio="xMidYMid slice"/></pattern>');
        return { attr: 'fill="url(#' + id + ')"' };
      }
      return { attr: 'fill="none"' };
    }

    function strokeAttr(n) {
      const st = n.stroke;
      if (!st || st.visible === false || !(st.width > 0)) return '';
      const c = R.resolvedColor(doc, st, '#000000');
      let s = ' stroke="' + c.color + '" stroke-opacity="' + c.opacity + '" stroke-width="' + st.width + '"';
      if (st.cap) s += ' stroke-linecap="' + (st.cap === 'square' ? 'square' : st.cap) + '"';
      if (st.join) s += ' stroke-linejoin="' + st.join + '"';
      if (st.dash && st.dash.length) s += ' stroke-dasharray="' + st.dash.join(' ') + '"';
      return s;
    }

    function mat(n) {
      const m = n._wt;
      if (m && m.length >= 6) return ' transform="matrix(' + m[0] + ' ' + m[1] + ' ' + m[2] + ' ' + m[3] + ' ' + m[4] + ' ' + m[5] + ')"';
      return ' transform="translate(' + (n.x || 0) + ' ' + (n.y || 0) + ')"';
    }

    function walk(n, ind) {
      if (!n || n.visible === false) return;
      const w = n.w || 0, h = n.h || 0;
      const rad = Array.isArray(n.radius) ? n.radius[0] || 0 : 0;
      const rx = Math.max(0, Math.min(rad, w / 2, h / 2));
      const fill = (n.fills || []).find((f) => f && f.visible !== false);
      const fa = fill ? fillAttr(fill) : { attr: 'fill="none"' };
      const st = strokeAttr(n);
      const pad = '  '.repeat(ind);
      out.push(pad + '<g' + mat(n) + ' data-name="' + esc(n.name) + '">');
      if (n.type === 'ellipse') {
        out.push(pad + '  <ellipse cx="' + (w / 2) + '" cy="' + (h / 2) + '" rx="' + (w / 2) + '" ry="' + (h / 2) + '" ' + fa.attr + st + '/>');
      } else if (n.type === 'line') {
        out.push(pad + '  <line x1="0" y1="' + (h / 2) + '" x2="' + w + '" y2="' + (h / 2) + '" fill="none"' + (st || ' stroke="none"') + '/>');
      } else if (n.type === 'vector' && n.path) {
        const rule = n.windingRule === 'evenodd' ? 'evenodd' : 'nonzero';
        out.push(pad + '  <path d="' + n.path + '" fill-rule="' + rule + '" ' + fa.attr + st + '/>');
      } else if (n.type === 'text') {
        const t = n.text || {};
        const c = R.resolvedColor(doc, (n.fills && n.fills[0]) || { color: '#111111' }, '#111111');
        const lines = String(t.content || '').split('\n');
        const size = t.size || 14;
        const lh = size * (t.lineHeight || 1.2);
        lines.forEach((ln, i) => {
          const y = (i + 0.82) * lh;
          out.push(pad + '  <text x="0" y="' + y + '" font-family="' + esc(t.font || 'Inter') + ', Helvetica, Arial, sans-serif" font-size="' + size + '"' +
            (t.weight ? ' font-weight="' + t.weight + '"' : '') +
            (t.italic ? ' font-style="italic"' : '') +
            ' fill="' + c.color + '" fill-opacity="' + c.opacity + '">' + esc(ln) + '</text>');
        });
      } else if (fill || (n.stroke && n.stroke.visible && n.stroke.width)) {
        out.push(pad + '  <rect width="' + w + '" height="' + h + '" rx="' + rx + '" ' + fa.attr + st + '/>');
      }
      if (n.clips && n.children && n.children.length) {
        const cid = 'clip' + (++gid);
        defs.push('<clipPath id="' + cid + '"><rect width="' + w + '" height="' + h + '" rx="' + rx + '"/></clipPath>');
        out.push(pad + '  <g clip-path="url(#' + cid + ')">');
        for (const id of n.children) walk(page.nodes[id], ind + 2);
        out.push(pad + '  </g>');
      } else {
        for (const id of n.children || []) walk(page.nodes[id], ind + 1);
      }
      out.push(pad + '</g>');
    }

    const b = worldBox(n);
    walk(n, 1);
    const W = Math.max(1, Math.ceil(b.w));
    const H = Math.max(1, Math.ceil(b.h));
    return '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="' + W + '" height="' + H + '" viewBox="' + b.x + ' ' + b.y + ' ' + W + ' ' + H + '">\n' +
      (defs.length ? '  <defs>' + defs.join('') + '</defs>\n' : '') +
      out.join('\n') + '\n</svg>';
  }

  ready(function () {
    const App = global.App;
    const P = global.Panels;
    const R = global.Renderer;
    const Ico = global.Icons && global.Icons.svg;
    if (!App || !P) return;

    App.renderNodePng = renderNodePng;

    App.exportSetting = async function (n, setting) {
      if (!n || !this.page) throw new Error('Nothing to export');
      this.layoutDoc && this.layoutDoc(this.doc, this.page);
      const fmt = (setting.format || 'png').toLowerCase();
      const scale = setting.scale || 1;
      const suffix = setting.suffix || (scale !== 1 ? '@' + scale + 'x' : '');
      const base = safeName(n) + suffix;
      if (fmt === 'svg') {
        const svg = betterSvg(this.doc, this.page, n);
        await saveBlob(new Blob([svg], { type: 'image/svg+xml' }), base + '.svg');
        return base + '.svg';
      }
      if (fmt === 'pdf') {
        const Pdf = global.PdfExport;
        if (!Pdf) throw new Error('PDF exporter missing');
        const res = Pdf.renderNode(this.doc, this.page, n);
        const bytes = Uint8Array.from(res.pdf, (ch) => ch.charCodeAt(0) & 0xff);
        await saveBlob(new Blob([bytes], { type: 'application/pdf' }), base + '.pdf');
        return base + '.pdf';
      }
      const bg = fmt === 'jpg' || fmt === 'jpeg' ? (setting.background || '#ffffff') : (setting.background || '');
      const c = renderNodePng(this.page, this.doc, n, scale, { background: bg });
      const blob = await canvasToBlob(c, fmt);
      const ext = fmt === 'jpeg' ? 'jpg' : fmt;
      await saveBlob(blob, base + '.' + ext);
      return base + '.' + ext;
    };

    App.exportNode = async function (n) {
      const list = ensureExports(n);
      const names = [];
      for (const s of list) names.push(await this.exportSetting(n, s));
      return names;
    };

    App.exportSelection = async function () {
      const ids = this.sel.length ? this.sel.slice() : (this.page.tops || []).slice();
      const nodes = ids.map((id) => this.page.nodes[id]).filter(Boolean);
      if (!nodes.length) { this.toast('Nothing to export'); return; }
      const names = [];
      for (const n of nodes) {
        const got = await this.exportNode(n);
        names.push.apply(names, got);
      }
      this.toast('Exported ' + names.length + ' file' + (names.length === 1 ? '' : 's'), 3000, 'success');
    };

    if (global.SvgExport) {
      const _rn = global.SvgExport.renderNode.bind(global.SvgExport);
      global.SvgExport.renderNode = function (doc, page, n) {
        try { return betterSvg(doc, page, n); }
        catch (e) { return _rn(doc, page, n); }
      };
    }

    if (P && P.refreshInspector) {
      const _ri = P.refreshInspector.bind(P);
      P.refreshInspector = function () {
        _ri();
        if (this._inspectorTab && this._inspectorTab !== 'design') return;
        const nodes = this.selNodes ? this.selNodes() : [];
        if (nodes.length !== 1) return;
        const n = nodes[0];
        const el = document.getElementById('ed-right');
        const host = el && (el.querySelector('.ins-tab-content') || el);
        if (!host || host.querySelector('[data-ex="add"]')) return;
        const list = ensureExports(n);
        const sec = document.createElement('section');
        sec.className = 'ins-sec pf-export-sec';
        sec.innerHTML =
          '<div class="ins-head"><span>Export</span>' +
            '<button type="button" class="mini" data-ex="add" title="Add export setting">' + (Ico ? Ico('plus', { size: 11 }) : '+') + '</button>' +
          '</div>' +
          list.map((s, i) =>
            '<div class="pf-ex-row" data-i="' + i + '">' +
              '<input type="number" min="0.25" max="8" step="0.25" value="' + (s.scale || 1) + '" data-ex="scale" title="Scale">' +
              '<select data-ex="fmt">' +
                ['png', 'svg', 'jpg', 'pdf'].map((f) => '<option value="' + f + '"' + ((s.format || 'png') === f ? ' selected' : '') + '>' + f.toUpperCase() + '</option>').join('') +
              '</select>' +
              '<input type="text" data-ex="suf" value="' + esc(s.suffix || '') + '" placeholder="@2x" title="Suffix">' +
              '<button type="button" class="mini" data-ex="del" title="Remove">−</button>' +
            '</div>'
          ).join('') +
          '<label class="chk pf-ex-bg"><input type="checkbox" data-ex="white"' + (list[0] && list[0].background ? ' checked' : '') + '> White background</label>' +
          '<div class="ins-btnrow"><button type="button" class="ed-btn ed-btn-primary" data-ex="go">Export ' + esc(n.name || 'layer') + '</button></div>';
        host.appendChild(sec);

        const commit = (fn) => {
          App.history.begin(App.doc);
          fn();
          App.history.end(App.doc);
          P.refreshInspector();
          App.markDirty();
        };
        sec.querySelector('[data-ex="add"]').onclick = () => commit(() => {
          ensureExports(n).push({ format: 'png', scale: 2, suffix: '@2x', contentsOnly: true, background: '' });
        });
        sec.querySelectorAll('.pf-ex-row').forEach((row) => {
          const i = +row.dataset.i;
          row.querySelector('[data-ex="scale"]').addEventListener('change', (e) => {
            const v = Math.max(0.25, Math.min(8, +e.target.value || 1));
            commit(() => { n.exports[i].scale = v; });
          });
          row.querySelector('[data-ex="fmt"]').addEventListener('change', (e) => {
            commit(() => { n.exports[i].format = e.target.value; });
          });
          row.querySelector('[data-ex="suf"]').addEventListener('change', (e) => {
            commit(() => { n.exports[i].suffix = e.target.value; });
          });
          row.querySelector('[data-ex="del"]').onclick = () => commit(() => {
            n.exports.splice(i, 1);
            if (!n.exports.length) n.exports = defaultExports();
          });
        });
        const bg = sec.querySelector('[data-ex="white"]');
        if (bg) bg.addEventListener('change', () => commit(() => {
          for (const s of n.exports) s.background = bg.checked ? '#ffffff' : '';
        }));
        sec.querySelector('[data-ex="go"]').onclick = () => {
          App.exportNode(n).then((names) => {
            App.toast('Exported ' + names.join(', '), 3500, 'success');
          }).catch((err) => {
            console.error(err);
            App.toast('Export failed: ' + (err && err.message || err), 7000, 'error');
          });
        };
      };
    }

    if (global.Shortcuts && global.Shortcuts.def) {
      global.Shortcuts.def('shift+mod+e', 'Export selection', 'App', (a) => a.exportSelection());
    }
  });
})(window);
