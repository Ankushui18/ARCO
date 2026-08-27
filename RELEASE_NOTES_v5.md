# ARCO v5 — Competitive Workflow Pass

This release focuses on making existing capabilities faster, clearer, and more professional rather than inflating the feature count.

## Interface

- Added **Design / Prototype / Inspect** tabs to the right inspector.
- Kept transformation, appearance, layout, component, grid, mask, and arrange controls in Design.
- Moved interactions into a focused Prototype workspace.
- Added generated CSS/HTML and annotations to the Inspect workspace.
- Made the inspector tabs sticky so the current workflow remains visible while scrolling.
- Improved focus rings and numeric-control feedback.

## Tool and workflow improvements

- Numeric inspector controls now support:
  - Arrow keys: normal step
  - Shift + Arrow: 10× step
  - Alt + Arrow: 0.1× step
- Added **Paste in Place** with `Shift + Cmd/Ctrl + V`.
- Added keyboard resizing:
  - `Cmd/Ctrl + Left/Right`: decrease/increase width by 1px
  - `Cmd/Ctrl + Up/Down`: decrease/increase height by 1px
  - Add Shift for 10px increments
- Keyboard resizing updates regular-shape paths and correctly demotes affected auto-resizing text axes.
- Corrected the existing nudge shortcuts so Shift reliably applies the documented 10px step.

## Validation

- All maintained JavaScript files pass syntax validation.
- Engine smoke tests pass.
- Central shortcut registry: 67 bindings, 0 conflicts.

## Next competitive milestone

The next pass should replace browser prompts with accessible product dialogs, add expression/scrubbable number fields, implement direct on-canvas image cropping, and expand rich-text range editing.
