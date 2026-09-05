# Dek deck format

A deck is **one HTML file**. Dek renders it inside a sandboxed frame with its runtime injected, so a deck is also a plain web page any browser can open.

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Quarterly review</title>
  <meta name="dek-transition" content="rise">
  <style>
    :root { --bg: oklch(0.14 0.01 260); --ink: oklch(0.95 0.01 90); --accent: oklch(0.8 0.15 80); }
    section { background: var(--bg); color: var(--ink); font-family: "Inter", system-ui, sans-serif; }
    h1 { font-size: 4rem; letter-spacing: -0.03em; }
  </style>
</head>
<body>
  <section id="s-cover" class="dek-center">
    <h1 data-id="title">Quarterly review</h1>
    <p class="fragment fade-up">Q3 · Growth team</p>
    <aside class="notes">Open with the headline number. 30 seconds.</aside>
  </section>

  <section id="s-numbers" data-transition="zoom">
    <h2>Revenue</h2>
    <figure class="dek-chart" style="width: 1400px; height: 640px"
            data-chart='{"type":"bar","labels":["Jul","Aug","Sep"],"series":[{"name":"ARR","data":[1.2,1.6,2.1]}],"options":{"values":true,"suffix":"M","prefix":"$"}}'></figure>
  </section>
</body>
</html>
```

## Rules

1. **Slides are top-level `<section>` elements** (a `<section>` with no `<section>` ancestor). Wrappers like `<main>` are fine; nested sections belong to the slide that contains them.
2. **The canvas is 1920×1080 px.** Lay slides out in absolute pixels on that canvas; Dek scales the whole thing to any screen. `html { font-size: 32px }`, so `1rem` is a comfortable body size and `4rem` a big title. Change the canvas with `<meta name="dek-size" content="1600x1000">`.
3. **Give every slide an `id`** (Dek adds `s-xxxx` if you don't). Tools accept a 1-based slide number or the id.
4. **Style with `section`, classes and ids** in `<head><style>`. Never rely on `body > section`; sections are absolutely positioned by the runtime (`position`, `top/left`, `width/height`, `overflow` and `visibility` on `section` are managed by Dek; everything else is yours). A slide's background is the section's `background`.
5. **Speaker notes** live in `<aside class="notes">` inside the slide. They never render on stage; the presenter view shows them.
6. **Assets** (images, fonts, video) resolve relative to the deck file. External `https://` URLs work too. Prefer local files for anything shown on stage.
7. **Scripts are allowed** (`<script>` in head or body, `type="module"` too). They run on the stage but not in thumbnails. Use them for Three.js, D3, live data. Listen to `document.addEventListener('dek:change', e => e.detail)` for slide changes if a script needs to know the current slide (`window.dek.state()` also works).

## Motion

Everything below ships in the runtime; no library needed. All timings honor `prefers-reduced-motion`.

### Slide transitions
Deck default: `<meta name="dek-transition" content="fade">`. Per slide: `data-transition="slide"` on the incoming section. Presets: `fade` · `slide` · `rise` · `zoom` · `flip` · `none`. Duration: `--dek-transition-ms` on `:root` (default 480ms) or `data-transition-ms` on the slide.

### Fragments (step-by-step reveals)
Add `class="fragment"` to any element; each `→` shows the next one. Order is document order unless `data-fragment-index="2"` is set (equal indices appear together).

Variants (add as a second class): `fade-up` `fade-down` `fade-left` `fade-right` `zoom` `blur` · `highlight` (turns `--dek-highlight`) · `strike` · `fade-out` · `dim` (dims once it is no longer the current fragment). Current fragment carries `.current-fragment`.

### Auto-animate between slides
Put `data-auto-animate` on two consecutive slides and give elements the same `data-id` in both. Dek animates position, size, font-size, color, background and radius from one to the other (600ms, override with `data-auto-animate-duration="900"`). Unmatched elements fade in/out. Use it for "zoom into one number", "list becomes diagram", "title moves to the corner".

### Enter animations
`data-animate="fade-up"` on any element animates it when its slide appears. Presets: `fade` `fade-up` `fade-down` `fade-left` `fade-right` `rise` `zoom-in` `zoom-out` `blur-in` `wipe-right` `wipe-up` `grow-x` `grow-y`. Options: `data-delay="200"` (ms), `data-duration="900"`, and `data-stagger="80"` on a parent to animate its children one after another with the parent's preset.

### Numbers and text
- `<span data-count-to="2400000" data-prefix="$" data-decimals="0">0</span>` counts up on enter (`data-count-from`, `data-duration`, `data-suffix`).
- `<h1 data-typewriter="30">Typed on enter</h1>` types the text at 30 ms/char.

