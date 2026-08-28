# Changes made to arco-native-x-test-v03

## 1. Fixed a real compile error the README's "cargo test/cargo run" claim missed
`Color::with_alpha()` / `.alpha()` don't exist on this project's pinned
`vello`/`peniko` version — only `with_alpha_factor(f32)` does (and it
already does exactly what the code was manually trying to compute: existing
alpha × factor). This affected all 3 fill call sites (Rect, Ellipse, Line).
As shipped, this crate did not compile — worth knowing, since it means the
README's stated verification either wasn't run against this exact
dependency tree, or wasn't run at all before packaging.

## 2. Verified claims in the README against the actual code (not just read them)
- **Confirmed real**: scene graph, transforms, viewport culling, dirty
  counting, deterministic 10K/50K stress scenes. All covered by passing
  tests.
- **Confirmed overstated**: "variables/tokens: color and number
  resolution" — `Variables.numbers` is stored but never read/resolved
  anywhere. "component + instance property overrides" — `Node.overrides`
  is stored but never applied to anything. Both are inert data fields, not
  working systems, as of this version.
- **Confirmed via actual run output, not just reading**: `Text`,
  `Vector`, `Component`, and `Instance` node kinds have an empty match arm
  in `encode()` — they render nothing. The demo scene's own printed stats
  prove it: `nodes=4 paths=2` (only the rect and ellipse produced draw
  calls; the text node did not).

## 3. Restructured as a real lib + bin crate
Was a single `main.rs` (binary-only). Split into `src/lib.rs` (all the
actual model/scene/render logic, now testable and reusable) + a thin
`src/main.rs` that just builds the demo scene using the library. This
was necessary to add a second binary without duplicating code.

## 4. New: `src/bin/render_headless.rs` — actual rendered pixels
Builds a real `wgpu` device (software Vulkan/`llvmpipe` in this sandbox —
a real GPU on any actual machine), runs the demo scene through
`vello::Renderer::render_to_texture`, copies the result off the GPU, and
writes `render_output.png`. This is the strongest verification available
without a live window: real rendered output, not draw-op counts or
compiling code. See `render_output.png` — a visibly rotated (22.5°)
rounded rectangle with correct corners, and a circle whose muted color
confirms 0.75-opacity alpha blending is working correctly.

Required installing `mesa-vulkan-drivers` + `vulkan-tools` in this sandbox
(not present by default; a real dev machine with a GPU wouldn't need the
software driver).

## Toolchain note (same as the earlier renderer PoC)
Built against Rust 1.75 via apt with a chain of transitive dependency pins
(`indexmap`, `hashbrown`, `num_enum`, `proc-macro-crate`, `pxfm`,
`moxcms`) worked around to avoid edition2024 requirements this sandbox's
Rust can't satisfy (can't reach `rustup.rs` from here to get current
Rust). Also swapped the `image` crate for the lower-level `png` crate
directly — `image`'s PNG path pulls in modern color-management
dependencies (`pxfm`/`moxcms`) with the same edition2024 problem, which
`png` alone avoids. None of this pinning should be necessary on a real
machine with current Rust via `rustup`.

## Verification
- `cargo build` — clean (warnings only, no errors).
- `cargo test` — 5/5 pass.
- `cargo run --bin arco_native` — runs, matches expected output.
- `cargo run --bin render_headless` — runs, produces a correct PNG
  (visually confirmed).

---

# Session 2 — closed the two gaps flagged as stubs

Both gaps identified in session 1 (`Variables.numbers` unused,
`Node.overrides` unapplied) are now real, wired-up, tested features —
not just added methods.

## 5. `Variables::number()` wired into Auto Layout gap/padding
Added `AutoLayout.gap_var`/`padding_var: Option<&'static str>`. When set,
`apply_auto_layout` (now takes `&Variables`) resolves the gap/padding from
the variable, falling back to the struct's literal value if the variable
name isn't defined. Two new tests: one proving the variable value is what
actually drives layout (not the fallback), one proving the fallback
behavior when the variable is missing.

## 6. Instance -> Component resolution, with real fill overrides
- `collect_components()` walks the tree once per `build_scene()` call,
  building a name -> `&Node` registry of every `Component` node.
- Encoding an `Instance` node looks up its component by name and encodes
  the component's children in the instance's place — the component
  definition itself renders nothing directly (matches the existing
  no-op-for-`Component`-kind behavior), only what's actually instanced
  does.
