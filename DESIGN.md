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
- Text faint: oklch(0.60 0.008 260), labels and numerals only; running copy never drops below Text secondary (4.5:1 on every chrome surface).
- Spot (accent, the stage light): oklch(0.83 0.12 82) soft gold. Only for: current slide ring, focus, live-agent dot, active states, the edit selection outline.
- Danger: oklch(0.70 0.16 25), only for destructive confirmations.

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
- Design system control at the foot of the navigator: a six-stop swatch strip, the system's name, a mono version chip (`v3`, `v3+` in spot when the library has moved on). Its popover lists the five systems with a spot check on the active one; the manager is a full-width panel like Settings, one card per system with its tokens summarized in two columns and its version history inline. Destructive delete confirms in place on the button, never in a dialog.
- Presenter view: current slide 60% width left; right column: next slide preview, notes; bottom bar: elapsed timer, clock, counter.

## Motion
- Chrome: 150–200ms, ease-out (cubic-bezier(0.22, 1, 0.36, 1)) on state changes only. Nothing decorative.
- Slides: transition default 480ms with the same ease-out-quint curve; presets fade · slide · zoom · flip · none; auto-animate 600ms. Fragments 320ms. All durations respect `prefers-reduced-motion` (collapse to a 120ms fade).
- Never animate layout properties in the chrome; slides may animate width/height only through auto-animate's FLIP (transform) path.

## Components
- Pill buttons: text-only, 13px, hover = faint background, active = spot text.
- Navigator item: 12px mono index left, thumbnail right (1px hairline, 6px radius); current = 2px spot ring; drop indicator = 2px spot line.
- Command palette / go-to: one centered card 560px, 15px input, list rows 32px, active row raised background.
- Toasts: bottom center, raised chrome, 12px, 1.7s (3.2s when they carry an undo key), one at a time, never while presenting.
- Panels open and close instantly; only their contents fade (150ms). Width is never animated.
- Agent panel cards: author · time · tool sentence; no accept/reject (edits are already in the file; ⌘Z undoes).
- No modals except native sheets (open/save) and the destructive confirm for deleting a slide with notes (inline in the navigator item, not a dialog).
