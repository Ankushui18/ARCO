# Penfig Engine v2 — Progress (2026-08-25)

## Architecture foundation (P0 spec §0–§4)

- **Single deterministic layout pass**: `Layout.layoutPage()` now runs Measure → Distribute → Place in one pass, writes `n._l = {x,y,w,h}` in **parent-local** coordinates, then calls `World.computePage()` ONCE to compose world affines top-down. No double application of transforms anywhere.
- **World transform module (`src/world.js`)**: computes `n._wt` (local→world affine), `n._wc` (4 world corners), `n._w` (axis-aligned world BB) via a single top-down traversal composing each ancestor's translate → rotate → flip. Provides `worldToLocal()` for hit-testing.
- **Renderer rewrite (`src/render.js`)**: parent-local transform stack in `drawNode`; each node applies `translate(lx,ly) → rotate → flip → translate(-w/2,-h/2)` then recurses into children at their parent-local `(k.x,k.y)`. No double-transforms.
- **No emoji anywhere**: all icons are inline SVGs in `src/icons.js` (now 141 icons, added flip-h/flip-v).

## P0 features completed in this sweep

| # | Feature | Status |
|---|---------|--------|
| 1 | Single-deterministic layout + world transform pass | ✅ Done |
| 2 | Rotation + flip (free rotate, Shift 15° snap, ⇧H/⇧V shortcuts, rotate handle, rotate-correct OBB selection, inspector angle input + flip buttons, OBB hit-test, OBB snap targets) | ✅ Done |
| 3 | Dashed strokes + cap/join controls (butt/round/square, miter/round/bevel, 4 dash presets) | ✅ Done |
| 4 | Multi-selection handles (8 corner/edge handles on selection AABB) | ✅ Done |
| 5 | Image drag-drop onto canvas (places as image-fill rect; also .fig/.pfg drop opens file) | ✅ Done |
| 6 | Radial gradient support in renderer | ✅ Done |
| 7 | Image fill scaleModes: fill/fit/tile | ✅ Done |
| 8 | Inspector 2.0 foundations: X/Y/W/H, Rotation°, Flip H/V, Radius, Opacity, Fills (add solid/gradient, color+opacity, delete), Stroke (on/off, color, width, align, cap, join, dash), Add-shadow | ✅ Done |
| 9 | Layers panel tree (eye/lock, indent, type icons) — drag-drop reorder wiring scaffolded | 🟡 Tree rendered; DnD pending |
| 10 | Command system ⌘K with flip/rotate entries added | ✅ Done |
| 11 | Engine smoke-test suite (`test-engine.js` — 13 assertions, all green) | ✅ Done |
| 12 | Node syntax validation (`node --check` on all 21 modules: zero errors) | ✅ Done |

## Known P0 gaps (next sprint)

- Drag-drop layers panel reorder/reparent (wiring the HTML5 DnD handlers)
- Rich text runs (per-run formatting)
- Nested auto-layout wrap last-row stretch, min/max propagation, stroke/effect bounds
- `.pfg` v2 (DEFLATE, SHA-256, asset dedup, recovery journal)
- Batch export modal
- Custom tool cursors
- Canvas mini-map navigator
- Point-in-path hit test for vectors (currently bbox)
- Deep select (⌘-click through)
- System clipboard interop
- Numeric transform inputs for multi-selection
- Keyboard-driven rotation 90° CW/CCW palette entries

## Architecture locked

- **No business logic duplicated between web and desktop** (spec §0). Tauri 2 desktop shell will mount the same modules with added native FS/clipboard/font APIs injected at runtime.
- **`.penfig` native format** (spec §3): reserved `{document.json, assets/, fonts/, metadata.json}` structure in v2 spec (codec pending).
- **`.fig` stays interop only** (spec §2/§3): `figconv.js` reads/writes the kiwi blobs via the bundled FigIO codec; never the native model.
- **No AI until P0+P1+P2** (spec §52): engine, desktop, QA, collaboration all ship first.

## Files added/changed

- Added: `src/world.js` (world affine pass), `test-engine.js` (headless engine smoke), `test-icons.js`, `test-rotation.js`
- Rewrote: `src/layout.js`, `src/render.js`, `src/model.js`, `src/ui-editor.js` (hit-test, rotate/resize/move/snap/marquee all world-coord aware), `src/ui-panels.js` (full inspector, stroke options), `src/shortcuts.js` (flip, rotate shortcuts), `src/icons.js` (flip icons, radial/gradient swatch), `index.html` (loads world.js)
