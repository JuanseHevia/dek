# Taste review: Welcome deck (2026-09-01)

Reviewed with the `design-taste-frontend` skill (tasteskill) against `decks/Welcome.html`, using stage snapshots of every slide from the running app.

**Design read.** An editorial product-tour deck (10 slides) for a design-literate consultant who will judge whether agent-written decks can look premium, with a quiet editorial language, leaning on macOS system type (New York display, SF Pro text, SF Mono) and Dek's built-in motion rather than any framework.

**Dials.** `DESIGN_VARIANCE: 6` (left-aligned, asymmetric two-column layouts, one inverted chapter slide) · `MOTION_INTENSITY: 6` (every animation demonstrates a runtime feature, so each is motivated) · `VISUAL_DENSITY: 3` (one idea per slide).

## Findings and what changed

| # | Tell found | Fix applied |
|---|---|---|
| 1 | **Eyebrow on 9 of 10 slides** (mono uppercase tracked label above every headline: the #1 templated rhythm). Cap is 1 per 3 sections. | Kept four that carry information the headline lacks (cover, Charts, CSS 3D, Agents · MCP); removed the rest. Headlines stand alone. |
| 2 | **Warm paper + oxblood + espresso palette**, the most recycled "premium" reflex. | Cooler paper `oklch(0.975 0.005 95)`, neutral ink `oklch(0.20 0.012 260)`, cobalt accent `oklch(0.50 0.20 262)`, amber `oklch(0.76 0.14 75)` as the second chart color. Inverted slide background is a cool near-black, not espresso. |
| 3 | **Middle dot as the default separator** (presets list had six per row, tool lists joined pairs with dots, footers used them). | Presets are a two-column term/description grid without separators; tools are one per line; footers carry one phrase each. |
| 4 | **Fake-precise numbers presented as real** ("38 slides shipped from one JSON block", bar and donut data). | Chart and donut carry a "Sample data" caption; stats now state real facts about the runtime (5 chart types, 0 libraries). |
| 5 | **Version stamp in a footer** ("Dek 0.1 · …") and a decorative filename ("welcome.html") on the cover. | Removed. The cover footer keeps only the functional key hints. |
| 6 | **Two inverted slides** in a light deck. | One inverted chapter slide (Motion) remains as a deliberate device; the 3D slide is light. |
| 7 | **Consecutive identical layout family** (slides 2 and 3 were both numbered lists). | Slide 2 is now lead + three fragments beside the slide's own markup in a code block (real content, not a fake screenshot). |
| 8 | **Corner radii mixed** (22 / 14 / 8). | 16px for containers, 6px for key caps. |
| 9 | **Italic descender clearance** on the display italic "something." | Line-height 1.04 with bottom padding on the italic span. |
| 10 | Quote longer than three lines on the closing slide. | Shortened to two sentences. |

## Kept on purpose

- **The display serif.** New York is the macOS system serif: zero downloads, a deliberate contrast with the SF Pro chrome, and the deck's argument is that system fonts alone can look finished. Not Fraunces or Instrument Serif.
- **Fragments, auto-animate, enter animations, the spinning cube.** Each one demonstrates the runtime feature the slide is about.
- **Numbered fragment rows.** The numbers show order, which is the point of that slide.
- **Key-cap hints on the cover.** A first-time user needs them; they are functional, not decorative.

## Open note

WebKit's snapshot API flattens CSS 3D, so the cube reads as a flat square in `snapshot_slide` although the live stage renders it in 3D. Agents reviewing 3D slides should be told this (it is in the README).
