/* chrome-figma.js — Figma UI3 chrome.
 * https://www.figma.com/blog/behind-our-redesign-ui3/
 *
 * Horizontal toolbelt at the bottom of the canvas. Slim top bar.
 * File / Assets / Variables. Quiet empty inspector.
 */
(function (global) {
  'use strict';

  function ready(fn) {
    if (typeof document === 'undefined') return;
    if (document.readyState === 'complete') return fn();
    window.addEventListener('load', fn, { once: true });
  }

  const KEEP = { move: 1, frame: 1, rect: 1, pen: 1, text: 1, hand: 1, comment: 1 };

  function compactToolbar() {
    const tb = document.getElementById('ed-toolbar');
    if (!tb) return;
    tb.classList.add('pf-rail', 'pf-ui3');
    tb.querySelectorAll('.tool').forEach((b) => {
      const t = b.dataset.tool;
      b.style.display = KEEP[t] ? '' : 'none';
      if (t === 'frame' || t === 'rect' || t === 'pen') b.classList.add('has-fly');
      const key = b.querySelector('.tool-key');
      if (key) key.remove();
    });
    tb.querySelectorAll('.tb-sep').forEach((s) => { s.style.display = 'none'; });
    // Avoid translateX(-50%) half-pixels (makes every icon look blocky).
    requestAnimationFrame(() => {
      const parent = tb.parentElement;
      if (!parent) return;
      const x = Math.round((parent.clientWidth - tb.offsetWidth) / 2);
      tb.style.left = x + 'px';
      tb.style.transform = 'none';
    });
  }

  function placeFlyouts() {
    document.querySelectorAll('.pf-flyout').forEach((fly) => {
      const tb = document.getElementById('ed-toolbar');
      if (!tb) return;
      const active = tb.querySelector('.tool.active.has-fly') || tb.querySelector('.tool.has-fly:hover') || tb.querySelector('.tool.has-fly');
      const r = (active || tb).getBoundingClientRect();
      fly.classList.add('pf-fly-up');
      fly.style.left = Math.max(8, r.left) + 'px';
      fly.style.top = 'auto';
      fly.style.bottom = (window.innerHeight - r.top + 8) + 'px';
    });
  }

  function quietEmptyInspector() {
    const el = document.getElementById('ed-right');
    if (!el) return;
    const empty = el.querySelector('.studio-empty-ins');
    if (!empty) return;
    empty.classList.add('pf-quiet-empty');
    const h = empty.querySelector('h3');
    if (h) h.textContent = 'Nothing selected';
    const p = empty.querySelector('p');
    if (p) p.remove();
  }

  function slimTabs() {
    document.querySelectorAll('.ed-ltab[data-tab="pages"]').forEach((t) => { t.style.display = 'none'; });
    const file = document.querySelector('.ed-ltab[data-tab="layers"] span');
    if (file && file.textContent !== 'File') file.textContent = 'File';
    const collapse = document.querySelector('[data-collapse-all]');
    if (collapse) {
      collapse.textContent = '';
      collapse.title = 'Collapse layers';
      collapse.classList.add('pf-collapse');
    }
  }

  function addResize(el, edge) {
    if (!el || el.querySelector('.pf-resize')) return;
    const h = document.createElement('div');
    h.className = 'pf-resize ' + edge;
    h.title = 'Drag to resize panel';
    el.appendChild(h);
    h.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      h.setPointerCapture(e.pointerId);
      const startX = e.clientX;
      const startW = el.getBoundingClientRect().width;
      const move = (ev) => {
        const dx = ev.clientX - startX;
        const next = edge === 'left' ? startW + dx : startW - dx;
        el.style.width = Math.max(180, Math.min(420, next)) + 'px';
        if (global.App && global.App.resizeCanvas) global.App.resizeCanvas();
      };
      const up = () => {
        h.removeEventListener('pointermove', move);
        h.removeEventListener('pointerup', up);
        compactToolbar();
        if (global.App && global.App.resizeCanvas) global.App.resizeCanvas();
      };
      h.addEventListener('pointermove', move);
      h.addEventListener('pointerup', up);
    });
  }

  function apply() {
    document.body.classList.add('pf-chrome', 'pf-ui3');
    compactToolbar();
    quietEmptyInspector();
    slimTabs();
    addResize(document.querySelector('.ed-left'), 'left');
    addResize(document.querySelector('.ed-right'), 'right');
  }

  ready(function () {
    const App = global.App;
    const P = global.Panels;
    if (!App) return;

    const _build = App.buildChrome && App.buildChrome.bind(App);
    if (_build) {
      App.buildChrome = function () {
        _build();
        apply();
      };
    }
    if (P && P.refreshInspector) {
      const _ri = P.refreshInspector.bind(P);
      P.refreshInspector = function () {
        _ri();
        quietEmptyInspector();
      };
    }
    if (P && P.refreshLayers) {
      const _rl = P.refreshLayers.bind(P);
      P.refreshLayers = function () {
        _rl();
        slimTabs();
      };
    }

    const obs = new MutationObserver(() => placeFlyouts());
    obs.observe(document.body, { childList: true, subtree: true });

    apply();
    window.addEventListener('resize', () => compactToolbar());
  });
})(typeof window !== 'undefined' ? window : globalThis);
