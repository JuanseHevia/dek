# Dek local authoring pass

Implemented 14 September 2026. The product remains a local, single-user macOS app. HTML and neighboring assets are the document; external Codex/Claude connections remain the agent interface.

## Delivered

- Quiet native stage refined with impeccable: neutral chrome, contextual Edit inspector, visible creation/export/slide actions, responsive light/dark appearance and reduced motion.
- Selected-word and whole-object text formatting, including color/highlight, fonts, size, spacing, links, lists and decoration. Shape insertion, geometry, grouping, locking, arrangement and snapping. Native image upload, drop/paste, replacement, proportional resize, crop/position and descriptions.
- New/Open/Recent, deck title/duplication, five layouts, backgrounds, transitions and multiline speaker notes.
- Multiple slide selection, range selection, batch operations, reordering, hide/show, collapsible named sections, search, overview and empty-deck creation. Copying across decks transfers assets and components, resolves name/ID collisions and retains the destination design.
- Shared source mutations and undo history for manual/MCP editing. Stable object IDs remain separate from animation IDs. Serialized writes, revision conflicts, atomic disk acknowledgments, external-change detection and recoverable failed saves.
- Hidden-slide policy shared by presentation and export. Presenter previews/notes/timer, fragments, blackout and explicit hidden-slide access. Agent mutations receive a retryable error while presenting; reads and snapshots remain isolated.
- Separate local export renderer for vector-capable PDF, editable PowerPoint and slide-image PowerPoint. Both PowerPoint modes retain notes. PptxGenJS 4.0.1 is bundled. Exports expose progress, warnings, cancellation and saved paths; missing assets fail explicitly.

## Verification evidence

- 107 automated source tests pass, covering existing design-system behavior plus source mutations, IDs, sections, grouping, locks, imports, component dependencies and notes.
- The isolated native acceptance runner passes 46 checks: acknowledged writes, stale revisions, undo/redo, group resize, lock enforcement, slide batches, section ordering, cross-deck assets/components, source preservation, hidden slides/fragments, agent presentation guard, external changes, failed-save recovery/retry, all export modes, isolated snapshots, cancellation and empty-deck recovery.
- Native click-through in a separate bundle/profile: color only “better” in a heading; enter multiline notes with an ampersand; choose a local SVG through the macOS file picker; crop square; resize proportionally to 300 × 300; add a description; quit and reopen. The reopened HTML and visible slide preserve the result.
- Native presenter view shows the notes and previews the next visible slide, skipping the hidden appendix. Timer starts with presentation; blackout and clear state verified. Inactive slides are excluded from editing accessibility/focus.
- Browser checks cover actual selected-word formatting, shape grouping, crop/reposition, range selection and batch hide; light/dark appearance, reduced motion and a 900 × 700 window. A 100-slide fixture navigates to slide 100, hides three non-adjacent slides and restores them with one undo without horizontal overflow.
- PDF inspection: four 1280 × 720 pages by default, five with hidden slides included; correct order, final fragment text and no hidden-slide text leaking into visible pages.
- PowerPoint XML inspection: four slides and four notes pages in each mode. Editable output contains native text and shapes plus image objects; appearance output has exactly one full-slide image on each slide. Complex component/SVG fallbacks are identified in export warnings. PDF rendering and native slide appearance were inspected visually.
- Universal arm64/x86_64 build succeeds and the ad-hoc signature verifies. Dependency audit reports zero known vulnerabilities after pinning the patched transitive image parser.

## Practical limits

A physical second-display setup and editing inside Microsoft PowerPoint were not exercised in the final checks. Presenter-window behavior and PowerPoint package structure/editability were verified; actual external-monitor behavior and round-trip editing in PowerPoint remain device/application checks. Arbitrary HTML applications are preserved and exported as static image fallbacks when they cannot be represented by standard PowerPoint objects. PowerPoint import and dedicated chart/table editors remain outside this pass.

The installed personal Dek session was not replaced or restarted. The tested package is `dist/Dek.app`; the portable archive is `dist/Dek-macOS.zip`.

## Reproduce

Run `npm ci` and `npm test` in `web`, then `./build.sh` at the repository root. Copy the app to a temporary QA bundle with its own bundle identifier, launch it with `DEK_SUPPORT_DIR=/tmp/dek-workspace-qa/profile`, and open a copy of `web/test/fixtures/workspace.html` alongside `photo.svg`. Run `python3 mac/test/native_acceptance.py /tmp/dek-workspace-qa/profile`. The runner refuses the normal profile and only mutates the disposable fixture.
