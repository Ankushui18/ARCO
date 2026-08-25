# Penfig Design Engine v2 — Module-by-Module Audit & Roadmap

_Generated 2026-08-25 after full codebase sweep, static analysis, runtime
smoke tests (13 engine tests, 0 failures) and UI rendering verification._

This document is the source of truth for **what Penfig can do today, what must
be rewritten, what should be improved, and what new architecture we need** to
make Penfig a legitimate Figma competitor that a designer can use for an
8–10 hour day without reaching for Figma.

**Standing rules** (from ROADMAP.md §0/§2/§3/§43/§48 — unchanged):

1. §0  Honest scoring — no fake parity claims. Every gap is listed.
2. §2  `.pfg` is the authoritative native lossless format. `.fig` is
       interop-only.
3. §3  `.fig` never becomes the native model.
4. §43 Plugin sandbox honesty: Web Worker with whitelisted RPC = sandboxed;
       `new Function` fallback = local trusted mode, labeled as such.
5. §48 Figma interaction model + terminology + shortcuts, Penfig visual
       identity (not a pixel clone).
6. §50 Do NOT build: FigJam / slides / sites clones, AI generation, plugin
       marketplace, cloud SaaS, template marketplace, enterprise billing.
7. **No AI until Phase 12 (Collaboration) ships.** AI is the intelligence
   layer on top of a great editor, not a crutch for a weak editor.

---

## Priority ladder (verbatim from the product spec)

| Tier | Meaning |
|------|---------|
| **P0 — Must be perfect** | Canvas, scene graph, selection, layers, auto layout, constraints, text, vectors, components, undo/redo, import/export, stability |
| **P1 — Professional** | Variables, design systems, responsive design, prototyping, motion, assets, grids, accessibility, performance, collaboration |
| **P2 — Differentiation** | Code workflow, real data, runtime, design linting, advanced vector effects |
| **P3 — AI** | AI assistant, AI generation, AI agent, AI code, AI QA — **after P0+P1+P2 ship** |

---

## Module inventory and status

All lines counts are for hand-maintained ES module IIFEs (no build step, no
npm dependency, zero-runtime-dep promise intact).

| File | LOC | Purpose | Grade |
|------|-----|---------|-------|
| `src/model.js` | 492 | Scene graph, nodes, doc, history, IndexedDB store | B+ |
| `src/layout.js` | 356 | Auto-layout engine + constraints + resize-to-fit | B |
| `src/render.js` | 772 | Canvas renderer, text metrics, paints, strokes, shadows, rulers, guides, export raster | B |
| `src/pen.js` | 280 | Vector pen engine (cubic paths, nodes, handles, simplify, smooth) | A- |
| `src/boolean.js` | 483 | Real-geometry booleans / flatten / outline / offset / shapes | A- |
| `src/figconv.js` | 788 | `.fig` kiwi import/export | B |
| `src/tokens.js` | 328 | Design tokens (variables/modes/aliases) | B |
| `src/components.js` | 372 | Components / instances / variants / props | B- |
| `src/svgexport.js` | 128 | SVG export | B |
| `src/pdfexport.js` | 241 | PDF 1.4 export (pure JS) | B- |
| `src/shortcuts.js` | 139 | Central shortcut registry (53 bindings, 0 conflicts) | A- |
| `src/arrange.js` | 62 | Align / distribute | B |
| `src/styles.js` | 115 | Shared text/paint styles | B- |
| `src/eco.js` | 219 | Versions, comments, prototyping, annotations, codegen | C+ |
| `src/collab.js` | 123 | Multiplayer over BroadcastChannel (local) | B- |
| `src/plugins.js` | 478 | Sandboxed plugin system | B+ |
| `src/icons.js` | 246 | Inline SVG icon system (139 icons) | A |
| `src/ui-editor.js` | 2110 | Editor shell: canvas input, tools, pan/zoom, drag/resize, smart guides, pen state machine, present mode, toast, command palette | B |
| `src/ui-panels.js` | 1775 | Layers, pages, inspector, menus, context menu, export, assets, styles, tokens | B- |
| `src/ui-dashboard.js` | 603 | Dashboard, starters, `.fig`/`.pfg` I/O, thumbnails | B |
| `assets/figio.js` | — | Prebuilt IIFE: Figma kiwi schema + ZIP + SHA-1 + commandsBlob/vectorNetworkBlob codecs (354 KB) | A |
| `app.css` | 720 | Dark editor chrome, light dashboard, toolbar, panels, menus, toasts, modals, scrollbars | B+ |

---

# P0 — Core Editor (must be perfect before anything else)

## 1. Canvas & Scene Graph (`model.js` + `render.js`)

### What works today
- Figma-style scene graph: `Doc → Pages → Node tree` with parent-by-id refs
  (JSON-safe, no circular pointers).
- Node types: `frame`, `rect`, `ellipse`, `line`, `text`, `vector`, `instance`.
- Solid fills, linear gradients, image fills (fit/fill/crop modes).
- Drop shadows, opacity, 16 blend modes, rounded corners (independent per
  corner, TL/TR/BR/BL).
- Strokes (color, width, align: inside/center/outside — **center/outside/inside
  bugs fixed in this sweep**).
- Clip frames, clipping masks, frame name labels.
- Canvas rendering on a single 2D context with DPR scaling.
- Infinite dot-grid background (Figma-style), 1-2-5 adaptive rulers, magenta
  smart-guide snapping, line-grid view option.
- Selection overlay, 8 resize handles, size label, marquis selection, dev-mode
  measurements.
- 80-step undo/redo history with begin/end/cancel batching.
- IndexedDB persistence (async, debounced, localStorage fallback, quota
  warning with actionable backup action).

