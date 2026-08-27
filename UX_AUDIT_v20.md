# ARCO UX/UI Audit — Critic's List (v20, 2026-08-26)

Audited: dashboard, editor chrome, tool toolbar, layers/assets/pages/vars tabs,
right inspector, context menus, command palette, comment pins, present mode,
crop modal, import summary, shortcuts modal, plugins modal, version history
menu, toast system, empty states.

Severity key:
- P0 = blocker / user will quit or assume the app is broken
- P1 = major confusion, slows every session
- P2 = feels unpolished vs Figma/Sketch
- P3 = polish / delight

---

## P0 — Must fix before anyone takes it seriously

1. **No onboarding / first-run "what is this canvas" cue.**
   First open: dark checkerboard, floating toolbar, left+right empty panels,
   a blue status bar "Editing text…" only when editing. The empty state
   ("Start designing · F Frame / R Rectangle / T Text…") renders only when
   the page has zero nodes — the starter doc ships WITH nodes, so the
   empty state NEVER appears. A brand new user stares at pre-baked content
   they don't recognize, with no tour, no way to know they can just click
   and drag, no hint about pan/zoom.
   Fix: ship an actual blank starter doc OR show a one-time coach overlay on
   first open ("Press V to select · drag on canvas to draw · scroll to pan"),
   and add a tiny "?" help button in the top-right that opens shortcuts.

2. **Save button says "Save" but saves to this-browser storage with zero
   explanation.** New users see "Saved to this browser" toast and panic —
   "where is my file? Is it in the cloud? Do I have an account?" The product
   promise (no account, offline-first, `.pfg` export-native) is the headline
   differentiator but the UI hides it. There is no "Download .pfg" / "Export
   .fig" affordance next to Save; export is hidden under the export-submenu
   only. Fix: (a) after first save show a persistent tiny banner "Files stay
   on this device — export .pfg to back up" with an "Export now" button;
   (b) rename the primary button "Save to browser" or split into
   Save (local) | ▾ Export; (c) add an "Export .pfg" entry next to Save.

3. **Top bar center is empty dead space 99% of the session.**
   Figma shows the file name + page name + a sharing avatar cluster + a
   zoom-percent in the middle; ARCO puts a "Dark/Light mode" segment there
   (two sun/moon icons) which is a setting you click once a month. The
   zoom% lives buried in the bottom-right zoom control; there is no
   collaboration-status, no "present" button, no quick-share.
   Fix: move the dark/light toggle into the View menu (⇧D or the eye icon)
   and use the center for: file name (large) · page chevron · (spacer)
   · zoom % · present/play button · share. That immediately looks like a
   serious design tool.

4. **Selection chrome is invisible on dark canvases / no hover
   highlight.** When you click a dark shape on the dark #383838 canvas, the
   selection box is drawn in the Figma-blue accent — that works — but hover
   state on the canvas is "default" cursor only. Figma draws a subtle 1px
   outline on hover; ARCO draws nothing. Users have no idea what is
   clickable. Fix: add a hover-highlight pass in drawSelection
   (semi-transparent blue outline on the hovered node when tool==='move').

