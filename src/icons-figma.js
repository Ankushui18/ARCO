/* icons-figma.js — replace the old decorative set with Figma-like marks.
 * 24×24, 2px stroke, round caps. Instantly readable: # = frame, T = text.
 */
(function (global) {
  'use strict';
  const Icons = global.Icons;
  if (!Icons || !Icons.ALL) return;
  const I = Icons.ALL;
  const S = { stroke: 2 };

  // Tools — these sit on the UI3 belt and must read at a glance.
  I.move = [['M4.5 2.8v16.2l4.2-4.1 3.8 8.1 2.4-1.1-3.9-8.2 6.6-.2z'], '', { fill: true }];
  I.hand = [['M8 11.2V6.4a1.4 1.4 0 012.8 0V11M10.8 11V5.6a1.4 1.4 0 012.8 0V11M13.6 11V5.2a1.4 1.4 0 012.8 0v6.4M16.4 11.4v3.2A5.6 5.6 0 017.2 13V11'], '', S];
  I.scale = [['M5 10V5h5M14 5h5v5M19 14v5h-5M10 19H5v-5'], '', S];
  // Figma frame = hash / crop window
  I.frame = [['M8 3v18M16 3v18M3 8h18M3 16h18'], '', S];
  I.section = [['M5 6h14v12H5z'], '', Object.assign({ stroke: 2 }, {})];
  I.rect = ['<rect x="4.5" y="6" width="15" height="12" rx="1.5"/>'];
  I.ellipse = ['<circle cx="12" cy="12" r="7.2"/>'];
  I.line = [['M5 18.5L19 5.5'], '', S];
  I.arrow = [['M6 18L18 6M18 6H11M18 6v7'], '', S];
  I.pen = [['M15 4.2l4.8 4.8L10 19H5v-5L15 4.2zM14.2 5l4.8 4.8'], '', S];
  I.pencil = [['M15.2 4.4l4.4 4.4L8.2 20.2 4 21l.8-4.2z'], '', S];
  I.polygon = ['<polygon points="12,3.8 20.2,9.4 17.2,19.6 6.8,19.6 3.8,9.4"/>'];
  I.star = ['<polygon points="12,3.2 14.6,9.6 21.4,10 16.2,14.6 17.8,21.2 12,17.6 6.2,21.2 7.8,14.6 2.6,10 9.4,9.6"/>'];
  I.triangle = ['<polygon points="12,4 20.6,19.5 3.4,19.5"/>'];
  I.text = [['M5.5 6h13M12 6v13M8 19h8'], '', S];
  I.comment = [['M5 5.5h14a1.8 1.8 0 011.8 1.8v8a1.8 1.8 0 01-1.8 1.8H10L5 21v-3.9H5A1.8 1.8 0 013.2 15.3v-8A1.8 1.8 0 015 5.5z'], '', S];
  I.image = ['<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.8"/><path d="M3.8 16.5l5-4.2 3.2 2.6 3.4-3.4 4.8 5"/>'];

  // Chrome
  I.back = [['M14.5 6L8.5 12l6 6'], '', S];
  I.undo = [['M8.5 13.5L4 9l4.5-4.5M4 9h10a5 5 0 010 10h-1.5'], '', S];
  I.redo = [['M15.5 13.5L20 9l-4.5-4.5M20 9H10a5 5 0 000 10h1.5'], '', S];
  I.search = ['<circle cx="11" cy="11" r="6.2"/><path d="M20 20l-3.6-3.6"/>'];
  I.eye = ['<path d="M2.4 12S6 6.2 12 6.2 21.6 12 21.6 12 18 17.8 12 17.8 2.4 12 2.4 12z"/><circle cx="12" cy="12" r="2.6"/>'];
  I.play = ['<polygon points="8,5.5 19,12 8,18.5" fill="currentColor" stroke="none"/>'];
  I.download = [['M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14'], '', S];
  I.save = [['M6 4h10l4 4v12H6zM8 20v-7h8v7M8 4v5h7'], '', S];
  I.plus = [['M12 5.5v13M5.5 12h13'], '', S];
  I.minus = [['M5.5 12h13'], '', S];
  I.zoomfit = [['M4.5 9.5V5h4.5M19.5 9.5V5H15M4.5 14.5V19H9M19.5 14.5V19H15'], '', S];
  I.close = [['M6.5 6.5l11 11M17.5 6.5l-11 11'], '', S];
  I.check = [['M5 12.5l4.5 4.5L19 7.5'], '', S];
  I.layers = [['M12 3.5L3.5 8 12 12.5 20.5 8zM3.5 12.5L12 17l8.5-4.5M3.5 16.5L12 21l8.5-4.5'], '', S];
  I.component = [['M12 3.5L20.5 12 12 20.5 3.5 12z'], '', S];
  I.instance = [['M12 3.5L20.5 12 12 20.5 3.5 12z'], '', S];
  I.tokens = [['M12 3.5l8 4.5v8l-8 4.5-8-4.5v-8z'], '', S];
  I.pages = [['M7 4h7l5 5v11H7zM14 4v5h5'], '', S];
  I.group = ['<rect x="4" y="4" width="8" height="8" rx="1.5"/><rect x="12" y="12" width="8" height="8" rx="1.5"/>'];
  I.lock = ['<rect x="6" y="11" width="12" height="9" rx="1.5"/><path d="M8.5 11V8a3.5 3.5 0 017 0v3"/>'];
  I.unlock = ['<rect x="6" y="11" width="12" height="9" rx="1.5"/><path d="M8.5 11V8a3.5 3.5 0 016.2-2"/>'];
  I.eye_off = [['M3.2 3.2l17.6 17.6M10.4 10.6a2.4 2.4 0 003 3M9.5 5.4A9 9 0 0112 5.2c5.8 0 9.2 6.8 9.2 6.8a12 12 0 01-1.6 2.4M6.4 6.6A12 12 0 002.8 12s3.4 6.8 9.2 6.8a8.8 8.8 0 004.8-1.4'], '', S];
  I.trash = [['M4.5 6.5h15M9 6.5V4.8h6v1.7M7 6.5l.8 13h8.4l.8-13'], '', S];
  I.code = [['M8 7L3.5 12 8 17M16 7l4.5 5L16 17'], '', S];
  I.history = [['M4.2 12a7.8 7.8 0 101.8-5M4.2 4.5v5h5M12 7.5V12l3 1.8'], '', S];
  I.plugin = [['M8 4v3.5H5.5A1.5 1.5 0 004 9v2.2h3.2V15H4v2.2A1.5 1.5 0 005.5 18.7H8V22h2.2v-3.3h3.6V22H16v-3.3h2.5a1.5 1.5 0 001.5-1.5V15h-3.2v-3.8H20V9a1.5 1.5 0 00-1.5-1.5H16V4h-2.2v3.5h-3.6V4z'], '', S];

  const _svg = Icons.svg.bind(Icons);
  Icons.svg = function (name, opts) {
    opts = opts || {};
    if (opts.stroke == null) opts.stroke = 2;
    return _svg(name, opts);
  };

  // Bigger, cleaner tool buttons (no hotkey clutter on the glyph)
  const _tb = Icons.toolBtn;
  Icons.toolBtn = function (tool, iconName, label, key, opts) {
    opts = opts || {};
    const active = opts.active ? ' active' : '';
    return '<button class="tool' + active + '" data-tool="' + tool + '" title="' + label + (key ? ' (' + key + ')' : '') + '">' +
      Icons.svg(iconName, { size: 24 }) + '</button>';
  };
})(window);
