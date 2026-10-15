# Dek design system

## Theme
Dark-first, by function not fashion. Scene: a presenter rehearsing a client deck at a desk in the evening, then presenting it in a meeting room the next morning. The slide must look exactly as it will on the projector, so the chrome around it is a neutral near-black theatre that neither reflects into the slide nor shifts how its colors read (the photo-editor canvas argument). A light chrome is available for daylight desk work; both are neutral and low-chroma. The deck itself owns its colors completely.

## Color (OKLCH, restrained strategy: tinted neutrals + one accent ≤10%)
Stage (default, dark):
- Theatre (stage background behind the slide): oklch(0.12 0.004 260)
- Chrome (navigator, panels): oklch(0.165 0.005 260)
- Chrome raised (pill, menus, cards): oklch(0.21 0.006 260)
- Hairline: oklch(0.28 0.006 260)
- Text: oklch(0.92 0.006 90) warm off-white
- Text secondary: oklch(0.68 0.008 260)
- Text faint: oklch(0.63 0.008 260), labels and numerals only; running copy never drops below Text secondary (4.5:1 on every chrome surface).
- Spot (accent, the stage light): oklch(0.83 0.12 82) soft gold. Only for: current slide ring, focus, live-agent dot, active states, the edit selection outline, and Export, the one filled button (text in On-spot oklch(0.17 0.02 82); hover Spot strong oklch(0.87 0.12 82)).
- Danger: oklch(0.70 0.16 25) (Daylight oklch(0.52 0.19 25)), only for destructive actions and confirmations.

Daylight (light):
- Theatre: oklch(0.90 0.005 90) · Chrome: oklch(0.965 0.004 90) · Raised: oklch(0.99 0.003 90)
- Hairline: oklch(0.87 0.006 90) · Text: oklch(0.22 0.010 260) · Secondary: oklch(0.46 0.010 260) · Faint: oklch(0.49 0.010 260)
- Spot: oklch(0.50 0.13 70)

## Typography
- Chrome: -apple-system (SF Pro). 13px labels, 12px secondary, 11px uppercase tracked section labels in settings.
- Counters, slide numbers, timer: ui-monospace (SF Mono) with tabular figures. Timer in presenter view: 44px/1, weight 500.
- Presenter notes: SF Pro 22px/1.5, max 60ch, adjustable in settings.
- Slides: whatever the deck says. The runtime only sets a 1920×1080 canvas, `html { font-size: 32px }` so `rem` reads as "slide points", and a neutral system-font default the deck is expected to override.