5. **You cannot tell which tool is active from the canvas cursor alone
   once you've clicked.** Move tool shows `default` arrow, text shows `text`
   I-beam, shape/pen/frame show `crosshair` — fine — but as soon as you press
   space the cursor becomes `grab` even though you haven't started panning,
   and it never returns to `default` when you release space while hovering a
   text node (the keyup fix from this pass handles the flag but the cursor
   isn't re-synced). Fix: centralize cursor state in `updateCursor()` that
   runs on every onMove, keyup, setTool, endTextEdit.

6. **Pan / zoom muscle memory is broken.**
   - Figma/Sketch: Space+drag pans, trackpad pinch zooms, ⌘+scroll wheel
     zooms. ARCO wheel: `wheel` listener does `preventDefault()` and
     treats plain wheel as pan (shift+wheel = horizontal), Ctrl-wheel =
     zoom. This is the opposite of Figma and will make every designer
     motion-sick within 30 seconds.
   - Trackpad pinch is not detected (no `wheel.deltaY` with ctrlKey on
     Mac trackpads maps to pinch, but many trackpads send it as wheel
     with ctrlKey=false and small deltaY).
   Fix: match Figma exactly — plain wheel = vertical pan, Shift+wheel =
   horizontal pan, ⌘/Ctrl+wheel = zoom around cursor, trackpad pinch =
   zoom around gesture center. Zoom should be smooth (accumulator exists
   but feels jumpy because _wheelZoomAcc resets per-event incorrectly on
   trackpads).

---

## P1 — Will frustrate in the first hour

7. **Left panel tabs have no labels, only icons.**
   Four 14px icons (layers/assets/pages/tokens) on a dark 40px bar. The
   "tokens" tab (grid icon) is unguessable. Hover title attributes exist
   but designers expect labeled tabs for primary navigation, especially
   because Figma uses icon+label for Layers/Assets/Components/Pages.
   Fix: icons + text labels stacked, OR at minimum a visible tooltip on
   hover with keyboard shortcut. Add a Components tab (currently buried
   inside Assets).

8. **Layers panel has no type-to-search focus, no renaming on slow
   double-click, no right-click context menu parity.**
   - Clicking a layer row selects on mousedown (good) but there is NO
     inline rename — you have to right-click → Rename. Figma: slow
     double-click on the layer name renames.
   - No layer search autofocus (⌘/ doesn't filter layers; there is a
     `ly-search` input but it's not auto-focused when switching to the
     layers tab).
   - Layer hover doesn't highlight canvas (Figma highlights the object
     on layer hover).
   - Layer icons are the generic layer type glyph but there is no
     opacity/lock/visibility toggle per row (lock and hidden exist in
     the model but not rendered in the row).
   Fix: add the three toggle dots (visible / lock / mask) per row; add
     inline rename; add hover-to-highlight-canvas; ⌘F focuses layer
     search.

9. **Right inspector has no "Design / Prototype / Inspect" tab
   switcher.** Figma groups the right rail into three tabs so the panel
   never becomes a 3000px scroll. ARCO dumps everything (Position,
   Size, Rotation, Constraints, Corner radius, Fills [n], Stroke,
   Effects, Auto layout, Layout [item], Text, Fill-mode, Export,
   Interactions) in one scrolling list. On a 768px-tall laptop, once you
   select a text node that has fills + stroke + effects + auto layout
   + text properties, the panel is 2000px tall. Fix: introduce
   Design / Prototype / Inspect tabs, and collapse sections by default
   (Stroke, Effects, Export set, Constraints) until expanded.

10. **Number inputs don't support scrubbing, math, or ↑/↓ nudge.**
    Figma lets you drag a label to scrub values, type `16+8` or `16*2`,
    and press ↑/↓ (Shift+↑/↓ for 10x) to nudge. ARCO number inputs are
    plain `<input type="number">` — no scrub, no math, Shift+arrow
    doesn't step by 10, Tab-to-next works but Shift+Tab is intercepted
    by the browser (it blurs the textarea too). Fix: custom number
    input component with scrub-on-label-drag, math eval, ↑/↓/⇧↑/⇧↓
    nudge, ⌘↑/⌘↓ for ×10.

11. **Fills/Strokes section is overwhelming and mis-ordered.**
    - The fill type (solid/linear/radial/image) is a tiny dropdown that
      blends with the hex input. Figma uses 4 icon buttons (solid swatch,
      gradient, image, none).
    - There is no visible "+" to add another fill — you have to right
      click or hunt for a button.
    - The color picker is a native `<input type="color">` (4mm square
      with no hue/saturation/alpha controls). Real design work needs
      HSB sliders, hex/RGB/HSL fields, alpha %, eyedropper, and a
      saved-colors swatch row.
    - No "Swap fill/stroke" shortcut, no "default fill/stroke" (D key).
    Fix: rebuild fills panel Figma-style: swatch-row with fill-type
    icons, HSB+opacity sliders inline, eyedropper, + add fill, blend
    mode per fill, style/token chip.