- `Node.overrides` (`HashMap<id, hex color string>`) is now read: any
  descendant of the resolved component whose id matches an override key
  gets that fill color instead of its own, via a new `effective_fill()`
  used everywhere a fill was previously resolved directly. Overrides
  propagate to all nested descendants by id (not just direct children),
  but a nested `Instance` inside the resolved subtree switches to *its
  own* overrides rather than inheriting the outer instance's — matches
  how per-instance overrides actually behave in comparable systems.
- **Cycle guard**: a `MAX_INSTANCE_DEPTH` (32) stops a component that
  (directly or transitively) instances itself from recursing forever.
  Added a test that builds exactly that malformed document and asserts
  the render terminates rather than hanging or overflowing the stack.

4 new tests (10 total, up from 5+1): instance resolution renders the
right number of paths, overrides change the resolved color (tested
directly against `effective_fill`, matching this suite's existing style
of asserting on resolved values rather than decoding vello's opaque
`Scene` encoding), the missing-variable fallback, and the cycle guard.

## 7. Visual re-verification
Extended `render_headless.rs`'s demo scene to include the hidden master
component + 3 instances (two overridden, one not) alongside the existing
rotated/rounded card and translucent dot, re-ran the real headless GPU
render, and looked at the actual output. First attempt revealed a real
demo-composition mistake (not a library bug): placing the hidden master
*inside* the auto-layout row still consumed layout space — a hidden node
isn't a zero-width node — pushing the last button off the 800px canvas
entirely. Moved the master outside the row (the correct pattern), re-ran,
confirmed all 5 expected shapes render with correct colors, including the
non-overridden instance correctly falling back to the component's own
default fill (visible as a subtle tonal difference from the background,
not just "nothing rendered").

## Verification (session 2)
- `cargo build` — clean.
- `cargo test` — 10/10 pass.
- `cargo run --bin arco_native` and `cargo run --bin render_headless` —
  both run correctly; the headless render's output was visually inspected,
  not just assumed correct from exit code 0.

---

# Session 3 — v0.4: every roadmap phase gets a working native slice

Scope: everything that can run and be verified headless in this sandbox.
Phase 1 (winit window) needs a display; all editor ops were built
UI-independent so the window layer is now purely event translation.

## New modules
- `src/editor.rs` — hit testing (rotation/ellipse/lock aware), marquee,
  command-log **undo/redo**, move/resize/rotate/fill/text/delete/z-order,
  group/ungroup (snapshot-undo), align/distribute, snapping, constraints,
  prototype Player, SpatialGrid (100K nodes ~20ms build, ~10µs queries),
  version checkpoints, dev-mode CSS export.
- `src/text.rs` — Text nodes now draw real vector glyphs (built-in
  16-segment stroke font); v0.3's empty match arm is gone.
- `src/fileio.rs` — versioned `.x` JSON format with zero-dependency
  writer + parser (byte-stable double roundtrip, forward-compatible),
  plus SVG export.

## lib.rs upgrades
- gradients (linear/radial), per-corner radii, drop shadows, blend modes
  (real Vello mix layers), strokes on rects
- Auto Layout v2: cross-axis align, space-between, cross-axis hug,
  recursive solve
- Variables v2: strings/bools, aliases (cycle-limited), modes (light/dark)
- typed overrides: `text:` prefix replaces Text content per instance
- all `&'static str` model fields replaced with owned `String` (Phase 0)

## Verification (session 3)
- `cargo test` — **45/45 pass** (was 10).
- `cargo run --bin arco_native` — scripted editor session prints verifiable
  results for every phase slice (undo/redo roundtrip, .x roundtrip stable,
  prototype navigation, spatial-index speedup vs full-tree hit test).
- `cargo run --bin render_headless` — re-rendered on real (software) GPU;
  output now also shows: gradient bar, vector text "X NATIVE 0.4",
  drop shadow under the rotated card. Visually inspected.

---

# Session 4 — v0.5: window shell + vectors + interop + smart animate

## Phase 1: `x_native_app` — the actual windowed application
winit 0.29 + wgpu surface + `render_to_surface`, camera pan/zoom, click &
drag editing, keyboard shortcuts, save/load `document.x`, selection
overlays. Every interaction is a thin translation onto the already-tested
`Editor` — no editing logic lives in the window layer. Verified to compile
here (no display in sandbox); run on a real machine.