## Layout
- Three regions: navigator (left, 224px, collapsible to 0), stage (center, letterboxes the slide at its aspect ratio with ≥24px theatre margin), agent panel (right, 320px, collapsible).
- One floating pill, top center: deck name · `4 / 18` counter · Present. Fades to 40% while the mouse is idle over the stage.
- Presenting: chrome gone, theatre goes pure black, slide fills the screen, cursor hides after 2s.
- Overview (light table): grid of thumbnails over the theatre, 5 per row, current slide ringed.
- Design systems: a **Design** button in the pill (three-stop swatch + the active system's name, spot when open) turns the navigator into the list — one row per system, swatch strip, name, mode/face/version, a spot dot when it is the one on the deck. Clicking a row puts its composition on the stage under a single action bar; the composition is the system's own guidelines page, authored 1440 wide and scaled into the pane. Destructive delete confirms in place on the button, never in a dialog. Esc unwinds one level at a time.
- Presenter view: current slide 60% width left; right column: next slide preview, notes; bottom bar: elapsed timer, clock, counter.

## Motion
- Chrome: 150–200ms, ease-out (cubic-bezier(0.22, 1, 0.36, 1)) on state changes only. Nothing decorative.
- Slides: transition default 480ms with the same ease-out-quint curve; presets fade · slide · zoom · flip · none; auto-animate 600ms. Fragments 320ms. All durations respect `prefers-reduced-motion` (collapse to a 120ms fade).
- Never animate layout properties in the chrome; slides may animate width/height only through auto-animate's FLIP (transform) path.

## Components
- Pill buttons: text-only, 13px, hover = faint background, active = spot text.
- Export: the step after editing, so the only filled button in the pill: spot background, upload icon + "Export", between Edit and Present. It opens a 384px popover with the two formats as selectable rows (42px icon tile, name, one-line purpose; the chosen one gets a spot border, spot-soft fill and a spot icon tile), a hint that follows the format, and a full-width spot button that names the action ("Export PowerPoint…"). Daylight uses Spot oklch(0.50 0.13 70) with On-spot near-white.
- Navigator item: 12px mono index left, thumbnail right (1px hairline, 6px radius); current = 2px spot ring; drop indicator = 2px spot line.
- Command palette / go-to: one centered card 560px, 15px input, list rows 32px, active row raised background.
- Toasts: bottom center, raised chrome, 12px, 1.7s (3.2s when they carry an undo key), one at a time, never while presenting.
- Panels open and close instantly; only their contents fade (150ms). Width is never animated.
- Agent panel cards: author · time · tool sentence; no accept/reject (edits are already in the file; ⌘Z undoes).
- No modals except native sheets (open/save) and the destructive confirm for deleting a slide with notes (inline in the navigator item, not a dialog).

## Authoring refinement
Edit mode opens a 272px contextual inspector in place of the agent panel. It is icon-first: drawn 16px icons on one stroke weight, each with an accessible name and a quick tooltip that carries its shortcut; words appear only where an icon would be ambiguous (Fit / Fill / Stretch, field captions).

- **Everything with words is text.** Any element whose content is words plus inline markup (a `<div>` with an `<em>`, a label with a number badge, a figure caption, a table cell, SVG `<text>`) selects and edits as text. Click picks the words directly; double-click edits them, or steps inside a card, figure, table, component or SVG; Esc finishes editing (keeping the words), then steps out one level; ↩ steps in; Tab / ⇧Tab moves between objects at the same level. SVG text edits through a field laid over the words.
- **One name everywhere.** Objects are called by role plus their first words ("Card · Context…", "Tag · Written review"). The canvas tag, breadcrumb (roles only), header and object tree all use it. Roles come from structure and paint: Heading, Text, Text box, Tag, List, Card, Columns, Row, Stack, Image, Graphic, Table, Group…
- **Layout of the panel.** Header: role icon and name, the keyboard-keys help toggle, the breadcrumb, then one toolbar (select the box around it · step inside | duplicate · lock · delete). Properties scroll: Type (role, font, size, weight, alignment, emphasis, spacing, lists, case, color, highlight, link), Image, Layout (X Y W H, rotation, opacity, align, arrange, snap), Appearance (fill, stroke, radius, padding, shadow). Plain text keeps Highlight; a text in a box gets Fill under Appearance instead, never both. The Objects tree is pinned at the bottom (collapsible, remembered; closed by default on short windows), in reading order: branches fold, the path to the selection is always open, ↑↓ select, ←→ fold, typing jumps to a row.
- **Editing text is a state.** The ring turns dashed, the canvas tag reads "Editing text · Esc to finish", the header says so, and properties other than Type dim.
- **Keys belong to where focus is.** Keys on panel and shell controls (pill, navigator, insert bar) never reach the slide. F6 / ⇧F6 cycle the window's areas (slide, panel, insert bar, top bar, slide list), landing in the panel on the object's toolbar, never a value field; in Edit, ⌘↩ only finishes text and never starts presenting; Esc in the panel or on a shell control goes back to the slide, selection kept; clicking the slide takes the keyboard (a changed field commits to the object it showed first). ⌫ / ⌘⌫ delete only the selected object, from the slide or its current Objects row (never a slide in Edit; never from another control), with a toast naming it; ⌘L locks or unlocks the selection; a held or double-tapped ⌫ deletes once, so the neighbour that takes the selection needs a fresh press; undo restores the object and its selection, and undo labels name the property ("Undid font size").
- **Canvas tag** names the object at screen size (11px whatever the zoom) as it is picked, then fades after ~2s so it never covers slide words; while editing it reads "Editing text · Esc to finish" and fades too, leaving the dashed ring and the panel header to carry the state.
- **Selection ring:** 2px spot edged by a dark hairline on both sides, so it reads on light and dark slides alike.
- **Fields:** numbers read with a dot, whole pixels for geometry, ↑/↓ step (⇧ ×10), out-of-range values are clamped with a note on the field; impossible ones (a zero or negative size, garbage) keep the last good value and say so ("Kept 76."). An emptied field removes the override so the deck's CSS applies again. Field borders use Field line (oklch(0.53 0.008 260) / Daylight oklch(0.60 0.008 90)) so inputs read against the chrome.
- With no selection the inspector edits slide background, transition (fade · slide · rise · zoom · flip · none), skip-when-presenting, speaker notes and the deck title. Presentation and export never show editing chrome.
