# ARCO tool parity audit — 2026-08-26

This audit compares the tools exposed by the current ARCO build with Figma Design's current official tool documentation. “Parity” means the core workflow is usable; it does not claim identical rendering or every advanced option.

| Area | ARCO now | Figma baseline | Status | Next engineering target |
|---|---|---|---|---|
| Move / selection | Select, multi-select, marquee, move, snapping, keyboard nudging | Move/select, deep selection and alignment workflows | Strong core | Selection cycling and direct measurement overlays |
| Scale | Dedicated K tool; proportional geometry; scales descendants, text, strokes, effects and auto-layout spacing | K Scale tool preserves proportions and visual properties | Added in this pass | Multi-root scaling and numeric percentage control |
| Frame | Free-draw frames plus phone, Android, tablet, desktop, presentation and social presets | Free-draw and categorized presets | Core parity | Custom saved presets and full preset catalog |
| Section | Section creation and layer organization | Section organization | Core parity | Section status and richer presentation behavior |
| Rectangle | Draw, radii, smoothing-related styling, fills, strokes and effects | Rectangle with independent radii and smoothing | Strong core | On-canvas radius handles |
| Ellipse | Ellipse drawing and styling | Ellipse plus arc, semicircle and ring controls | Partial | Arc start/sweep/inner-radius controls |
| Polygon / star | Regular polygon, triangle and star creation | Editable point count and star ratio | Partial | Inspector and on-canvas point/ratio controls |
| Line / arrow | Line and arrow creation; Arrow uses Shift+L and alternate A | Line; configurable start/end arrowheads | Partial | Independent start/end cap menus |
| Pen / pencil | Bézier drawing/editing, node types, handles, split/close; freehand pencil | Pen/vector networks and broad vector edit toolset | Strong core / advanced gap | Variable width, shape builder, cut, bend, eraser, lasso and paint |
| Text | Point text, inline editing, auto width/height, fixed sizing, rich typography controls | Point and area text; advanced OpenType and text-on-path options | Strong core | Drag-to-create area text and OpenType feature controls |
| Hand | Pan and temporary Space hand | Hand and Space pan | Parity |
| Comment | Pins and threaded collaboration model | Pins, threads, mentions and notifications | Core parity | Mentions, notification delivery and permissions |
| Image | Local image placement/fills and export | Images as fills, crop/fit/fill/tile, video and GIF support | Partial | Crop UI, fit modes, video/GIF playback |
| Boolean / flatten | Union, subtract, intersect, exclude and flatten | Boolean operations and flatten | Core parity | Non-destructive compound editing UX |
| Auto layout | Horizontal/vertical, wrap, padding, gap, alignment, hug/fill/fixed | Mature auto layout system | Strong core | Grid auto layout, min/max sizing and suggested layout |

## Changes completed in this parity pass

- Added a dedicated Scale tool to the toolbar and shortcut registry (`K`).
- Scale preserves aspect ratio and proportionally scales nested geometry, typography, stroke width/dashes, effects and auto-layout gaps/padding.
- Added Figma-compatible Arrow shortcut (`Shift+L`) while preserving ARCO's existing `A` shortcut.
- Added frame presets for common phone, Android, tablet, desktop, presentation and social canvases.
- Kept the existing text editing duplicate-render fix and vertical auto-layout text sizing regression coverage.
- Verified JavaScript syntax, shortcut conflicts and the complete engine smoke suite.

## Honest conclusion

ARCO now covers the everyday core of Figma's creation toolbar, and several workflows are already competitive: local-first operation, offline availability, dependency-free deployment, auto layout, vector drawing, components, variables, prototyping, export and dev inspection. It is not yet truthful to call every tool fully equal to current Figma. The largest remaining tool-level gaps are advanced vector-edit subtools, ellipse arcs/rings, parametric shape controls, richer image cropping/media, and drag-created area text. These should be addressed as engine features rather than cosmetic toolbar additions.
