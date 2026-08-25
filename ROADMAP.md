# Penfig — Complete Product Update Specification (Roadmap)

This document is the product update specification pasted by the user (2026-08-25),
persisted as the roadmap of record. The user's instruction: **“update all this
changes.”** Work is executed in the spec's own implementation order (§49).

> **North Star (verbatim, spec §52):** “Build Penfig as a **standalone,
> offline-first professional design tool**… **Figma-level interaction model +
> professional feature coverage + completely local/offline capability +
> Penfig-native file format.**”

## The standing rules (always in force)

- **§0 — Honest scoring.** “Do **not** treat the current 88% ecosystem score as
  the actual Figma parity score.” Every score in the README is a *measured*
  value for a named dimension; gaps are listed next to the number.
- **§2 — Native format.** “The `.pfg` format becomes the **authoritative native
  format**… Use a deterministic ZIP/container format… versioned schema, forward
  compatibility, migration system, checksums, asset deduplication, compressed
  assets, thumbnails, metadata, recovery information, optional history, no
  external Internet dependency.”
- **§3 — Interop discipline.** “Do **not** let `.fig` become the native model.
  Native: PFG → full fidelity. Interop: FIG → supported fidelity.”
- **§48 — Compatibility rule.** Figma interaction model + terminology +
  shortcuts + mental model, with **Penfig visual identity** (not a pixel copy).
- **§43 — Sandbox honesty.** “Do not silently claim `new Function` is a secure
  sandbox.” (Plugins: sandboxed Web Worker with whitelisted RPC; labelled local
  fallback; sandboxed scripts-only iframe for UI plugins.)

## §4 — Tools (Figma keys)

V Move · F Frame · S Section · R Rectangle · O Ellipse · L Line · A Arrow ·
P Pen · N Pencil · T Text · H Hand · C Comment — **12 tools in the toolbar.**

## §5 — Keyboard

All tool keys above + ⌘C/V/X/D, ⌘Z/⇧⌘Z, ⌘G/⇧⌘G, ⌘S/⇧⌘S, Shift+arrows, Alt+drag,
Shift+resize, ⌘click, Enter, Escape, Tab.
“Shortcut conflicts should be managed by a central shortcut registry.”
→ Implemented: `src/shortcuts.js` — **one table** drives (a) `onKey` dispatch,
(b) the “?” shortcuts reference modal, and (c) `Shortcuts.conflicts()`
(headless-tested, must be empty — it is: 48 bindings, 0 conflicts).

## §6 — Vector engine (P0 — “This is **P0**.”)

- **Pen** — line/cubic segments, corner & smooth nodes, open/close paths,
  Enter/dbl-click/click-first-point to close, Esc ladder (open → end → leave).
- **Nodes** — select, move, add (click a segment), delete (Backspace),
  join, split, convert corner ↔ smooth, independent & mirrored handles.
- **Vector ops** — union/subtract/intersect/exclude/flatten/outline-stroke/
  offset → **implemented** in `src/boolean.js` (real geometry: exact edge
  splitting + region parity, even-odd *and* nonzero winding, holes +
  self-intersections; results are polyline-flattened — Figma's arc-preserving
  clipping is the remaining polish gap).
- **Pencil** — freehand + RDP simplification + smoothing → stroked vector.
  → Implemented: `src/pen.js` (pure, unit-tested headlessly) + the pen state
  machine and node editor in `ui-editor.js` (draw mode + node-edit mode with a
  Path section in the inspector).

## §7–8 — Shapes & boolean geometry

Arrow and Section tools: done this session (arrow = line + `arrowEnd`, arrowhead
rendered in canvas/SVG/PDF; section = frame + `section flag`, Figma-style
subtle fill + border). **Real-geometry booleans: done** — `src/boolean.js`
implements union/subtract/intersect/exclude on actual path geometry (flatten →
split at every intersection → keep by region parity → trace loops), with
flatten, outline stroke (center/inside/outside, round/miter with real
stroke-join physics) and offset; every test area is measured against the
analytic value. **Polygon (6) / Star (5) / Triangle tools: done** — drag to
draw, path bbox kept exactly equal to the node bbox. Deviations (documented in
README): results are polylines, offset/outline skip open subpaths, round-join
arcs are chord-approximated.

## §29 — Context menus