## Phase 2.6: NodeKind::Vector became real
`Vector { path_count }` (inert metadata since v0.3) is now
`Vector { path: Vec<PathCmd> }` — Move/Line/Cubic/Close in local coords —
rendered as real filled + stroked paths, serialized in `.x`, exported to
SVG, and drawn in render_output.png (the gold star).

## Phase 2.7: copy / paste / duplicate
Clipboard of cloned subtrees; paste remaps every id in the subtree against
the full document id set; insert goes through the command log so undo
removes pasted nodes cleanly.

## Phase 7.4: SVG import
Hand-rolled XML lexer (attrs, self-closing tags, comments) + element
parser. Imports rect/circle/ellipse/line/path/text/g with fills, rx,
opacity, translate/rotate, and a real `d`-attribute parser (absolute +
relative commands, H/V shorthands). Round-trip test: export our page to
SVG, re-import, shape kinds/counts/renderability all assert.

## Phase 8.3: smart animate
`smart_animate(from, to, t)` matches nodes by id and lerps
position/size/rotation/opacity/solid-fill; unmatched nodes fade in/out.
Mid-frame is a plain renderable Node — proven by rendering t=0.5 of a
red→blue morph in render_output.png (the purple box, exactly halfway in
position, size, and color).

## Verification (session 4)
- `cargo test` — **55/55 pass** (was 45).
- `cargo build --bin x_native_app` — compiles clean against winit 0.29.
- `cargo run --bin arco_native` — new sections print verifiable results:
  paste ids + undo, star renders 1 path, SVG re-import renders 13 paths,
  smart-anim midpoint x=100 w=150 fill=#800080.
- `cargo run --bin render_headless` — updated PNG visually inspected:
  star + smart-animate mid-frame present and correct.

---

# Session 5 — ran the actual windowed app (Xvfb) and click-tested it

No physical display in this sandbox, so: Xvfb virtual X server (1280x800)
+ xdotool for real mouse/keyboard events + screenshots of the live window.
This is the actual `x_native_app` binary running its real winit event loop
and wgpu surface (llvmpipe software Vulkan) — not a mock.

## One real bug found and fixed by doing this
`x_native_app` hardcoded `Rgba8Unorm` as the surface format; the X11
surface only offers `Bgra8UnormSrgb`/`Bgra8Unorm`, so the app panicked on
`Surface::configure`. Now queries `surface.get_capabilities()` and picks a
supported non-sRGB format. This would have crashed on many real Linux
machines too — exactly the kind of thing only actually running it reveals.

## Interactions verified with screenshots (app_screenshot_*.png)
1. App opens, demo document renders in-window (title "X Native", 1280x800).
2. Click on card -> blue selection outline + corner handles appear.
3. Drag -> card moves with the cursor, outline tracks it.
4. Ctrl+Z -> drag segment undone (visible position step-back).
5. Ctrl+D -> duplicate appears offset behind the original, selected.
6. Ctrl+S -> `document.x` written; contains `"id":"card-copy"` proving the
   duplicate went through the command log into the saved file.
7. Ctrl+scroll -> zoom-to-cursor (screenshot at ~2x, text glyphs scale
   crisply — vector text, not bitmaps).

Sandbox prerequisites (a real desktop needs none): Xvfb, xdotool,
libxkbcommon-x11 (+ unversioned .so symlink), XDG_RUNTIME_DIR set,
mesa-vulkan-drivers for llvmpipe.

---

# Session 6 — v0.6-beta.1: the beta app

`x_native_app` grew from a proof-of-life shell into a usable beta editor.
All chrome is drawn by Vello itself (same renderer as the document; the
built-in vector font renders every label) — no UI toolkit dependency.

