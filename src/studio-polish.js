/* studio-polish.js
 * 1. Frames have no automatic stroke (Figma).
 * 2. Autosave like Figma: idle debounce + min gap, not every keystroke.
 *    ⌘/Ctrl+S saves immediately.
 * 3. Export settings from
 *    https://help.figma.com/hc/en-us/articles/13402894554519
 *    Scale 2x / 200w / 100h · ignore overlapping · SVG id · JPG quality
 *    · resampling · SVG/PDF stay 1×.
 */
(function (global) {
  'use strict';

  function ready(fn) {
    if (typeof document === 'undefined') return;
    if (document.readyState === 'complete') return fn();
    window.addEventListener('load', fn, { once: true });
  }

  function parseScale(raw, w, h) {
    const s = String(raw == null ? '1' : raw).trim().toLowerCase();
    let m = s.match(/^(\d+(\.\d+)?)x$/);
    if (m) return Math.max(0.1, +m[1]);
    m = s.match(/^(\d+(\.\d+)?)w$/);
    if (m && w > 0) return Math.max(0.1, +m[1] / w);
    m = s.match(/^(\d+(\.\d+)?)h$/);
    if (m && h > 0) return Math.max(0.1, +m[1] / h);
    const n = parseFloat(s);
    return isFinite(n) && n > 0 ? n : 1;
  }

  function formatScale(s) {
    if (s == null) return '1x';
    if (typeof s === 'string' && /[xwh]$/i.test(s.trim())) return s.trim();
    const n = +s;
    if (!isFinite(n) || n === 1) return '1x';
    return (Math.round(n * 100) / 100) + 'x';
  }

  global.StudioPolish = { parseScale, formatScale };

  ready(function () {
    const App = global.App;
    const P = global.Panels;
    if (!App) return;

    // ------------------------------------------------------------------ save
    const IDLE_MS = 8000;
    const MIN_GAP_MS = 15000;

    const _md = App.markDirty && App.markDirty.bind(App);
    App.markDirty = function () {
      if (_md) _md();
      // Core schedules saveNow in 900ms on every paint. Cancel that.
      if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
    };

    App.scheduleSave = function () {
      this._saveWanted = true;
      if (this._saveTimer) clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(() => this.flushSave(), IDLE_MS);
      const pill = document.getElementById('ed-save-state');
      if (pill) pill.textContent = 'Unsaved';
    };

    App.flushSave = function (force) {
      if (!force && !this._saveWanted) return;
      const now = Date.now();
      if (!force && this._lastSaveAt && now - this._lastSaveAt < MIN_GAP_MS) {
        this._saveTimer = setTimeout(() => this.flushSave(), MIN_GAP_MS - (now - this._lastSaveAt));
        return;
      }
      this._saveWanted = false;
      if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
      this._lastSaveAt = now;
      this._saveSilent = true;
      try { this.saveNow(); } finally { this._saveSilent = false; }
      const pill = document.getElementById('ed-save-state');
      if (pill) pill.textContent = 'Saved';
    };

    const _saveNow = App.saveNow && App.saveNow.bind(App);
    App.saveNow = function () {
      if (_saveNow) _saveNow();
      this._lastSaveAt = Date.now();
      this._saveWanted = false;
      if (this._saveTimer) { clearTimeout(this._saveTimer); this._saveTimer = null; }
      if (!this._saveSilent) {
        const pill = document.getElementById('ed-save-state');
        if (pill) pill.textContent = 'Saved';
      }
    };

    App.saveManual = function () {
      this.flushSave(true);
      if (this.toast) this.toast('Saved', 1400, 'success');
    };

    if (App.history && App.history.end) {
      const _end = App.history.end.bind(App.history);
      App.history.end = function (doc) {
        _end(doc);
        App.scheduleSave();
      };
    }

    if (global.Shortcuts && global.Shortcuts.def) {
      const table = global.Shortcuts.table || [];
      const hit = table.find((b) => b.norm === 'mod+s' || b.keys === 'mod+s');
      if (hit) hit.run = (a) => a.saveManual();
      else global.Shortcuts.def('mod+s', 'Save', 'Editing', (a) => a.saveManual());
    }

    const _cmds = App._paletteCommands && App._paletteCommands.bind(App);
    if (_cmds) {
      App._paletteCommands = function () {
        const list = _cmds() || [];
        list.push({ label: 'Save', hint: '⌘S', kw: 'save persist local', run: () => this.saveManual() });
        return list;
      };
    }

    // Tiny "Saved / Unsaved" next to the filename.
    function ensureSavePill() {
      if (document.getElementById('ed-save-state')) return;
      const wrap = document.querySelector('.ed-filename-wrap');
      if (!wrap) return;
      const pill = document.createElement('span');
      pill.id = 'ed-save-state';
      pill.className = 'ed-save-state';
      pill.textContent = 'Saved';
      wrap.appendChild(pill);
    }
    const _chrome = App.buildChrome && App.buildChrome.bind(App);
    if (_chrome) {
      App.buildChrome = function () {
        _chrome();
        ensureSavePill();
      };
    }
    ensureSavePill();

    // ------------------------------------------------------------------ export
    const _exportSetting = App.exportSetting && App.exportSetting.bind(App);
    if (_exportSetting) {
      App.exportSetting = async function (n, setting) {
        setting = Object.assign({}, setting);
        const fmt = (setting.format || 'png').toLowerCase();
        if (fmt === 'svg' || fmt === 'pdf') setting.scale = 1;
        else {
          const box = n._w || n;
          setting.scale = parseScale(setting.scaleSpec || setting.scale, box.w, box.h);
        }
        if (fmt === 'svg') this._svgExportOpts = {
          includeId: setting.includeId !== false,
          outlineText: !!setting.outlineText,
        };
        const prevSmooth = this._exportResample;
        this._exportResample = setting.resample || 'detailed';
        const R = global.Renderer;
        const _dn = R && R.drawNode && R.drawNode.bind(R);
        if (_dn && R) {
          R.drawNode = function (ctx, page, node, doc) {
            if (ctx) {
              if (App._exportResample === 'basic') ctx.imageSmoothingEnabled = false;
              else {
                ctx.imageSmoothingEnabled = true;
                if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
              }
            }
            return _dn(ctx, page, node, doc);
          };
        }
        try {
          if ((fmt === 'jpg' || fmt === 'jpeg') && setting.quality) {
            const c = App.renderNodePng && App.renderNodePng(this.page, this.doc, n, setting.scale, {
              background: setting.background || '#ffffff',
            });
            if (c) {
              const q = Math.max(0.4, Math.min(1, setting.quality));
              if (this._exportResample === 'basic') {
                const ctx = c.getContext('2d');
                if (ctx) ctx.imageSmoothingEnabled = false;
              }
              const blob = await new Promise((res, rej) => {
                c.toBlob((b) => b ? res(b) : rej(new Error('JPG encode failed')), 'image/jpeg', q);
              });
              const suffix = setting.suffix || '';
              const name = String(n.name || 'export').replace(/[\\/:*?"<>|]+/g, '-') + suffix + '.jpg';
              if (global.PenfigSave && global.PenfigSave.saveBlob) await global.PenfigSave.saveBlob(blob, name);
              else {
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob); a.download = name; a.click();
              }
              return name;
            }
          }
          return await _exportSetting.call(this, n, setting);
        } finally {
          this._svgExportOpts = null;
          this._exportResample = prevSmooth;
          if (_dn && R) R.drawNode = _dn;
        }
      };
    }

    if (global.SvgExport && global.SvgExport.renderNode) {
      const _svg = global.SvgExport.renderNode.bind(global.SvgExport);
      global.SvgExport.renderNode = function (doc, page, n) {
        let s = _svg(doc, page, n);
        if (App._svgExportOpts && App._svgExportOpts.includeId !== false && n && typeof s === 'string') {
          const id = String(n.name || 'layer').replace(/[^A-Za-z0-9_-]+/g, '-') || 'layer';
          s = s.replace('<svg ', '<svg id="' + id + '" ');
        }
        return s;
      };
    }

    if (P && P.refreshInspector) {
      const _ri = P.refreshInspector.bind(P);
      P.refreshInspector = function () {
        _ri();
        const sec = document.querySelector('.pf-export-sec');
        if (!sec || sec.querySelector('[data-ex="overlap"]')) return;
        const n = App.sel && App.page && App.page.nodes[App.sel[0]];
        if (!n || !n.exports || !n.exports[0]) return;
        const s0 = n.exports[0];
        sec.querySelectorAll('[data-ex="scale"]').forEach((inp, i) => {
          const row = n.exports[i];
          if (!row) return;
          inp.type = 'text';
          inp.removeAttribute('min'); inp.removeAttribute('max'); inp.removeAttribute('step');
          inp.value = formatScale(row.scaleSpec || row.scale);
          inp.title = '1x · 2x · 200w · 100h';
          inp.addEventListener('change', () => {
            App.history.begin(App.doc);
            row.scaleSpec = inp.value.trim();
            row.scale = parseScale(inp.value, n.w, n.h);
            App.history.end(App.doc);
          });
        });
        const extra = document.createElement('div');
        extra.className = 'pf-ex-adv';
        extra.innerHTML =
          '<label class="chk"><input type="checkbox" data-ex="overlap"' + (s0.contentsOnly !== false ? ' checked' : '') + '> Ignore overlapping layers</label>' +
          '<label class="chk"><input type="checkbox" data-ex="svgid"' + (s0.includeId !== false ? ' checked' : '') + '> Include id (SVG)</label>' +
          '<div class="ins-row"><label>JPG quality</label>' +
            '<select data-ex="jpgq">' +
              '<option value="0.95"' + ((s0.quality || 0.92) >= 0.94 ? ' selected' : '') + '>High</option>' +
              '<option value="0.82"' + ((s0.quality || 0.92) < 0.94 && (s0.quality || 0.92) >= 0.75 ? ' selected' : '') + '>Medium</option>' +
              '<option value="0.6"' + ((s0.quality || 0.92) < 0.75 ? ' selected' : '') + '>Low</option>' +
            '</select></div>' +
          '<div class="ins-row"><label>Resample</label>' +
            '<select data-ex="resample">' +
              '<option value="detailed"' + ((s0.resample || 'detailed') === 'detailed' ? ' selected' : '') + '>Detailed</option>' +
              '<option value="basic"' + (s0.resample === 'basic' ? ' selected' : '') + '>Basic</option>' +
            '</select></div>' +
          '<div class="ph sm">SVG and PDF export at 1× (Figma). Scale like 2x / 200w / 100h applies to PNG and JPG.</div>';
        const go = sec.querySelector('[data-ex="go"]');
        if (go) sec.insertBefore(extra, go.parentElement);
        else sec.appendChild(extra);
        const commit = (fn) => { App.history.begin(App.doc); fn(); App.history.end(App.doc); };
        extra.querySelector('[data-ex="overlap"]').addEventListener('change', (e) => {
          commit(() => { n.exports.forEach((s) => { s.contentsOnly = e.target.checked; }); });
        });
        extra.querySelector('[data-ex="svgid"]').addEventListener('change', (e) => {
          commit(() => { n.exports.forEach((s) => { s.includeId = e.target.checked; }); });
        });
        extra.querySelector('[data-ex="jpgq"]').addEventListener('change', (e) => {
          commit(() => { n.exports.forEach((s) => { s.quality = +e.target.value; }); });
        });
        extra.querySelector('[data-ex="resample"]').addEventListener('change', (e) => {
          commit(() => { n.exports.forEach((s) => { s.resample = e.target.value; }); });
        });
      };
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
