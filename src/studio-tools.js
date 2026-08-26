/* studio-tools.js — Figma-like tool chrome: comment composer + shape flyouts. */
(function (global) {
  'use strict';

  function ready(fn) {
    if (document.readyState === 'complete') return fn();
    window.addEventListener('load', fn, { once: true });
  }

  ready(function () {
    const App = global.App;
    const M = global.Model;
    const Ico = global.Icons && global.Icons.svg;
    if (!App || !M) return;

    // ---- Comment: inline pin instead of window.prompt --------------------
    const _onDown = App.onDown && App.onDown.bind(App);
    App.onDown = function (e) {
      if (this.tool === 'comment' && e.button === 0 && !this.space) {
        e.preventDefault();
        const p = this.toWorld(e);
        openCommentComposer(this, p, e);
        return;
      }
      if (_onDown) return _onDown(e);
    };

    function openCommentComposer(app, world, e) {
      document.querySelectorAll('.pf-comment-pop').forEach((n) => n.remove());
      const wrap = document.querySelector('.ed-canvas-wrap');
      if (!wrap) return;
      const screen = app.toScreen(world);
      const pop = document.createElement('div');
      pop.className = 'pf-comment-pop';
      pop.style.left = Math.max(12, screen.x) + 'px';
      pop.style.top = Math.max(12, screen.y) + 'px';
      pop.innerHTML =
        '<div class="pf-comment-caret"></div>' +
        '<textarea class="pf-comment-ta" rows="3" placeholder="Add a comment…"></textarea>' +
        '<div class="pf-comment-row">' +
        '<button class="ed-btn" data-x>Cancel</button>' +
        '<button class="ed-btn ed-btn-primary" data-ok>Comment</button>' +
        '</div>';
      wrap.appendChild(pop);
      const ta = pop.querySelector('textarea');
      setTimeout(() => ta.focus(), 0);
      const close = () => pop.remove();
      pop.querySelector('[data-x]').onclick = close;
      const submit = () => {
        const text = ta.value.trim();
        if (!text) { close(); return; }
        app.history.begin(app.doc);
        global.Eco.Comments.add(app.doc, app.page.id, world.x, world.y, text, global.Collab.self ? global.Collab.self.name : 'You');
        app.history.end(app.doc);
        app.renderPins();
        app.markDirty();
        app.setTool('move');
        close();
      };
      pop.querySelector('[data-ok]').onclick = submit;
      ta.addEventListener('keydown', (ev) => {
        ev.stopPropagation();
        if (ev.key === 'Escape') { ev.preventDefault(); close(); }
        if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); submit(); }
      });
    }

    // ---- Shape / frame flyouts (Figma long-press or click-hold) ----------
    const GROUPS = {
      frame: [
        { tool: 'frame', icon: 'frame', label: 'Frame', key: 'F' },
        { tool: 'section', icon: 'section', label: 'Section', key: 'S' },
      ],
      rect: [
        { tool: 'rect', icon: 'rect', label: 'Rectangle', key: 'R' },
        { tool: 'ellipse', icon: 'ellipse', label: 'Ellipse', key: 'O' },
        { tool: 'line', icon: 'line', label: 'Line', key: 'L' },
        { tool: 'arrow', icon: 'arrow', label: 'Arrow', key: 'A' },
        { tool: 'polygon', icon: 'polygon', label: 'Polygon' },
        { tool: 'star', icon: 'star', label: 'Star' },
        { tool: 'triangle', icon: 'triangle', label: 'Triangle' },
      ],
      pen: [
        { tool: 'pen', icon: 'pen', label: 'Pen', key: 'P' },
        { tool: 'pencil', icon: 'pencil', label: 'Pencil', key: 'N' },
      ],
    };

    function bindFlyouts() {
      const tb = document.getElementById('ed-toolbar');
      if (!tb || tb._flyouts) return;
      tb._flyouts = true;
      let holdTimer = 0, opened = false;
      const close = () => { document.querySelectorAll('.pf-flyout').forEach((n) => n.remove()); opened = false; };
      document.addEventListener('pointerdown', (e) => {
        if (!e.target.closest('.pf-flyout') && !e.target.closest('.ed-toolbar')) close();
      }, true);

      tb.querySelectorAll('.tool').forEach((btn) => {
        const tool = btn.dataset.tool;
        const groupKey = tool === 'frame' || tool === 'section' ? 'frame'
          : (tool === 'rect' || tool === 'ellipse' || tool === 'line' || tool === 'arrow' || tool === 'polygon' || tool === 'star' || tool === 'triangle') ? 'rect'
          : (tool === 'pen' || tool === 'pencil') ? 'pen' : null;
        if (!groupKey) return;
        const items = GROUPS[groupKey];
        const open = () => {
          close();
          opened = true;
          const r = btn.getBoundingClientRect();
          const fly = document.createElement('div');
          fly.className = 'pf-flyout';
          fly.style.left = (r.right + 8) + 'px';
          fly.style.top = r.top + 'px';
          fly.innerHTML = items.map((it) =>
            `<button data-tool="${it.tool}">${Ico ? Ico(it.icon, { size: 15 }) : ''}<span>${it.label}</span>${it.key ? `<kbd>${it.key}</kbd>` : ''}</button>`
          ).join('');
          document.body.appendChild(fly);
          fly.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
            App.setTool(b.dataset.tool);
            close();
          }));
        };
        btn.addEventListener('pointerdown', (e) => {
          if (e.button !== 0) return;
          holdTimer = setTimeout(open, 280);
        });
        btn.addEventListener('pointerup', () => { clearTimeout(holdTimer); });
        btn.addEventListener('pointerleave', () => { clearTimeout(holdTimer); });
        btn.addEventListener('contextmenu', (e) => { e.preventDefault(); open(); });
      });
    }

    const _build = App.buildChrome && App.buildChrome.bind(App);
    if (_build) {
      App.buildChrome = function () {
        _build();
        bindFlyouts();
      };
    }
    bindFlyouts();
  });
})(window);
