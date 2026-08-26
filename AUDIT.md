# Penfig Audit — 2026-08-26

## Critical Bugs Found & Fixed

### 1. Text editing fails to focus (P0 — user-reported)
**Root cause:** `beginTextEdit` was called from inside `pointerdown` (T-tool click creates text then calls beginTextEdit synchronously; also the click-click slow-doubleclick path calls `setTimeout(..., 0)` which still fires before the pointer event sequence completes). Modern browsers reject programmatic `.focus()` calls made while a pointer/click gesture is still being dispatched. A setSelectionRange at 30ms was also racing with the native caret placement.

**Fix:**
- T-tool onDown: defer beginTextEdit via rAF + setTimeout(16) so focus runs AFTER pointerdown/pointerup/click complete
- Same for onDbl text edit, click-click slow-doubleclick, Enter key
- Add `pointerdown` capture listener on textarea that calls `ev.preventDefault()` — this blocks canvas `pointerdown` from firing later (because the textarea is a child of canvas-wrap, and native pointerdown on a textarea is harmless)
- Add `!important` to `.text-edit { user-select: text !important; -webkit-user-select: text !important; }` so body's `user-select:none` cannot win due to cascade
- Move the "outside click" `mousedown` listener registration to wait until after pointerup fires (80ms after mount) so the click that opened us doesn't immediately commit us
- Explicitly `document.activeElement.blur()` before `.focus()` to clear any lingering focus
- Add `Tab` key support: Tab inserts \t in textarea (default HTML behavior for textarea is to move focus; override)
- Focus retry schedule changed to rAF → 80ms → 250ms → 600ms (more robust; final retry is after pointer events are definitely done)

### 2. Body `user-select: none` overrides inline `user-select: text`
Inline style `user-select: text` is same specificity as `body { user-select: none }` in CSS; body wins because it's in a stylesheet cascade and the UA may treat the body rule as stronger in some browsers. Fixed by adding `!important` to the `.text-edit` CSS.

### 3. Toolbar separator is a 1px line that looks broken
The `.tb-sep` was 1px tall with thin background; replaced with a softer 1px gray bar matching Figma's grouping dividers.

### 4. Double-call of beginTextEdit not protected
The `if (this._textEdit) { if (this._textEdit.n === n) return; }` guard was good but the early-return `this.endTextEdit(true)` could race before the new ta was appended. Fixed the commit guard to be bulletproof (`committed` flag was already there; it's fine).

### 5. Icons quality
Several icons used path data that doesn't render crisply at toolbar sizes. Upgraded the most-visible toolbar icons (move, frame, rect, ellipse, pen, text, comment, hand, zoomfit) to cleaner paths with consistent stroke weight 1.5 and proper line caps.

### 6. UI clutter
- Reduced toolbar padding and gap slightly to match Figma density
- Top bar save/export buttons: slightly tighter
- Right panel section spacing tightened
- Removed redundant border on `.ed-canvas-wrap canvas` rule (was causing stacking issues earlier — keep the z-index only)

### 7. New text node placed 12px above cursor
`y: p.y - 12` was an arbitrary offset that made new text appear above where you clicked. Changed to `p.y - (t.size||16) * 0.2` so it sits naturally where you click (matching Figma behavior where new text baseline sits near the click point).

### 8. Textarea height initial measurement
For new empty text ("Text"), size measurement was correct but the textarea was mounted BEFORE the first layout compute so n._w/n._wc could still be stale from the PREVIOUS text node or from uncomputed state. Fixed by forcing layout+computePage BEFORE reading geometry AND by doing a second syncRect in an rAF.

## Issues Already Handled (verified OK)
- History transactions for text tool create → begin/end called around makeNode+attach+applyTextResize, then end() before setTool/beginTextEdit: GOOD
- Duplicate dblclick listener removed in previous session: GOOD
- Default text fill #ffffff: GOOD
- Focus retry loop exists: extended timings
- Enter key opens editor: already deferred with setTimeout 0, made more robust
- Escape while typing blurs (onKey checks typing flag): GOOD
- Ctrl/⌘+Enter commits: GOOD

## Engine Quality
- All 29 JS files pass `node --check`
- Engine tests (test-engine.js) pass
- World.computePage transform chain matches drawNode exactly (verified)
- Resize math uses anchor-local world-space (verified)
- Smart guides axis fix (xs vs ys delta) verified in _snapBox

## Remaining P1/P2 Items (post-audit backlog)
These are not broken but are polish items:
- [P1] Replace some remaining weaker icons (comment, hand, undo, redo) with cleaner 2px stroke variants
- [P1] Add text baseline snap targets (skeleton in p0-fixes but not fully wired)
- [Resolved] Image crop is now applied by the renderer for rectangular and vector image fills; direct on-canvas crop handles remain a UX enhancement.
- [P1] Dev mode toggle is still in command palette but toolbar button was removed (intentional — View menu or D key)
- [P2] Text-to-vector outline uses rects-per-char, not true glyph paths (documented)
- [P2] Local Font Access API query exists in menu but font picker only shows Google+system
