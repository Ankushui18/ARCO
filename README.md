# Penfig — a Figma-style design tool in the browser

Penfig is a complete Figma-style design tool: a **Figma-like dashboard**, a
canvas editor with frames/text/shapes, a **custom auto-layout engine**
(deliberately **not** CSS flexbox), **Figma-style design tokens** (variables
with Light/Dark modes), and **real `.fig` import & export** — the actual
Figma kiwi/ZIP byte format, not a lookalike.

```
┌────────────────────────────────────────────────────────────────────┐
│  Penfig                                                            │
│                                                                    │
│  .fig (Figma's real format) ⇄ Penfig document ⇄ canvas renderer    │
│       figio.js (kiwi)           model.js         render.js         │
│       figconv.js      ──▶   layout.js  ◀──  tokens.js              │
│                                  │                                │
│                                  ▼                                │
│                 explicit x/y/w/h world coordinates (no CSS layout) │
│                                                                    │
│  Dashboard (ui-dashboard.js)  ──  Editor (ui-editor.js)            │
│                 + panels (ui-panels.js)                            │
└────────────────────────────────────────────────────────────────────┘
```

## Run it

```bash
cd /home/user/penfig
python3 -m http.server 8080 --bind 0.0.0.0
# → http://localhost:8080   (live preview in the sandbox)
```

No build step, no dependencies — plain ES modules + one prebuilt IIFE bundle
(`assets/figio.js`, 346 KB, the `.fig` codec including the vector
`commandsBlob`/`vectorNetworkBlob` ⇄ SVG-path codec). A starter file (UI
starter kit with a brand token set + hero landing frame using auto layout) is
seeded on first run.

### Local test demo (works even offline)

`test-demo.html` runs the **real app code** (the identical module set
`index.html` loads) through 12 live checks — real `.fig` import of an
**embedded** Figma file, the auto-layout engine, a vector round-trip through
a real kiwi-encoded `.fig`, SVG/PDF export, token modes, the plugin sandbox,
components, durable persistence, constraints — and reports pass/fail in-page
(`test-demo.js` holds the checks; verified green: 11/11 + 1 http-only skip).

- **served:** `http://localhost:8080/test-demo.html` — check 12 additionally
  fetches the real 9-vector `word-outline-stroke.fig` from `fixtures/`
- **offline:** double-click `test-demo.html` directly — no server, no network
  (the Figma fixture for check 2 is base64-embedded; check 12 skips itself)

### What “offline” means here (precisely)

| Level | Meaning | Penfig |
|-------|---------|--------|
| A | No internet required to run | ✅ no `fetch`/`WebSocket`/CDN in the runtime; everything ships in the folder |
| B | Persistent local application (durable storage, crash recovery, multi-user) | ✅ single-user durable: files persist in **IndexedDB** (multi-MB, survives reloads; verified by test across a simulated app restart), with a `localStorage` fallback + loud quota toast where IndexedDB is unavailable. Multi-user still needs a server |
| C | Enterprise offline (auth, permissions, server history, backups) | ❌ out of scope for a static app; this is what a Penpot-server deployment provides |

### The `.fig` support — precise scope