### P0 gaps (must fix)
| Gap | File | Action |
|-----|------|--------|
| **No rotation / skew transforms.** No `rotation` field on nodes; resize handles have no rotate affordance. | `model.js`, `render.js`, `ui-editor.js` | **Add:** `n.rotation` (radians), rotate canvas context around the node's pivot, add a rotate handle 20px above top-center, rotate-correct bounding boxes for hit-test and selection, persist in `.pfg`/`.fig` (kiwi has rotation matrix). |
| **No flip (horizontal/vertical).** | `model.js`, `render.js` | Add `flipH`/`flipV` bits, apply via canvas scale(-1,1) around pivot. |
| **No dashed / variable stroke.** Only solid strokes with width. No caps/joins controls. | `model.js`, `render.js` | Add `stroke.dash`, `stroke.cap`, `stroke.join` fields; UI in inspector; round-trip in `.fig`/`.pfg`. |
| **Image placement is minimal.** Images can be set as fill but there is no image place tool, no drag-drop import, no crop/scale-mode UI. | `render.js`, `ui-editor.js`, `ui-panels.js` | Add image place tool (drag an image file onto canvas, or click to place), image replace menu, fill-mode selector (fill/fit/crop/tile), scale % controls. |
| **Renderer is single-threaded.** Everything (layout + paint + hit-test) runs on the main thread. Large docs will jank. | `render.js`, new `worker/` | P1 target, but we must architect the seam now. |
| **Nested-template-string bugs** (re-introduce easily). | all `ui-*.js` | Switch all repetitive UI chunks to `createElement` helper or tagged-template escaping; audit after every PR. |
| **DPR-correct text is approximate.** Text is painted via `fillText` with no subpixel rendering awareness; at high DPR some text looks slightly fuzzy. | `render.js` | Use `ctx.setTransform(dpr,…)` consistently for text (already applied for most nodes but verify). |
| **No infinite canvas bounds clamping.** Zoom can go to 0.04× and 24× but panning is unbounded — easy to pan "forever" away from content. | `ui-editor.js` | Add "Return to content" zoom-to-fit if user pans >5000 px from any node (Figma does this). |

### P0 target
- 100% reliable basic editing: create, select, move, resize, rotate, nudge,
  zoom, pan — no crashes, no NaNs, no orphan nodes, no layout drift after
  undo/redo.
- Rotation + flip ship **before** any P1 work.

## 2. Selection & Multi-selection (`ui-editor.js`)

### What works today
- Click to select, shift-click to add/toggle, marquee (box) select.
- ⌘A select-all, Tab/Shift+Tab cycle selection.
- Single-selection shows 8 handles; multi-selection shows union bbox (no
  handles yet).
- Smart-guide snapping for both move and resize (edge/center + page origin,
  6 px tolerance, Alt bypass, magnet mode).
- Locked/hidden nodes are skipped during hit-test.

### P0 gaps
| Gap | Action |
|-----|--------|
| **Multi-selection has no resize handles.** Only single selection shows handles. | Add group resize with proportional-scale (Shift) and center-scale (Alt) for union bbox. |
| **Hit-test is simple rect-in-rect.** No tolerance for stroked lines, no path hit-test for vector shapes (uses bounding box). | Add a 6px tolerance hit-test for lines; add point-in-path for vectors (use `isPointInStroke`/`isPointInFill` with Path2D). |
| **Deep selection / ⌘click through is missing.** Figma lets you ⌘click to select through to the next child in z-order when a parent covers a child. | Add cycle-on-⌘click that walks the hit stack and advances selection index each click. |
| **No selection marching ants / dashed outline.** Current outline is a solid 1.5 px blue rectangle; Figma uses a dashed marching-ant stroke. | Switch selection rendering to a 1 px dash-animated outline (like Figma/Photoshop). |
| **No keyboard-driven resize/move beyond nudging.** Arrow keys nudge; Shift+Arrow nudges ×10. Missing: keyboard resize (⌘+arrows). | Add ⌘+Arrow to resize 1 px, ⌘+Shift+Arrow to resize 10 px. |

## 3. Move / Resize / Rotate

### What works today
- Move tool drag, Alt-drag duplicates, Shift constrains to axis/ratio.
- Resize with 8 handles; Shift preserves aspect ratio on corner handles; Alt
  resizes around center.
- Smart-guide snapping on both move and resize (correctly scoped to moving
  edge only for resize; fixed NaN bug).
- Text auto-resize demotion: dragging a hugging text axis fixes it.
- Constraints apply during frame resize (min/center/max/stretch/scale, H+V).

### P0 gaps
- Rotate (see canvas gap above).
- Bounding boxes don't account for rotation → hit-test and selection breaks
  once rotation lands (rotated rect uses OBB, not AABB).
- Double-application of layout — this is the **"no double layout"** rule from
  the user spec. Current engine computes layout once via `Layout.layoutPage`
  and paints from `_l`, but `_res` is also written; ensure nothing in
  `ui-editor.js` reads `n.x/n.y` for laid-out nodes when it should read `_l`.
  Audit every access to `n.x`/`n.y`/`n.w`/`n.h` in paint/selection code.

## 4. Smart Guides & Snapping

### What works today
- Edge + center alignment snap against visible nodes + page origin; magenta
  guide lines drawn.
- 6 px screen-space tolerance, Alt bypass, magnet mode (snap only while Shift
  held).
- Resize snaps only the moving edge; multi-selection snaps the union bbox.