Cut / Copy / Paste / Duplicate, Group, Frame selection, Create component,
4-way z-order (front/forward/backward/back), Lock/Hide, Copy/Paste properties,
plus a vector-only block (edit path nodes, make smooth/corner, split, close),
align/distribute, rename, delete. → **Done** (rewritten `contextMenu`).

## §30 — Command palette

At **⌘/** with searchable commands (fuzzy ranking, ↑↓ + ⏎, Esc to close).
Context-aware: ⌘/ toggles mask when the selection is maskable (Figma parity),
otherwise opens the palette. → **Done** (~29 commands).

## §32 — Empty states

Canvas: “Start designing” + tool hints + import hint. Layers / Assets / Styles /
Variables panels: guiding empty states. Nothing-selected inspector: tool
cheat-sheet. → **Done.**

## §33 — Error system

“Specific + actionable + non-destructive” — e.g. a save failure shows
“Couldn’t save this project. Your document is still open.” with **[Export
backup (.fig)] [Try again]** action buttons. → **Done** (toast supports action
buttons; wired to the storage-quota error path).

## §34 — UI design system

Dark Figma-like palette (bg #1e1e1e, accent #0d99ff), consistent radii
(4–8 px), spacing on the 4/8/12/16/24/32 scale. → Applied to the new
palette/modal/toast components.

## §49 — The actual implementation order (phase tracker)

Status: ✅ done · 🟨 partial · ⬜ not started
This session (2026-08-25) shipped the **Phase 1 core + the full Phase 2
drawing slice** (pen, node editor, pencil, arrow, section, **real-geometry
booleans/flatten/outline/offset**, polygon/star/triangle), then — per the
P0/P1 technical-first directive — the **P0 closeout** work: text auto-resize
(Phase 3), the acceptance matrix + `.fig` component interop, and
**rulers + smart guides + snapping** (see session log entries 2026-08-25
(2)–(5)).

### Phase 1 — UX foundation
| Item | Status | Notes |
| --- | --- | --- |
| Inspector (all sections) | ✅ | existing + new **Path** section for pen node editing |
| Layers panel | ✅ | existing + richer empty state, lock/visibility |
| Toolbar | ✅ | 8 → 12 → **15 tools** (§4 + §7 shape tools) |
| Context menus | ✅ | rewritten per §29 incl. vector ops |
| Keyboard | ✅ | central shortcut registry (§5), conflict-free |
| Selection (marquee, ⌘click, shift, Tab cycle) | ✅ | existing |
| Rulers + line grid + smart guides/snapping | ✅ | 2026-08-25 (5): adaptive 1-2-5 rulers + origin markers, optional 10/20/50 line grid (view-only, never exported), Figma-style object edge/center + page-origin snapping (6px, Alt bypass, magnet mode ⇧, move/multi-select union bbox/resize moving edge), magenta guide lines; View ▾ menu + ⌘/ palette (no Figma keys exist for these); measured in acceptance Q |
| Command palette | ✅ | ⌘/, §30 |
| Error/toast system | ✅ | actionable toasts, §33 |
| Empty states | ✅ | canvas + panels, §32 |
| UI design system pass | 🟨 | tokens applied to new components; full audit later |

### Phase 2 — Drawing / Vector (highest priority, §6 = P0)
| Item | Status | Notes |
| --- | --- | --- |
| Pen tool (open/closed, corner/smooth) | ✅ | `src/pen.js` + pen state machine |
| Node editor (select/move/add/delete) | ✅ | edit mode + inspector Path section |
| Bézier handles (independent + mirrored) | ✅ | drag handles; smooth = mirrored |
| Convert corner ↔ smooth (one or all) | ✅ | inspector + context menu |
| Split / join / close | ✅ | split in inspector & menu; join in engine (tested); close via Enter/menu |
| Pencil (freehand + smoothing + cleanup) | ✅ | RDP + cubic-through-midpoints |
| Arrow | ✅ | canvas + SVG + PDF arrowheads |
| Section | ✅ | frame with section styling |
| Boolean ops (union/subtract/intersect/exclude) | ✅ | `src/boolean.js` — real geometry (parity of split edges); holes + nonzero winding; all test areas exact; ⌘]/⌘[/⌘\ /⇧⌘\ + context menu + palette. *Gap: polyline-flattened results (no arc preservation)* |
| Flatten / outline stroke / offset | ✅ | flatten (world-space merge), outline (stroke→fill, center/inside/outside, real join physics), miter offset; *gap: open subpaths skipped, round arcs chord-approximated* |
| Polygon / Star / Triangle | ✅ | tools with bbox-fitted paths (handles/hit-test aligned); click/palette only (no Figma key exists) |

### Phase 3 — Visual fidelity
| Item | Status |
| --- | --- |
| Typography (full font stack, OpenType, auto-size) | 🟨 (text editor + styles + **auto-resize done** — Figma's four modes: fixed / auto width / auto height / auto w+h, new text hugs content, drag-a-hugging-axis fixes it, re-fits on content/font/size, `textAutoResize` round-trips in `.fig` (auto width exports as `NONE` — no enum value); gaps: rich text, variable fonts, OpenType features) |
| Gradients (radial/conic, stops) | 🟨 (linear exists) |
| Stroke (dashes, caps, joins, variable) | 🟨 (solid strokes; arrowheads done) |
| Image editing (crop, scale modes) | ⬜ |
| Masks (advanced) | 🟨 (basic mask toggle/clip exist) |
| Effects (blurs, background blur, blend modes) | 🟨 (drop shadows + layer blur) |
| Transforms (rotate/flip/skew) | ⬜ |

### Phase 4 — Design systems
Components/variants/instances ✅ · shared libraries ✅ · variables/modes/aliases
✅ · text & paint styles ✅ · **advanced: component sets, property types,
library publishing — partial/deferred.**

### Phase 5 — Prototyping
Interactions (click → frame/page, 5 animations) ✅ · present mode (⇧K) ✅ ·
**advanced: conditionals, scroll, variable overrides — deferred.**

### Phase 6 — Developer mode
Dev Mode (D) with CSS/HTML codegen ✅ · spec inspector ✅ · annotations ✅ ·
**advanced: measurement overlay, code snippet variants — partial/deferred.**

### Phase 7 — Files (`.pfg` native format)
⬜ **Next major milestone after Phase 3.** Per §2: deterministic ZIP container
(`manifest.json`, `document.json`, `pages/`, `assets/`, `fonts/`, `thumbnails/`,
`components/`, `variables/`, `styles/`, `prototypes/`, `plugins/`, `history/`),
versioned schema + migrations + checksums + asset dedup + thumbnails + recovery
info. Interop stays: `.fig` import/export (existing). Autosave/recovery:
localStorage + IndexedDB store exist; `.pfg` recovery metadata deferred with
the format.

### Phase 8 — Collaboration
Multiplayer (BroadcastChannel) ✅ local · **deferred: CRDT, WebSocket server,
presence at scale, comments threading, permissions, hosted libraries,
self-hosted server.**

## §50 — Do NOT build (verbatim list)

FigJam/slides/sites clones · AI generation · plugin marketplace · cloud SaaS ·
template marketplace · enterprise billing.

## §52 — Success targets

- Feature parity: **90%+ of the important Figma Design workflow**
- UX parity: **95%+ muscle memory** (shortcuts/interactions, §48)
- Offline: **100% core** (no network at runtime — already true)
- Native files: **100% Penfig fidelity through `.pfg`** (Phase 7)
- Figma interop: best-effort (`.fig` stays interop-only, §3)
- “The next major milestone should therefore be **P0 UX + Drawing/Vector +
  Typography**, while preserving the existing Auto Layout/component/variable
  architecture rather than rewriting those working systems.”

→ **This session delivered P0 UX (Phase 1 core) + Drawing/Vector (Phase 2:
pen, node editor, pencil, arrow, section, **real-geometry booleans, flatten,
outline stroke, offset, polygon/star/triangle**, palette, context menus,
empty states, error system).** The Phase 2 table is now fully ✅ (with the
documented polyline-flattening caveat). Phase 3 started: text auto-resize
(Figma's four modes) is done — tracked next inside Phase 3 is rich text
(per-selection inline styles), then gradients/advanced strokes per the
table below.

## Session log

- **2026-08-25** — Spec received (“update all this changes”). Phase 1 core +
  Phase 2 drawing slice implemented: `src/pen.js` (new vector engine),
  `src/shortcuts.js` (new registry), 12-tool toolbar, pen draw + node-edit
  state machine (incl. a local/world coordinate fix for the node editor),
  pencil, arrow, section, command palette (⌘/), rewritten context menu with
  vector ops, inspector Path section, empty states, actionable error toasts,
  registry-driven shortcuts reference. Tests: headless 144→**169**, ui-smoke
  63→**97**, try-app 16→**17** steps. Docs updated honestly (README score
  dimensions broadened, no false parity claims).
- **2026-08-25 (2)** — “try”: the remaining Phase 2 gap closed —
  `src/boolean.js` (new, ~500 lines, pure): boolean geometry on **real
  geometry** (union/subtract/intersect/exclude — exact edge splitting incl.
  collinear overlaps, region parity for even-odd *and* nonzero winding,
  boundary tracing; flatten; outline stroke with real stroke-join physics —
  a round join rounds only the side the offset opens up; miter offset).
  Three real engine bugs found and fixed along the way (offset closing-dup
  corner, `sv` normalization typo, and `inLoops` OR-ing hole loops into the
  region — the last one was behind a “zero-area sliver” trace). UI: 15-tool
  toolbar (+Polygon/Star/Triangle, bbox-fitted paths), shape draw/resize
  path sync, boolean/flatten/outline App ops, context-menu block, Figma
  boolean keys in the registry (`⌘]` `⌘[` `⌘\` `⇧⌘\` + `⇧⌘F`, 53 bindings,
  0 conflicts), palette commands. Tests: headless 169→**201** (section V:
  exact areas vs analytic values), ui-smoke 97→**120** (section O: tools +
  pointer-drawn shapes + booleans via keyboard/menu + outline + palette),
  try-app 17→**18** steps (measured areas printed). Drawing score 70→85%,
  13-dim average 82.3→**83.5%**; documented deviations kept honest.
- **2026-08-25 (3)** — “try”: first Phase 3 typography slice — **text
  auto-resize, Figma's four modes** (fixed / auto width / auto height /
  auto w+h). Model: `resize` field on text (default `'auto'` — Figma's
  default for new text; legacy docs without the field behave as fixed via
  `textResizeMode`), `applyTextResize` (hug axes re-fit to measured content,
  explicit box width for fixed-width wrap), `textResizeDemote` (dragging a
  hugging axis fixes it — auto→auto-h/auto-w, auto-w→fixed, auto-h→fixed),
  als items defer to their item sizing. Render: pure `textBoxWidth(n)`
  (hug width ⇒ no wrap constraint), `measureText(n, boxW)` with explicit
  box override + `setTextCtx` test hook (linkedom's canvas ctx is null).
  UI: T-tool text fits on creation; inline-edit commit re-fits; inspector
  four-mode button row (⇲/⇆/⇵/▣) with active state; font/size/weight/LH/
  tracking/italic commits re-fit hug text. `.fig`: `textAutoResize` import
  (WIDTH_AND_HEIGHT→auto, HEIGHT→auto-h, NONE→fixed) + export round-trip;
  also fixed an als-mapping leak that put `als` on every free text node.
  Documented deviation: the kiwi enum has no WIDTH-only value, so "auto
  width" exports as `NONE`. Tests: headless 201→**224** (section W: per-mode
  fits with measured values, demotion table, als ownership, .fig A/B/C/D
  round-trip), ui-smoke 120→**131** (section P: creation fit 28×20, blur
  re-fit 77×20, all four buttons + active state, size-change re-fit),
  try-app 18→**19** (252×20 natural → auto-h keeps width, h 39; fixed stops
  tracking). Typography 45→**55%**; 13-dim average 83.5→**84.2%**. Next
  tracked: rich text (per-selection inline styles).
- **2026-08-25 (4)** — “P0 closeout: interaction verification + `.fig`
  component interop.” Built the **P0 acceptance matrix**
  (`figlib/test/acceptance.mjs`, 99 checks, wired into `npm test`): the agreed
  acceptance line (open → create → draw → layout → componentize → tokenize →
  prototype → inspect → export) plus the interaction matrix (create → edit →
  resize → transform → undo → save → reopen → export), every check measured
  against the real app under linkedom. It immediately caught **four real
  bugs** that no earlier suite exercised:
  1. **NaN handle resize** — `onDown` built the resize drag with `sp` = the
     node origin while `doResize` computes total delta against the *start
     pointer*, and omitted `ox`/`oy` (→ NaN w/h on any pointer resize).
  2. **`History` shadowing** — the constructor's `this.undo`/`this.redo`
     *arrays* shadowed the `undo()`/`redo()` methods, so ⌘Z/⌘Y threw
     “this.history.undo is not a function”. Stacks renamed `_u`/`_r`.
  3. **Version restore wiped history** — a version's snapshot predates its own
     list entry, so `restore()` (which copies the snapshot's `versions`)
     emptied the version list. Restore now preserves the current list.
  4. **Infinity group bounds** — `groupSel`'s reduce seeded `x: Infinity`,
     making the group's w/h Infinity → `null` in JSON snapshots → broken
     `.fig` export after any undo. Rewritten as a min/max loop.
  Also closed the **`.fig` component interop** gap: export now writes
  components as `SYMBOL` and instances as `INSTANCE` bound via
  `overriddenSymbolID` (this openfig v101 schema has no `COMPONENT` type and
  no `mainComponentGuid` field — documented deviation: real Figma keeps the
  cloned subtree, reads the instance as detached, and does not round-trip
  per-instance prop overrides or the variant grid); import maps both back and
  re-binds instances (cross-page), verified by the matrix (per-type counts,
  full geometry+fill multiset, 3/3 instances re-bound, clean warnings).
  Tests: 355/355 → **454/454** green (headless 224 + ui-smoke 131 +
  acceptance 99). P0 acceptance matrix: **99/99**. Rotation remains the one
  documented P0 transform gap (no rotation field in the model).
- **2026-08-25 (5)** — “try”: P0 UX closeout slice — **rulers + smart guides +
  snapping** (the biggest UX-muscle-memory gap the audit flagged). Built:
  - **Rulers** (`R.drawRulers`, render.js): top + left 22px bands with
    adaptive 1-2-5 ticks (smallest step whose labels are ≥60px apart at the
    current zoom), sub-ticks, numeric labels, origin (0,0) triangle markers,
    corner/edge positions deliberately unlabeled; on by default, toggle from
    the new **View ▾** top-bar menu (ui-panels `viewMenu`) and the ⌘/ palette.
  - **Line grid** (`R.drawGridLines`): optional under-content grid (10/20/50
    world px, major line every 5th), default off; view-only chrome — PNG/SVG/
    PDF/`.fig` exports never see it (like Figma's viewport grid).
  - **Smart guides + snapping** (ui-editor `_snapBox`/`snapEnabled`/
    `_selBoxAt`): while a move, multi-select, or resize drag is active, the
    moving box's edges + center lines are matched against every other
    visible node's edges + centers **and the page origin** on the same axis;
    a match within 6 screen px pulls the box to the exact alignment and the
    match renders as a magenta (`#eb1478`) guide line spanning both objects
    (`R.drawSnapGuides`). Figma behaviors kept: **Alt bypasses snapping**,
    **magnet mode** = snap only while Shift is held, resize snaps only the
    moving edge (fixed edge stays put; center-line snap on corner handles),
    multi-selection snaps the **union bbox**. No new Figma key bindings
    (Figma ships none for these) — View ▾ menu + ⌘/ palette only, per spec §4.
  - View state (`rulers/grid/gridSize/snap/magnet`) lives in the session
    (`App.view`), never in the saved document (byte-identical-snapshot check).
  The acceptance matrix (now **section Q, 33 new checks — 132 total**) caught
  **two more real bugs** on the first run:
  1. **Duplicate window listeners per file open** — `buildCanvas` re-added
     `pointermove`/`pointerup`/`keydown`/`keyup` on `window` for every
     `openFile`; the stale runs re-computed a drag from the nodes' *current*
     (already-snapped) positions and overwrote the first run's result,
     silently undoing every snap after a second file open. Window handlers
     are now bound once (`_winHandlers`); canvas handlers stay per-element.
     (Latent P0 bug: any stateful drag behavior would have been corrupted
     after reopening a file.)
  2. **Y-snap delta in the wrong field** — `_snapBox`'s axis-agnostic `pick`
     named the match's offset `dx` for *both* axes, so vertical snaps
     computed `h + undefined` → **NaN** boxes on any vertical resize/move
     snap (east-resize passed, south-resize NaN — the matrix caught it).
     The match now carries `delta`, mapped to `dx`/`dy` exactly once.
  Tests: 454/454 → **487/487** green (headless 224 + ui-smoke 131 +
  acceptance 132) + **20-step** try-app (step 20: fresh file, live guide +
  exact snap measured, ruler label output, View menu round-trip). UX
  muscle-memory dimension 75% → **78%** (13-dim average 84.2% → **84.5%**).
  Remaining P0 gaps, unchanged: **rotation** (no model field), **image tool**
  (place/crop/scale-modes/replace), **rich text** (per-selection styles).
