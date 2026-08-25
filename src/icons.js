/* icons.js — inline SVG icon set for Penfig.
 * Every icon is a 24×24 viewBox path (or multi-path). Use icon(name, cls, size).
 * No external assets. All icons match Figma/Sketch visual language with
 * Penfig's stroke weight (1.5) and rounded linecaps/joins.
 */
(function(global) {
  'use strict';

  // Each entry: [pathData, extraSvg, fillStyle]
  // pathData may be a single string or array of strings; extraSvg is optional raw svg (e.g. <circle>, <rect>).
  const I = {
    // ── branding ──
    logo: ['M4 20L12 4L20 20M7.5 14.5H16.5', '<rect x="2" y="2" width="20" height="20" rx="5" fill="none" stroke="currentColor" stroke-width="0"/>'],

    // ── tools ──
    move:     ['M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20'],
    frame:    ['<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M9 4v16M15 4v16M4 9h16M4 15h16" opacity=".35"/>'],
    section:  ['<rect x="3" y="5" width="18" height="14" rx="2" stroke-dasharray="2 2"/>'],
    rect:     ['<rect x="4" y="5" width="16" height="14" rx="1.5"/>'],
    rect_radius: ['<rect x="4" y="5" width="16" height="14" rx="4"/>'],
    ellipse:  ['<ellipse cx="12" cy="12" rx="8" ry="6.5"/>'],
    line:     ['M5 19L19 5'],
    arrow:    ['M5 19L19 5M19 5H11M19 5V13'],
    pen:      ['M4 20l4-1 11-11-3-3L5 16l-1 4zM14 6l3 3'],
    pencil:   ['M15.5 4.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L15.5 4.5z'],
    polygon:  ['<polygon points="12,3 21,9 18,20 6,20 3,9"/>'],
    star:     ['<polygon points="12,3 14.6,9 21,9.8 16.2,14.3 17.6,21 12,17.6 6.4,21 7.8,14.3 3,9.8 9.4,9"/>'],
    triangle: ['<polygon points="12,4 21,20 3,20"/>'],
    text:     ['M5 5V4h14v1M12 4v16M8.5 20h7'],
    hand:     ['M7 11V6a1.5 1.5 0 013 0v4M10 10V4.5a1.5 1.5 0 013 0V10M13 10V5.5a1.5 1.5 0 013 0V11M16 11V7.5a1.5 1.5 0 013 0V14a7 7 0 01-7 7h-1a6 6 0 01-5.2-3l-2.3-4a1.6 1.6 0 012.6-1.9L8 16v-5a1.5 1.5 0 013 0v1'],
    comment:  ['<path d="M21 11.5a8.4 8.4 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.4 8.4 0 01-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.4 8.4 0 013.8-.9h.5a8.5 8.5 0 018 8v.5z"/>'],

    // ── ui / common ──
    back:     ['M15 18l-6-6 6-6'],
    cursor:   ['M5 3l14 7-6 2-2 6L5 3z'],
    send_back:['M4 8l8-5 8 5M5 9v12h14V9'],
    send_front:['M4 16l8 5 8-5M19 15V3H5v12'],
    chevron_l:['M15 18l-6-6 6-6'],
    chevron_r:['M9 18l6-6-6-6'],
    chevron_d:['M6 9l6 6 6-6'],
    chevron_u:['M18 15l-6-6-6 6'],
    close:    ['M6 6l12 12M18 6L6 18'],
    plus:     ['M12 5v14M5 12h14'],
    minus:    ['M5 12h14'],
    search:   ['<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>'],
    more:     ['<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>'],
    more_v:   ['<circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/>'],
    check:    ['M5 12l5 5L20 7'],
    eye:      ['<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>'],
    eye_off:  ['<path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8M9.9 5.1A10 10 0 0112 5c6.5 0 10 7 10 7a13.2 13.2 0 01-1.7 2.6M6.6 6.6A13 13 0 002 12s3.5 7 10 7a10 10 0 005.4-1.6"/>'],
    lock:     ['<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/>'],
    unlock:   ['<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 018 0"/>'],
    trash:    ['<path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2M6 6l1 14a2 2 0 002 2h6a2 2 0 002-2l1-14"/>'],
    download: ['M12 3v12M7 10l5 5 5-5M5 21h14'],
    upload:   ['M12 21V9M7 14l5-5 5 5M5 3h14'],
    copy:     ['<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h10"/>'],
    edit:     ['M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/>'],
    grid:     ['<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>'],
    ruler:    ['<path d="M3 3l18 18-3 3L0 6l3-3z"/><path d="M7.5 10.5l-2 2M10.5 7.5l-2 2M13.5 4.5l-2 2M16.5 13.5l-2 2M19.5 10.5l-2 2" opacity=".6"/>'],
    magnet:   ['<path d="M4 4v7a8 8 0 0016 0V4M4 4h4v7a4 4 0 008 0V4h4"/>'],
    layers:   ['<path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5M2 12l10 5 10-5" opacity=".65"/>'],
    assets:   ['<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h7v7h-7z" opacity=".55"/>'],
    styles:   ['<circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c1 0 1.5-.5 1.5-1.2 0-.4-.2-.7-.5-1-.3-.3-.5-.6-.5-1 0-.7.6-1.3 1.3-1.3H16c3.3 0 6-2.7 6-6 0-5-4.5-9.5-10-9.5z"/>'],
    pages:    ['<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M8 13h8M8 17h8M8 9h2"/>'],
    tokens:   ['<path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0l-5.2-5.2a2 2 0 010-2.8l7.2-7.2a2 2 0 012.8 0l5.2 5.2a2 2 0 010 2.8z"/><path d="M10 9l-2 2M14 13l-2 2" opacity=".6"/>'],
    file_new: ['<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M12 12v6M9 15h6"/>'],
    file_import:['<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M12 18v-6M9 15l3-3 3 3"/>'],
    folder:   ['<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>'],
    image:    ['<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>'],
    user:     ['<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/>'],
    sun:      ['<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'],
    moon:     ['<path d="M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z"/>'],
    // alignment
    align_l:  ['M4 6h16M4 12h10M4 18h16'],
    align_hc: ['M4 6h16M7 12h10M4 18h16'],
    align_r:  ['M4 6h16M10 12h10M4 18h16'],
    align_t:  ['M6 4v16M12 7v13M18 4v16'],
    align_vc: ['M6 4v16M12 4v16M18 4v16', '<path d="M3 12h18" stroke-dasharray="1 2"/>'],
    align_b:  ['M6 4v16M12 4v10M18 4v16'],
    dist_h:   ['M5 12h4M15 12h4M11 9v6M13 9v6'],
    dist_v:   ['M12 5v4M12 15v4M9 11h6M9 13h6'],
    wrap_h:   ['M4 6h16M4 12h10M14 12l3-3-3-3M4 18h16'],
    fill_swatch: ['<rect x="4" y="4" width="16" height="16" rx="2" fill="currentColor"/>'],
    stroke_sw: ['<rect x="4" y="4" width="16" height="16" rx="2" fill="none"/>'],
    gradient_sw: ['<defs><linearGradient id="g1" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".4"/><stop offset="1" stop-color="currentColor"/></linearGradient></defs><rect x="4" y="4" width="16" height="16" rx="2" fill="url(#g1)"/>'],
    shadow:   ['<ellipse cx="12" cy="16" rx="8" ry="2" opacity=".35" fill="currentColor" stroke="none"/><rect x="4" y="4" width="16" height="12" rx="2"/>'],
    // arrange
    front:    ['<rect x="4" y="4" width="12" height="12" rx="1" opacity=".45"/><rect x="8" y="8" width="12" height="12" rx="1"/>'],
    forward:  ['<rect x="4" y="8" width="12" height="12" rx="1" opacity=".45"/><rect x="8" y="4" width="12" height="12" rx="1"/>'],
    backward: ['<rect x="8" y="4" width="12" height="12" rx="1" opacity=".45"/><rect x="4" y="8" width="12" height="12" rx="1"/>'],
    back:     ['<rect x="8" y="8" width="12" height="12" rx="1" opacity=".45"/><rect x="4" y="4" width="12" height="12" rx="1"/>'],
    'flip-h': ['<path d="M12 3v18M8 7l-4 5 4 5M16 7l4 5-4 5" stroke-linecap="round" stroke-linejoin="round"/>'],
    'flip-v': ['<path d="M3 12h18M7 8l5-4 5 4M7 16l5 4 5-4" stroke-linecap="round" stroke-linejoin="round"/>'],
    group:    ['<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/><path d="M11 7h6a2 2 0 012 2v4M13 17H7a2 2 0 01-2-2v-4"/>'],
    ungroup:  ['<rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="13" width="8" height="8" rx="1.5"/>'],
    frame_sel:['<rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="3 2"/>'],
    component:['<path d="M4 12l8-8 8 8-8 8z M8 12l4 4M12 8l4 4"/>'],
    instance: ['<path d="M4 12l8-8 8 8-8 8z" opacity=".6"/><circle cx="12" cy="12" r="3" fill="currentColor"/>'],
    // export formats
    svg:      ['<path d="M4 4h16v16H4z"/><path d="M8 9v6M8 9h2a1.5 1.5 0 010 3H8M16 9l-2 3 2 3M13 9l2 3-2 3" stroke-linecap="round"/>'],
    png:      ['<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/><text x="7" y="14" font-size="5" fill="currentColor" stroke="none" font-family="ui-monospace,monospace">PNG</text>'],
    pdf:      ['<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><text x="7" y="18" font-size="5" fill="currentColor" stroke="none" font-family="ui-monospace,monospace">PDF</text>'],
    fig:      ['<path d="M8 3h4a3 3 0 010 6H8zM8 9h4a3 3 0 010 6H8zM8 15h4a3 3 0 010 6H8zM14 9a3 3 0 100-6 3 3 0 000 6z" fill="currentColor" stroke="none" opacity=".15"/><path d="M8 3h4a3 3 0 010 6H8zM8 9h4a3 3 0 010 6H8zM8 15h4a3 3 0 010 6H8zM14 9a3 3 0 100-6 3 3 0 000 6z"/><text x="11" y="21" font-size="4" fill="currentColor" stroke="none" font-family="ui-monospace,monospace">FIG</text>'],
    pfg:      ['<path d="M3 7a2 2 0 012-2h8l5 5v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/><path d="M13 5v5h5"/><text x="6" y="18" font-size="4.5" fill="currentColor" stroke="none" font-family="ui-monospace,monospace" font-weight="700">PFG</text>'],
    css:      ['<path d="M4 4h16l-2 14-6 2-6-2z"/><text x="7" y="14" font-size="5" fill="currentColor" stroke="none" font-family="ui-monospace,monospace">#</text>'],
    code:     ['<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>'],
    // zoom
    zoomin:   ['<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M11 8v6M8 11h6"/>'],
    zoomout:  ['<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6"/>'],
    zoomfit:  ['<path d="M4 9V5a1 1 0 011-1h4M20 9V5a1 1 0 00-1-1h-4M4 15v4a1 1 0 001 1h4M20 15v4a1 1 0 01-1 1h-4"/>'],
    // undo/redo
    undo:     ['<path d="M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3"/>'],
    redo:     ['<path d="M15 14l5-5-5-5M20 9H9a5 5 0 000 10h3"/>'],
    // boolean ops
    union:    ['<path d="M8 14a6 6 0 100-10 6 6 0 108 6 6 6 0 01-8 4z" fill="currentColor" opacity=".2" stroke="none"/><path d="M8 14a6 6 0 100-10 6 6 0 108 6 6 6 0 01-8 4z"/>'],
    subtract: ['<circle cx="10" cy="10" r="6" fill="currentColor" opacity=".2" stroke="none"/><circle cx="14" cy="14" r="6"/><path d="M14 8a6 6 0 100 12 6 6 0 010-12z" fill="var(--bg2)" stroke="none"/>'],
    intersect:['<path d="M8 14A6 6 0 0114 8a6 6 0 010 6A6 6 0 018 14z" fill="currentColor" opacity=".25" stroke="none"/><path d="M4 14a6 6 0 016-6 6 6 0 016 6 6 6 0 01-6 6 6 6 0 01-6-6zM8 8a6 6 0 016-6 6 6 0 016 6 6 6 0 01-6 6 6 6 0 01-6-6z" stroke-dasharray="0 3 0" opacity=".7"/>'],
    exclude:  ['<path d="M8 14A6 6 0 0114 8 6 6 0 0014 20 6 6 0 008 14z" fill="currentColor" opacity=".25" stroke="none"/><path d="M14 8a6 6 0 10-6-6 6 6 0 016 6zm0 0a6 6 0 116 6 6 6 0 00-6-6z" opacity=".6"/>'],
    // present / play
    play:     ['<polygon points="6,4 20,12 6,20" fill="currentColor"/>'],
    stop:     ['<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor"/>'],
    // versions / history
    history:  ['<path d="M3 12a9 9 0 109-9"/><path d="M3 3v6h6M12 7v5l3 2"/>'],
    // plugins
    plugin:   ['<path d="M12 2l3 5 5 1-4 4 1 6-5-3-5 3 1-6-4-4 5-1z"/>'],
    // dev/code
    dev:      ['<path d="M8 6l-6 6 6 6M16 6l6 6-6 6M14 4l-4 16"/>'],
    // mask
    mask:     ['<path d="M4 4h16v16H4z"/><circle cx="9" cy="10" r="2" fill="var(--bg2)" stroke="none"/><path d="M4 20l6-6 4 4 3-3 5 5" fill="var(--bg2)" stroke="none"/>'],
    // alerts
    warn:     ['<path d="M12 2L1 21h22L12 2z"/><path d="M12 9v5M12 18v.01" stroke-linecap="round"/>'],
    info:     ['<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8v.01" stroke-linecap="round"/>'],
    // keyboard
    keyboard: ['<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h12"/>'],
    // share/collab
    share:    ['<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>'],
    // save
    save:     ['<path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z"/><path d="M17 21v-8H7v8M7 3v5h8"/>'],
    // settings/gear
    gear:     ['<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1-1.5 1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1 1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/>'],
    // bold/italic/underline/align for text section
    bold:     ['<path d="M6 4h7a4 4 0 010 8H6zM6 12h8a4 4 0 010 8H6z" fill="none"/>'],
    italic:   ['<path d="M19 4h-9M14 20H5M15 4L9 20"/>'],
    // shadow/effects
    shadow:   ['<rect x="4" y="4" width="12" height="12" rx="1.5"/><rect x="8" y="8" width="12" height="12" rx="1.5" opacity=".35" fill="currentColor" stroke="none"/>'],
    blur:     ['<circle cx="9" cy="9" r="4" opacity=".55"/><circle cx="15" cy="15" r="4" opacity=".55"/>'],
    // rotate
    rotate:   ['<path d="M21 12a9 9 0 11-3-6.7L21 8M21 3v5h-5"/>'],
    // flip
    flip_h:   ['<path d="M12 3v18M8 7l-5 5 5 5M16 7l5 5-5 5M3 12h18" stroke-dasharray="2 2" opacity=".55"/>'],
    flip_v:   ['<path d="M3 12h18M7 8l5-5 5 5M7 16l5 5 5-5" stroke-dasharray="2 2" opacity=".55"/>'],
    // crop
    crop:     ['<path d="M6 2v16h16M2 6h16v16"/>'],
    // pen node edit
    node:     ['<circle cx="6" cy="6" r="2"/><circle cx="18" cy="18" r="2"/><path d="M8 8l8 8"/>'],
    node_smooth:['<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M7 17c3-7 8-8 10-8"/>'],
    close_path:['<path d="M6 6l12 4-4 12L4 14z" opacity=".25" fill="currentColor" stroke="none"/><path d="M6 6l12 4-4 12L4 14z"/>'],
    split:    ['<circle cx="5" cy="5" r="2"/><circle cx="19" cy="19" r="2"/><path d="M5 5l7 7M12 12l7-7M12 12l7 7" opacity=".6"/>'],
    // anchors (for constraints/resize)
    anchor_tl:['<path d="M3 11V3h8" />'],
    anchor_t: ['<path d="M12 3v8" />'],
    anchor_tr:['<path d="M21 11V3h-8"/>'],
    anchor_l: ['<path d="M3 12h8"/>'],
    anchor_c: ['<circle cx="12" cy="12" r="2"/>'],
    anchor_r: ['<path d="M21 12h-8"/>'],
    anchor_bl:['<path d="M3 13v8h8"/>'],
    anchor_b: ['<path d="M12 21v-8"/>'],
    anchor_br:['<path d="M21 13v8h-8"/>'],
    // fill/stroke indicators
    fill_swatch: ['<rect x="4" y="4" width="16" height="16" rx="1.5" fill="currentColor" stroke="none"/>'],
    stroke_sw: ['<rect x="4" y="4" width="16" height="16" rx="1.5" fill="none"/>'],
    // link / alias
    link:     ['<path d="M10 14a5 5 0 007 0l3-3a5 5 0 00-7-7l-1 1M14 10a5 5 0 00-7 0l-3 3a5 5 0 007 7l1-1"/>'],
    // dash pattern
    dash:     ['<path d="M3 12h3M9 12h3M15 12h3M21 12h.01"/>'],
    // corner
    corner:   ['<path d="M4 20V8a4 4 0 014-4h12"/>'],
    // prototype
    proto:    ['<polygon points="6,4 20,12 6,20" fill="currentColor" opacity=".2" stroke="none"/><polygon points="6,4 20,12 6,20"/>'],
    // dev mode inspect
    inspect:  ['<path d="M3 12l4-8h10l4 8-9 9z"/><circle cx="12" cy="12" r="2"/>'],
    // home/dashboard
    home:     ['<path d="M3 10l9-7 9 7v10a2 2 0 01-2 2h-4v-6h-6v6H5a2 2 0 01-2-2V10z"/>'],
    recent:   ['<path d="M12 8v4l3 2"/><circle cx="12" cy="12" r="9"/>'],
    draft:    ['<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/>'],
    trash2:   ['<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6M10 11v6M14 11v6"/>'],
    duplicate:['<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V4a2 2 0 012-2h12"/>'],
  };

  function svg(name, opts) {
    opts = opts || {};
    const size = opts.size || 16;
    const cls  = opts.cls  || '';
    const sw   = (opts.stroke || 1.6).toFixed(2);
    const title = opts.title ? `<title>${opts.title}</title>` : '';
    const def = I[name];
    if (!def) {
      // graceful fallback: small square so missing icons are obvious but not broken
      return `<svg class="icon ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"><rect x="6" y="6" width="12" height="12" rx="2" stroke-dasharray="2 2"/></svg>`;
    }
    // Build inner. def[0] is the primary path(s); def[1] (if exists) is extra raw svg.
    const paths = (Array.isArray(def[0]) ? def[0] : [def[0]]).map(p => {
      // if string starts with '<' treat as raw element, else as path data
      if (p.charAt(0) === '<') return p;
      return `<path d="${p}"/>`;
    }).join('');
    const extra = def[1] || '';
    return `<svg class="icon ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${title}${extra}${paths}</svg>`;
  }

  // Button helper: icon-only action button with tooltip
  function iconBtn(name, opts) {
    opts = opts || {};
    const size = opts.size || 28;
    const isize = opts.isize || 16;
    const title = opts.title || '';
    const cls = opts.cls || '';
    const dataAttrs = Object.keys(opts).filter(k => k.indexOf('data-') === 0).map(k => `${k}="${String(opts[k]).replace(/"/g,'&quot;')}"`).join(' ');
    const active = opts.active ? ' active' : '';
    return `<button class="ibtn${active} ${cls}" style="width:${size}px;height:${size}px" title="${title}" ${dataAttrs}>${svg(name, {size: isize})}</button>`;
  }

  // Tool button: bigger (36px) with hotkey badge
  function toolBtn(tool, iconName, label, key, opts) {
    opts = opts || {};
    const active = opts.active ? ' active' : '';
    const badge = key ? `<span class="tool-key">${key}</span>` : '';
    return `<button class="tool${active}" data-tool="${tool}" title="${label}${key ? ' ('+key+')' : ''}">${svg(iconName, {size: 18})}${badge}</button>`;
  }

  // Layer-type icon (small, inline)
  function layerIcon(type) {
    const map = {
      frame: 'frame', rect: 'rect', ellipse: 'ellipse', line: 'line',
      text: 'text', vector: 'pen', group: 'group', instance: 'instance',
      section: 'section', component: 'component', arrow: 'arrow',
      polygon: 'polygon', star: 'star', triangle: 'triangle',
    };
    return svg(map[type] || 'rect', { size: 14 });
  }

  global.Icons = { svg, iconBtn, toolBtn, layerIcon, ALL: I };
})(window);