### P0 gaps
| Gap | Action |
|-----|--------|
| No **distance/size snapping** to sibling (Figma shows the 24/48/… red gap indicators and snaps to them). | Add sibling-gap snap: when a moved edge is parallel to another edge at the same gap as other siblings, snap. |
| No **grid snap** toggle to lock to 8/16 px grid. | Add grid-snap mode (separate from the visual grid). |
| No **rotation snap** (0/45/90/… when rotating with Shift). | Add with rotation. |
| No **pixel-snap** option (snap all coordinates to whole pixels at 1× zoom for crisp rendering). | Add post-layout pixel-snap pass. |

## 5. Alignment / Distribution (`arrange.js` + inspector + shortcuts)

### What works today
- 6 align commands (left/h-center/right, top/v-center/bottom) for multi-select.
- Distribute H/V for 3+ selections (equal spacing by center).
- Inspector buttons, context menu, and ⌃⌘/ alignment shortcuts planned.

### P0 gaps
- Distribute uses centers (Figma uses equal spacing between edges for even
  distributions). Add the edge-based distribute mode.
- Tidy-up / smart-align (auto-snap to nearest grid of positions) is missing.

## 6. Copy / Paste / Duplicate

### What works today
- ⌘C/X/V cut/copy/paste, ⌘D duplicate (offset +20,+20).
- DeepClone reassigns ids; clipboard survives selection changes.
- Copy works across files within the same session (in-memory clipboards).