## New in the app
- Toolbar: Select/Frame/Rect/Ellipse/Line/Text tools (click or V/F/R/O/L/T)
- Drag-to-create shapes on canvas (undoable Insert via command log)
- Marquee selection when dragging empty canvas with Select
- Resize handles on single selection (opposite corner stays pinned)
- Layers panel: live tree, indented, click / shift-click to select
- Inspector: id/kind/x/y/w/h/opacity + 8-swatch fill palette (undoable)
- Arrow-key nudge (Shift=10px), Ctrl+]/[ z-order, Ctrl+E SVG export,
  Esc to deselect, live zoom % display, status bar messages
- Drag gestures merge into ONE undo step (`Editor::merge_last`)

## Engine additions (tested)
- `Editor::merge_last` / `undo_depth` — gesture merging (test:
  three 5px moves + merge -> single undo returns to origin)
- `Editor::insert_node` — undoable programmatic insert (test)

## Click-tested live in Xvfb (beta_*.png, all visually verified)
1. Launch: chrome + demo doc render, layers panel lists the tree.
2. Canvas click -> selection outline + handles + panel row highlight +
   live inspector properties.
3. Inspector swatch click -> card recolored green, undoable, logged.
4. R + drag -> "r-1" rect created exactly under the drag (W:300 H:200
   in inspector), auto-selected, appears in layers panel and saved file.
5. Corner-handle drag -> resized to W:467 H:300, status "RESIZED".
6. Layers-panel click on TITLE -> selects the text node on canvas.
7. Ctrl+E + Ctrl+S -> export.svg (with gradient defs) + document.x
   (contains r-1 with resized W/H and card fill #2ecc71).
8. Ctrl+Z -> the whole resize gesture reverts in one step (W back to 300).

`cargo test`: 57/57 pass.

---

# Session 7 — v0.6-beta.2: text editing, rotate, fields, pages

## New in the app (all click-tested live in Xvfb, beta2_*.png)
- **Inline text editing**: double-click a Text node -> yellow edit frame,
  live character-by-character preview on canvas, status echoes the buffer,
  Enter commits (undoable via SetText), Esc restores the original.
  Verified: retyped title to "HELLO BETA", committed, persisted in .x.
- **Rotate handle**: knob + stem above single selection; drag rotates
  around center, Shift snaps to 15° steps, gesture merges to one undo.
  Verified: card rotated to 92° (status + inspector + saved file agree).
- **Numeric inspector fields**: click X/Y/W/H box -> yellow active state,
  type digits, Enter applies (Move/Resize through the command log).
  Verified: W set to 400 exactly.
- **Multi-page**: tab bar in the top bar, "+" adds a page, switching
  stores/restores each page's tree; Ctrl+S saves ALL pages.
  Verified: page-2 created, ellipse drawn on it, switch back intact,
  document.x contains both pages ('page-1','page-2' with 'o-1').

## Notes
- Focused edits capture the keyboard entirely (no tool-shortcut leaks).
- Text cancel restores content without polluting the undo stack.
- 57/57 engine tests still pass; app builds clean.

---

# Session 8 — v0.7-beta.3: images, presentation mode, smart guides, opacity

## Engine (60/60 tests, was 57)
- `Assets` (Phase 4.2): PNG decoding (rgba/rgb/gray/gray-alpha -> RGBA8)
  via the existing `png` crate; `build_scene_with_assets` draws real
  bitmaps for Image nodes via `Scene::draw_image`, placeholder otherwise.
  Test writes a real PNG, decodes, renders, asserts.
- `alignment_guides` (Phase 2.10): edge/center match detection against
  every other visible node. Tests: edge match, center match, no-match.
- `Command::SetOpacity` + `Editor::set_opacity`, undoable. Test.

## App
- **Image assets**: PNGs in ./assets/ auto-load by filename stem; an
  Image node with that asset name renders the actual bitmap. Verified:
  injected a 'photo' node referencing 'checker' -> checkerboard rendered
  on canvas, scaled into its 256px box, listed in layers panel.
- **Presentation mode** (Ctrl+P): full-window black-backed playback,
  page fitted to screen, click advances pages with a 350ms ease-in-out
  SMART-ANIMATE transition (live use of `smart_animate` per frame),
  Esc exits. Screenshot mid-transition shows the interpolation actually
  rendering (all shared shapes mid-fade, page frame mid-morph).
- **Smart guides**: red alignment lines across the canvas while dragging
  a single node, tolerance 3px, edges + centers. Screenshot shows 3
  horizontal guides while the dot aligns with its row neighbors.
- **Opacity control**: -/+ buttons in the inspector, 0.1 steps, undoable.
  Verified 0.8 -> 0.5 after 3 clicks, persisted through Ctrl+S.

All verified live in Xvfb (beta3_*.png).

---

# Session 9 — v0.7-beta.4: auto-layout controls in the UI

## Engine (61/61 tests)
- `Command::ReplaceNode`: whole-node swap command for mutations with wide
  side effects; inverse is the reverse swap.
- `Editor::set_auto_layout(id, Option<AutoLayout>, &vars)`: sets/clears a
  frame's layout AND re-solves child positions as ONE undoable command.
  Rejects non-frames. `auto_layout_of(id)` reads current config.
- Test: apply -> children restacked; one undo -> original scattered
  positions AND no layout; redo; clear keeps positions; non-frame rejected.

## App: LAYOUT section in the inspector (frames only)
- NONE / H / V direction buttons (active one highlighted)
- GAP and PAD -/+ steppers (4px, floor 0), live re-flow on every click
- defaults on first enable: gap 16, pad 16, cross-axis center

## Click-tested live in Xvfb (beta4_*.png)
1. Select PAGE-1 -> LAYOUT section appears showing H / GAP 24 / PAD 40.
2. Click V -> entire page re-stacks vertically, center-aligned, instantly.
3. GAP + twice -> 24 -> 32, spacing visibly widens.
4. Ctrl+Z x2 -> back to horizontal gap 24 (screenshot verified).
5. Ctrl+Shift+Z x2 -> vertical gap 28 again; saved file confirms
   `dir v gap 28`.

## Real bug found by live-testing (and fixed)
Redo was dead: with Shift held, winit delivers the UPPERCASE character
("Z"), so the `"z"` match arm never fired for Ctrl+Shift+Z. Normalized
with `to_ascii_lowercase()`. Undo had always worked; only redo-by-
keyboard was affected — exactly the kind of bug only real input testing
catches.

---

# Session 10 — v0.8-beta.5: component workflow

## Engine (62/62 tests)
- `Editor::make_component(name)`: selection -> hidden master Component at
  the document root (members re-based to origin) + an Instance replacing
  the selection in place. Snapshot-undo (one step reverts everything).
- `Editor::place_instance(component, x, y)`: stamps a new uniquely-id'd
  Instance sized from the master. Undoable insert.
- `Editor::component_names()` for the assets UI.
- Test covers: instance replaces selection at collective origin, master
  hidden with re-based children, render resolves instances (path counts),
  second placement, undo of placement, undo of componentization.

## App
- **Ctrl+K**: create component from selection (auto-named ComponentN).
- **ASSETS panel** (bottom of layers): one row per component with a
  Figma-style purple diamond; click arms stamping, next canvas click
  places an instance there (status bar guides the flow).
- Layers panel shows INST rows and the hidden COMP master row.

## Click-tested live in Xvfb (beta5_*.png)
1. Ctrl+K on selection -> Component1-1 instance selected, COMP-COMPONENT1
   master in layers, COMPONENT1 in ASSETS with diamond.
2. Stamped Component1-2 and -3 via ASSETS click + canvas click.
3. Selected the MASTER's dot child in layers, clicked green swatch ->
   ALL THREE instances turned green simultaneously (live master->instance
   propagation, the core component value).
4. Saved file verifies: hidden master (visible:false), dot fill #2ecc71,
   instances Component1-1/-2/-3 on the page.

---

# Session 11 — v0.9-beta.6: prototype linking + tool polish

## New: prototype linking & click-through (Phase 8 completed in-app)
- Engine: `Command::SetPrototype` + `Editor::set_prototype` (undoable,
  clearable). Test: set -> undo -> redo -> clear.
- Inspector "PROTOTYPE" section: NONE + one button per other page;
  clicking links the selected node (350ms transition).
- Canvas: linked nodes show a purple "»" badge chip at their top-right.
- Presentation mode is now a real prototype player: clicking maps the
  cursor back into page space, hit-tests the page, walks ancestors for
  the nearest link, and smart-animates to THAT destination; clicking
  empty space still advances sequentially.
- Verified live: card linked to page-2 (badge visible), Ctrl+P, click ON
  the card -> transitioned to page-2; saved file has {'to':'page-2'}.

## Tool improvements (all verified live)
- **Hover highlight**: thin blue outline under the cursor (Select tool),
  suppressed for already-selected nodes and over chrome.
- **Shift = aspect-lock resize**: corner drag keeps w:h exactly —
  verified 260x160 -> 360x221.5, ratio 1.625 preserved to 4 decimals.
- **Ctrl+0 / Ctrl+1**: zoom 100% / zoom-to-fit (fit computed against the
  canvas area, verified at 49% for the 1600x1000 page).
- **Scrollable layers panel**: wheel over the panel scrolls rows (2/tick),
  "..." indicator when scrolled, click mapping accounts for offset.
- Layers wheel no longer pans the canvas underneath.

## Environment note
Sandbox lost apt packages + part of the cargo registry between sessions
(snapshots exclude caches); reinstalled and cleared ~/.cargo/registry/src
to force re-extraction. Source tree was unaffected.

63/63 engine tests pass.

---

# Session 12 — v0.10-beta.7: features & interface derived from Figma/Sketch docs

Sources mined this session:
- Figma "Access design tools from the toolbar" + "Tour the interface"
- Sketch "The Mac app interface"

## New tools (Figma toolbar parity)
- **Hand tool (H)** + **spacebar-hold temporary hand** (Figma tip verbatim):
  drag pans the canvas; space release returns to the previous tool.
- **Polygon (P)** and **Star (S)** shape tools (Figma's shape-tool menu):
  drag-create real vector nodes — regular hexagon and 5-point star path
  generators (`regular_polygon`, `star_path`) feeding NodeKind::Vector.
  Verified: s-1 saved with 11 path cmds, p-2 with 7.

## Interface (Sketch Mac-app parity)
- **Minimap** (Sketch #5): bottom-right overlay showing the page outline,
  top-level layers as colored blocks, and the current viewport rectangle;
  click anywhere on it to jump the viewport there.
- **Search Layers** (Sketch layer list): FIND box atop the layers panel;
  typing filters rows live by id or kind (verified: "vector" -> only the
  two vector layers). Esc clears, Enter keeps the filter.
- **Hide Interface** (Sketch ⌘. -> our Ctrl+.): full-bleed canvas with all
  chrome hidden, hint text in the corner, toggle back on.
- Big nudge (Shift = 10px) already matched Figma's default nudge values;
  kept as-is per the nudge doc.

All click-tested live in Xvfb (beta7_*.png): star+hexagon drawn on canvas,
search filtering, minimap present with viewport rect, hidden-UI mode,
space-pan.

63/63 engine tests still pass.

---

# Session 13 — v0.11-beta.8: Scale tool, frame presets, rulers/guides, outline view

Continuing through the Figma/Sketch doc mining.

## Engine (64/64 tests)
- `Editor::scale_node(id, factor)` — Figma's Scale tool semantics: scales
  the node AND subtree uniformly (sizes, child offsets, stroke widths,
  corner radii, vector path coords). One undoable ReplaceNode. Test
  verifies child offset/size/radius scaling and undo.
- Frames now RENDER their background fill (Figma: frames have fills,
  groups don't) — found because the phone-preset frame was invisible on
  canvas; fixed in encode() with drop-shadow support included.

## App
- **Scale tool (K)**: click selects, vertical drag scales the subtree
  live (200px = ±100%, clamped 20%–500%), whole gesture = one undo.
  Verified: phone frame 390x844 -> exactly 585x1266 (+50% for 100px).
- **Frame presets** (Figma's frame-tool panel): with Frame tool active,
  inspector lists PHONE/TABLET/DESKTOP/WATCH/SLIDE; click drops a
  preset-sized white frame. Verified: 390x844 phone frame created.
- **Rulers (Shift+R)**: top/left strips with labeled ticks every 100
  units; click a ruler to drop a cyan guide at that position; Ctrl+;
  clears guides.
- **Outline view (Ctrl+Y)**: wireframe rendering of the whole document
  (gray strokes, no fills), toggles back.

All click-tested in Xvfb (beta8_*.png).

---

# Session 14 — v0.12-beta.9: interface rebuilt to match Figma's layout

Per the Figma Design help category (nav/sidebar + right-sidebar articles):
- **Toolbar moved to a floating bar at the BOTTOM of the canvas** (Figma:
  "the toolbar at the bottom of the screen"). Click or keys to switch.
- **Left sidebar = Figma File tab**: PAGES section (click row to switch,
  "+ NEW PAGE" row) above the LAYERS panel with FIND; ASSETS below.
  Top-bar page tabs removed.
- **Right properties panel = Design | Prototype tabs** exactly like
  Figma's edit-access panel: Design holds position/size/rot/opacity/fill/
  auto-layout; Prototype holds the link-destination buttons (moved from
  the always-on section).
- FIGMA_PARITY.md added: full feature matrix vs the docs, including
  honest gaps (pen tool, comments, font shaping, variables UI).

Click-verified in Xvfb (beta9_*.png): layout renders, card select shows
Design tab, tab switch to Prototype, PAGE-2 link via Prototype tab
(badge appears), bottom-bar tool click (R) + drag creates R-1.
64/64 engine tests pass.

---

# Session 15 — v0.13-beta.10: Figma behavior parity wave

## Engine (69/69 tests, was 64)
- `click_figma` / `top_level_ancestor`: Figma's selection model — plain
  click = top-level object, Ctrl+click = deep select, shift toggles.
- `drill_into`: double-click descends one level toward the hit.
- `ungroup`: dissolves group/frame, children re-parented with world
  positions preserved, snapshot-undo, selects the children.
- `select_all`: page-level, or scoped inside a selected frame.
- `snap_delta`: magnetic move snapping (edge/center pull), separate from
  the visual guides.
- `set_pin`: undoable constraints change.

## App
- Selection: plain/deep/drill/Esc-to-parent all per Figma; double-click
  drill that lands on Text opens inline editing.
- Alt+drag duplicates the selection then moves the copy (Figma).
- Move drags now magnet-snap onto neighbors (4px/zoom) and show red
  guides only at exact alignment.
- Ctrl+G / Ctrl+Shift+G / Ctrl+A.
- Design tab: alignment button row (multi-select aligns selection;
  single selection aligns to page) + CONSTRAINTS picker (2x5 pins).

## Verified live (beta10_*.png + saved-file assertions)
- group -> plain click selects GROUP-0, ctrl+click selects GRAD inside.
- Esc from GRAD -> GROUP-0 ("SELECTED PARENT").
- Alt+drag -> card-copy in document.
- Ctrl+Shift+G -> children back at page level, group gone (file check).
- Constraints panel renders with active pins; click sets pin (undoable).

---

# Session 16 — v0.13.1-beta.11: selection visuals now match Figma, not Photoshop

User-reported mismatch: our selection had a rotate KNOB on a stem
(Photoshop/PowerPoint pattern). Figma has no knob at all.

## Now matching Figma exactly
- Selection chrome = tight blue outline + 4 small corner squares. Nothing
  else. No stem, no knob, no edge dots.
- **Dimension badge**: blue "W X H" pill centered under the selection,
  live-updating (Figma's size label).
- **Rotation = invisible ring outside the corners** (6..24px past each
  corner, only outside the bounds). Grab and turn — exactly how Figma
  does it. Shift still snaps to 15°.
- **Edge resize**: all four edges are grabbable (invisible 4px zones,
  corner zones win) for single-axis resize; opposite edge stays pinned;
  Shift aspect-lock applies to corners only (like Figma).

## Verified live (beta11_*.png + file assertions)
- Selection shows badge "220 X 130", no knob anywhere.
- Drag 14px outside TR corner -> rotated to 36 deg (status + inspector),
  badge still shows unrotated dims like Figma.
- Right-edge drag -> w 220->437, h unchanged 130 (file-verified).

---

# Session 17 — v0.14-beta.12: interface polish beyond Figma/Sketch

Goal: friendlier + more discoverable than both references.

## Visual refresh
- New softer theme (slate panels #24262b, deep canvas #1b1d21, hover tint).
- Floating panels get rounded corners + soft drop shadows (toolbar,
  minimap, tooltips, cards).

## Real tool icons (drawn as vectors by our own renderer)
- Cursor/hand/scale/frame-grid/rect/circle/line/hexagon/star/T icons in
  the bottom bar replace bare letters; hover highlights the slot and
  shows a TOOLTIP with the tool name + shortcut key — something neither
  Figma nor Sketch shows without a delay.

## Layers panel affordances
- Per-row fill COLOR CHIP (instant visual identification of layers).
- Hover a row -> eye + lock affordances appear; click toggles
  visibility / lock right in the list (Figma parity, discoverable).
  Verified via saved file: card visible=false, grad locked=true.

## Learnability (the "easier than Figma" part)
- "?" chip next to the toolbar + ? key -> full-screen KEYBOARD SHORTCUTS
  overlay (30 shortcuts, 3 columns). Esc or click closes.
- Inspector empty state = GET STARTED card (R/T/F/Ctrl+P/?) instead of
  a blank panel.
- Multi-selection state shows contextual hints (align row / Ctrl+G).
- Zoom widget in the top bar: [-] [100%] [+], click the % = zoom-to-fit.

All verified live in Xvfb (beta12_*.png). 69/69 engine tests unchanged.