### Charts
`<figure class="dek-chart" data-chart='{…}' style="width:1200px;height:600px"></figure>` renders an animated SVG chart from JSON:

```json
{ "type": "bar | line | area | donut | pie",
  "labels": ["Q1","Q2","Q3"],
  "series": [{ "name": "North", "data": [12, 18, 24], "color": "oklch(0.7 0.15 250)" }],
  "options": { "stacked": false, "values": true, "legend": true, "grid": true, "smooth": true,
               "dots": true, "ymax": 30, "ticks": 4, "prefix": "$", "suffix": "%", "compact": true,
               "title": "Revenue", "center": "82%", "centerSub": "retention", "colors": ["…"] } }
```
Series colors default to `--dek-c1 … --dek-c6` (set them on `:root` to theme all charts). Text inherits the slide's font and color. Give the figure an explicit width and height. Bars grow, lines draw, arcs sweep when the slide appears.

### 3D (CSS)
- Scene: `<div class="dek-scene">` sets perspective (`--dek-perspective: 1400px`).
- Cube: `<div class="dek-cube" data-orbit style="--size: 360px; --orbit: 20s"><div class="front">…</div><div class="back">…</div><div class="right">…</div><div class="left">…</div><div class="top">…</div><div class="bottom">…</div></div>` builds a spinning cube from six faces you style freely.
- `data-orbit` rotates any preserve-3d element continuously (`--orbit` duration, `--tilt` angle).
- `class="dek-tilt" data-tilt="10"` tilts an element toward the pointer (parallax cards, mockups).
- Real 3D: include Three.js (`<script type="module">` from a CDN or a local file) and draw into a `<canvas>` inside the slide.

## Layout helpers (opt-in classes)
`dek-center` (center everything) · `dek-stack` (column, `--gap`) · `dek-row` · `dek-cols` · `dek-cols-2` · `dek-cols-3` · `dek-fill` (absolute inset 0) · `dek-bottom` (footer band) · `dek-full` (no padding) · `dek-cover` (object-fit cover) · `dek-muted`.

Sections get `padding: 96px 120px` by default; `dek-full` removes it for full-bleed slides.

## Components (recurring elements)
Store reusable snippets as templates in the body: `<template data-dek-component="stat" data-description="Big number with label">…</template>`. Inside, `{{name}}` placeholders are filled when the component is used. Agents list them with `list_components` and instantiate with `use_component` (or `add_slide` with `component`). Components keep a deck visually consistent: define them once, reuse everywhere.

## Theme variables
Define the deck's design tokens as CSS custom properties on `:root` (colors, fonts, spacing). `get_theme` reads them; `set_theme` upserts them into a `<style id="dek-theme">` block so the whole deck can be re-skinned with one call.

## Design systems
A **design system** is that whole visual language kept as data, outside any one deck, so the same look dresses all of them. Dek stores up to five, each with an append-only version history, in `~/Library/Application Support/Dek/design-systems.json`. The user switches between them from the design-system button at the bottom of the slide navigator (⌥⌘D); you build and edit them over MCP.

### The token set
`list_theme_tokens` returns every token with the complete default system as a worked example. The groups:

| Group | What it decides |
| --- | --- |
| `meta` | `mode` (dark / light), `mood`, `notes` — when to reach for this system |
| `typography` | `fonts.display/body/mono` (`family`, `fallback`, `weights`, `url`), `scale` (display · h1 · h2 · h3 · lead · body · small · caption), `weight`, `tracking`, `leading`, `transform`, `measure` |
| `color` | `bg`, `surface`, `surfaceAlt`, `ink`, `inkMuted`, `inkFaint`, `accent`, `accentInk`, `accentSoft`, `hairline`, `highlight`, `positive`, `negative`, `warning`, `series[6]`, `gradient` |
| `space` | `unit`, `slidePadX/Y`, `gap`, `gapTight`, `gapLoose`, `radius`, `radiusSm`, `radiusLg`, `border`, `rule`, `shadow` |
| `motion` | `transition` + `transitionMs` + `ease` (between slides), `fragment` + `fragmentMs`, `autoAnimateMs`, `enter` + `enterMs` + `stagger`, `reducedMotion` |
| `chart` | `palette`, `grid`, `legend`, `values`, `smooth`, `dots`, `compact`, `ticks`, `gridOpacity`, `axisOpacity`, `prefix`, `suffix`, `decimals` |
| `components` | named `{{var}}` snippets written into the deck as `<template data-dek-component>` |
| `css` | raw CSS appended verbatim, for anything the tokens do not cover |