### P0 gaps
| Gap | Action |
|-----|--------|
| No **system clipboard interop** (can't copy a node from one Penfig tab/window to another via real clipboard). | Serialize clipboard to `application/vnd.penfig+json` + SVG fallback + PNG fallback on the system clipboard on copy; read it on paste. |
| No **paste in place** (⌘⇧V pastes at original canvas position, not +20,20). | Add shortcut. |
| Paste doesn't respect the current parent (e.g. pasting into a selected frame). | Detect selected frame parent and attach under it when possible. |
| Paste style (⌘⌥C/V) exists but only copies basic fills/stroke/radius/opacity/shadows/blur — not text, auto layout, effects. | Expand `propClip` to cover all inspectable properties. |

## 7. Undo / Redo

### What works today
- Snapshot-based history (JSON serialize/restore) with 80-step cap.
- begin/end/cancel batching for compound actions; stale-batch guards.
- ⌘Z / ⇧⌘Z wired to top bar buttons + shortcuts; correctly does not shadow
  undo/redo methods (fixed).
- History menu integration, named versions (separate from undo).

### P0 gaps
- JSON snapshots are O(n) and 80 deep — for 10K+ nodes this is hundreds of
  MB. **Rewrite to inverse-op history** (command pattern) for P1 performance.
- No undo coalescing for continuous drags (resize/move/pen-drag); each mouse
  move doesn't push (good) but the final end() coalesces into one undo step
  — verify.
- Versions keep full JSON snapshots capped at 30; large files will bloat
  storage. Move versions into the `.pfg` history log for P1.

## 8. Zoom / Pan

### What works today
- ⌘/Ctrl+wheel zoom to cursor, H hand tool, space-drag pan, ⇧1 zoom to fit,
  ⇧2 zoom to selection, Z zoom marquee (single-click shortcut only today).
- Zoom range 0.04×–24×; DPR-crisp canvas.
- Zoom % label, zoom in/out buttons, zoom-to-fit button in corner.

### P0 gaps
- No pinch-to-zoom on trackpads (wheel zoom works but trackpad pinch maps to
  wheel with ctrlKey — verify it works on Safari/Chrome/Firefox).
- No zoom-to-selected-layer on double-click in layers panel.
- No animated zoom transitions (minor polish).

## 9. Layers Panel (`ui-panels.js`)

### What works today
- Full tree with type icons, eye/lock hover-reveal buttons, expand/collapse
  carets, selection highlight, auto-layout/mask/component badges.
- Double-click to rename, ⌫ deletes, drag-to-reorder is **missing** (see P0 gaps).

### P0 gaps
| Gap | Action |
|-----|--------|
| **No drag-and-drop reparenting/reordering** in the layers panel. Biggest UX gap vs Figma. | Add HTML5 drag/drop on layer rows with insertion indicators (between/inside); commit via `M.attach` in history batch. |
| Search/filter layers (⌘F) is missing. | Add search box that filters rows by name (and type/component status). |
| Selection highlight in canvas doesn't auto-scroll the layers panel to the selected layer. | Scroll layer row into view on selection change. |
| Multi-select in layers panel (shift-click range, ⌘-click toggle) is missing. | Add proper click modifiers to layer rows. |
| Layer row context menu is limited. | Add full right-click menu (same as canvas context menu). |

## 10. Groups / Frames / Sections

### What works today
- Frame tool (F) draws frames; Section tool (S) draws dashed sections;
  ⌘G groups selection; ⇧⌘G ungroups; frame selection wraps selection in a
  frame.
- Frames clip content by default; groups do not clip.
- Resize-to-fit (shrink-wrap) for both manual and auto-layout frames.

### P0 gaps
- Group → frame conversion and vice versa is rough; groups are frames with
  `clips:false` — fine, but the UI doesn't expose "Frame / Group" as a
  toggle in the inspector.
- No frame preset sizes (iPhone/Desktop/etc.) in the frame creation flow.
- Sections have only visual styling; no page-organization semantics (they
  don't cluster layers or show in any dedicated panel).

## 11. Pages

### What works today
- Multiple pages, add/delete/rename from the Pages panel, switch via click.
- New pages are empty frames; page name shown in top bar with chevron,
  double-click to rename.

### P0 gaps
- No page thumbnails in the page panel.
- No duplicate-page or move-selection-to-page actions.
- No "Go to page" search in the command palette.

---

# Phase 2 — Layout Engine (must be one of Penfig's strongest areas)

## Auto Layout (`layout.js`)

### What works today
- Custom measure→distribute→place engine (NOT CSS flexbox — deliberate).
- Direction (H/V), wrap + independent cross-axis gap, 4 independent paddings,
  item gap, primary alignment (start/center/end/space-between/space-evenly),
  cross alignment (start/center/end/stretch).
- Per-item sizing: fixed / hug / fill (grow weight), min/max clamping,
  absolutely positioned children, align-self.
- Nested auto layout; `resizeToFit` computes hug sizes recursively.

### P0/P1 gaps — **critical, per user instruction "no double-application of layout calculations"**
| Gap | Action |
|-----|--------|
| **Wrap mode uses greedy first-fit.** Figma's wrap is smarter (stretch-to-fill-last-row, balanced rows for certain wrap settings). | Enhance wrap algorithm; match Figma's last-row stretch when container is fixed width. |
| **Space-between on wrap is wrong.** Distributes per-line rather than globally. | Compute spacing per-line. |
| **Min/max size clamping only works at top-level.** Hug items don't propagate minW/minH up correctly to parents. | Fix `measure()` to respect min/max recursively. |
| **Nested hug/fill can cycle.** Measure → distribute → remeasure can produce unstable sizes for certain nested combinations. | Add a fixed-point loop with iteration cap (Figma converges in 2-3 passes). |
| **Text + auto-layout is fragile.** Text hug sizing works, but text inside fill-width containers doesn't always re-wrap when parent width changes (relies on `textBoxWidth` reading `als.w`). | Audit every text resize path; add unit tests for wrap/rewrap regressions. |
| **No `basis` (preferred size) for fill items.** Fill items always take residual space with no minimum preferred width. | Add `als.basis` field. |
| **Stroke/effect bounds aren't included in hug measurement.** Auto layout uses `w/h` but stroke outside grows the visual size without growing the layout box. | Account for stroke alignment/shadow spread in measure. |
| **Layout is run every RAF frame.** For large docs this is the main perf bottleneck — dirty-subtree layout needed for P1. | Add dirty flags per node; relayout only ancestors of changed nodes. |
| **Constraints (for non-auto-layout frames)** don't work during resize-drag of nested frames — they apply once on pointer-up. | Apply constraints live during resize drag (like Figma). |
| **No counter-axis gap for single-row/column containers.** `gapCross` only has effect in wrap mode. | Add support. |

### P1 — Responsive
- **Layout grids** (columns/rows) exist as a visual overlay only — children
  don't snap to them.
- **Container queries** (per spec) — completely absent.
- **Aspect ratio constraint** on frames (`n.aspectRatio` field) — absent.
- **Responsive resize preview** (drag frame width and watch constraints +
  auto layout react) — this is the magic Figma devs rely on.

---

# Phase 3 — Professional Vector Editor

## Pen / Node editor (`pen.js` + boolean state machine)

### What works today (grade A-)
- Cubic Bézier paths with corner/smooth nodes; independent and mirrored
  handles; add/delete nodes on segments; convert corner↔smooth; split; join;
  close/open; pen-tool draw mode + node-edit mode (double-click a vector to
  edit).
- Pencil tool with RDP simplification + cubic-through-midpoints smoothing.
- Real-geometry booleans (union/subtract/intersect/exclude) using edge
  splitting + region parity + loop tracing; evenodd AND nonzero winding;
  flatten; outline stroke (center/inside/outside) with real miter joins;
  offset; polygon/star/triangle parametric shapes.
- Paths are stored as SVG `d` strings which round-trip through kiwi
  commandsBlob/vectorNetworkBlob (real `.fig` roundtrip verified on
  circle.fig and word-outline-stroke.fig fixtures).

### P0/P1 gaps
| Gap | Action |
|-----|--------|
| Boolean results are **polyline-flattened** (no arc preservation). Round joins on outline are chord-approximated. | Switch to arc-preserving clipping (add arc primitives to the edge data structure; this is hard — several weeks of work). |
| Outline stroke doesn't handle open subpaths. | Cap open ends (butt/round/square) and close the outline correctly. |
| Offset path has no round-join option. | Add round join support (arc approximation). |
| No **scissors / knife** tool (cut a path at a point). | Add knife drag that splits segments at intersections. |
| No **join two endpoints** command in the UI (engine has `canJoin`/`joinSubpaths`). | Expose in inspector path section + context menu. |
| No **path baking**: converting rect/ellipse/text to editable vector outlines is missing (outline stroke works for stroked shapes but "outline" for filled shapes doesn't). | Add Object → Outline / Flatten for all shapes. |
| Vector handle snapping (⌘ to constrain handles to 45°) is missing. | Add with Shift constraint. |
| No **vector network editing** (Figma's ability to have two strokes meet at a point); paths are strictly sequential subpaths. | Future hard problem — current model is SVG subpaths, which is sufficient for most UI work. |
| No **mask feathering / gradient masks**. | Masks are binary clip-paths today; add alpha mask support. |
| No **radial/conic gradients** (linear only). | Add radial gradient rendering + stop editor; conic is a P2 stretch. |
| No **mesh gradients**. | P2. |
| No **blur/effect preview on vectors**. Layer blur exists but not as a per-node Gaussian — uses `ctx.filter` where available (needs polyfill or post-processing). | Add proper effect layers in render. |
| SVG import is missing (SVG export exists but not the reverse). | Build SVG → node parser using the existing `Pen.dToNodes` path infrastructure; add Import SVG to file menu. |
| SVG export needs optimization (minify path d, merge groups, remove unused attributes). | Add `svgo`-style minification built-in (zero dep). |

---

# Phase 4 — Typography

### What works today
- Font family selector (web-safe + Inter), size, weight (100–900), italic,
  line height, letter spacing, H/V alignment.
- Figma's four auto-resize modes: `auto` (hug w+h), `auto-w`, `auto-h`,
  `fixed`; dragging a hugging handle demotes the mode.
- Text renders via canvas `fillText`; line-wrapping at box width; text edit
  via floating textarea overlay.
- Text color is bound to fills; text styles capture font/size/weight/LS/LH.

### P0 gaps
| Gap | Priority | Action |
|-----|----------|--------|
| **No rich / inline text.** All text is uniform; no per-selection bold/color/link changes. This is a top-3 P0 gap. | P0 | Add runs array: `text.runs = [{from, to, fill, weight, italic, size, font}]`; inline text editor that supports selection-scoped style changes; render each run separately; round-trip in `.fig` (Figma stores this as `characterStyleOverrides` + `styleMap`). |
| **No mixed fonts inside a text node.** | P0 | Covered by runs. |
| **Text rendering is not pixel-perfect.** Uses `fillText` with no shaping; ligatures, kerning, and complex scripts (Arabic, Devanagari, Thai) will look wrong. | P1 | Consider opentype.js (loaded lazily, not a hard dep) or use the browser's own shaping via DOM measurement off-screen. |
| **No custom font loading / @font-face.** Text always falls back to Inter/system. | P1 | Add Font Manager: drop font files (.ttf/.otf/.woff2), register via `@font-face` in an injected stylesheet, persist in `.pfg` under `fonts/`. |
| **Variable fonts / OpenType features** (small-caps, tabular nums, stylistic sets). | P2 | Expose when a loaded font exposes them. |
| **Text truncation / max lines.** Figma has "truncate text" with ellipsis. | P1 | Add `text.truncate: {lines, ellipsis: true}`. |
| **Lists (bulleted/numbered)** — Figma doesn't have these natively but they're a Penfig differentiator opportunity. | P2 | Add `text.list: 'bullet'|'number'`; draw bullet/number adornments. |
| **RTL / CJK vertical text.** | P1 | Detect direction from content; add writing-mode option (horizontal/vertical). |
| **Text on path** (the user's spec includes this). | P2 | Render text along a vector path using `getPointAtLength` emulation. |
| **Letter-spacing % vs px.** Figma uses % of font size; we use px. | P1 | Convert units to match Figma. |
| **Import/export text fidelity is fragile.** Text shifts between Figma↔Penfig today due to line-height and fonts-missing differences. | P0 | Bundle default fonts as data URIs or fall back gracefully; measure text with the actual browser font metrics. |

---

# Phase 5 — Components (`components.js`)

### What works today
- Make component from a frame, create instances that clone the source.
- Source edits flow to instances via `updateAny()`; text overrides are
  preserved (by depth-first slot path).
- Variants (component set with named variants; variant switcher in inspector).
- Instance properties (boolean toggle + text props bound to child name).
- Local libraries: link another file as a component library; insert
  instances; unlink; update-all refreshes from source.

### P0/P1 gaps
| Gap | Action |
|-----|--------|
| **Instance overrides beyond text/props are not systematically preserved.** If you change fill, size, or position of a child in an instance and then update the instance, the override is lost. | Implement an override map: `n.overrides = { childPath: { fills?, size?, pos?, text? } }` applied after re-clone, matching Figma's override model. |
| **Variant properties are flat names** (`"Primary/Large"`) instead of structured property-value pairs (`variant = { Size: "Large", Type: "Primary" }`). | Migrate component sets to variant-property matrices: `set.props = [{name:"Type", values:["Primary","Secondary","Destructive"]}, {name:"Size", values:["S","M","L"]}]`; variant name is auto-composed. |
| **Instance swap** (swap one component for another while preserving overrides) is missing. | Add swap-component picker in the inspector. |
| **Nested instances** (a component contains another component's instances) work for render but overrides don't cascade properly. | Audit nested-instance override merging. |
| **Component descriptions / docs / property panels** (Figma's component playground). | P2 feature. |
| **Publish to library** is just "link this file as library" — no publishing flow, no versioning of library components. | P1 library publishing with stable component ids across edits. |

---

# Phase 6 — Design Systems (`tokens.js` + `styles.js`)

### What works today
- Variables/modes (Light/Dark default), multiple sets, color/number/string/
  boolean types, aliases between variables, W3C DTCG export/import, CSS
  variable export.
- Live-bake writes resolved values to `_resolved` fields so the renderer is
  token-agnostic.
- Text styles + paint styles, apply from Styles panel, capture from selection.

### P0/P1 gaps
| Gap | Priority | Action |
|-----|----------|--------|
| **Token types are incomplete.** No typography token, no shadow token, no gradient token, no stroke token. | P0 | Add composite token types that bundle all fields for a style category. |
| **Semantic → Foundation layering** (per user's spec: Foundation + Semantic layers). | P1 | Add `token.layer` and UI grouping; allow semantic tokens to alias foundation tokens but not vice versa. |
| **Modes don't have values for every variable** by default (they do inherit — verify). | P1 | Add explicit per-value-mode editor. |
| **Styles don't bind to tokens.** A text style captures literal font/size/weight; it doesn't link to a typography token. | P1 | Make styles token-aware: a style can be a binding to a token plus overrides. |
| **Token collections / variable grouping** inside sets is flat; no folders. | P1 | Add nested folders. |
| **Themes / brand switcher** for the whole document. | P1 | Add theme system: a theme is a (mode, set of overrides) bundle applied at doc level. |
| **W3C DTCG compatibility** exists for JSON export but not for types like `cubicBezier`, `duration`, `fontFamily`, `dimension`. | P1 | Extend token model + import/export. |
| **Color manipulation** (tint/shade/opacify derived tokens) is manual. | P2 | Add derived token transforms. |

---

# Phase 7 — Prototyping (`eco.js` Proto section)

### What works today
- Click-to-frame and click-to-page navigation; 5 animations (none/fade/slide/
  overlay/scroll); present mode with dual-canvas transitions and interactive
  highlight (blue dashed outlines) overlay support for overlays.

### P0/P1 gaps
| Gap | Priority | Action |
|-----|----------|--------|
| Only `on click` trigger. Missing: hover, drag, scroll, key press, delay, mouse enter/leave. | P1 | Add trigger enum + UI. |
| Only navigate action. Missing: open overlay, close overlay, back, scroll to, swap variant, set variable, play/pause media. | P1 | Add actions enum; variables-change drives token/prop updates live. |
| No conditional logic ("if variable X == Y then …"). | P1 | Add condition editor. |
| Overlays don't have positioning (manual/centered/relative to trigger/…). | P1 | Add overlay position + close-on-outside-click. |
| Scroll interactions (horizontal scroll frames, sticky, scroll-to anchoring) are absent. | P1 | Add scroll containers (frames with `overflow: 'scroll'`), render scrollbars, wire scroll-triggered actions. |
| Smart animate (morph between frames by matching node names) is missing. | P2 | Diff two frames, match nodes by name/id, tween position/size/fills/opacity. |
| No animation spring/timeline/curve editor. | P2 | Add motion editor (Phase 8). |
| Prototype doesn't preview in a shareable link (would require a URL router for presentation mode). | P1 | Add `#/present/:fileId/:pageId/:nodeId` route. |

---

# Phase 8 — Motion

### Status: ⬜ Not started.

Phase 8 does not exist in code. The only motion is fade/slide transitions in
present mode. Target architecture:

```
Object (node) ← has MotionTimeline[]
  ├─ property: x, y, w, h, opacity, rotation, scale, fill, blur, radius, shadow
  ├─ keyframes: [{t, value, easing}]
  └─ playback: trigger (load, click, scroll, hover, after previous)
```

Presets: Ease / Ease In / Ease Out / Spring / Bounce / custom cubic-bezier.
Spring physics solver (stiffness/damping/mass).
Timeline UI in a bottom panel with draggable keyframes.

---

# Phase 9 — Import / Export (`figconv.js`, `svgexport.js`, `pdfexport.js`, pfg)

### What works today (grade B)
- Real `.fig` roundtrip: frames, rects, ellipses, lines, text, vectors,
  auto-layout (direction/wrap/gap/padding/align), fills/strokes/shadows,
  component/instances, variables/modes imported and exported.
- Kiwi schema is bundled (handles both old and new Figma exports by
  extracting the embedded schema).
- Real `.fig` fixtures verified (circle.fig, word-outline-stroke.fig,
  OpenFigs.fig, circle-and-rounded-rectangle-outline-stroke.fig).
- **`.pfg` v1 native format**: deterministic STORE-only ZIP with CRC32,
  manifest.json + document.json + thumbnails/thumb.png. Roundtrip verified.
- PNG export via canvas `toDataURL`, SVG via pure-string serializer (fill/
  stroke/shadow/gradients/text), PDF via pure-JS 1.4 writer (moves/curves).
- Tokens export/import (W3C JSON + CSS variables).

### P0 gaps
| Gap | Action |
|-----|--------|
| **`.pfg` v1 is minimal.** No asset deduplication, no checksums beyond ZIP CRC32, no forward-compatible schema migrations, no compressed assets (DEFLATE), no edit-history log, no recovery metadata. | Build `.pfg` v2 with all of §2 (deterministic ZIP DEFLATE, manifest version, schemaVersion per file, per-blob SHA-256, asset dedup by hash, fonts/, pages/ shard for large docs, recovery journal, optional signed history). |
| **`.fig` import loses styling fidelity** in areas: radial/angle gradients, inner shadows, background blur, stroke styles (dashes/caps), advanced effects, component properties/variants matrix. | Extend `mapNode` for each missing paint/effect; add the corresponding model fields. |
| **`.fig` export uses the openfig v101 schema** where COMPONENT is SYMBOL and instance binding goes via `overriddenSymbolID` (documented deviation: real Figma sees instances as detached). | Generate against a newer Figma schema version where `mainComponentGuid` exists; add schema version detection. |
| **SVG import is absent.** | Build SVG → node tree importer. |
| **PDF import** not needed (niche), but **PDF export needs text-as-text** (currently text renders as filled paths via canvas — need native PDF text operators for selectable text). | Add text operators to pdfexport.js with correct font embedding. |
| **JPG/WEBP/GIF import** as image fills — drag/drop an image file. | Add file-drop handler + image conversion. |
| **JSON export (scene graph dump)** exists for tokens but not for the whole doc; useful for debugging. | Add Dev-mode "Copy document as JSON". |
| **HTML/CSS/React/Tailwind/Vue/SwiftUI codegen** is a key differentiator the user called out. Currently only basic CSS/HTML in Dev mode. | Implement per-frame codegen: infer Auto Layout → flexbox, text → `<p>`, fills → background, tokens → CSS vars. Generate clean JSX/TSX + Tailwind classes. This is a P1/P2 feature but high-impact. |
| **Batch export modal** (export all frames at 1x/2x/3x/… in one click, with suffix naming). | Add batch-export UI; high leverage for handoff. |
| **Export slices** (define slice regions independent of frames). | Add slice tool + slice nodes. |

---

# Phase 10 — Performance

### Current measurements (estimated; real benchmarking needed)
- 1K nodes → smooth (60+ FPS expected) because RAF layout+paint is
  sub-millisecond for small docs.
- 10K nodes → likely jank on pan/zoom (full-document layout every frame,
  no layer culling, no display list caching).
- 50K+ nodes → will lock up.

### Target architecture (per user spec)

```
Main Thread                Worker                        GPU
├── UI                     ├── Layout                    └── Rendering
├── Input                  ├── Geometry
└── Chrome                 ├── Import
                           ├── Serialization
                           └── Bounds culling
```

### P0/P1 work
| Task | Priority | Action |
|------|----------|--------|
| Dirty-subtree layout | P0 | Only relayout changed nodes and their ancestors; add per-node `_dirty` flag. |
| Viewport culling | P0 | Don't paint nodes whose `_l` bbox is outside the visible rect (with padding). |
| RAF coalescing | P1 | Already using requestAnimationFrame — verify no double paints per frame. |
| Offload heavy work to Worker | P1 | Move layout, serialization, and `.fig`/`.pfg` import/export to a Web Worker. Rendering stays on main thread. |
| GPU rendering layer (Canvas2D → WebGPU) | P2 | Long-term; Canvas2D is fine through ~20K nodes with culling. |
| Display-list caching | P1 | Cache painted groups as offscreen bitmaps when static (like Figma's surface caching); invalidate only when descendants change. |
| Scene graph TypedArrays | P2 | For 100K+ nodes, store x/y/w/h/opacity/visibility in parallel Float32Arrays for cache-friendly traversal. |
| Benchmark harness | P0 | Add `fixtures/perf/*.pfg` synthetic docs (1K, 10K, 50K, 100K nodes) + FPS counter (already have dev-mode measurements). |

---

# Phase 11 — Professional UX

## What shipped this session
- Full CSS rewrite to Figma production quality (dark editor `#2c2c2c` panels,
  `#1e1e1e` bg, `#0d99ff` accent, 4/8/12/16/24 scale, consistent radii, custom
  scrollbars, proper hover/active states).
- 139 professional line icons (inline SVG, no external assets, zero deps).
- Top bar with undo/redo, ruler/grid/snap toggles, save, present, dev mode,
  versions, plugins, export; mode switcher with sun/moon icons.
- Floating left toolbar with tool groups, hotkey badges, active state.
- Left panel tabs (Layers/Assets/Styles/Pages/Tokens) with proper active state.
- Layer rows: type icons, carets, eye/lock, badges (Auto/Mask/Component),
  blue selection highlight.
- Inspector sections with grid-aligned inputs, icon buttons, proper headings.
- Context menu with icons for every item.
- Menus/popovers/modals with padding, icons, separators, hover.
- Toast system with success/error/action buttons.
- Light dashboard with hero banner, search, primary CTAs, file cards with
  thumbnail previews and hover actions.

### P0/P1 polish gaps
| Gap | Priority | Action |
|-----|----------|--------|
| **Tooltips** on every icon button. Current UI has `title=` attrs but no custom tooltip component (title is delayed, unstyled). | P1 | Add custom tooltip on hover (120 ms delay, 6 px arrow, small caps label + shortcut). |
| **Custom tool cursors** (pen/pencil/hand/resize/rotate/zoom). All are default/crosshair today. | P1 | Use SVG data-URI cursors. |
| **Canvas mini-map** (bottom-left navigator). | P1 | Add small bird's-eye canvas view with viewport rectangle; click/drag to pan. |
| **Infinite dotted canvas background** already draws but should be improved to match Figma's 20 px grid with major 5-line emphasis (already partially there; tune colors/scale). | P0 | Tune dot color/density to be more Figma-like. |
| **Selection marching ants.** Solid blue outline → animated dashed stroke. | P1 | Use setLineDash + lineDashOffset animation. |
| **Canvas scroll/zoom at edges** while dragging (auto-scroll when pointer is near canvas edge during drag/resize). | P1 | Add edge-zone auto-scroll. |
| **Inspector sections collapsibility.** All sections are expanded; Figma lets you collapse. | P1 | Add collapse toggles per section; remember state in localStorage. |
| **Inspector search** (search for a property by name — Figma doesn't have this, but it's a differentiator). | P2 | Add ⌘F in inspector to fuzzy-filter properties. |
| **Command palette (⌘/)** exists but needs more commands (every menu action, every tool, every style). | P0 | Expand command list to cover every action (~80–100 commands) with section grouping. |
| **Proper scrollbars** in panels matching theme. | P0 | Style scrollbars per-panel (current CSS has global scrollbar styles but panels need them applied). |
| **Accessibility**: keyboard navigation in panels, ARIA labels, focus rings. | P1 | Audit with axe; add focus styles and key handlers. |
| **Dashboard sidebar "Import" link** is wired now (fixed in this session: wired it to trigger the hidden file input). | P0 | Verified. |

---

# Phase 12 — Collaboration (`collab.js`)

### What works today
- Same-origin multiplayer via `BroadcastChannel` — works across tabs/windows
  on the same browser; peer cursors with names + colors; selections; live
  document relay (last-write-wins per revision).

### P0/P1 gaps
| Gap | Priority | Action |
|-----|----------|--------|
| **Last-write-wins loses edits** when two users edit simultaneously. | P1 | Add CRDT (Yjs is ideal — **but adding Yjs would be a runtime dependency.** Penfig stays zero-dep for the main bundle; design a minimal CRDT or use a per-operation log with epoch counters.) |
| **No server relay.** Cross-machine collaboration needs a WebSocket server. | P2 | Build tiny relay server (separate repo, optional self-host); client code already abstracts over BroadcastChannel so adding a WebSocket transport is straightforward. |
| **No cursor presence labels** (names show as single-letter dots; tooltip on hover). | P1 | Show full name on hover. |
| **Comments** exist but no threading/reactions/resolved history/mentions. | P1 | Add threaded comments, @mentions with autocomplete, resolved filter. |
| **Version history** exists as named snapshots but no visual diff, no branching, no restore preview. | P1 | Add restore preview modal; visual diff (highlight changed bounds). |
| **Share links** (read-only view URLs) are absent. | P1 | Add `#/view/:fileId` route that presents in view-only mode (no editing chrome). |
| **Permissions** (edit/comment/view) — absent. | P2 | Add file-level permission flags enforced client-side (server-side would need auth backend). |
| **Follow mode** (follow another peer's viewport) — absent. | P2 | Add. |

---

# Then AI (Phase 13 — P3)

**Only after P0 + P1 + P2 are shippable.** The AI layer sits on top of the
design graph:

```
                 PENFIG
                    │
        ┌───────────┴───────────┐
        │                       │
   DESIGN ENGINE            AI ENGINE
        │                       │
   ┌────┼────┐             ┌────┼────┐
   │    │    │             │    │    │
Canvas Layout Vector      Design Code QA
   │    │    │             │    │    │
   └────┼────┘             └────┼────┘
        │                       │
        └───────────┬───────────┘
                    │
              Design Graph
```

- AI design assistant (chat that can create/modify nodes via the plugin RPC
  API — no privileged access; it calls the same penfig API human plugins do)
- AI generation (prompt → frame with real Penfig nodes, NOT a flat PNG)
- AI agent (autonomous refactoring: "make all cards consistent", "convert
  this grid to a 12-column responsive auto layout", "swap every color
  token to dark mode accessible contrast")
- AI code (produce cleaner Tailwind/React/Vue output, fix prop naming,
  generate a11y labels)
- AI QA (contrast checks, tap-target-size lint, overflow detection,
  offscreen-element warnings, keyboard navigation audit)

The AI must operate on the structured scene graph — not on screenshots.
That's why the engine must be solid first.

---

# P0 Action plan (next implementation sprint)

Order matters. Each item is a shippable vertical slice.

1. **Rotation + flip** — model field, rendering, rotate handle, Shift
   snapping to 45°, `.fig`/`.pfg` roundtrip.
2. **Drag-and-drop layers panel reorder/reparent** — the single biggest UX
   gap; unlocks real layer management.
3. **Multi-selection resize** — union bbox handles, Shift-constrain, Alt-
   center, smart-guide snapping during group resize.
4. **Rich text (inline runs)** — runs data model, inline style toolbar,
   rendering, text edit with selection-scoped formatting.
5. **Image place tool + drag-drop import** — load image files from disk,
   create image-fill rects, scale-mode controls, replace image.
6. **Dashed strokes + stroke caps/joins** — model fields, inspector UI,
   canvas rendering, SVG/PDF export, `.fig` roundtrip.
7. **Radial gradients** — add to renderer, inspector gradient editor.
8. **Fix auto-layout edge cases** — double-layout audit, wrap last-row
   stretch, min/max recursive propagation, stroke/effect visual bounds in
   measurement, nested hug/fill fixed-point convergence.
9. **`.pfg` v2** — DEFLATE compression, per-blob SHA-256, asset deduplication,
   schemaVersion + forward-compat migrations, fonts folder, recovery journal.
10. **Batch export modal** — select scales/suffixes/formats, export all.
11. **Custom tool cursors + tooltip component** — polish pass.
12. **Benchmark harness + 1K/10K/50K node performance targets** — measure
    before optimizing so we know what's slow.
13. **Bug bash pass** — use the tool for 2 hours, file and fix every crash,
    every layout glitch, every surprise.

Ship P0 when: a designer can create a 5-page mobile app mockup with frames,
auto layout, text, components, colors, export to PNG/SVG/PDF/`.fig`/`.pfg`,
reopen after reload, import a real `.fig` file and edit for 2 hours without
once reaching for Figma.

---

# Current bugs fixed in this sweep

| # | Bug | File | Fix |
|---|-----|------|-----|
| 1 | Stroke alignment `inside` was broken (translate-only, no clip); center/else branch duplicated | `src/render.js` drawStroke | Added proper clip for inside, full-width expansion for outside, half-width for center |
| 2 | "Internal Only Canvas" page leaked into imported `.fig` files | `src/figconv.js` | Filter out internal-named and empty canvases during import |
| 3 | `Model.esc` was missing (other modules used fallback to `Dash.esc`) | `src/model.js` | Added `esc()` HTML escape helper and exposed it |
| 4 | View menu button was not in the top bar (`#ed-view` referenced but never rendered) | `src/ui-editor.js` buildChrome | Added View icon button (eye icon) wired to viewMenu |
| 5 | `Dash.exportPfgBytes`/`importPfg`/`exportFig` not exposed on the global `Dash` object (only reachable via `Dash.D.*`) | `src/ui-dashboard.js` | Exported convenience wrappers on global `Dash` |
| 6 | Boolean module was exported as `Booleans` (not `Boolean`) — already correct (used as `global.Booleans` everywhere); verified | — | No change needed; added note |
| 7 | All JS files validated with `node --check` (21/21 pass); 13 engine smoke tests pass (0 failures); 139 icons verified with 0 missing references | — | Green |

---

# Files changed this sweep

- `src/render.js` — fixed stroke alignment (inside/center/outside)
- `src/model.js` — added `esc()` helper
- `src/figconv.js` — filter internal Figma canvases on import
- `src/ui-editor.js` — added View button in top bar
- `src/ui-dashboard.js` — exposed `exportPfgBytes`/`importPfg`/`exportFig` on global Dash
- `ENGINE_V2_AUDIT.md` — this document (new)

Dev server: http://localhost:8080 — verified 200 OK for all assets; zero
build step, zero npm dependencies, double-click offline works.