12. **Canvas panning indicator: no "grab" affordance, no "press H or
    Space" hint.** The hand icon in the toolbar shows "Hand (H)" in a
    tooltip but when Space is held the cursor doesn't change to an open
    hand until you start dragging. Fix: Space-keydown → switch cursor to
    open hand immediately; on-drag → closed fist (`grabbing`).

13. **Selection handles are white 7px squares with no dark halo — on
    light/white fills they vanish entirely.**
    Figma draws a 1px blue outline AND white handle squares with a 1px
    blue outline so they're visible on any background. ARCO handles
    render with a hard-coded white fill and no contrast border (look at
    drawSelection in render.js). Fix: always draw handles with accent
    border + white fill, 8px with 1.5px stroke, regardless of background.

14. **Marquee selection is a thin blue 1px line with no fill.**
    Figma uses a 1px blue outline + 10% blue fill. ARCO draws no
    fill (only a line) — very easy to lose track of when dragging on a
    dark canvas, especially at zoom. Fix: add `rgba(13,153,255,0.10)`
    fill to the marquee rect.

15. **No rulers-interaction: you can see rulers (⇧R toggles) but you
    cannot drag guides out of them.** Designers expect this from the
    first minute. Fix: add draggable guides from rulers; store per-page
    in `page.guides`; snap to them; lock/unlock; clear all.

16. **No "zoom to selection" keyboard shortcut feedback.**
    Shift+2 works (bindings exist) but the shortcut isn't discoverable
    — the zoom widget in the corner has only +/−/fit/100. Add a
    "Zoom to selection" icon button and bind Shift+2 visibly.

---

## P2 — Polished-tool gaps (people will compare to Figma and say "feels early")

17. **Top bar Save/Export buttons look identical (same `ed-btn` style,
    Save just happens to be accent-blue).** "Save" is the most-pressed
    button in the app; it should be unmistakable. The "Share" label is
    misleading — right now it just shows a toast "Saved to this
    browser". Figma's "Share" opens a collaboration dialog. Either
    implement a real share (link/share-to-web for static snapshot) or
    rename to "Local only" / "Export".

18. **Undo/Redo buttons are permanently dim until there's history, but
    they have no disabled-state tooltip ("Nothing to undo") and no
    badge/count.** Minor but you find yourself clicking them wondering
    if they work.

19. **Filename input is not obviously editable.** It looks like a plain
    label until you hover. Add a subtle pencil-on-hover or a hover
    background that looks interactive. Also, editing it saves but does
    not flash any confirmation.

20. **Toolbar tool buttons have the shortcut key (V, R, T…) in a tiny
    8px `.tool-key` span that only appears on hover.** Figma shows the
    keycap inside the tooltip (e.g. "Text (T)") — ARCO has it in the
    `title` attribute, which is correct, but there's no visual way for
    a new user to discover shortcuts without hovering each button.
    Consider showing the keycap in the corner of the icon permanently
    at ~10px with 40% opacity, like Figma does after first use.

21. **Toolbar groups are not visually grouped.** The toolbar lists:
    Move · Frame · ▭ Rectangle · ◯ Ellipse · ╱ Line · ↗ Arrow · (sep) ·
    Pen · Pencil · (sep) · T Text · ✋ Hand · 💬 Comment. The
    relationship between Frame vs Rectangle is wrong: in Figma, Frame
    and Slice/Section are in their own group ABOVE shape tools, then
    Shape tools (rect/ellipse/line/arrow/polygon/star), then Pen/Pencil,
    then Text, then Hand, then Comment. Right now Frame is visually
    equivalent to a shape tool — new users will try to draw rectangles
    with it. Also missing: Polygon / Star are in the command palette
    but not in the toolbar (accessible only via shortcuts). Add a
    shape-flyout (long-press or click-and-hold on Rectangle) like
    Figma/Sketch.

22. **No color-swatch chip next to the filename for the current-user's
    multiplayer color.** Since collab is implemented (peers, cursors,
    avatars) you should show your own avatar dot in the top-right so
    users know multiplayer is on.

