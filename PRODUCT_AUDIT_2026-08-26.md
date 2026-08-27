# ARCO — Product and Engineering Audit

Date: 2026-08-26

## Executive assessment

ARCO is a credible local-first editor prototype with an unusually broad feature surface. It is not yet at production parity with Figma, Sketch, or Framer. The strongest areas are offline operation, the document model, transforms, vector tools, auto layout, tokens, and practical `.fig` interoperability. The largest risks are maintainability, limited automated coverage, incomplete professional fidelity, and feature claims that sometimes describe prototypes as complete workflows.

Overall readiness: **alpha / serious prototype**.

## Verified in this audit

- All maintained JavaScript files pass `node --check`.
- Engine smoke tests pass for scene transforms, rotated bounds, auto layout, undo/redo, cloning, hit geometry, text sizing, and manual-frame positioning.
- The editor runs without a build system or network dependency.
- IndexedDB persistence and local fallback paths are present.
- Image fill crop, fit, fill, and tile rendering are implemented in the current renderer; the older `AUDIT.md` crop warning is stale.
- Rotation, flip, dashed strokes, image placement, layer search, layer reordering, recovery journaling, components, variables, and prototype presentation have real code paths.

## Honest capability matrix

| Area | Current level | Main gap |
| --- | --- | --- |
| Canvas and transforms | Strong prototype | Large-document performance and broad regression coverage |
| Vector drawing and booleans | Strong prototype | Arc-preserving output and open-path outline/offset fidelity |
| Auto Layout | Strong prototype | Complex nested stress tests and full Figma edge-case parity |
| Typography | Partial professional | Rich text ranges, variable fonts, OpenType controls and true glyph outlines |
| Images | Functional | Interactive crop handles, filters, masking polish and asset management |
| Components | Functional | Nested overrides, robust component properties and library publishing |
| Variables and styles | Functional | Broader binding coverage and scalable library workflows |
| Prototyping | Functional basic | Variables, conditionals, scroll behavior and advanced motion |
| Dev Mode | Useful basic | Multi-framework output, measurements and production code fidelity |
| `.fig` interoperability | Valuable, lossy | Unsupported node fields and editable vector-network fidelity |
| Native `.pfg` | Early implementation | Formal schema, migrations, checksums, recovery and compatibility suite |
| Collaboration | Local demo | Real CRDT/server sync, permissions, threads and conflict resolution |
| Plugins | Experimental | Remove trusted `new Function` fallback for untrusted code |
| Testing | Insufficient | Visual regression, interaction, import corpus, fuzz and performance tests |

## Architecture findings

1. `ui-editor.js` and `ui-panels.js` are too large and own many unrelated responsibilities. They should be split by tools, interactions, panels, commands and overlays.
2. The application relies on hundreds of global/window references. This makes initialization order fragile and isolated testing difficult.
3. History uses full JSON snapshots. It is simple and reliable for small documents but memory-heavy for professional files.
4. The Canvas 2D renderer is appropriate for the alpha, but it needs spatial indexing, dirty-region rendering and eventually a WebGL/WebGPU backend for large documents.
5. Older audits and roadmap sections conflict with the current code. Capability documentation must be generated from acceptance tests or maintained alongside them.
6. Browser `prompt`, `confirm`, and `alert` calls remain in important workflows. They interrupt focus and cannot provide polished validation or accessibility.

## UX findings

### P0

- New users lacked onboarding and local-storage clarity.
- Important existing tools were hidden in the command palette.
- Hover targeting on a dense canvas was unclear.
- “Save” did not clearly communicate local-only persistence.

These four issues are addressed in the audited build.

### P1

- Inspector content needs Design / Prototype / Inspect organization.
- Native prompts should become consistent dialogs.
- Number fields need expression input, scrubbing, and predictable keyboard stepping.
- Component and variable editing needs better bulk management.
- Image cropping needs direct on-canvas manipulation.
- Layer operations need stronger multi-select and drop-position feedback.

### P2

- Add customizable workspaces, command/key remapping and theme controls.
- Add accessibility inspection and linting as first-class workflows.
- Improve present-mode transitions and responsive breakpoint previews.

## Changes made after the audit

- Introduced a consistent ARCO interface theme and clearer hierarchy.
- Added labeled primary panel tabs.
- Added Quick Actions, Present, Dev and Focus Canvas controls.
- Added a first-run onboarding and persistent Help entry.
- Renamed Save to **Save locally** and added a visible local-state indicator.
- Added canvas hover outlines for target discoverability.
- Exposed Section, Polygon, Star and Triangle directly in the toolbar.
- Preserved every existing engine capability and verified syntax plus smoke tests.

## Recommended implementation order

1. Expand automated acceptance coverage before deeper feature work.
2. Replace prompt-based workflows with the shared modal system.
3. Split the editor and panel modules behind explicit interfaces.
4. Complete rich text and interactive image editing.
5. Formalize `.pfg` schema, migrations, checksums and compatibility fixtures.
6. Add performance budgets and large-document benchmarks.
7. Build real CRDT collaboration only after deterministic document operations exist.

## Release criterion

Do not market ARCO as “better than Figma” until representative professional files can be edited for a full workday without data loss, all P0 workflows have interaction tests, native files round-trip without loss, and large-document performance budgets pass on mid-range hardware.