The *container* (ZIP + `fig-kiwi` + embedded kiwi schema) is real, both
directions. Node coverage is **interoperability for supported node types**,
not full Figma parity: frames/rects/ellipses/lines/text/auto-layout/
components/variables/constraints/resize-to-fit map faithfully, and **vectors
now carry their real path data** — the `commandsBlob`/`vectorNetworkBlob`
bytes are decoded into an SVG path on import and re-encoded back to both blob
types on export (so vector-heavy files round-trip their geometry). What is
still lossy: Figma's editable vertex/tangent *network* is flattened to a path,
`strokeGeometry`/`arcData`/`strokeJoin` are not modeled, and unsupported node
types are reported by the import scanner, not silently dropped. The table at
[`.fig` compatibility](#fig-compatibility--measured-against-real-figma-files)
states exactly what maps (24 of 40 fields seen in real files).

## The `.fig` file — real, both directions

A Figma `.fig` is a ZIP (store mode): `canvas.fig` = 8-byte `fig-kiwi` prelude +
u32 version + repeated `[u32 len][data]` chunks where **chunk 0 is the kiwi
schema itself** and chunk 1 is the node tree (each chunk deflateRaw | zstd |
raw, auto-detected), plus `meta.json`, `thumbnail.png`, and `images/*` (raw
rasters, filename = 20-byte hex SHA-1 hash).

**Import** (`src/figconv.js` → `importFig`): decodes with the **schema embedded
in the file** — so any Figma version's file decodes with no pinning. Normalizes
fields kiwi omits when they equal their default (`guid 0:0`, `phase CREATED`),
maps frames/rects/ellipses/lines/text/vectors/groups, all paint kinds
(solid, linear/radial gradients, images), strokes, corner radii, shadows/blur,
**components & instances** (`SYMBOL` → component frame, `INSTANCE` → instance
node re-bound to its component via `overriddenSymbolID`, cloned subtrees
imported as the instance's children),
**vector geometry** (each `fillGeometry` part's `commandsBlob` — and as a
fallback `vectorData.vectorNetworkBlob` — is decoded from `message.blobs`
into an SVG path stored on the node, multi-part icons reassembled),
**auto layout under both the 2026 `stack*` field names and the legacy
`layoutMode/itemSpacing/...` names**, item sizing (fixed/hug/fill via grow
weight, absolute), min/max sizes, and **design variables** (`VARIABLE_SET`
modes + `VARIABLE` per-mode color/float/bool/string values).

**Export** (`src/figconv.js` → `exportFig`): writes a real `.fig` —
`fig-kiwi` prelude, **version 101**, the current 550-definition Figma kiwi
schema (from [OpenFig-org/openfig-core](https://github.com/OpenFig-org/openfig-core),
bundled as fallback), deflateRaw message chunk, `meta.json`, thumbnail, images
by SHA-1 hash. **Vector nodes are written as `VECTOR`** with their path
re-encoded into *both* a `fillGeometry[0].commandsBlob` and a
`vectorData.vectorNetworkBlob` (vertices/tangents/regions rebuilt from the
path), the blobs stored in `message.blobs` and referenced by index — the same
dual representation Figma itself writes. **Components export as `SYMBOL`
frames and instances as `INSTANCE` nodes** bound back to their (variant)
component via `overriddenSymbolID` — the v101 openfig schema has no
`COMPONENT` type and no `mainComponentGuid` field, so the binding rides the
legacy symbol-reference field (documented deviation: in real Figma the
instance keeps its cloned subtree — visual parity — but reads as detached,
and per-instance prop overrides / the variant grid do not round-trip).
Round-trips through our parser (verified by tests, including geometry,
z-order, and component/instance re-binding); structurally conformant for
Figma — final acceptance = opening one in the Figma app.

Try it: **Dashboard → Import .fig**, or **Editor → Export → Figma file (.fig)**.

## Auto layout — a real engine, not flexbox

`src/layout.js` is a self-contained **measure → distribute → place** engine
written from scratch. It computes exact x/y/w/h for every node and the renderer
places children with **absolute coordinates** — no CSS layout is anywhere in the
pipeline (the canvas renderer has no layout concept to begin with). This mirrors
how Figma itself works: its auto-layout is a JS engine on a WebGL canvas, not the
platform's box model.

Features (all tested):

- horizontal / vertical, 4 independent paddings, gap
- **wrap** with greedy line packing + independent cross-axis gap
- primary axis: start / center / end / space-between / space-evenly
- cross axis: start / center / end / stretch (+ per-item align-self)
- item sizing per axis: **fixed / hug / fill** — fill items share the remaining
  space weighted by grow
- min/max size clamping; absolutely-positioned children skip flow
- hug measurement uses real font metrics (text measured by the renderer)
- numeric fields can be **tokens** (`{ n, tok }`) and resolve per active mode

Inspector → **Auto layout** section: add H/V, direction, wrap, reverse, 3×3
alignment grid, axis dropdowns, 4 paddings (linkable), gap (+ token), wrap gap;
per-item: hug/fill/fixed segments, align-self, absolute.

## Design tokens — Figma variables with modes

`src/tokens.js` mirrors Figma's variable system:

- `doc.vars = { modes: [Light, Dark, …], defaultMode, sets: [{ name, vars:
  [{ name, type: color|number|string|boolean, values: { [modeId]: v } }] }] }`
  — the same shape as Figma's `VARIABLE_SET.variableSetModes` +
  `VARIABLE.variableDataValues.entries`.
- Fills/strokes/text reference a variable by id; numeric fields (radius, gap,
  paddings) accept `{ n, tok }`.
- `bake(doc, modeId)` resolves every reference for the active mode, so layout
  and rendering stay token-agnostic.
- **Live mode switching**: the editor topbar has a Light/Dark segment control;
  the whole file re-renders on switch.
- **Variable aliases** (Figma-style token references): a variable's value in a
  mode can point at another same-type variable (`{ alias: varId }`, linked via
  the 🔗 button in the Tokens panel — the chip shows `→ set/target`).
  Resolution is recursive with a cycle guard (a cycle resolves to nothing
  instead of looping), per-mode (the linked mode follows the target, other
  modes keep their own literal), `removeVar` freezes a literal fallback into
  any alias that referenced the removed variable, and exports render
  references, not values: W3C `{set/varName}`, CSS `var(--set-var)`.
- **W3C Design Tokens JSON export/import** (`$schema`-conformant, bucketed by
  set name) and **CSS variables export** — from the Tokens panel.

## The app itself

**Dashboard** (`src/ui-dashboard.js`) — Figma-style: left nav rail, search,
file cards with **live thumbnails**, hover actions (rename / duplicate /
**export .fig** / delete), `+ New design file` (blank or UI starter kit),
**Import .fig**.

**Editor** (`src/ui-editor.js`) — **12-tool toolbar** (move, frame, **section**,
rect, ellipse, line, **arrow**, **pen**, **pencil**, text, hand, **comment**),
zoom (ctrl/cmd+wheel at cursor, 0/1, zoom-to-fit), pan (space/mid-drag/hand),
marquee select (shift-add, alt-subtract), 8-handle resize (shift keeps
aspect), move with shift/alt, inline text editing with **Figma text
auto-resize** (new text hugs its content; the inspector offers the four modes
— auto w+h / auto width / auto height / fixed — and dragging a handle on a
hugging axis fixes that axis, exactly like Figma), group/ungroup, clipboard
(⌘C/X/V/D), full undo/redo (⌘Z/⌘⇧Z, 80 steps). **Keyboard is driven by one
central shortcut registry** (`src/shortcuts.js` — 53 bindings, conflict-free,
headless-tested): `V F S R O L A P N T H C` tools, `D` dev mode,
**boolean ops `⌘]` union · `⌘[` subtract · `⌘\` intersect · `⇧⌘\` exclude ·
`⇧⌘F` flatten** (Figma's own vector keys), `⌘S` save,
`⌘E`/`⇧⌘S` export, `⌘A` select all, `⌘G`/`⇧⌘G` group/ungroup, `⌘/` mask or
**command palette**, `⌘K` version history, `⇧K` present, `⇧1`/`⇧2`/`0`/`1`
zoom, `⌫` delete, `Tab` cycle layers, arrows nudge (±1/±10), `Esc`
deselect/exit, `?` shortcut sheet (the sheet is *rendered from the same
registry*, so it can't drift).
**Drawing (spec Phase 2):** the **Pen tool** draws open/closed paths with
corner & smooth nodes and opens a **node editor** (click a vector → select /
move / add-on-segment / delete nodes, drag independent handles, convert corner
↔ smooth, split & close paths — inspector **Path** section + context menu).
The **Pencil** smooths freehand drags (RDP simplification → cubic
through-midpoints) into stroked vectors. **Arrow** and **Section** match
Figma's defaults (arrowhead sized to the stroke; section = a subtle-filled
frame).
**Vector booleans (spec §7–8) on real geometry** — `src/boolean.js`:
**union / subtract / intersect / exclude** (context menu, `⌘]`/`⌘[`/`⌘\`/
`⇧⌘\`, or the command palette), **flatten** (merge many shapes into one
world-space path), **outline stroke** (stroke → fill, center/inside/outside,
round or miter joins), and **offset**. The engine is exact vector math:
paths are flattened to polylines (de Casteljau, 0.25 px), split at every
edge intersection (incl. collinear overlaps), and kept by region parity
(even-odd *or* nonzero winding, per node) — holes, self-intersecting paths
and multi-subpath inputs are handled, and every result area in the test
suite is measured against the analytic value (union 175, holed-square
subtract 312 with a clean notched trace, outline rings 80/64/96, offset
400/144 …). Deliberate, documented deviations: results are polylines
(Figma keeps the original arcs — arc-preserving clipping isn't built),
offset/outline skip open subpaths, and round joins approximate arcs with
chords (≤ π/8 per segment). **Regular shapes (§7):** **Polygon (6) /
Star (5) / Triangle** tools — drag to draw; the path's bbox is kept exactly
equal to the node's bbox so handles/hit-testing line up (no key bindings —
Figma has none either; toolbar click or palette).
Top bar adds **▶ Present** (prototyping overlay with fade/slide/none
transitions), **⟨/⟩ Dev mode** (spec + CSS/HTML codegen in the inspector),
**🕘 Versions** (named version history menu), **⚙ Plugins**, and a live
**multiplayer presence** indicator.

**Ecosystem modules** (the "rest of Figma"):
- **Components** (`src/components.js`) — make any frame a component
  (◆ in the inspector/layers), **variants** (cloned siblings), **instances**
  with per-instance text overrides that survive updates (source edits flow
  through on update; explicit overrides don't), **component props**
  (bool/text, bound by child name: text props set that child's text, bool
  props toggle its visibility — values live on the instance and survive
  updates), the Assets tab in the left rail (double-click to drop an
  instance), update/rename/delete a component set.
- **Shared libraries** (`global.Libraries`, same module) — Figma's team
  libraries are a cloud feature; Penfig's equivalent **links other local
  files as component libraries** (Assets tab → “＋ Link a file as
  library…”). Linked files are read live from the local store: their
  components appear in Assets with a 📚 badge, double-click drops a
  library instance (stamped with `libraryFileId`), prop definitions resolve
  from the source file, and **↻ Update** re-clones every instance from the
  (possibly edited) source file — Figma's "library updated, update instances"
  workflow, minus the server. Unlink keeps the instances' content.
- **Eco** (`src/eco.js`) — **named versions** (whole-doc snapshots,
  restore), **comments** (pin tool, C, overlay pins with resolve/delete,
  author + timestamp), **prototyping** (per-node interactions: click →
  node/page, none/fade/slide/**overlay**/**scroll**; drives present mode),
  **codegen** (CSS with real flex for auto-layout, or absolute-positioned
  HTML), **dev annotations** (per-node notes with author + time).
- **Layout extras** (`src/layout.js`) — **Figma constraints** (min / center /
  max / stretch / scale per axis; applied when a manual-layout frame is
  resized) and **resize-to-fit** (manual frame → shrink-wrap to children;
  auto-layout frame → engine natural size).
- **Styles** (`src/styles.js`) — Figma-style **text styles & paint styles**:
  capture from a selected node, apply to the selection, rename, delete
  (nodes unlink). Styles tab in the left rail.
- **Arrange** (`src/arrange.js`) — align (left/h-center/right/top/v-center/
  bottom) and distribute (h/v by center) for multi-selections, via the
  context menu, undoable.
- **SVG export** (`src/svgexport.js`) — pure-JS, canvas-free SVG of any node
  (gradients → defs, radii, masks → clipPath, token-resolved colors).
- **PDF export** (`src/pdfexport.js`) — pure-JS PDF 1.4 writer (no
  libraries): rects (rounded), ellipses, lines, Helvetica-family text,
  first-solid-paint fills; selection or whole page.
- **Collab** (`src/collab.js`) — real-time multiplayer between tabs of the
  same origin over `BroadcastChannel`: live cursors, selection, presence
  dots, full-doc last-write-wins sync (300 ms debounce).
- **Plugins** (`src/plugins.js`) — 5 built-ins + a plugin modal with custom
  plugins (persisted in localStorage) running against a small, explicit,
  **async** `penfig` API (`doc`, `setMode`, `selection`, `setSelection`,
  `listNodes`, `getNode`, `setPos`, `setProps`, `create`, `remove`,
  `history.begin/end`, `refresh`, `toast`, console capture). The API is the
  RPC contract: plain data in, plain data out — nodes arrive as summaries and
  writes go through `setProps`/`setPos`/`create`/`remove` — so a plugin
  behaves identically whether its calls cross a worker boundary or not.
  Plugin code is wrapped in an async IIFE: top-level `await` and
  top-level `return <result>` both work. Two execution modes, labeled in the
  modal:
  **▶ Run (headless)** — in a real browser the code executes in a
  **dedicated Web Worker** (separate JS realm: no host `window`/`document`/
  `localStorage`), talking to the app *only* through a whitelisted
  `postMessage` RPC (`handleRpc`); any unlisted call is rejected
  (`blocked plugin call: …`). 15 s timeout, then the worker is terminated.
  Where Web Workers don't exist (headless tests, some webviews) it falls back
  to `new Function` in the local realm — a **trusted-local** channel, clearly
  labeled as such in the UI. **🖥 Open (UI plugins)** — a
  `sandbox="allow-scripts"` iframe (srcdoc) whose UI code talks to the app
  through the *same* whitelisted RPC bridge (`penfig.call(name, ...)`). The
  built-in **“Theme switcher (UI plugin)”** demos it: lists token modes,
  switches on click, toasts the result.

**Panels** (`src/ui-panels.js`) — layers tree (visibility/lock/rename/
collapse, ◆ component + MASK badges), pages (add/rename/switch), **Assets**
(components/instances), **Styles** (text + paint styles: create from / apply
to selection, rename, delete), inspector (XYWH, 4-corner radii, opacity,
fills with hex+opacity+**token dropdown**+gradient stops, stroke, drop
shadow/blur, auto-layout + item sections, text section, z-order,
**component/variant section, component-props section, constraints +
resize-to-fit, interactions section (none/fade/slide/overlay/scroll),
layout-grid section (columns/rows)**, **dev-mode spec + CSS/HTML code view
with copy + dev annotations**), tokens panel, export menus (PNG of
selection/page at 1×/2×, **SVG + PDF of selection/page**, `.fig`, tokens as
JSON/CSS), context menu (Figma-style: cut/copy/paste/duplicate, group, frame
selection, 4-way z-order, lock/hide, copy/paste properties, Make component,
Mask, align & distribute for multi-selections, **and for vectors: edit path
nodes / make smooth / make corner / split / close path**), an **empty-state
layer** (onboarding hints on a blank canvas, §32), and **actionable error
toasts** (e.g. save failure → “Your document is still open.” with **[Export
backup (.fig)] [Try again]** buttons, §33).

**Model** (`src/model.js`) — JSON-safe scene graph (parent referenced by id, no
circular pointers), undo/redo history with batch support, durable file
store: **IndexedDB** primary (`penfig-files` db, `files` store, async writes
debounced; `Model.store.init()`/`flush()`), **localStorage fallback**
(`penfig.files.v1`) where IndexedDB is unavailable — reads are always
synchronous off the in-memory list, so the editor never waits on storage.

**Renderer** (`src/render.js`) — canvas 2D: dot grid, world transform, frame
clipping, solid/linear-gradient/image fills, inside/center/outside strokes,
shadows with spread, blend modes, text with wrapping/letter-spacing/valign,
**real vector paths** (`Path2D` over the decoded path, with even-odd/nonzero
winding, gradient/image fills clipped to the path, and stroke — falling back
to a dashed placeholder only when a node has no path data), selection handles
+ W×H badge, marquee, PNG region export.

## Tests — 487/487 green (+ 20-step user journey)

(Prefer a no-node, in-browser check? [`test-demo.html`](test-demo.html) runs
12 live checks of the same code in your browser — served or straight off disk.)

The suites are **location-independent** (all paths resolve relative to the
checkout) and **self-building**: if the `.fig` bundles are missing (fresh
clone / workspace reset), `scripts/ensure-build.mjs` rebuilds them first
(needs `node_modules`; run `npm i` in `figlib/` once).

```bash
cd figlib
npm i            # once
npm test         # 224/224 headless + 131/131 ui-smoke + 132/132 P0 acceptance (pretest ensures the build)
npm run test:e2e # 20-step end-to-end "try it" journey + previews
# or directly:  node test/headless.mjs · node test/ui-smoke.mjs · node test/try-app.mjs
```

Headless:
- **A** auto-layout positions: padding 20, gap 10, fill width 252, fixed 100
- **B** wrap: three 150-wide items in 400 → second line at y=50
- **C** tokens: number resolution, dark-mode color, CSS + W3C export
- **C2** regression: token resolution survives a second document (the token
  index is per-doc — importing a file with variables must not break tokens in
  the previously-open file)
- **D** `.fig` import of **real Figma bytes**: auto layout (vertical, gap 12),
  radius 12, fill `#3366ff`, text "Hello Figma" Bold, variable dark value
  `#4dccff`, transform positions — and imported children **re-laid-out by our
  engine** (not Figma's stored coords) at (16,16)
- **E** export → re-import round-trip: FRAME/TEXT/VARIABLE present, per-mode
  values intact, `meta.json` survives
- **F** components: make/variant/instance (subtree cloned, text overrides
  survive `updateInstance`), instancesOf, delete orphans instances
- **G** versions (add/restore/remove, whole-doc snapshot), comments
  (add/resolve/remove), prototyping (interaction → destination, screens)
- **H** dev-mode codegen (flex CSS for auto-layout, absolute HTML) +
  pure-JS SVG export (text, radius, clip)
- **I** component props (bool/text, defaults on instances, set, survive
  `updateInstance`)
- **J** constraints (min/center/max/stretch/scale reposition children on
  resize) + resize-to-fit (manual + auto-layout frames)
- **K** text + paint styles (capture/apply/rename/delete, unlink on delete)
- **L** align (edges/centers) + distribute (h/v by center)
- **M** PDF export (header/xref/trailer, escaped text, font mapping,
  startxref offset, bounds)
- **N** dev annotations (add/listFor/remove) + proto overlay/scroll anims
- **O** `.fig` round-trip of `constraints` + `resizeToFit`
- **P** variable aliases: per-mode link, chain resolution, cross-type
  rejection, cycle guard (resolves to null, no hang), clear-alias restores
  target value, `removeVar` freezes a fallback, W3C `{brand/base}` + CSS
  `var(--brand/base)` reference rendering
- **Q** shared libraries: store a source file, `link`/`componentsOf`/
  `makeInstance` (stamps `libraryFileId`), edit the source in the store →
  `updateAny` flows the change through, `updateAll` re-clones with explicit
  text overrides surviving, `unlink` keeps instance content
- **R** plugin sandbox: async `run()` executes a plugin (result + console
  capture, node moved through the API, `getNode` returns data not a live
  handle, errors caught), `sandbox` label matches the environment, plus the
  RPC surface (`doc`/`setMode` incl. unknown-mode rejection / `getNode`/
  `setPos`/`listNodes`/`setSelection`/`create`) with unlisted calls blocked,
  the UI built-in + bridge script + `runUI` present
- **S** vectors: SVG `d` ⇄ `commandsBlob` / `vectorNetworkBlob` round-trips
  (incl. M/L/C/Z idempotence, arc→cubic normalization, `h/v/s/q/t` + S/T
  reflection per the SVG spec), **import of a real 9-vector Figma file**
  (every vector gets a path, path in node-local coords), export writes
  `VECTOR` + blobs, re-import matches every path (canonical multiset) and
  preserves sibling z-order
- **T) persistence**: a fake-IndexedDB backend proves `init`/`put`/`flush`/
  reload durability (files + edits + removals survive a simulated app
  restart), then the **localStorage fallback** path when `indexedDB` is
  absent
- **U) pen vector engine + shortcut registry** (spec §5/§6): `nodesToD`/
  `dToNodes` round-trips incl. a real-Figma-fixture path (byte-identical),
  insert/remove/convert (mirrored half-distance handles)/split/join, RDP +
  smoothD, segment projection, local-coordinate commit helper, and the
  shortcut registry (53 bindings, **zero conflicts**, deterministic
  order-insensitive dispatch incl. the `shift+/ → ?` normalization) — plus
  **V** — the boolean geometry engine (spec §7–8): exact areas for
  union/intersect/subtract/exclude, holes under even-odd *and* nonzero
  winding, bar-across-hole subtract with a clean notched trace, bowtie
  idempotence, bezier flattening vs πr², miter offset, outline rings
  (center/inside/outside × round/miter, incl. the stroke-join physics that
  only the offset side of a sharp corner rounds), a real `.fig` fixture
  path, the §7 shape paths, world-space flatten, and the new Vector
  shortcut group

UI smoke (A–P): dashboard card/thumbnail, editor boot (15 tools), live edit
drives layout, tokens panel + exports, `.fig` export of a live doc, plus
**K** — Assets tab/panel, make-component from the inspector, present overlay
lifecycle, dev-mode code view, plugins modal (run built-in, output), versions
menu (add a named version) — **L** — Styles tab, add a component prop from
the inspector, constraints + resize-to-fit sections, PDF entry in the export
menu — **M** — alias chip + 🔗 buttons in the Tokens panel, library
components in Assets (update-all/unlink), and the plugin **UI panel**: 🖥
Open button, sandboxed iframe srcdoc carrying the RPC bridge, panel closes
with the plugins modal — and **N (UX foundation + drawing, spec Phase 1/2)** —
arrow + section creation via real pointer events, a pen path (3 clicks + Enter
→ exact local-coord `M 0 50 L 100 0 L 200 50 Z`), node-edit mode (world
cursor hit-tested in the vector's local space; inspector **Smooth** produces
the exact mirrored-handle cubic and keeps the world anchor), pencil
freehand → smoothed stroked vector, ⌘/ command palette (open/filter/close),
context menu vector ops (Make smooth rewrites the path), the registry-driven
`?` shortcuts reference, and the empty-state draw on a truly empty page —
and **O (vector booleans + regular shapes, spec §7–8)** — the three new
shape tools via real pointer drags (path bbox == node bbox), Union by
`⌘]`, Subtract by `⌘[`, Intersect by `⌘\`, Exclude from the context menu,
flatten, outline stroke (stroke → fill, measured ring 576), and the palette
finding the boolean commands — and **P (text auto-resize, spec Phase 3)** —
T-tool text fits its content on creation (28×20 for "Text"), inline editing
re-fits on blur (77×20), the inspector's four auto-resize buttons switch
modes live (auto-h 77×39 / auto-w 77×39 / fixed untouched), the active
button reflects the current mode, and a font-size change re-fits hug text.

P0 acceptance (A–Q, 132 checks): the agreed P0 acceptance standard run
end-to-end on the real app — **open → create → draw → layout → componentize →
tokenize → prototype → inspect → export** plus the interaction matrix
**create → edit → resize → transform → undo → save → reopen → export**. Every
check is measured (coordinates, sizes, areas, exact strings), not presence:
pointer-drawn shapes at exact geometry, real inspector fill/rename, handle
resize, duplicate/group/z-order, auto-layout wrap reflow (Δy=50), component
props + override-survives-update, token mode switching, present lifecycle,
dev-mode codegen, version restore, byte-for-byte undo×5/redo×5, save→close→
reopen, `.fig` export→import with per-type counts + measured vector areas +
full geometry/fill multiset + component/instance re-binding, corrupt-input
and quota-failure handling, and the nine-verb acceptance line on a fresh file.
**Q (rulers / grid / snapping)** adds the P0 UX closeout: default view state,
live magenta smart-guide line at the exact target edge, edge/center/origin
move-snaps (x **and** y axis), 6px tolerance boundary, Alt bypass, magnet
mode (Shift-gated), multi-select union-bbox snap, resize snaps on the moving
edge with the fixed edge untouched, the View ▾ menu toggles (rulers/grid
10·20·50/snap/magnet), view state staying out of the saved document, and the
⌘/ palette finding the view commands — plus measured ruler output
(1-2-5 adaptive labels, corner/edge positions skipped), grid stroke counts,
and snap-guide rendering.
This matrix is what caught **six** real bugs before they shipped (NaN handle
resize, the History `undo`/`redo` shadowing, version-restore wiping history,
Infinity group bounds, **duplicate window pointer/key listeners leaking per
file-open** — stale runs re-computed drags from current node state and
silently undid snapping — and **the y-snap delta living in the wrong field**
(`dx` on both axes), which turned every vertical snap into a NaN box) — see
the session log in ROADMAP.md.

The try-app journey walks the *actual* app (same modules `index.html` loads)
through all 19 steps — the last one being **text auto-resize, Figma's four
modes (fixed / auto width / auto height / auto w+h)**, creating a text
node via the T tool, editing it inline, and switching modes with measured
refits (252×20 natural → auto-h keeps the 252 width, h grows to 39; fixed
stops tracking content) — the one before it covering **vector booleans +
outline stroke + regular shapes on real geometry (spec §7–8)**, printing the
measured result areas — the one before that covering **pen + node editor +
pencil + arrow + section + palette + shortcut registry** (spec Phase 1/2) — and
additionally exercises present-mode state, the
plugin API on a real node, a clean collab join/leave, component props,
constraint resizing, text styles, a real PDF write, and (16) the whole
ecosystem trio: linking a second local file as a library and watching a
source edit flow through an instance update, a variable alias resolving
per-mode + exporting as `var()`, and opening the sandboxed plugin UI panel
with its RPC whitelist enforced.

Rebuilding the `.fig` bundles after a reset:

```bash
cd figlib
npm i
npm run build        # or: node scripts/ensure-build.mjs (builds only what's missing)
```

## `.fig` compatibility — measured against real Figma files

Verified by decoding **four real Figma files** (OpenFig-org/openfig-core test
fixtures, kept in `figlib/ref/real/`) with our parser:

| File | Version | Contents | Result |
|------|---------|----------|--------|
| `circle.fig` | 101 | FRAME + ELLIPSE (red circle, stroke) | decoded, imported 1:1 (fill/stroke/size/pos exact) |
| `OpenFigs.fig` | **106** | FRAME + VECTOR | decoded via embedded schema (newer than our v101 export); vector path decoded |
| `circle-and-rounded-rectangle-outline-stroke.fig` | 101 | 4 × VECTOR | decoded; all 4 paths recovered (bbox == node size) |
| `word-outline-stroke.fig` | 101 | FRAME + 9 × VECTOR | decoded; all 9 paths recovered, re-export round-trips exactly |

Header (`fig-kiwi` v101), chunk layout, 550-def kiwi schema, and ZIP members
(`canvas.fig`/`meta.json`/`thumbnail.png`/`images/`) are structurally identical
to real Figma output. Of the **40 distinct node fields** those real files use,
our converter maps **24** (including `horizontalConstraint`/
`verticalConstraint` — round-tripped as our constraints — `resizeToFit`, and
**`vectorData`/`fillGeometry`** — decoded/re-encoded as real path data); the
rest cluster into: remaining vector-editing fields
(`strokeGeometry`, `arcData`, `strokeJoin` — the editable vertex/tangent
network and arc metadata are flattened to a path, not modeled), frame-background
model + per-side borders (`backgroundColor`, `border*Weight`,
`frameMaskDisabled`, `proportionsConstrained`), and metadata (`editInfo`,
`exportSettings`, `autoRename`, `documentColorProfile`, `internalOnly`).

## Known limitations (honest list)

- Exported `.fig` files round-trip through our parser and encode
  schema-conformantly (the kiwi encoder enforces required fields like
  `fontName.postscript`); they have **not** been opened inside the commercial
  Figma app from this sandbox.
- **Vector nodes round-trip their geometry, not their editability.** Import
  decodes each vector's `commandsBlob` (all `fillGeometry` parts, with a
  `vectorNetworkBlob` fallback) into a path that renders on canvas / SVG / PDF;
  export re-encodes the path back into both a `commandsBlob` and a rebuilt
  `vectorNetworkBlob`, so vector-heavy files round-trip their *shape* exactly
  (verified against `word-outline-stroke.fig`). What is still lossy: Figma's
  editable vertex/tangent handle model, `strokeGeometry` (outline offset),
  `arcData`, and `strokeJoin` are flattened into the path rather than modeled —
  a vector opened back in Figma is the same silhouette, not the same
  handle-by-handle network.
- Figma's float32 quirk: some colors round-trip shifted (e.g. `#33aaff` →
  `#4dccff`, from `0.3*255 = 76.500003 → 77`).
- Files persist in **IndexedDB** (one browser, multi-MB) with a `localStorage`
  fallback where IndexedDB is unavailable (then the ~5 MB per-origin quota
  applies; a save that exceeds it flags `Model.store.quotaError`, toasts an
  actionable warning, and the in-memory document can still be exported to
  `.fig`). Persistence is per-browser-profile: there is still no cross-device
  sync, sharing, or server-side history — that is the Penpot-server / Option-B
  step.
- **Multiplayer is same-origin** (browser tabs on the same machine/origin via
  `BroadcastChannel`). The message protocol is relay-shaped, so a WebSocket
  relay would extend it cross-machine — but that relay isn't built.
- **Vector booleans are real geometry, but not curve-preserving.** Union /
  subtract / intersect / exclude, flatten, outline-stroke, and offset are
  implemented in `src/boolean.js` on **real vector geometry** (spec §7–8):
  exact edge splitting + region parity, holes and self-intersections
  included — every test area matches its analytic value. The documented
  deviations: results are **polylines** (input curves are flattened at
  0.25 px; Figma keeps the original arcs — arc-preserving clipping is not
  built), offset/outline **skip open subpaths** (no fill to offset), round
  joins approximate corner arcs with chords (≤ π/8 per segment), and stroke
  joins follow real stroke physics (a round join rounds only the side the
  offset opens up).
- **Documented `.fig` export deviations (new this round):** `arrowEnd`
  (arrow) and `section` (section frame) are Penfig-only flags — Figma has no
  equivalent node types, so they export as a plain line/frame and the
  arrowhead/section styling is lost in the round trip. Pen-drawn paths
  default to a `#111111` solid fill (Figma's pen default is a stroke; this is
  a deliberate, documented choice so filled vectors render identically in
  canvas/SVG/PDF).
- PDF export writes a spec-valid single-page PDF 1.4
  (shapes + real vector paths + Helvetica text), verified structurally; it has
  not been opened in a commercial PDF viewer from this sandbox.
- Variable aliases and shared libraries exist but are **client-side
  equivalents**: aliases are per-mode references within one file; libraries
  link *other local files in this same browser* (the local store), not a
  remote team library server — cross-file "who has the latest" coordination
  needs a backend.
- Plugins run **locally only** (snippets in localStorage) in a sandboxed
  panel; there is no plugin marketplace/distribution, and the RPC surface is
  deliberately a small whitelist.
- Present mode transits between tops/pages with none/fade/slide/overlay/
  scroll; Figma's variables-in-prototype and conditional logic are not
  modeled.
- **UX gaps, measured 2026-08-25 (5):** rulers + line grid + Figma-style
  smart-guide snapping (move / multi-select / resize, 6px tolerance, Alt
  bypass, magnet mode) are built and acceptance-tested — but the guides
  carry **no distance labels**, **rotation does not exist** (no model field),
  there is **no image placement/crop/replace tool** (images exist only as
  `.fig` import/export IMAGE fills), and text has **no per-selection rich
  styling**. Rulers and the line grid have no Figma equivalent to match
  pixel-for-pixel (Figma ships neither) — they are spec §34/UX additions;
  snapping follows Figma's documented behaviors.

## Figma product ecosystem score (measured, Aug 2026)

Each dimension scored against the corresponding Figma product surface; the
numbers reflect what is **built and tested** in this codebase (487/487 tests +
20-step e2e), with the honest gap stated. Per the update spec (§0), the old
“88%” was an **ecosystem** score over 10 dimensions — it is **not** a Figma
parity score, and it is reported as such below. This round adds **three newly
measured dimensions** (Drawing/Vector, Typography, UX muscle memory) from the
spec's Phase 1–3 scope, measured the same way (built + tested, gap stated).

**Legacy 10-dimension average: 88%** (unchanged this round; Files 80→90 and
Plugins 80→88 were the previous round's gains; vectors: `.fig` field coverage
22/40 → 24/40).

| Dimension | Score | What is measured-working | Honest gap |
|---|---|---|---|
| Design system | 95% | components · variants · instances · bool+text props (name-bound, overrides survive updates), shared libraries with update-all/unlink, text+paint styles | libraries are local-store-based; no cross-browser distribution |
| Tokens (variables) | 95% | sets/modes/live switching, per-mode aliases (cycle-guarded), W3C JSON + CSS export/import, `.fig` round-trip of per-mode values | no variables-in-prototypes / conditional logic |
| Plugins | 88% | async `penfig` API executing in a **sandboxed Web Worker** (separate realm, whitelisted `postMessage` RPC, 15 s timeout) with labeled local fallback; UI plugins in a sandboxed iframe; 5 built-ins + persisted custom plugins | no marketplace/distribution; deliberately small RPC surface |
| Auto layout | 100% | custom engine (measure→distribute→place, **not flexbox**): wrap + cross-axis gap, 5 primary-axis modes, grow/fill weights, min/max, absolute children, reverse, constraints + resize-to-fit | (parity with Figma's implemented semantics; canvas, not WebGL, renderer) |
| Dev mode | 100% | measure overlay (W/H, x/y, edge distances), CSS/HTML codegen, per-node annotations | — |
| Export | 100% | PNG (canvas), SVG (pure JS), PDF (pure JS spec-valid 1.4 with real vector paths), `.fig` (v101 kiwi, real `VECTOR` blobs, `SYMBOL`/`INSTANCE` component round-trip) | exports not yet opened in real Figma / a PDF viewer from this sandbox |
| Prototyping | 80% | present mode, 5 transitions (none/fade/slide/overlay/scroll), node & page targets | no branching / conditional logic |
| Collaboration | 58% | same-origin multiplayer (cursors, selection, LWW doc sync via `BroadcastChannel`) | same-origin only — no cross-machine relay, presence/permissions |
| Versioning | 75% | named whole-document snapshots + restore | no autosave timeline, no diffs, local only |
| Files (dashboard + persistence) | 90% | **IndexedDB** durable store (multi-MB; fake-IDB tested: edits/removals survive reload) + localStorage fallback with quota toast, thumbnail dashboard, new/import/export/rename/duplicate/delete | client-only by design: no cross-device sync, sharing, or server-side history (that is the Penpot-server / Option-B step) |

**Newly measured this round (spec Phase 1–3 scope):**

| Dimension | Score | What is measured-working | Honest gap |
|---|---|---|---|
| **Drawing & vector** (§6–8) | 85% | Pen tool: open/closed paths, corner + smooth nodes, **node editor** (select/move/add-on-segment/delete, independent + mirrored handles, convert corner↔smooth, split, close — tested headlessly + via pointer events), Pencil (RDP simplification + cubic smoothing), arrow (arrowhead in canvas/SVG/PDF), section, vector path ⇄ `.fig` round-trip, **boolean geometry on real vector math** (union/subtract/intersect/exclude with holes + nonzero winding, flatten, outline stroke with real stroke-join physics, miter offset — all areas measured against analytic values), **Polygon/Star/Triangle tools** (path bbox == node bbox) | results are polyline-flattened (not arc-preserving like Figma's booleans); offset/outline skip open subpaths; round-join arcs are chord-approximated; no boolean *edit* UI (no Figma-style separate "Path" sub-layers / "Path" panel state machine) |
| **Typography** (Phase 3) | 55% | text nodes: 12 font families, size/weight/line-height/tracking/italic, alignment (h+v), wrapping, inline editing, text styles, `.fig` font round-trip (Helvetica), **text auto-resize — Figma's four modes** (new text hugs content; auto w+h / auto width / auto height / fixed; drag-a-hugging-axis fixes it; re-fits on content/font/size changes; `textAutoResize` round-trips in `.fig`) | no variable fonts, no OpenType features, **no rich text (per-selection inline styles — next slice)**, no outlined/converted text, canvas text rendering, limited font coverage beyond local families; "auto width" has no `.fig` enum value (exports as `NONE` — documented) |
| **UX / interaction** (§4/§5/§29–§33) | 78% | 15 tools (12 Figma-key + 3 shape tools), **central shortcut registry** (53 bindings, **0 conflicts** — conflict detection itself is tested; `?` sheet rendered from the same table; Figma's boolean keys `⌘]`/`⌘[`/`⌘\`/`⇧⌘\` + `⇧⌘F` flatten), ⌘/ command palette (fuzzy search, keyboard nav), Figma-style context menus (incl. vector ops, **boolean ops + outline stroke**, 4-way z-order, copy/paste properties), marquee/shift/alt selection, shift-resize, Tab cycling, empty states, **actionable error toasts** (export-backup / try-again), **rulers** (top+left, adaptive 1-2-5 ticks/labels, origin markers, View ▾ toggle), **line grid** (10/20/50, under content, never exported), **smart guides + snapping** (Figma object edges/centers + page origin, 6px tolerance, magenta guide lines while dragging, Alt bypass, magnet mode = snap only with Shift, works for move + multi-select union bbox + resize moving edge, all measured in acceptance Q) | no rotation at all, no image placement/crop/replace, no rich text per-selection styling; snapping has no Figma-style distance labels on the guides; rulers/grid/magnet have no Figma key bindings (Figma ships no keys for them either — View ▾ menu + ⌘/ palette only); full UI polish audit pending |

**Legacy 10-dimension average: 88%** (the ecosystem score — see above why it
is *not* a parity number). **Expanded 13-dimension average: 84.5%**
((88×10 + 85 + 55 + 78) / 13) — the new, lower-scoped drawing/typography
dimensions dilute the mean, which is the honest reading: feature parity with
*important Figma Design workflows* (§52 target: 90%+) is **not yet met**;
the roadmap (ROADMAP.md, per spec §49) tracks the remaining phases —
typography depth (Phase 3), arc-preserving booleans (Phase 2 polish),
`.pfg` native format (Phase 7), collaboration server (Phase 8). The two
sub-60/75 items (collab, versioning) and the client-only file boundary are
the standing gap; the [Penpot migration plan](../penpot/PENPOT_MIGRATION_PLAN.md) is the path that
closes them server-side.

## Relationship to Penpot

Penfig is the reference implementation for making
[Penpot](https://github.com/penpot/penpot) Figma-like. The Penpot repo clone at
`/home/user/penpot` contains the plan and the building blocks:

- `figma-tools/fig2json.mjs` — offline `.fig → JSON` CLI (the import building
  block; Penpot's `dashboard/import.cljs` today only accepts `.penpot,.zip`)
- `FIGMA_UPDATES.md` — full parity status + roadmap (`.fig` I/O, variables,
  auto-layout engine port, Figma-style dashboard) with the real Penpot files
  each item maps onto
- `PENPOT_MIGRATION_PLAN.md` — **Option B**, the executable plan to port this
  Figma-format surface into real (server-backed) Penpot: the chosen
  client-decode → backend-RPC architecture, the `.fig` → `binfile/v1` data
  mapping, repo layout, Docker, MPL-2.0 licensing, and a phased
  scope/acceptance plan