23. **Context menu (right-click) ordering is random-ish.** It has
    "Edit text" / "Copy" / "Paste here" / "Duplicate" / "Toggle mask" /
    "Group" / "Ungroup" / "Ungroup to frames" / "Copy properties" /
    "Paste properties" / "---" / "Bring forward" / "Bring to front" /
    "Send backward" / "Send to back" / "---" / "Copy as PNG" / "Copy as
    SVG" / "Copy as CSS" / "---" / "Add comment" / "---" / "Rename" /
    "Delete". Figma groups it as: Copy/Paste/Duplicate — separator —
    Copy as/Paste over — separator — Group/Ungroup/Frame selection —
    separator — Arrange (with submenu) — separator — Mask/Boolean —
    separator — Copy/Paste properties — separator — Add comment —
    separator — Rename/Delete. Reorder to match, and add icons to
    context menu items for fast scanning.

24. **The "Copy as CSS" / "Copy as SVG" outputs should be previewable.**
    After copying there is no toast confirming "CSS copied to
    clipboard" — users don't know if it worked. Fix: toast on every
    copy-as action.

25. **Version history menu is a plain list with no thumbnails.** Figma
    shows an autosave timeline with named versions + timestamp + canvas
    thumbnail. A list is fine for v1, but add a timestamp (not just
    "Auto-saved") and a "Name this version" input so the feature is
    useful.

26. **Comment pins are a rotated blue diamond ("pin-head rotate(-45deg)")
    with a white border. They look like bug markers, not Figma's
    speech-bubble pins, and they don't pulse/open smoothly.** The open
    popover appears instantly at the pin with no caret arrow pointing
    back to the pin. Fix: add a small CSS triangle/pointer on the pin
    popover.

27. **No alignment / distribute buttons anywhere visible.**
    There are shortcuts (⌥⌘H/V for alignment?) but no toolbar/inspector
    row of alignment icons. Figma puts a 6-icon alignment row + 6
    distribute icons + Tidy up at the top of the right inspector (or
    in a floating row under the selection for multi-select). Add an
    "Align & distribute" section in the inspector when 2+ nodes are
    selected.

28. **Layer panel indent depth is only 12px; nested groups are hard to
    scan.** Figma uses 16px + a 1px tree-connector line. ARCO uses a
    fixed padding-left (n*something small) with no connectors. Add a
    subtle vertical guide line or widen indent to 16px.

29. **Right panel is 280px wide and cannot be resized.** Figma lets you
    drag the divider between canvas/inspector/layers. For an app with
    long inspectors, a draggable divider is expected.

