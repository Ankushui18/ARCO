# X Native v0.6-beta.1

The JS/ARCO editor is **reference-only**. This build picks its product
features from that reference but implements them in native Rust.

v0.4 turns the v0.3 scene-graph/renderer PoC into a full **headless editing
engine**: every roadmap phase now has a working, tested native slice.

## What's in this build

### Core editor model (v0.3, kept)
- scene graph / hierarchy; frames, groups, rects, ellipses, lines
- text, image, vector, component and instance node types
- x/y/w/h, rotation, scale, opacity, fills, strokes
- dirty-node tracking, viewport culling, deterministic 10K/50K stress scenes

### Phase 2 — Editing (`src/editor.rs`)
- transform-aware **hit testing** (z-order, rotation, ellipse shape, lock/hide)
- click / shift-click / **marquee selection**
- move, resize, rotate, set-fill, set-text — all through a **command log
  with full undo/redo** (structural ops use snapshots)
- delete (restores at the same index on undo), z-order ops, **group/ungroup**
- **align & distribute**, edge/center **snapping** with grid fallback
- **constraints**: pin left/right/center/stretch/scale on frame resize

### Phase 3 — Text (`src/text.rs`)
- Text nodes now draw **real vector glyphs** (built-in 16-segment stroke
  font, A–Z 0–9 punctuation, tofu boxes for unknowns) through the same
  Vello pipeline as every other node. `measure()` for layout.
- Upgrade path: swap the glyph source for `parley`/`cosmic-text`; the
  encode call site stays.

### Phase 4 — Visual fidelity
- **linear & radial gradient fills**, per-corner radii
- **drop shadows** (hard; Vello 0.1 has no blur primitive — modeled fields
  are ready for it), inner-shadow/blur effects modeled + serialized
- **blend modes** (multiply/screen/overlay/darken/lighten) as real Vello
  mix layers

### Phase 5 — Design systems v2
- Auto Layout v2: **cross-axis alignment, space-between, cross-axis hug,
  recursive solving** (`apply_layout_recursive`)
- Variables v2: color/number/**string/bool**, **aliases** (cycle-safe),
  **modes** (light/dark) with per-mode color tables
- typed instance overrides: fill (`#hex`) and **text (`text:...`)**

### Phase 6/7 — Documents & files (`src/fileio.rs`)
- `Document` with **multiple pages** + variable collection
- **`.x` v1 format**: versioned JSON, zero-dependency writer + parser,
  forward-compatible (unknown keys skipped, newer versions rejected),
  byte-stable double roundtrip
- **SVG export** (shapes, gradients, rotation, opacity, text)

### Phase 8 — Prototyping
- `Player`: click-to-navigate state machine over prototype actions,
  navigation stack with `back()`, transition metadata surfaced for animation

### Phase 9 — Performance
- `SpatialGrid` index: 100K nodes indexed in ~20ms, point queries in ~10µs
  (~700x faster than full-tree hit testing in the same sandbox)

### Phase 10 — Platform
- named **version checkpoints** (save/restore document states)
- **dev mode**: per-node CSS export (background, radius, shadow, rotation)

### v0.5 additions
- **Phase 1 — windowed app shell** (`src/bin/x_native_app.rs`): winit 0.29 +
  wgpu surface + live Vello renderer over the same headless engine. Click /
  shift-click select, drag-move with px snapping, scroll pan, ctrl+scroll
  zoom-to-cursor, Ctrl+Z/Shift+Z undo/redo, Ctrl+D duplicate, Delete,
  Ctrl+S/Ctrl+O save/load `document.x`, Figma-blue selection outlines with
  corner handles. Compiles headless; needs a display to run.
- **Phase 2.6 — editable vector paths**: `NodeKind::Vector` now owns real
  `PathCmd` data (Move/Line/Cubic/Close) and renders as filled+stroked
  Vello paths. Serialized in `.x`, exported to SVG.
- **Phase 2.7 — copy/paste/duplicate**: internal clipboard, recursive id
  remapping (`-copy`, `-copy-2`, ...), paste offset, fully undoable.
- **Phase 7.4 — SVG import**: zero-dependency XML lexer + parser for
  svg/g/rect/circle/ellipse/line/path/text, `d` attribute with absolute and
  relative M/L/C/H/V/Z, translate/rotate transforms, nested groups.
  Round-trips our own exporter output.
- **Phase 8.3 — smart animate**: id-matched property interpolation between
  frames (position/size/rotation/opacity/solid fill), fade-in for entering
  nodes, fade-out ghosts for exiting nodes; output frames are renderable.

## Run

```
cargo test                       # 45 tests
cargo run --bin arco_native      # scripted editor session + stats
cargo run --bin render_headless  # real GPU render -> render_output.png
```

`render_output.png` is rendered by a real wgpu device (llvmpipe software
Vulkan in a sandbox, a real GPU on an actual machine): gradient bar, vector
text, drop-shadowed rotated card, translucent blend-mode circle, and three
component instances (two overridden, one falling back to the master fill).

## Still ahead (needs a display / dedicated subsystems)

- Phase 1: `winit` + `wgpu` surface + live Vello renderer (windowed shell) —
  every editor operation here is already UI-independent and event-driven,
  so the window layer only translates input events into `Editor` calls.
- real text shaping (parley), image decoding, editable vector networks,
  GPU blur for shadow/blur effects, `.fig` importer, multiplayer/CRDT.
