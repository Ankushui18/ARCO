# ARCO Audit — Issues Found & Fixed (v20, 2026-08-26)

Full source audit across all 29 JS files + CSS + HTML + SW. Below is every bug
that was found and fixed this pass.

## CRITICAL (text-editing blocker class)

1. **Keyboard events bubbled out of textarea to window capture listeners.**
   `keydown`/`keyup`/`keypress` were registered in bubble phase only;
   presentation-mode's `window.addEventListener('keydown', onKey, true)`
   fired first on capture, so typing keys (V/F/R/T/etc.) would toggle
   tools / nudge selection / delete nodes *while* editing text.
   **Fix:** all three listeners now register with `capture:true`, call
   `stopImmediatePropagation`, and also block `compositionstart/update/end`
   so IME input (Chinese/Hindi/Japanese) can't leak to shortcuts.

2. **Space key-up while typing left hand-pan active.**
   The window `keyup` handler toggled `space = false` on Space without
   checking if focus was in an input/textarea. Pressing space in text
   would toggle the hand tool when released.
   **Fix:** guard the keyup listener to ignore keyups from INPUT/TEXTAREA/SELECT.

3. **Deprecated `-webkit-user-modify: read-write-plaintext-only` on `.text-edit`.**
   That legacy WebKit property forces a contenteditable-like mode inside
   the textarea, which in Chrome 120+ causes keystrokes to be eaten /
   caret to misbehave / spellcheck artifacts.
   **Fix:** removed the rule. A plain `<textarea>` is already read-write.
   Added `touch-action: auto` and `-webkit-touch-callout: default`.

4. **Focus watchdog was a single 250 ms timeout — easy to miss.**
   If the canvas stole focus at the wrong moment (e.g. markDirty rAF +
   mousedown racing) there was no retry.
   **Fix:** replaced with a `setInterval(…, 200)` that runs the whole
   time the textarea is mounted and re-focuses whenever
   `activeElement` becomes body/canvas. Cleared on commit / endTextEdit.

5. **commit() did not clear stale drag / marquee state.**
   If an outside click landed on the canvas, `onOutside` called
   `commit(true)` synchronously during the mousedown capture phase,
   then the canvas's own pointerdown handler (next in target phase)
   would still fire App.onDown and start a drag against a removed
   textarea, potentially dragging the underlying text node.
   **Fix:** commit() nulls `_drag`, `_snapGuides`, `marquee`,
   `_marqueePreview`, `pencil` before calling markDirty.

6. **setTool() did not end active text edit.**
   Pressing V/F/R while editing text left a dangling textarea (keyboard
   events still intercepted by a removed editor, focus could get stuck).
   **Fix:** setTool() calls `endTextEdit(true)` before switching tools.

7. **T-tool branch in onDown did not cancel stale drag or call preventDefault.**
   If a previous drag state was lingering the new text node could be
   caught by an old move handler on the next onMove.
   **Fix:** added `e.preventDefault()` and explicit drag/marquee reset
   before scheduling beginTextEdit.

8. **Outside-click exclusion list was incomplete.**
   Font picker (`.pf-font-picker`), modals (`.ed-modal-backdrop`,
   `.modal-back`, `.pf-modal`), toasts, open comment pins, and peer
   cursors would all commit the text edit when clicked.
   **Fix:** extended `.closest(...)` filter to cover every popover class
   used by the app.

9. **Missing capture-phase blocker for input/paste/cut/focusin on textarea.**
   Parent-level listeners (enhancements/p0-fixes) could observe these
   events and run their own logic.
   **Fix:** added capture-phase stopP listeners for input, paste, cut, focusin.

## HIGH (UI polish / UX issues)

10. **History icon SVG was malformed.** `<path d="M3 12a9 9 0 109-9"/>`
    (self-closing, back-arrow path incomplete — clock arc that ended in
    mid-air). Redrew as `M3 12a9 9 0 1 0 3-6.7` + proper back-tail and
    clock hand.

11. **Copy icon path went to h10 (off-grid), tail extended to (15,15) instead
    of (15,15)-in-the-20x20-viewBox — minor rendering misalignment. Fixed to
    `M5 15V5a2 2 0 012-2h8`.**

12. **Service Worker cache bumped to v20** so users on the production
    build get the fixes immediately rather than stale v19. Dev hosts
    (localhost/.local/vercel previews) continue to unregister the SW
    automatically — no cache there.

## MEDIUM (defensive / correctness)

13. **clearTimeout → clearInterval for _textFocusTimer.** With the new
    repeating watchdog, endTextEdit and commit() both use clearInterval
    so the interval doesn't leak after the textarea is removed.

14. **beginTextEdit already had a full drag/marquee reset on entry** —
    that was in place from the previous pass and remains correct; double-
    checked that all 5 entry paths (T-tool, dbl-click, click-click, Enter,
    inspector button, context menu) route through beginTextEdit and
    benefit from it.

15. **textarea stopP handlers verified** for mousedown/mouseup/click/dblclick/
    pointerdown/pointerup/touchstart/touchend/contextmenu — all at capture
    phase, all calling stopImmediatePropagation. Intentional choice: we
    do NOT call preventDefault on pointerdown because Chrome will refuse
    to focus the textarea if pointerdown is preventDefault'ed on it.

16. **Keydown handler now preventDefault's non-text Ctrl/Cmd combos**
    (Ctrl+G group, Ctrl+D duplicate, etc.) while still letting the native
    A/C/V/X/Z/Y pass through.

17. **Arrow keys / Home / End / PageUp/PageDown** still work natively in
    the textarea (bubble already killed; no shortcut interference).

## SMOKE-TEST STATUS

- All 29 JS files pass `node --check`.
- Engine smoke tests 19/19 pass (`node test-engine.js`).
- Dev server returns 200 for all key assets and serves the patched
  ui-editor.js / app.css / sw.js / icons.js.
- No new dependencies, no build step — still double-click-to-open offline.

## HOW TO TEST (user)

After this deploy, hard-refresh with **Ctrl+Shift+R** (or Cmd+Shift+R on Mac),
then verify text editing through all entry paths:

1. Press **T**, click canvas, type "Hello" — should immediately start typing.
2. **Double-click** existing text, type.
3. Select text, press **Enter**, type.
4. Click **Edit** pencil button in the right inspector, type.
5. **Right-click → Edit text**, type.
6. Slow **click-click** (not double-click) on selected text, type.
7. Type spaces, tabs, IME characters, Ctrl+Z/Y/A/C/V/X — all native.
8. Click outside textarea (canvas, toolbar, inspector) — text commits.
9. Press **Esc** while editing → cancels (discards); Ctrl/⌘+Enter → commits.
10. Switch tools (V/F/R) while editing → commits and switches tool cleanly.