### What applying one does
`apply_theme` rewrites four things and nothing else:

1. **`<style id="dek-theme">`** — every token as a custom property (`--font-display`, `--text-h1`, `--bg`, `--ink`, `--accent`, `--gap`, `--radius`, `--dek-transition-ms`, `--dek-c1…6`, …) followed by the rules that use them.
2. **`<meta name="dek-transition">`** — the system's slide transition.
3. **`<meta name="dek-chart">`** — the chart defaults, which every `.dek-chart` figure inherits unless its own `data-chart` options say otherwise.
4. **`<meta name="dek-theme" content="id@version">`** — which system and version dressed the deck, so Dek can tell you when the system has moved on.

Everything else in the file — the deck's own `<style>` blocks, slides, notes, scripts — is untouched.

### Writing slides against a system
Use the tokens, not literals: `color: var(--ink)`, `font-family: var(--font-display)`, `gap: var(--gap)`. The helper classes `dek-display` `dek-lead` `dek-muted` `dek-caption` `dek-eyebrow` `dek-accent` `dek-mono` `dek-card` `dek-surface` `dek-rule` `dek-positive` `dek-negative` `dek-warning` are all bound to them.

The compiled block is the deck's **base layer**: it beats plain element styling (`h1 { … }`) but loses to any class-based rule the deck writes, so a slide can always override it. Roles that mean "the same ink, dimmer" (`small`, `figcaption`, `th`, `blockquote`, `dek-muted`, `dek-caption`) follow `currentColor`, so a slide that flips to a dark background stays readable. A slide that inverts should redeclare the tokens it changes on itself:

```css
section.inverted { --bg: oklch(0.18 0.02 265); --ink: oklch(0.96 0.01 90); --hairline: oklch(0.34 0.02 265);
                   background: var(--bg); color: var(--ink); }
```

`apply_theme` reports `missing_vars`: custom properties the deck's CSS reads that the incoming system does not define. A non-empty list means those rules stopped resolving — rewrite them against the system's tokens, or put the values in the system's `css`.

### The tools
`list_themes` (what exists, what is on the deck, whether it is out of date) · `list_theme_tokens` · `get_theme_system` · `preview_theme_css` (compile without writing) · `create_theme` · `update_theme` (merges a patch; `null` removes a key; every change is a new version) · `revert_theme` · `duplicate_theme` · `delete_theme` · `apply_theme` · `remove_theme` · `capture_theme` (turn the look a deck already has into a system — the way to start from a deck you like).

Design one *with* the user: read the deck, agree the direction out loud, then write a complete token set in one `create_theme`, apply it, and check it with `snapshot_slide` on a title slide, a dense slide and a chart slide. Each `update_theme` is a version they can roll back, so give every one a `note` that says what changed.

## Compatibility with Claude Design decks
Dek opens Claude Design exports directly (they are unpacked into a `<name> (Dek).html` copy) and honors that format's conventions in any deck:
- `data-speaker-notes="…"` on a section is read as speaker notes when there is no `<aside class="notes">`.
- The current slide carries `data-deck-active` in addition to `.present`, so CSS such as `[data-deck-active] .reveal { animation: … both }` plays on entry.
- Sections keep `data-deck-slide="n"` (index) after import, so styles written against `section[data-deck-slide]` still apply.

## Other metadata
- `data-dek-skip` on a section keeps the slide in the file but out of the presentation: → and ← jump over it, it is dimmed in the navigator, and it stays reachable by number or `goto`. Claude Design's `data-deck-skip` means the same. Toggle from the slide's context menu or with `update_slide` (`attrs: {"data-dek-skip": ""}` / `null`).
- `<meta name="dek-autoslide" content="8000">` advances every 8 s while presenting (per slide: `data-autoslide="4000"`).
- `<meta name="dek-slide-numbers" content="of">` asks Dek to show `4 / 18` on stage (`plain` shows `4`).

## Craft notes for agents
- Design the deck as a whole: pick a type scale, a palette (2–3 colors on tinted neutrals), one motion language. Put them in `:root` variables.
- One idea per slide. Big type (titles 3.5–5rem, body 1–1.25rem). Left-align long text; center only short statements.
- Prefer full-bleed color or imagery over white boxes. Avoid centered-everything and identical three-column card grids.
- Reveal with fragments only when the order matters. Use auto-animate for continuity between two views of the same thing.
- Check your work: `snapshot_slide` returns a PNG of the slide exactly as the audience sees it.
