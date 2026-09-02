# Impeccable critique: Dek shell (2026-09-01)

`impeccable critique` on the chrome around the slide (navigator, pill, stage, light table, settings, palette, shortcuts, agent panel, edit mode, presenter view). Two isolated assessments: an independent design-review agent working from source and native screenshots, and the deterministic detector (`npx impeccable --json`; the live overlay is not available in this detector version). Register: product.

## Design health score (before fixes)

| # | Heuristic | Score | Key issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Disabled Present looked live; timer mode unlabeled |
| 2 | Match system / real world | 2 | "Chrome", "Stage/Daylight", "Agents · MCP", `127.0.0.1`, "rem" leaked into UI copy |
| 3 | User control and freedom | 3 | Agent panel had no close; Esc ignored it; light table had no visible exit |
| 4 | Consistency and standards | 3 | Drift from DESIGN.md (timer 32px vs 44; animated `width`); custom context menu; ⌘P |
| 5 | Error prevention | 2 | ⌘⌫ / ⌘D / ⇧⌘N / ⌘Z / ⌘R fired while presenting; toolbars leaked over Settings and the light table |
| 6 | Recognition rather than recall | 3 | Agent panel, light table, presenter, black screen had no visible control; ✦ unlabeled |
| 7 | Flexibility and efficiency | 4 | Keys, palette, context menu, native menus, drag reorder, digit go-to |
| 8 | Aesthetic and minimalist design | 3 | Permanent edit hint, duplicate "img" label, 35 flat palette items |
| 9 | Error recovery | 2 | Failure toasts named the problem, never the fix; raw agent errors |
| 10 | Help and documentation | 3 | Shortcut sheet, tooltips, Welcome deck, teaching empty state |
| **Total** | | **28/40** | **Good** |

Cognitive load: 3 of 8 checks failed (moderate): chunking in Settings, too many visible options (pill 6, text toolbar 12, palette 35), Settings hides the slide it configures.

## Anti-patterns verdict

**Design review:** not AI-looking. System fonts, low-chroma OKLCH neutrals, hairlines, one gold accent under 10%, no gradients, glass, hero metrics or card grids. The dark theatre is earned (photo-editor argument, plus a light mode), not a category reflex. Two reflexive touches: the ✦ sparkle with a gold count badge (the AI-feature cliché) and a 2px gold frame around the whole slide in edit mode, which competes with the deck's colors exactly when the user is judging them.

**Detector (58 findings):** 36 × low-contrast text, all one token (`--ink-3`, 2.7–3.6:1); 4 × layout transition (`transition: width` on the navigator and agent panel, against DESIGN.md's own rule); 16 × "1px border + 28px shadow" advisory on the shared `--shadow` token; 2 × cramped padding on the presenter's next-slide preview, a false positive (the preview is meant to fill its box).

Where they agreed: contrast of faint text, the width animation. What the detector caught that the review had only sensed: the shadow token as a recurring tell.

## What was fixed in this pass

- **Presenting is sealed.** `command()` allows only navigation, black screen, presenter and stop while presenting; toasts never render; the end of the deck goes to black (click or → leaves the presentation) instead of a toast on the projector; file changes that arrive while presenting are applied after.
- **Agent front door.** The pill always shows an "Agent" button with a neutral dot (gold and the author's name when connected, count badge for unseen edits); the panel has a close button and Esc; the empty state and the empty panel link to setup; Settings copy is plain ("Ready for agents. They talk to Dek on this Mac only.", "paste this once in a terminal"); group renamed "Agents", appearance labels are Auto / Light / Dark.
- **Edit mode discipline.** Edit, light table and Settings are mutually exclusive; the training hint disappears after the first selection; the toolbar lost the duplicate kind label and the rem readout; alignment buttons are icons; the slide frame is a neutral hairline and the selection chip is neutral, gold stays on the selection outline only.
- **States and contrast.** Global `:disabled` styling (opacity 0.4, no hover); `--ink-3` raised to 0.60 (dark) / 0.49 (light) and readable copy (settings notes, empty states, hints) moved to `--ink-2`; light-theme accent darkened to 0.50 for 4.5:1 on the theatre. Detector: 58 → 1 (the false positive).
- **Motion and chrome.** Panels no longer animate width; their contents fade. Shadow token tightened to 6px/16px. Light table hides the navigator and lays out five across. Undo toasts stay 3.2s. Presenter timer 44px with an "elapsed / left" label, reset on double-click; waking from black no longer advances.

## Deferred (judgment calls made without the user)

- **Settings as a full-stage page.** The review recommends a side sheet or native window so the slide stays visible while choosing transitions. Kept for now; labels and copy were fixed. Candidate for `impeccable distill` + `adapt`.
- **⌘P for go-to-slide.** Conflicts with the macOS Print convention. Kept for consistency with Tinta and VS Code quick-open; Export PDF is ⇧⌘E.
- **⌘Z over external edits.** Undo deliberately includes agent and on-disk changes (that is the review surface for agent work). A non-modal "file changed, keep theirs / restore mine" prompt is the honest alternative if this bites.
- **Custom context menu on thumbnails.** HTML, not NSMenu, so it works in the dev harness too. A native menu is a small Swift change if the mismatch bothers.
- **Multi-select in the navigator**, palette grouping/recency, and mapping raw agent errors to plain sentences.

## Personas (from the review)

- *Power presenter:* Open Recent → ⌘⏎ under 10 s works; wants multi-select and palette recency.
- *First-timer:* empty state clear in 5 s; the one-time edit hint and unlabeled glyphs were the traps (fixed: hint until first selection, icon buttons, labeled Agent button).
- *Presenting under stress:* accidental slide deletion and the one-click timer reset were the dangerous moments (fixed).
- *Consultant directing an agent:* connection path was jargon-heavy and confirmation lived in a closed panel (fixed: plain copy, always-visible Agent button with the connected author's name).

Re-run `impeccable critique` after the next round of changes to see the score move.