30. **Inspector section headers (Design/Prototype/Inspect don't exist;
    section headers are "Position"/"Size"/"Rotation"/"Constraints"/"Corner
    radius"/"Fill"/"Stroke"/"Effects"/"Auto layout"/"Layout"/"Text"/
    "Export"/"Interactions") are 11px UPPERCASE with 0.06em letter-spacing
    and color `--txt-faint` (#6e6e6e) — too faint on a dark #2c2c2c
    background, hard to scan at a glance. Use 600 weight, 10.5–11px,
    #a9a9a9, and add a subtle 1px top border to anchor each section.**

31. **Stroke width default is 1 (good) but stroke alignment defaults to
    "inside" always, which is not the Figma default (center). Also
    strokes have no visible "stroke on/off" switch — the stroke shows
    only after you change width from 0. Add a visibility toggle per
    stroke just like fills.**

32. **Export is a button with no panel.** Figma has an Export section at
    the BOTTOM of the inspector showing the format/size suffix (e.g.
    "Export 1x PNG", "+ Add export setting"). ARCO opens a modal
    every time. A modal is OK for batch export, but a quick "Export
    selection as…" row in the inspector (with 1x/2x SVGs PNGs PDF JPG)
    is the standard designers expect.

33. **Command palette (⌘/) lists commands in a static order and the
    input doesn't fuzzy-search across shortcuts/layers/menus.** It
    searches only against `label + kw`; the first item on open is
    "Frame" alphabetically instead of "recently used". Fix: prioritize
    by recent usage, allow fuzzy/typo matching ("rr" → Rectangle), and
    include pages + layer names in the search scope (Figma lets you
    jump to layers via ⌘P).

34. **No undo/redo stack indicator.** When you press ⌘Z there is no
    floating "Undo: Move rectangle" tooltip; the status bar is in the
    bottom-left and it just shows the last drag coordinate, not the
    undo context. Figma shows a transient toast "Undid move" / "Redid
    create rectangle".

35. **Status bar (`.ed-status`) is positioned left:28px bottom:16px —
    directly under the floating toolbar!** When you draw a rectangle
    the width/height label appears at the same Y as the zoom controls
    on the right but on the left it sits RIGHT BENEATH the toolbar.
    Move it to bottom-center, above the zoom widget, like Figma's
    centered status, or right-align it.

36. **Zoom controls (±/100%/fit) look identical to every other icon
    button — no grouping, no current zoom% emphasis.** The 100% button
    should be a slightly wider, non-round or pill-shaped label showing
    the zoom level, clickable to type a zoom %.

37. **Grid (⇧G) draws but there is no UI to change grid size/color.**
    Figma adds a "Layout grid" section to the inspector when a frame
    is selected, supporting columns/rows/grid with color + opacity.
    ARCO has grid toggle only.

38. **"Present" mode exists (⇧K) but the present-bar exit button says
    "X Exit" with a close icon at the far right; there are no prev/next
    frame arrows, no "Restart" flow, and clicking an interaction target
    navigates with no transition (fade/slide flags exist but the
    transition classes aren't animated, just opacity swap).** Add fade
    (300ms) and slide (350ms cubic-bezier(.2,.8,.2,1)) as actual CSS
    transitions, not instant swap.

39. **No Figma-style "Quick actions" hint at the bottom of the screen on
    first launch.** Figma shows "Try: ⌘/ for quick actions, ⇧1 to zoom
    to fit, F for frame". This alone would cure 80% of "how do I…"
    friction.

40. **Crop modal exists (from p0-fixes) but the crop handles aren't
    draggable from the modal preview — you can only type numeric crop
    values. Crop needs WYSIWYG drag handles on the image preview.**

41. **Plugins modal shows a textarea to "paste plugin JS" but there is
    no example, no safety warning ("plugins run with full access to
    your document"), and no plugin marketplace. Either hide it for v1
    or ship 3 built-in example plugins (e.g. Unsplash, Iconify placeholder,
    Lorem ipsum) so the feature isn't a trapdoor.**

42. **File import (drag .fig onto canvas) works but the progress modal
    says "Working…" with a generic progress bar. When it finishes, the
    summary shows 0 nodes 0 pages 0 tokens if anything went wrong —
    users can't tell whether import succeeded without counting.
    Always show a success/failure state icon + an "Open file" vs
    "Close" primary action (currently it always says "Open file").**

43. **"Dev Mode" (D key) is advertised in the palette but there is no
    visual indication you are IN dev mode — no red/blue top bar stripe,
    no inspect/Code panel expansion, no measurements. The toolbar
    hides (existing code: `tb.style.display = this.devMode ? 'none' : ''`)
    — that's all it does right now! Ship a real Inspect tab or remove
    the toggle from the palette.**

---

## P3 — Polish / delight

44. **No sound/haptic/visual feedback on export/save complete.** Even a
    subtle checkmark pop next to the Save button for 600ms is enough.
45. **When you hover the canvas corner resize handles, the cursor
    doesn't change to nwse-resize / nesw-resize (this is partially
    implemented but only when hovering within 9px of the handle — the
    rotate-interaction wrapper overrides cursor on hover).**
46. **Tooltip styling is browser-default (title attribute). Figma uses
    custom tooltips with keyboard shortcut in a secondary opacity. Add
    custom `data-tooltip` styling so all tooltips look consistent.**
47. **Empty inspector (nothing selected) says "Select layers to view
    properties" — but it should ALSO show a row of quick actions:
    Import file, New Frame (F), New Text (T), Draw Rectangle (R),
    Shortcuts (?).**
48. **Dashboard sidebar: "Recent" / "Drafts" / "Projects" — but Drafts
    and Projects don't exist yet. Either implement or hide the
    placeholders so they don't read as broken.**
49. **Dashboard file cards have hover "Open / Duplicate / Delete /
    Export .fig" actions but the buttons appear instantly with no fade.
    Add a 120ms fade/slide transition and a right-click menu on the
    card for parity.**
50. **The ARCO logo in the dashboard is just the letter "A" chevron
    logo icon + the word "ARCO". Add a proper app icon / mark (the
    current `logo` path `M4 20L12 4L20 20M7.5 14.5H16.5` draws a sharp
    "A" — tweak it to be more distinctive, a little rounder, maybe add
    a subtle serif tail so it reads as a design-tool logo, not a
    generic chevron).**
51. **Canvas background is hard-coded #383838 dark gray. Figma lets you
    toggle Light/Dark/Canvas from the view menu and pick a custom
    color. The canvasColor view state exists and syncViewToggles
    already sets wrap.style.background, but there is no UI for changing
    it. Add a "Canvas color" submenu in the View menu with 4 swatches
    (Light #e5e5e5 / Dark #383838 / Black #000 / Custom…).**
52. **When you duplicate a selection (⌘D), the duplicate is offset
    +20,+20 and stays selected but there's no "smart duplicate" where
    repeated ⌘D steps by the same delta (Figma behavior). Implement
    smart duplicate (remember last drag delta).**
53. **"Paste to replace" doesn't exist.** Figma lets you copy a shape,
    select another, press ⇧⌘R to replace (same position/size). Useful
    for swapping icons.
54. **No keyboard shortcut for "Toggle sidebar" (⌘\ in Figma) or "Focus
    canvas" (⌘. / hide all UI for screenshots).**
55. **No option to toggle the toolbar orientation (vertical vs
    horizontal) or snap it to different corners.**

---

## Visual system issues

56. **Border radii are inconsistent:**
    - Toolbar: `10px` (border-radius)
    - Buttons: `6px`
    - Segmented controls: `var(--r2)=6px`
    - Inputs: `var(--r2)=6px`
    - Modals: `var(--r4)=10px`
    - Cards (dashboard): `var(--r3)=8px`
    - Toast: `var(--r3)=8px`
    Figma uses 6px for small interactive elements, 8px for popovers,
    12px for modals. The current mix reads as "close but not
    intentional". Standardize: small=4px, buttons/inputs=6px, cards/
    popovers=8px, modals=12px.

57. **Shadows are all the same `0 8px 24px rgba(0,0,0,.42)`
    (`--sh-popover`) with a secondary `--sh-raised` unused. Figma
    layers shadows (small nearby vs distant popover vs modal) to
    convey hierarchy. Add a `--sh-sm`, `--sh-md`, `--sh-lg` scale.**

58. **Text hierarchy uses only one small-caps-uppercase style for
    section labels. There's no `--txt-sm`/`--txt-xs` token set, so
    status text, tooltips, and empty-copy all end up at 11–12px with
    no distinction. Define: label (10.5/1.4/600/uppercase), body
    (12/1.4/400), body-strong (12/1.4/600), section title (11/1.3/700),
    heading (13/1.3/600 for modal titles).**

59. **Color tokens `--accent-soft` is `rgba(13,153,255,.18)` — used for
    selection highlight AND active button background AND focus rings,
    which means a selected layer row, a hovered button, and a focused
    input all look the same shade of blue. Introduce
    `--accent-soft-hover` (0.08), `--accent-soft-active` (0.18),
    `--accent-ring` (0.35) so they differ.**

60. **Toolbar active-state styling is `background:#0d99ff; color:#fff`
    with a 0 1px 3px blue shadow — good — but the pressed state
    (`:active`) uses `transform: scale(0.93)` which feels cartoonish on
    every tool switch. Drop to 0.97 or just use a color shift.**

---

## Engineering-adjacent UX issues

61. **`ed-top` has `-webkit-app-region: drag` but the filename input
    and top buttons use `no-drag`, which is correct for Electron/Tauri
    — but on web, `-webkit-app-region: drag` makes the whole top bar
    undraggable as a selection target (text selection on the filename
    works but selecting text NEAR the filename starts a window-drag in
    Tauri). Test on Tauri builds.**

62. **Canvas is `touch-action: none` — this kills iOS Safari pinch-zoom
    and two-finger pan. For a web-first design tool, touch support
    should at minimum allow two-finger pan/pinch. Change to
    `touch-action: none` only when a pointer is captured during a
    drag; default to `touch-action: pan-x pan-y` so trackpads keep
    working.**

63. **Resizing the window triggers a single `ResizeObserver` callback
    that calls `resizeCanvas()` + `markDirty()` — good — but there's no
    debounce on the rAF, so dragging the window edge redraws at 60fps
    even though the canvas is also size-changing; on low-end laptops
    this causes flicker.** Add a debounce or cancel the in-flight rAF
    on repeated resize.

64. **When a modal is open, ⌘Z/⌘S/⌘E still fire against the canvas and
    undo/save/export behind the overlay. Modals should intercept
    keyboard at the capture phase the same way text editing now does,
    or App.onKey should early-return when any `.ed-modal-backdrop` is
    in the DOM.**

65. **When deleting the last node on a page, the "Start designing"
    empty state re-appears — good — but the zoom level and pan are
    stuck wherever you were; zoom-to-fit doesn't auto-run, so the
    empty state text may appear off-screen.**

66. **Press-and-hold on a tool to reveal alternatives (e.g. hold on
    Rectangle to get Ellipse/Line/Polygon/Star) doesn't exist. Figma
    uses this heavily. Easy to add with a 250ms `setTimeout` on
    mousedown over a tool button that opens a radial/pie menu.**

67. **Scrollbars in panels are forced to 12px width (CSS) with custom
    dark styling; on Windows/Linux this works but on macOS with
    "always show scrollbars" off, the 12px gutter still takes up
    space even though the thumb is invisible. Detect overlay
    scrollbars or use `scrollbar-gutter: stable`.**

68. **Pasting an image from clipboard doesn't place it on the canvas
    (only drag-and-drop from file works). Figma lets you ⌘V an image
    you copied from a browser and it lands as an image fill. Hook up
    `paste` event on the canvas to read `e.clipboardData` for image
    blobs.**

---

## Quick wins (low effort, high impact)

69. Add "Press ? for shortcuts" to the canvas empty state.
70. Add ⌘\ to toggle left sidebar, ⌘⇧\ to toggle right sidebar.
71. Add a "+" affordance in the Fills section header to add a fill.
72. Add a visible cursor when panning (closed-hand) instead of the
    browser's default grabbing (which looks inconsistent across OSes).
73. When the color picker input is focused, also respond to number
    keys / hex paste (currently it only opens the native picker on
    click).
74. On the dashboard, if there are zero files (after user deletes
    them), show a proper empty state instead of a blank grid.
75. Add `loading="lazy"` is N/A (no images) but add `will-change:
    transform` on the canvas during zoom to hint the compositor.

---

## Recommended order of attack

1. This week (1–2 days): #1 (first-run coach + fix empty state to show
   on starter doc too), #5/#12 (cursor centralization + pan/zoom
   muscle-memory fix), #13/#14 (selection handles + marquee fill),
   #64 (modals trap keys).
2. Next sprint: #2/#3 (Save/Export re-do and top bar center real
   estate), #7/#8 (left panel labels + layer panel basics),
   #10 (scrubbable number inputs), #11 (fills panel rework),
   #27 (align/distribute buttons).
3. Next month: #9 (Design/Prototype/Inspect tabs + collapsible
   sections), #15 (guides), #29 (resizable panels), #40 (visual crop),
   #51 (canvas color picker), #66 (tool long-press flyouts).
4. Polish pass: #56–#60 (visual tokens), #44–#46 (delight + tooltips),
   #52 (smart duplicate).
