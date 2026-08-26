/* inspector-ui3.js — Figma-like right sidebar.
 *
 * The Design panel was a dump of every overlay (Arrange, Mask, Scale,
 * Constraints, full Stroke, help copy, Make component…). Figma shows
 * only the properties that apply, and empty Fill/Stroke/Effects/Export
 * collapse to a header + plus.
 *
 * https://help.figma.com/hc/en-us/articles/360039956634
 */
(function (global) {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'complete') return fn();
    window.addEventListener('load', fn, { once: true });
  }

  function titleOf(sec) {
    const el = sec.querySelector('.ins-head span, .ins-sec-title, .ins-head');
    return ((el && el.textContent) || '').replace(/\s+/g, ' ').trim().toLowerCase();
  }

  function hide(el) {
    if (el) el.style.display = 'none';
  }

  function collapseEmpty(sec) {
    sec.classList.add('pf-ins-empty');
    Array.from(sec.children).forEach((ch) => {
      if (ch.classList && ch.classList.contains('ins-head')) return;
      if (ch.classList && ch.classList.contains('ins-sec-title')) return;
      ch.classList.add('pf-ins-body');
    });
  }

  function makeCollapsible(sec) {
    if (sec._pfFold) return;
    const head = sec.querySelector('.ins-head, .ins-sec-title');
    if (!head) return;
    sec._pfFold = true;
    head.classList.add('pf-ins-fold');
    head.addEventListener('click', (e) => {
      if (e.target.closest('button, input, select, label, a')) return;
      sec.classList.toggle('pf-ins-shut');
    });
  }

  function tidy() {
    const App = global.App;
    const P = global.Panels;
    const el = document.getElementById('ed-right');
    if (!el || !App || !P) return;
    if (el.querySelector('.studio-empty-ins')) return;
    if (P._inspectorTab && P._inspectorTab !== 'design') return;
    const host = el.querySelector('.ins-tab-content') || el;
    const nodes = P.selNodes ? P.selNodes() : [];
    const n = nodes[0];
    if (!n) return;
    const isText = n.type === 'text';
    const isLine = n.type === 'line';
    const multi = nodes.length > 1;

    el.classList.add('pf-ins-ui3');
    host.classList.add('pf-ins-host');

    host.querySelectorAll('.ph.sm, .ins-sec .ph').forEach((p) => {
      if (p.closest('.studio-empty-ins')) return;
      const t = (p.textContent || '').trim();
      if (t.length > 18) hide(p);
    });

    host.querySelectorAll('[data-act="edit-text"]').forEach(hide);

    if (isText) {
      host.querySelectorAll('.radius-row, .pf-rad-sec').forEach(hide);
      host.querySelectorAll('[data-act="flip-h"], [data-act="flip-v"]').forEach(hide);
    }

    host.querySelectorAll('.f-token, select[data-act="stroke-token"], select[data-act="al-gap-tok"]').forEach((sel) => {
      const opts = sel.querySelectorAll('option');
      if (opts.length <= 1) hide(sel);
    });

    const sections = Array.from(host.querySelectorAll('.ins-sec'));
    const bucket = {
      align: null,
      pos: null,
      type: null,
      resize: null,
      fill: null,
      stroke: null,
      fx: null,
      al: null,
      item: null,
      export: null,
      rest: [],
    };

    for (const sec of sections) {
      const t = titleOf(sec);
      const hasMask = !!sec.querySelector('[data-act="mask-toggle"]');
      const hasArrange = /arrange/.test(t) || !!sec.querySelector('[data-act="z-front"]');
      const hasScale = sec.classList.contains('pf-scale-sec') || t === 'scale';
      const hasSelc = sec.classList.contains('pf-sel-colors');
      const hasTidy = sec.classList.contains('pf-tidy-sec');
      const hasClip = !!sec.querySelector('[data-act="clips"]') && !t;

      if (hasArrange) { hide(sec); continue; }
      if (hasMask && (isText || !n.parent)) { hide(sec); continue; }
      if (hasScale && App.tool !== 'scale') { hide(sec); continue; }
      if (hasSelc && nodes.length < 2) { hide(sec); continue; }
      if (hasTidy && nodes.length < 2) { hide(sec); continue; }
      if (/^component$/.test(t) && isText) { hide(sec); continue; }
      if (/constraint/.test(t) && (isText || multi)) { hide(sec); continue; }
      if (/layout grid/.test(t) && (isText || isLine)) { hide(sec); continue; }
      if (/text on path/.test(t) && !(n.text && n.text.pathId)) { hide(sec); continue; }

      if (/align/.test(t) && !bucket.align) bucket.align = sec;
      else if (sec.querySelector('[data-xy="x"]') && !bucket.pos) bucket.pos = sec;
      else if (sec.classList.contains('pf-type') || t === 'typography' || t === 'text') bucket.type = sec;
      else if (t === 'resizing') bucket.resize = sec;
      else if (/^fills?$/.test(t)) bucket.fill = sec;
      else if (t === 'stroke') bucket.stroke = sec;
      else if (t === 'effects') {
        if (!bucket.fx) bucket.fx = sec;
        else if (bucket.fx !== sec) hide(sec);
      } else if (t === 'auto layout') bucket.al = sec;
      else if (/layout \(item\)/.test(t)) bucket.item = sec;
      else if (sec.classList.contains('pf-export-sec') || t === 'export') bucket.export = sec;
      else if (hasClip) {
        sec.classList.add('pf-ins-appear');
        bucket.rest.push(sec);
      } else {
        bucket.rest.push(sec);
      }

      if (t === 'stroke') {
        const on = sec.querySelector('[data-act="stroke-on"]');
        if (on && !on.checked) collapseEmpty(sec);
      }
      if (t === 'effects') {
        const has = (n.shadows && n.shadows.length) || (n.blur > 0);
        if (!has) collapseEmpty(sec);
      }
      if ((sec.classList.contains('pf-export-sec') || t === 'export') && !(n.export && n.export.length)) {
        collapseEmpty(sec);
      }
      if (/layout grid/.test(t) && !n.grid) collapseEmpty(sec);
      if (t === 'auto layout' && !n.al) {
        /* keep the two buttons — they are the empty state */
      }

      makeCollapsible(sec);
    }

    if (isText && bucket.resize) {
      /* Figma puts resizing in Layout, not a second lecture. Keep the buttons. */
    }

    const order = [
      bucket.align, bucket.pos, bucket.al, bucket.item, bucket.resize,
      bucket.type, bucket.fill, bucket.stroke, bucket.fx, bucket.export,
    ].concat(bucket.rest).filter(Boolean);

    const seen = new Set();
    for (const sec of order) {
      if (seen.has(sec)) continue;
      seen.add(sec);
      host.appendChild(sec);
    }

    compactOpacity(host, n);
  }

  function compactOpacity(host, n) {
    const row = host.querySelector('[data-act="opacity"]');
    if (!row || row._pfCompact) return;
    const wrap = row.closest('.ins-row');
    if (!wrap) return;
    row._pfCompact = true;
    if (row.type === 'range') {
      row.classList.add('pf-ins-op');
      const lab = wrap.querySelector('#op-val, .ins-val');
      if (lab) lab.classList.add('pf-ins-op-val');
    }
  }

  ready(function () {
    const P = global.Panels;
    if (!P || !P.refreshInspector) return;
    const _ri = P.refreshInspector.bind(P);
    P.refreshInspector = function () {
      _ri();
      try { tidy(); } catch (e) { /* never break the panel */ }
    };
    if (document.getElementById('ed-right')) {
      try { tidy(); } catch (e) {}
    }
  });
})(typeof window !== 'undefined' ? window : globalThis);
