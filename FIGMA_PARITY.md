# X Native vs Figma Design — Parity Matrix

Interface reworked in v0.12 to mirror Figma's five interactive areas
(per "Explore design files" / "Tour the interface"):

| Figma area | Figma behavior | X Native now |
|---|---|---|
| Toolbar | Floating bar at the BOTTOM of the screen | ✅ floating bottom bar, centered, 10 tools, active highlight |
| Left sidebar (File tab) | PAGES panel above LAYERS panel, Find, Assets | ✅ PAGES section (click to switch, + NEW PAGE), LAYERS with FIND filter, ASSETS with component diamonds |
| Right properties panel | **Design / Prototype tabs** | ✅ tab switcher; Design = position/size/rotation/opacity/fill/layout; Prototype = link destination buttons |
| Canvas | Infinite, scrollable, zoom to cursor | ✅ pan/zoom/zoom-to-fit/100% |
| Nav bar | file-level workflows | ➖ partial (top strip holds title/status/zoom) |

## Tools (Figma toolbar doc)
| Figma | X Native |
|---|---|
| Move (V) | ✅ V |
| Hand (H, space-hold) | ✅ H + space-hold |
| Scale (K) | ✅ K, subtree scaling |
| Frame (F) + presets | ✅ F + PHONE/TABLET/DESKTOP/WATCH/SLIDE presets |
| Rectangle (R) / Line (L) / Ellipse (O) | ✅ R / L / O |
| Polygon / Star | ✅ P / S (real vector paths) |
| Text (T) | ✅ T (drag-create, double-click inline edit) |
| Pen / Pencil | ❌ (vector data model exists; no interactive pen yet) |
| Comments / annotations | ❌ (multiplayer feature) |
| Dev Mode | ✅ engine: per-node CSS export |

## Design-tab properties (right-sidebar doc)
Position/size ✅ (typed fields) · rotation ✅ · opacity ✅ · corner radius ✅ (engine, per-corner) ·
constraints ✅ (engine pins) · auto layout ✅ (direction/gap/padding UI; align/space-between in engine) ·
fill ✅ (solid palette; gradients in engine) · stroke ✅ engine · effects ✅ drop shadow ·
blend modes ✅ engine · components ✅ (Ctrl+K, assets, instances) · export ✅ SVG (Ctrl+E)

## Prototype tab (doc)
Interactions on click ✅ · navigate-to-page ✅ · smart animate ✅ (350ms ease) ·
presentation mode ✅ (Ctrl+P, click-through, Esc) · flow starting points ❌ · scroll behavior ❌

## View options (docs)
Rulers+guides ✅ Shift+R · outline view ✅ Ctrl+Y · hide UI ✅ Ctrl+. ·
zoom-to-fit/100% ✅ Ctrl+1/Ctrl+0 · minimap ✅ (Sketch) · nudge 1/10 ✅ (Figma defaults)

## Biggest remaining gaps vs Figma
1. Real font rendering/shaping (segment font is a stand-in)
2. Pen tool interactivity, boolean ops
3. Multi-fill/stroke stacks, gradient EDITING UI
4. Comments, multiplayer, variables UI, Dev Mode UI


## v0.13 behavior-parity upgrades (this round)

| Figma behavior | Status |
|---|---|
| Click selects top-level object; Ctrl+click deep-selects | ✅ `click_figma` |
| Double-click drills one level into groups/frames | ✅ `drill_into` (lands on Text -> inline edit) |
| Esc selects parent, then deselects at top | ✅ |
| Alt+drag duplicates then moves the copy | ✅ |
| Magnetic snapping while moving (edges + centers pull) | ✅ `snap_delta` (4px/zoom) with red guides at exact alignment |
| Ctrl+G group / Ctrl+Shift+G ungroup (positions preserved) | ✅ |
| Ctrl+A select all; scoped inside a selected frame | ✅ |
| Alignment row in Design panel (L/C/R/T/M/B), multi-select + single-to-page | ✅ |
| Constraints panel (pin L/R/CH/SH/SC x T/B/CV/SV/SC), undoable | ✅ |
| Shift+resize aspect lock, Shift+rotate 15° snap, Shift+nudge 10px | ✅ (previous rounds) |
