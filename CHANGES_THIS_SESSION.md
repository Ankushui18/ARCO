# ARCO — changes made this session

## 1. Native dialogs → real dialogs (`src/dialogs.js`, new)
All 21 call sites using the browser's blocking `prompt()`/`confirm()`/`alert()`
now use a new `Dialogs.confirm/prompt/alert` (Promise-based, styled with the
existing `.pf-modal` system, Escape/backdrop-click aware). This was flagged
as the top "next competitive milestone" in `RELEASE_NOTES_v5.md` and
`PRODUCT_AUDIT_2026-08-26.md`. Converted files: `enhancements.js`,
`layers-figma.js`, `p0-fixes.js`, `text-figma.js`, `ui-dashboard.js`,
`ui-editor.js`, `ui-panels.js`.

## 2. Modal keyboard trap (`src/ui-editor.js`)
`onKey()` didn't check for an open modal before dispatching shortcuts, so
⌘Z / ⌘S / tool keys reached the canvas underneath an open dialog. Fixed:
when `.ed-modal-backdrop` / `.modal-back` is present, only Escape is
processed (closes via a synthetic backdrop click, matching how every modal
here already closes itself).

## 3. `.fig` rotation/position round-trip bug (`src/figconv.js`) — real data loss
`applyFigTransform()` (import) reconstructed a node's x/y from a
re-derived cos/sin instead of solving the matrix directly, and had a sign
error: **any rotated node imported from a real `.fig` file landed in the
wrong position** (rotation angle itself was preserved; position drifted,
worse the further from 0°/no-flip). Confirmed independently in a
standalone script before touching source, then fixed by deriving x/y
directly from the matrix entries (the identity "local center maps to
world center" holds regardless of rotation/flip, so it doesn't need the
angle at all). Also factored the previously-inlined export-side matrix
math into `figTransformFor()` so import and export share one derivation
instead of two that can drift apart again.

Added `test-fig-transform.js` — loads the real `model.js`/`tokens.js`/
`figconv.js` via the existing vm-harness pattern and round-trips 7 cases
(plain, rotated, negative angle, 90°, flipH, near-180°). All pass.

## Verification
- All `src/*.js` pass `node --check`.
- All 10 test suites pass: `test-engine`, `test-rotation`,
  `test-radius-figma`, `test-frames-figma`, `test-handles-figma`,
  `test-icons`, `test-pixel-snap`, `test-studio-polish`,
  `test-text-engine`, `test-fig-transform` (new).
- Zero bare `prompt()`/`confirm()`/`alert()` calls remain outside
  `dialogs.js` itself.

## Not done this session (carried over, still real gaps)
- **Architecture debt**: `index.html` loads 38 scripts, many named
  `*-figma.js` / `studio-*.js` — patch-on-patch accumulation from repeated
  sessions. Tests pass, but this is the actual reason the app doesn't yet
  feel as tight as Figma internally; `PRODUCT_AUDIT_2026-08-26.md` already
  recommends splitting `ui-editor.js`/`ui-panels.js` by responsibility —
  that hasn't been started.
- Everything else in `PRODUCT_AUDIT_2026-08-26.md`'s "Recommended
  implementation order" (expand acceptance coverage, `.pfg` schema/
  migrations, performance budgets, real CRDT collab) is still open.
