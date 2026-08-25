/* shortcuts.js — central keyboard shortcut registry (spec §5).
 *
 * One table is the source of truth for: (a) dispatch (App.onKey asks
 * Shortcuts.dispatch for a binding), (b) the shortcuts modal (rendered from
 * the same table), and (c) conflict detection (Shortcuts.conflicts() —
 * tested headlessly). Figma-standard keys, per the spec's compatibility rule:
 * Figma interaction model + Figma shortcuts, Penfig identity.
 *
 * Entry shape: { keys, label, group, run }
 *   keys — 'v', 'mod+c', 'shift+2', 'shift+k', 'delete', 'space' …
 *          (order-insensitive: 'mod+shift+c' === 'shift+mod+c')
 *   run  — (App, e) => void ; implementers e.preventDefault() where needed
 *
 * Notes:
 *  - 'mod+/ ' is context-dependent (Figma does the same): mask toggle when
 *    the selection contains a maskable node, command palette otherwise.
 *    The table stores ONE entry; the disambiguation lives in its `run`.
 *  - Space is a held key (temporary hand) — it works via a keydown/keyup
 *    pair, so its run only fires on press.
 */
(function (global) {
  'use strict';
  const App = () => global.App;

  function normKeys(e) {
    const parts = [];
    if (e.metaKey || e.ctrlKey) parts.push('mod');
    if (e.shiftKey) parts.push('shift');
    if (e.altKey) parts.push('alt');
    let key = e.key == null ? '' : String(e.key);
    if (key === ' ') key = 'space';
    // shift+/ arrives as '?' on most layouts — normalize it back
    if (e.shiftKey && key === '?') key = '/';
    parts.push(key.toLowerCase());
    return parts.sort().join('+');
  }

  const table = [];
  function def(keys, label, group, run) {
    const k = keys.toLowerCase();
    // `keys` keeps its human-friendly order for display; `norm` is the
    // order-insensitive form dispatch() and conflicts() compare against
    // (normKeys() sorts its parts, e.g. 'mod+c' → 'c+mod').
    table.push({ keys: k, norm: k.split('+').sort().join('+'), label, group, run });
  }

  // ------------------------------------------------------------- Tools (Figma keys)
  def('v', 'Move / select', 'Tools', (a) => a.setTool('move'));
  def('f', 'Frame', 'Tools', (a) => a.setTool('frame'));
  def('s', 'Section', 'Tools', (a) => a.setTool('section'));
  def('r', 'Rectangle', 'Tools', (a) => a.setTool('rect'));
  def('o', 'Ellipse', 'Tools', (a) => a.setTool('ellipse'));
  def('l', 'Line', 'Tools', (a) => a.setTool('line'));
  def('a', 'Arrow', 'Tools', (a) => a.setTool('arrow'));
  def('p', 'Pen', 'Tools', (a) => a.setTool('pen'));
  def('n', 'Pencil', 'Tools', (a) => a.setTool('pencil'));
  def('t', 'Text', 'Tools', (a) => a.setTool('text'));
  def('h', 'Hand', 'Tools', (a) => a.setTool('hand'));
  def('c', 'Comment', 'Tools', (a) => a.setTool('comment'));
  def('d', 'Dev Mode', 'Tools', (a) => a.toggleDevMode());
  def('space', 'Temporary hand (hold)', 'Tools', (a) => a.spaceDown());

  // ------------------------------------------------------------- Editing
  def('mod+c', 'Copy', 'Editing', (a) => a.copySel());
  def('mod+x', 'Cut', 'Editing', (a) => a.copySel(true));
  def('mod+v', 'Paste', 'Editing', (a) => a.paste());
  def('mod+d', 'Duplicate', 'Editing', (a) => { a.duplicateSel(); });
  def('mod+z', 'Undo', 'Editing', (a) => a.historyUndo());
  def('shift+mod+z', 'Redo', 'Editing', (a) => a.historyRedo());
  def('mod+y', 'Redo', 'Editing', (a) => a.historyRedo());
  def('mod+a', 'Select all', 'Editing', (a) => a.selectAll());
  def('mod+g', 'Group selection', 'Editing', (a) => a.groupSel());
  def('shift+mod+g', 'Ungroup selection', 'Editing', (a) => a.ungroup());
  def('mod+s', 'Save', 'Editing', (a) => { a.saveNow(); });
  def('shift+mod+s', 'Export…', 'Editing', (a) => { a.openExport(); });
  def('mod+e', 'Export…', 'Editing', (a) => { a.openExport(); });
  def('mod+k', 'Versions', 'Editing', (a) => a.openVersions());
  def('mod+/', 'Use as mask / Quick actions', 'Editing', (a) => a.maskOrPalette());
  def('delete', 'Delete selection', 'Editing', (a) => a.deleteSel());
  def('backspace', 'Delete selection', 'Editing', (a) => a.deleteSel());
  def('tab', 'Next layer', 'Editing', (a) => a.cycleSel(1));
  def('shift+tab', 'Previous layer', 'Editing', (a) => a.cycleSel(-1));
  def('arrowleft', 'Nudge left (⇧ 10px)', 'Editing', (a) => a.nudge(-1, 0));
  def('arrowright', 'Nudge right (⇧ 10px)', 'Editing', (a) => a.nudge(1, 0));
  def('arrowup', 'Nudge up (⇧ 10px)', 'Editing', (a) => a.nudge(0, -1));
  def('arrowdown', 'Nudge down (⇧ 10px)', 'Editing', (a) => a.nudge(0, 1));
  // ------------------------------------------------------------- Vector (Figma boolean keys)
  def('mod+]', 'Union', 'Vector', (a) => a.booleanSel('union'));
  def('mod+[', 'Subtract', 'Vector', (a) => a.booleanSel('subtract'));
  def('mod+\\', 'Intersect', 'Vector', (a) => a.booleanSel('intersect'));
  def('shift+mod+\\', 'Exclude', 'Vector', (a) => a.booleanSel('exclude'));
  def('shift+mod+f', 'Flatten selection', 'Vector', (a) => a.flattenSel());

  // ------------------------------------------------------------- Transform (rotate/flip)
  def('shift+h', 'Flip horizontal', 'Transform', (a) => a.flipSel('h'));
  def('shift+v', 'Flip vertical', 'Transform', (a) => a.flipSel('v'));

  def('shift+1', 'Zoom to fit', 'View', (a) => a.zoomToFit());
  def('shift+2', 'Zoom to selection', 'View', (a) => a.zoomToSelection());
  def('shift+0', 'Zoom to 100%', 'View', (a) => a.zoomTo100());
  def('0', 'Zoom to fit', 'View', (a) => a.zoomToFit());
  def('1', 'Zoom to 100%', 'View', (a) => a.zoomTo100());
  def('+', 'Zoom in', 'View', (a) => a.zoomBy(1.2));
  def('=', 'Zoom in', 'View', (a) => a.zoomBy(1.2));
  def('-', 'Zoom out', 'View', (a) => a.zoomBy(1 / 1.2));
  def('shift+r', 'Toggle rulers', 'View', (a) => { a.view.rulers=!a.view.rulers; a.syncViewToggles(); a.markDirty(); });
  def('shift+g', 'Toggle layout grid', 'View', (a) => { a.view.grid = a.view.grid ? null : (a.view.gridSize||10); a.syncViewToggles(); a.markDirty(); });
  def('shift+k', 'Present', 'Prototype', (a) => a.startPresent());
  def('?', 'Shortcuts reference', 'App', (a) => a.showShortcutsModal());
  def('escape', 'Deselect / exit (pen: close→end→leave)', 'App', (a) => a.escapeAction());

  // e with '?' (shift+/) already normalizes to '?' — one extra alias entry
  def('shift+/', 'Shortcuts reference', 'App', (a) => a.showShortcutsModal());

  // ------------------------------------------------------------- dispatch
  // Returns the binding that matched (and was executed) or null.
  function dispatch(e, AppObj) {
    const norm = normKeys(e);
    // exact match on the normalized key; '?' arrives as '?' already (shift
    // handled in normKeys), and shift+/ normalizes to '?' → both '?' entries
    // cover every browser's spelling of the key.
    for (const b of table) if (b.norm === norm) { b.run(AppObj, e); return b; }
    // shift+/ reaches some browsers as '?' — both entries exist, so this is
    // only reached for genuinely unbound keys → no match
    return null;
  }

  // ------------------------------------------------------------- conflicts
  // Two entries with the same normalized keys (different actions) = conflict.
  function conflicts() {
    const seen = new Map();
    const out = [];
    for (const b of table) {
      if (seen.has(b.norm) && seen.get(b.norm) !== b.label) {
        out.push({ keys: b.keys, a: seen.get(b.norm), b: b.label });
      }
      seen.set(b.norm, b.label);
    }
    return out;
  }

  global.Shortcuts = { def, table, dispatch, conflicts, normKeys };
})(typeof window !== 'undefined' ? window : globalThis);
