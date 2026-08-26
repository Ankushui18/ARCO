/* create-designs.js — Figma "Create designs" closeouts.
 * https://help.figma.com/hc/en-us/sections/4403912808599-Create-designs
 *
 * Shift+A auto layout · ⌥⇧A remove · ⌃⇧A suggest
 * A = Frame · ⌥⌘G frame selection · ⌘R rename · I eyedropper
 * Selection colors · clip content · blend · last-size frame click
 */
(function (global) {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'complete') return fn();
    window.addEventListener('load', fn, { once: true });
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function hexFromRgb(r, g, b) {
    const c = (v) => Math.max(0, Math.min(255, v | 0)).toString(16).padStart(2, '0');
    return '#' + c(r) + c(g) + c(b);
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0, l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h /= 6;
    }
    return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
  }

  ready(function () {
    const App = global.App;
    const M = global.Model;
    const P = global.Panels;
    if (!App || !M) return;

    App._lastFrame = App._lastFrame || { w: 100, h: 100 };
    App._eyeModel = 0; // 0 hex 1 rgb 2 hsl

    function selNodes() {
      return (App.sel || []).map((id) => App.page && App.page.nodes[id]).filter(Boolean);
    }

    function worldBox(n) {
      return n._w || { x: n.x, y: n.y, w: n.w, h: n.h };
    }

    function inferDir(nodes) {
      if (nodes.length < 2) return 'v';
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const n of nodes) {
        const b = worldBox(n);
        x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
        x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
      }
      return (x1 - x0) >= (y1 - y0) ? 'h' : 'v';
    }

    function wrapInFrame(nodes, name, alDir) {
      if (!nodes.length) return null;
      const page = App.page;
      const parent = nodes.every((n) => n.parent === nodes[0].parent) ? nodes[0].parent : null;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const n of nodes) {
        const b = worldBox(n);
        x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y);
        x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h);
      }
      let lx = x0, ly = y0;
      if (parent) {
        const p = page.nodes[parent];
        if (p && p._w) { lx = x0 - p._w.x; ly = y0 - p._w.y; }
      }
      const f = M.makeNode('frame', { x: lx, y: ly, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0), name: name || 'Frame' });
      f.fills = [];
      f.clips = false;
      M.attach(App.doc, page, parent, f);
      for (const n of nodes) {
        const b = worldBox(n);
        M.detach(page, n);
        n.x = b.x - x0;
        n.y = b.y - y0;
        M.attach(App.doc, page, f.id, n);
      }
      if (alDir) M.makeAutoLayout(f, alDir, page);
      return f;
    }

    App.addAutoLayout = function () {
      const nodes = selNodes();
      if (!nodes.length) { this.toast('Select a frame or layers'); return; }
      this.history.begin(this.doc);
      if (nodes.length === 1 && (nodes[0].type === 'frame' || nodes[0].type === 'instance')) {
        const n = nodes[0];
        if (n.al) {
          n.al.dir = n.al.dir === 'h' ? 'v' : 'h';
        } else {
          const kids = (n.children || []).map((id) => this.page.nodes[id]).filter(Boolean);
          M.makeAutoLayout(n, inferDir(kids.length ? kids : [n]), this.page);
        }
        this.history.end(this.doc);
        if (P.refreshInspector) P.refreshInspector();
        this.markDirty();
        return;
      }
      const f = wrapInFrame(nodes, 'Auto layout', inferDir(nodes));
      this.history.end(this.doc);
      if (f) this.setSel([f.id]);
      if (P.refreshInspector) P.refreshInspector();
      if (P.refreshLayers) P.refreshLayers();
      this.markDirty();
    };

    App.removeAutoLayout = function (all) {
      const nodes = selNodes();
      if (!nodes.length) return;
      this.history.begin(this.doc);
      const strip = (n) => {
        if (n.al) M.removeAutoLayout(n, this.page);
        if (all) for (const id of n.children || []) {
          const c = this.page.nodes[id];
          if (c) strip(c);
        }
      };
      nodes.forEach(strip);
      this.history.end(this.doc);
      if (P.refreshInspector) P.refreshInspector();
      this.markDirty();
    };

    App.suggestAutoLayout = function () {
      const n = selNodes()[0];
      if (!n || n.type !== 'frame') { this.toast('Select a frame to suggest auto layout'); return; }
      const kids = (n.children || []).map((id) => this.page.nodes[id]).filter((c) => c && !c.als?.absolute);
      if (kids.length < 2) { this.addAutoLayout(); return; }
      this.history.begin(this.doc);
      const rows = [];
      const sorted = kids.slice().sort((a, b) => worldBox(a).y - worldBox(b).y);
      for (const c of sorted) {
        const b = worldBox(c);
        const cy = b.y + b.h / 2;
        let row = rows.find((r) => Math.abs(r.cy - cy) < Math.max(12, b.h * 0.45));
        if (!row) { row = { cy, items: [] }; rows.push(row); }
        row.items.push(c);
        row.cy = row.items.reduce((s, x) => s + worldBox(x).y + worldBox(x).h / 2, 0) / row.items.length;
      }
      if (rows.length > 1) {
        for (const row of rows) {
          if (row.items.length > 1) wrapInFrame(row.items, 'Row', 'h');
        }
        const fresh = (n.children || []).map((id) => this.page.nodes[id]).filter(Boolean);
        M.makeAutoLayout(n, 'v', this.page);
        n.al.gap.n = 12;
      } else {
        M.makeAutoLayout(n, inferDir(kids), this.page);
      }
      this.history.end(this.doc);
      if (P.refreshInspector) P.refreshInspector();
      if (P.refreshLayers) P.refreshLayers();
      this.toast('Suggested auto layout');
      this.markDirty();
    };

    App.frameSelection = function () {
      const nodes = selNodes();
      if (!nodes.length) return;
      this.history.begin(this.doc);
      const f = wrapInFrame(nodes, 'Frame', null);
      if (f) { f.clips = true; f.fills = []; }
      this.history.end(this.doc);
      if (f) this.setSel([f.id]);
      if (P.refreshInspector) P.refreshInspector();
      if (P.refreshLayers) P.refreshLayers();
      this.markDirty();
    };

    // ------------------------------------------------------------------ rename ⌘R
    App.renameLayers = function () {
      const nodes = selNodes();
      if (!nodes.length) { this.toast('Select layers to rename'); return; }
      document.querySelectorAll('.pf-rename-back').forEach((n) => n.remove());
      const back = document.createElement('div');
      back.className = 'pf-rename-back';
      back.innerHTML =
        `<div class="pf-rename">` +
          `<h3>Rename layers <span>${nodes.length}</span></h3>` +
          `<label>Match</label><input id="pf-rn-match" placeholder="Leave blank to replace the whole name">` +
          `<label>Rename to</label><input id="pf-rn-to" value="${esc(nodes[0].name || '')}">` +
          `<div class="pf-rn-btns">` +
            `<button type="button" data-ins="$&">Current name</button>` +
            `<button type="button" data-ins="$n">Number ↑</button>` +
            `<button type="button" data-ins="$N">Number ↓</button>` +
          `</div>` +
          `<div class="pf-rn-preview"></div>` +
          `<div class="pf-rn-foot"><button data-x>Cancel</button><button class="primary" data-ok>Rename</button></div>` +
        `</div>`;
      document.body.appendChild(back);
      const match = back.querySelector('#pf-rn-match');
      const to = back.querySelector('#pf-rn-to');
      const preview = back.querySelector('.pf-rn-preview');
      function applyTpl(name, i, total) {
        const pat = match.value;
        const tpl = to.value;
        let base = name;
        let rest = name;
        if (pat) {
          try {
            const re = new RegExp(pat);
            const m = name.match(re);
            if (!m) return name;
            rest = name.replace(re, tpl
              .replace(/\$n/g, String(i + 1))
              .replace(/\$N/g, String(total - i))
              .replace(/\$&/g, m[0])
              .replace(/\$1/g, m[1] || '')
              .replace(/\$2/g, m[2] || ''));
            return rest;
          } catch (e) {
            if (name.indexOf(pat) < 0) return name;
            return name.split(pat).join(tpl.replace(/\$n/g, String(i + 1)).replace(/\$N/g, String(total - i)).replace(/\$&/g, pat));
          }
        }
        return tpl
          .replace(/\$n/g, String(i + 1))
          .replace(/\$N/g, String(total - i))
          .replace(/\$&/g, name);
      }
      function render() {
        preview.innerHTML = nodes.slice(0, 8).map((n, i) =>
          `<div><s>${esc(n.name)}</s> → <b>${esc(applyTpl(n.name, i, nodes.length))}</b></div>`
        ).join('') + (nodes.length > 8 ? `<div>… +${nodes.length - 8} more</div>` : '');
      }
      match.addEventListener('input', render);
      to.addEventListener('input', render);
      back.querySelectorAll('[data-ins]').forEach((b) => b.addEventListener('click', () => {
        to.value += b.dataset.ins;
        to.focus();
        render();
      }));
      render();
      const close = () => back.remove();
      back.querySelector('[data-x]').onclick = close;
      back.addEventListener('click', (e) => { if (e.target === back) close(); });
      back.querySelector('[data-ok]').onclick = () => {
        App.history.begin(App.doc);
        nodes.forEach((n, i) => { n.name = applyTpl(n.name, i, nodes.length); });
        App.history.end(App.doc);
        if (P.refreshLayers) P.refreshLayers();
        App.markDirty();
        close();
      };
      to.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') back.querySelector('[data-ok]').click();
        if (e.key === 'Escape') close();
      });
      requestAnimationFrame(() => to.focus());
    };

    // ------------------------------------------------------------------ eyedropper I
    function sampleAt(e) {
      const c = App.canvas;
      if (!c) return null;
      const r = c.getBoundingClientRect();
      const x = Math.round((e.clientX - r.left) * (c.width / r.width));
      const y = Math.round((e.clientY - r.top) * (c.height / r.height));
      try {
        const ctx = App.ctx || c.getContext('2d');
        const d = ctx.getImageData(x, y, 1, 1).data;
        return { r: d[0], g: d[1], b: d[2], a: d[3] / 255, hex: hexFromRgb(d[0], d[1], d[2]) };
      } catch (err) { return null; }
    }

    function formatSample(s) {
      if (!s) return '';
      const m = App._eyeModel % 3;
      if (m === 1) return `rgb(${s.r}, ${s.g}, ${s.b})`;
      if (m === 2) {
        const h = rgbToHsl(s.r, s.g, s.b);
        return `hsl(${h.h} ${h.s}% ${h.l}%)`;
      }
      return s.hex.toUpperCase();
    }

    function applyHex(hex) {
      const nodes = selNodes();
      App.history.begin(App.doc);
      if (!nodes.length) {
        if (navigator.clipboard) navigator.clipboard.writeText(hex).catch(() => {});
        App.toast('Copied ' + hex);
      } else {
        for (const n of nodes) {
          if (n.type === 'line' || (n.stroke && n.stroke.visible && !(n.fills && n.fills.length))) {
            n.stroke = n.stroke || {};
            n.stroke.color = hex;
            n.stroke.visible = true;
          } else {
            if (!n.fills || !n.fills.length) n.fills = [{ type: 'solid', color: hex, opacity: 1, token: null }];
            else {
              const f = n.fills.find((x) => x && x.type === 'solid') || n.fills[0];
              f.type = 'solid';
              f.color = hex;
            }
          }
        }
        App.toast(hex);
      }
      App.history.end(App.doc);
      if (P.refreshInspector) P.refreshInspector();
      App.markDirty();
    }

    App.toggleEyedropper = function () {
      if (this._eyedrop) { stopEyedrop(); return; }
      this._eyedrop = true;
      this.status('Eyedropper — click to apply · Tab cycles Hex/RGB/HSL · Esc cancels');
      if (this.canvas) this.canvas.style.cursor = 'crosshair';
      if (!document.getElementById('pf-eye-chip')) {
        const chip = document.createElement('div');
        chip.id = 'pf-eye-chip';
        chip.hidden = true;
        document.body.appendChild(chip);
      }
    };

    function stopEyedrop() {
      App._eyedrop = false;
      App.status('');
      if (App.canvas) App.canvas.style.cursor = '';
      const chip = document.getElementById('pf-eye-chip');
      if (chip) chip.hidden = true;
    }

    const _onMove = App.onMove && App.onMove.bind(App);
    App.onMove = function (e) {
      if (this._eyedrop) {
        const s = sampleAt(e);
        const chip = document.getElementById('pf-eye-chip');
        if (chip && s) {
          chip.hidden = false;
          chip.innerHTML = `<i style="background:${s.hex}"></i><b>${formatSample(s)}</b>`;
          chip.style.left = (e.clientX + 16) + 'px';
          chip.style.top = (e.clientY + 16) + 'px';
        }
        return;
      }
      if (_onMove) return _onMove(e);
    };

    const _onDown = App.onDown && App.onDown.bind(App);
    App.onDown = function (e) {
      if (this._eyedrop && e.button === 0) {
        e.preventDefault();
        const s = sampleAt(e);
        if (s) applyHex(s.hex);
        stopEyedrop();
        return;
      }
      if (_onDown) return _onDown(e);
    };

    const _onUp = App.onUp && App.onUp.bind(App);
    App.onUp = function (e) {
      const creating = this._drag && this._drag.kind === 'create' && this._drag.node;
      const created = creating ? this._drag.node : null;
      if (_onUp) _onUp(e);
      if (created && created.type === 'frame') {
        if (created.w < 8 && created.h < 8) {
          created.w = this._lastFrame.w || 100;
          created.h = this._lastFrame.h || 100;
        } else {
          this._lastFrame = { w: Math.round(created.w), h: Math.round(created.h) };
        }
        this.markDirty();
      }
    };

    const _onKey = App.onKey && App.onKey.bind(App);
    App.onKey = function (e) {
      if (this._eyedrop) {
        if (e.key === 'Escape') { e.preventDefault(); stopEyedrop(); return; }
        if (e.key === 'Tab') { e.preventDefault(); this._eyeModel = (this._eyeModel + 1) % 3; return; }
      }
      // Figma: Control+Shift+A (not ⌘) suggests auto layout.
      if (e.ctrlKey && e.shiftKey && !e.metaKey && (e.key === 'A' || e.key === 'a')) {
        e.preventDefault();
        this.suggestAutoLayout();
        return;
      }
      if (_onKey) return _onKey(e);
    };

    // ------------------------------------------------------------------ inspector extras
    if (P && P.refreshInspector) {
      const _ri = P.refreshInspector.bind(P);
      P.refreshInspector = function () {
        _ri();
        const el = document.getElementById('ed-right');
        if (!el) return;
        const host = el.querySelector('.ins-tab-content') || el;
        const nodes = selNodes();
        if (this._inspectorTab && this._inspectorTab !== 'design') return;

        if (nodes.length > 1) {
          const colors = [];
          const seen = new Set();
          for (const n of nodes) {
            for (const f of n.fills || []) {
              if (f && f.type === 'solid' && f.color && f.visible !== false) {
                const k = 'f:' + f.color.toLowerCase();
                if (!seen.has(k)) { seen.add(k); colors.push({ kind: 'fill', color: f.color, key: k }); }
              }
            }
            if (n.stroke && n.stroke.visible && n.stroke.color) {
              const k = 's:' + n.stroke.color.toLowerCase();
              if (!seen.has(k)) { seen.add(k); colors.push({ kind: 'stroke', color: n.stroke.color, key: k }); }
            }
          }
          if (colors.length && !host.querySelector('.pf-sel-colors')) {
            const sec = document.createElement('section');
            sec.className = 'ins-sec pf-sel-colors';
            sec.innerHTML = `<div class="ins-head"><span>Selection colors</span><span class="ins-val">${colors.length}</span></div>` +
              colors.map((c) =>
                `<div class="pf-selc" data-key="${c.key}">` +
                  `<input type="color" value="${M.normHex(c.color)}">` +
                  `<span>${esc(c.color.toUpperCase())} · ${c.kind}</span>` +
                  `<button type="button" data-target="${c.key}" title="Select layers with this color">◎</button>` +
                `</div>`
              ).join('');
            host.insertBefore(sec, host.firstChild);
            sec.querySelectorAll('.pf-selc').forEach((row) => {
              const key = row.dataset.key;
              const inp = row.querySelector('input[type="color"]');
              inp.addEventListener('input', () => {
                const hex = inp.value;
                App.history.begin(App.doc);
                for (const n of nodes) {
                  if (key.startsWith('f:')) {
                    for (const f of n.fills || []) {
                      if (f && f.type === 'solid' && ('f:' + (f.color || '').toLowerCase()) === key) f.color = hex;
                    }
                  } else if (n.stroke && ('s:' + (n.stroke.color || '').toLowerCase()) === key) {
                    n.stroke.color = hex;
                  }
                }
                App.history.end(App.doc);
                App.markDirty();
              });
              row.querySelector('[data-target]').addEventListener('click', () => {
                const hits = [];
                for (const id of Object.keys(App.page.nodes)) {
                  const n = App.page.nodes[id];
                  if (!n) continue;
                  if (key.startsWith('f:') && (n.fills || []).some((f) => f && f.type === 'solid' && ('f:' + (f.color || '').toLowerCase()) === key)) hits.push(id);
                  if (key.startsWith('s:') && n.stroke && ('s:' + (n.stroke.color || '').toLowerCase()) === key) hits.push(id);
                }
                if (hits.length) App.setSel(hits);
              });
            });
          }
        }

        const n = nodes[0];
        if (nodes.length === 1 && n && (n.type === 'frame' || n.type === 'instance')) {
          if (!host.querySelector('[data-act="clips"]')) {
            const sec = document.createElement('section');
            sec.className = 'ins-sec';
            sec.innerHTML =
              `<div class="ins-row"><label class="chk"><input type="checkbox" data-act="clips" ${n.clips ? 'checked' : ''}> Clip content</label></div>` +
              `<div class="ins-grid g2"><label>Blend</label>` +
                `<select data-act="blend">${['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity']
                  .map((b) => `<option value="${b}" ${n.blend === b ? 'selected' : ''}>${b}</option>`).join('')}</select></div>`;
            host.appendChild(sec);
            sec.querySelector('[data-act="clips"]').addEventListener('change', (ev) => {
              App.history.begin(App.doc);
              n.clips = ev.target.checked;
              App.history.end(App.doc);
              App.markDirty();
            });
            sec.querySelector('[data-act="blend"]').addEventListener('change', (ev) => {
              App.history.begin(App.doc);
              n.blend = ev.target.value;
              App.history.end(App.doc);
              App.markDirty();
            });
          }
        }

        if (nodes.length === 1 && n && (n.type === 'text' || n.type === 'vector' || n.type === 'line') && !host.querySelector('[data-act="add-shadow"]')) {
          const sec = document.createElement('section');
          sec.className = 'ins-sec';
          const sh = (n.shadows || []).map((s, i) =>
            `<div class="sh-row"><input type="color" value="${M.normHex(s.color)}" data-sh="${i}" data-f="color">` +
            `<input type="number" value="${Math.round(s.x || 0)}" data-sh="${i}" data-f="x">` +
            `<input type="number" value="${Math.round(s.y || 0)}" data-sh="${i}" data-f="y">` +
            `<input type="number" value="${Math.round(s.blur || 0)}" data-sh="${i}" data-f="blur">` +
            `<button data-shdel="${i}">×</button></div>`
          ).join('');
          sec.innerHTML = `<div class="ins-head"><span>Effects</span><button class="mini" data-act="add-shadow">+ Shadow</button></div>` +
            (sh || '<div class="ph sm">No effects</div>') +
            `<div class="ins-grid g2"><label>Layer blur</label><input type="number" min="0" value="${n.blur || 0}" data-act="blur"></div>` +
            `<div class="ins-grid g2"><label>Blend</label><select data-act="blend">${['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten']
              .map((b) => `<option value="${b}" ${n.blend === b ? 'selected' : ''}>${b}</option>`).join('')}</select></div>`;
          host.appendChild(sec);
          sec.querySelector('[data-act="add-shadow"]').addEventListener('click', () => {
            App.history.begin(App.doc);
            n.shadows = n.shadows || [];
            n.shadows.push({ color: '#000000', opacity: 0.25, x: 0, y: 4, blur: 8, spread: 0, visible: true });
            App.history.end(App.doc);
            P.refreshInspector();
            App.markDirty();
          });
          sec.querySelectorAll('[data-sh]').forEach((inp) => inp.addEventListener('input', () => {
            const i = +inp.dataset.sh, f = inp.dataset.f;
            App.history.begin(App.doc);
            n.shadows[i][f] = f === 'color' ? inp.value : (+inp.value || 0);
            App.history.end(App.doc);
            App.markDirty();
          }));
          sec.querySelectorAll('[data-shdel]').forEach((b) => b.addEventListener('click', () => {
            App.history.begin(App.doc);
            n.shadows.splice(+b.dataset.shdel, 1);
            App.history.end(App.doc);
            P.refreshInspector();
            App.markDirty();
          }));
          const bl = sec.querySelector('[data-act="blur"]');
          if (bl) bl.addEventListener('input', () => {
            App.history.begin(App.doc);
            n.blur = Math.max(0, +bl.value || 0);
            App.history.end(App.doc);
            App.markDirty();
          });
          const bd = sec.querySelector('[data-act="blend"]');
          if (bd) bd.addEventListener('change', () => {
            App.history.begin(App.doc);
            n.blend = bd.value;
            App.history.end(App.doc);
            App.markDirty();
          });
        }
      };
    }

    if (P && P.framePresetsPanel) {
      const _fp = P.framePresetsPanel.bind(P);
      P.framePresetsPanel = function () {
        const extra = [
          ['iPhone 16', '393 × 852', 393, 852],
          ['iPhone 16 Pro Max', '440 × 956', 440, 956],
          ['Android Compact', '360 × 800', 360, 800],
          ['Tablet', '768 × 1024', 768, 1024],
          ['Desktop', '1440 × 1024', 1440, 1024],
          ['MacBook', '1512 × 982', 1512, 982],
          ['Presentation 16:9', '1920 × 1080', 1920, 1080],
          ['Watch', '184 × 224', 184, 224],
          ['A4', '595 × 842', 595, 842],
          ['Instagram post', '1080 × 1080', 1080, 1080],
          ['Instagram story', '1080 × 1920', 1080, 1920],
          ['Open Graph', '1200 × 630', 1200, 630],
        ];
        return `<div class="ins-tabs"><button class="active">Frame presets</button></div><section class="ins-sec"><div class="ins-head"><span>Create frame</span></div><div class="pf-preset-list">${extra.map((p) =>
          `<button class="ed-btn" data-frame-preset="${p[2]},${p[3]}" data-frame-name="${p[0]}"><span>${p[0]}</span><small>${p[1]}</small></button>`
        ).join('')}</div><div class="ph sm">Click a preset, or click / drag on the canvas. A click uses the last frame size (${App._lastFrame.w} × ${App._lastFrame.h}).</div></section>`;
      };
    }

    if (P && P.contextMenu) {
      const _cm = P.contextMenu.bind(P);
      P.contextMenu = function (x, y, ids) {
        _cm(x, y, ids);
        const menu = document.querySelector('.pf-menu');
        if (!menu || !ids || !ids.length) return;
        const extra = document.createElement('div');
        extra.innerHTML =
          `<hr>` +
          `<button data-cd="al">Add auto layout <span class="kbd">⇧A</span></button>` +
          `<button data-cd="alrm">Remove auto layout <span class="kbd">⌥⇧A</span></button>` +
          `<button data-cd="alsug">Suggest auto layout <span class="kbd">⌃⇧A</span></button>` +
          `<button data-cd="frame">Frame selection <span class="kbd">⌥⌘G</span></button>` +
          `<button data-cd="rename">Rename layers <span class="kbd">⌘R</span></button>` +
          `<button data-cd="lock">${(App.page.nodes[ids[0]] || {}).locked ? 'Unlock' : 'Lock'} <span class="kbd">⇧⌘L</span></button>` +
          `<button data-cd="hide">${(App.page.nodes[ids[0]] || {}).visible === false ? 'Show' : 'Hide'} <span class="kbd">⇧⌘H</span></button>`;
        menu.appendChild(extra);
        extra.querySelector('[data-cd="al"]').onclick = () => { menu.remove(); App.addAutoLayout(); };
        extra.querySelector('[data-cd="alrm"]').onclick = () => { menu.remove(); App.removeAutoLayout(); };
        extra.querySelector('[data-cd="alsug"]').onclick = () => { menu.remove(); App.suggestAutoLayout(); };
        extra.querySelector('[data-cd="frame"]').onclick = () => { menu.remove(); App.frameSelection(); };
        extra.querySelector('[data-cd="rename"]').onclick = () => { menu.remove(); App.renameLayers(); };
        extra.querySelector('[data-cd="lock"]').onclick = () => {
          menu.remove();
          App.history.begin(App.doc);
          const on = !App.page.nodes[ids[0]].locked;
          ids.forEach((id) => { const n = App.page.nodes[id]; if (n) n.locked = on; });
          App.history.end(App.doc);
          if (P.refreshLayers) P.refreshLayers();
          App.markDirty();
        };
        extra.querySelector('[data-cd="hide"]').onclick = () => {
          menu.remove();
          App.history.begin(App.doc);
          const on = App.page.nodes[ids[0]].visible !== false;
          ids.forEach((id) => { const n = App.page.nodes[id]; if (n) n.visible = !on; });
          App.history.end(App.doc);
          if (P.refreshLayers) P.refreshLayers();
          App.markDirty();
        };
      };
    }

    if (global.Shortcuts && global.Shortcuts.def) {
      const def = global.Shortcuts.def;
      def('a', 'Frame', 'Tools', (a) => a.setTool('frame'));
      def('shift+a', 'Add auto layout', 'Editing', (a) => a.addAutoLayout());
      def('alt+shift+a', 'Remove auto layout', 'Editing', (a) => a.removeAutoLayout());
      def('alt+mod+g', 'Frame selection', 'Editing', (a) => a.frameSelection());
      def('mod+r', 'Rename layers', 'Editing', (a) => a.renameLayers());
      def('i', 'Eyedropper', 'Tools', (a) => a.toggleEyedropper());
      def('shift+mod+l', 'Lock / unlock', 'Editing', (a) => {
        const nodes = (a.sel || []).map((id) => a.page.nodes[id]).filter(Boolean);
        if (!nodes.length) return;
        a.history.begin(a.doc);
        const on = !nodes[0].locked;
        nodes.forEach((n) => { n.locked = on; });
        a.history.end(a.doc);
        if (P.refreshLayers) P.refreshLayers();
        a.markDirty();
      });
      def('shift+mod+h', 'Hide / show', 'Editing', (a) => {
        const nodes = (a.sel || []).map((id) => a.page.nodes[id]).filter(Boolean);
        if (!nodes.length) return;
        a.history.begin(a.doc);
        const hide = nodes[0].visible !== false;
        nodes.forEach((n) => { n.visible = !hide; });
        a.history.end(a.doc);
        if (P.refreshLayers) P.refreshLayers();
        a.markDirty();
      });
    }

    // A was bound to Arrow earlier — last matching shortcut wins in dispatch
    // only if we iterate first-match. shortcuts.js uses first match.
    // Reorder: move our 'a' Frame ahead by rewriting the Arrow alias.
    if (global.Shortcuts && global.Shortcuts.table) {
      const arrowA = global.Shortcuts.table.find((b) => b.keys === 'a' && /arrow/i.test(b.label));
      if (arrowA) arrowA.keys = 'shift+a+unused';
      // first 'a' should now be Frame from def() above which was pushed last...
      // dispatch is first match, so old Arrow still wins. Swap labels/runs.
      const firstA = global.Shortcuts.table.find((b) => b.norm === 'a' || b.keys === 'a');
      if (firstA) {
        firstA.label = 'Frame';
        firstA.group = 'Tools';
        firstA.run = (a) => a.setTool('frame');
      }
    }
  });
})(window);
