# Dek

A macOS app that presents HTML slide decks. A deck is one `.html` file: each top-level `<section>` is a slide on a 1920×1080 canvas that Dek scales to any screen. You read, rehearse and present; an agent (Claude Code, Claude Desktop) writes and edits the deck over MCP and checks its work through snapshots. Light direct manipulation on the stage covers the small stuff: move, resize, retype, delete, add a text box or an image.

<sub>Native Swift/AppKit shell + WKWebView. No Electron, no runtime downloads. ~100 KB of JS, one small binary. Sibling of [Tinta](../tinta).</sub>

## Build & install

Requires Xcode Command Line Tools and Node.

```
./build.sh
```

That produces `dist/Dek.app`. To install:

```
cp -R dist/Dek.app /Applications/
```

Open decks any of these ways:

- `open -a Dek deck.html`
- Drag an `.html` file onto the window or the Dock icon
- **⌘O**, File → Open Recent, or **⌘N** for a new deck from the built-in template
- File → Open the Welcome Deck (a tour of the format, copied to `~/Documents/Dek/`)

## Using it

Three regions: a slide **navigator** on the left (⌘\ hides it), the **stage** in the middle, and an **agent panel** on the right (⌘J). One floating pill carries the deck name, the `4 / 18` counter, an **Agent** button (a gold dot and the agent's name while one is connected, a count of edits you have not looked at), **Edit** and **Present**.

### Presenting

| Key | Action |
| --- | --- |
| → ↓ space n | next fragment / slide |
| ← ↑ ⇧space p ⌫ | previous |
| home / end | first / last slide |
| `12` ⏎ | type a number to jump |
| ⌘P | go to slide by title |
| o | light table (all slides) |
| ⌘⏎ / ⌥⌘⏎ | present from here / from the start |
| ⌥⌘P or s | presenter view (current, next, notes, timer) |
| b / w | black / white screen |
| esc | stop presenting |
| ⇧⌘E | export a PDF (one vector page per slide) |

Present goes fullscreen with chrome hidden and the cursor auto-hiding; while presenting, nothing but navigation, black screen and the presenter view responds, so a stray ⌘⌫ or an agent edit never reaches the projector (file changes are applied when you stop). Past the last slide the screen goes black; one more click or → ends the presentation. Play → *Present on Second Display* puts the deck on the other screen and the presenter view on this one. Clicking advances (Settings turns it off). Speaker notes live in `<aside class="notes">` inside a slide and only show in the presenter view, whose timer counts elapsed time or down from a Settings countdown (double-click it to reset).

### Importing from Claude Design (and other HTML)

Open a Claude Design "standalone" export and Dek imports it: the bundled page is unpacked in the app, fonts are inlined, the deck's slides become top-level `<section>`s with their speaker notes, and the result is saved as `<name> (Dek).html` next to the original, which stays untouched. Re-opening the export reuses your Dek copy unless the export is newer. Pages whose slides are `.slide`, `[data-slide]` or `<article>` children are wrapped the same way. Agents get the same through `import_deck`. Claude Design decks keep their reveal animations because Dek marks the current slide with `data-deck-active` and reads `data-speaker-notes`.

### Reading and hot reload

Dek watches the deck file. When it changes on disk (agent, editor, git checkout) the stage reloads in place and stays on the same slide; a CSS-only change swaps styles live without a reload. Every change that lands this way is undoable with ⌘Z, including agent edits.

### Slides

Drag thumbnails to reorder. Right-click one for New Slide After, Duplicate, Move Up/Down, Copy Slide HTML, Copy Slide ID, Present From Here, Skip Slide (kept in the file, dimmed in the navigator, jumped over while presenting), Delete. Also ⇧⌘N (new slide), ⌘D (duplicate), ⌘⌫ (delete), ⌥⌘↑/↓ (move). All of it writes the file immediately; ⌘Z undoes.

### Edit mode (⌘E or `e`)

For the basics a human wants to fix by hand. Click an element to select it (headings, paragraphs, lists, images, charts, components), drag to move (Dek writes a CSS `translate`, so the layout stays intact), pull the corner handle to resize, ⌫ to delete, arrows to nudge (⇧ for 10px). Double-click or ⏎ edits text in place; the floating toolbar switches the type (H1 / H2 / H3 / Text), bold, italic, alignment and size. The bar at the bottom inserts a heading, a text box, or an image (⌥⌘H / ⌥⌘T / ⌥⌘I). Dropping an image file on the window inserts it too. Images are copied into an `assets/` folder next to the deck so the deck stays portable.

### Chrome

- **Command palette** ⌘K or ⇧⌘P: fuzzy-search every command. ⌘P is the same box in go-to-slide mode.
- **Settings** ⌘,: appearance (Auto / Light / Dark; dark keeps the stage neutral so slide colors read as they will on the projector), thumbnail size, slide numbers on stage, default transition and speed, click-to-advance, presenter timer (elapsed or countdown), notes size, and the agent connection.
- **Shortcuts overlay** ⌘/ or `?`.

## Deck format

Read [docs/DECK_FORMAT.md](docs/DECK_FORMAT.md). The short version:

```html
<section id="s-cover" class="dek-center" data-transition="rise">
  <h1 data-id="title" data-animate="fade-up">One idea per slide.</h1>
  <p class="fragment fade-up">Fragments reveal in order.</p>
  <figure class="dek-chart" style="width:1200px;height:600px"
          data-chart='{"type":"bar","labels":["Q1","Q2"],"series":[{"data":[3,5]}]}'></figure>
  <aside class="notes">What to say.</aside>
</section>
```

The runtime ships fragments (with variants), slide transitions (fade · slide · rise · zoom · flip), auto-animate between slides sharing `data-id` elements, thirteen enter animations with delay and stagger, animated counters and typewriters, SVG charts from JSON (bar · line · area · donut · pie, themed through `--dek-c1…c6`), CSS 3D helpers (cube, orbit, pointer tilt), components (`<template data-dek-component>` with live `data-dek-use` instances and `{{vars}}`), and theme variables on `:root`. Decks may include any script (Three.js, D3) too.

## Agents · MCP

The app runs a loopback-only HTTP API (bearer token in `~/Library/Application Support/Dek/agent.json`, `0600`, rotated per launch). A dependency-free stdio bridge, [mcp/dek-mcp.js](mcp/dek-mcp.js), exposes it as MCP tools:

| Group | Tools |
| --- | --- |
| Read | `get_deck` · `get_slide` · `get_source` · `get_elements` · `get_theme` · `list_components` · `get_state` · `get_format_guide` |
| Look | `snapshot_slide` (PNG of a slide at a fragment step) · `snapshot_overview` (light table) · `snapshot_window` (the app itself, optionally after running a shell command such as `settings`) |
| Write | `add_slide` · `update_slide` · `delete_slide` · `move_slide` · `duplicate_slide` · `set_notes` · `add_element` · `update_element` · `delete_element` · `set_theme` · `append_style` · `set_head` · `set_title` · `add_component` · `use_component` · `write_deck` · `create_deck` · `open_deck` · `import_deck` |
| Drive | `goto` · `navigate` · `present` · `overview` |

Writes go through the app, land in the file before the tool returns, preserve the rest of the file byte-for-byte, show up in the Agent panel, and are undoable with ⌘Z. Snapshots come back as images in the tool result so the agent sees exactly what the audience sees. The format guide is also an MCP resource (`dek://format-guide`), and two prompts ship with the server: `build-deck` and `polish-deck`.

**Setup.** Settings → Agents shows the exact command; for a checkout of this repo:

```
claude mcp add --scope user dek -- node ~/Documents/repos/dek/mcp/dek-mcp.js
```

Claude Desktop gets a one-click Install in Settings (quit Desktop first; it rewrites its config on exit). Then, with a deck open: *"Look at the deck open in Dek and turn it into a 10-slide pitch for my project; check each slide with a snapshot."*

## Layout

```
web/      shell (index.html, style.css, src/main.js) + deck runtime (src/runtime/) bundled with esbuild
mac/      Swift AppKit shell: window, menus, file I/O, watcher, presenter window, PDF export, agent server
mcp/      dek-mcp.js, the stdio MCP bridge
decks/    Welcome.html, the tour deck    templates/  blank.html, used by ⌘N and create_deck
docs/     DECK_FORMAT.md, the agent-facing format guide (also served as get_format_guide)
build.sh  web bundle + swiftc (universal) + .app assembly (ad-hoc signed)
```

`PRODUCT.md` and `DESIGN.md` hold the brief the interface follows. For web-only work, `npm run dev` inside `web/` watches and rebuilds; `.claude/launch.json` serves `web/` at `localhost:8742` with a dev harness that loads `decks/Welcome.html`.

## Reviews

`docs/reviews/` holds the design critiques run on the shell (`impeccable critique`, 28/40 before the fixes it prompted) and on the Welcome deck (`design-taste-frontend`), with what changed and what was deliberately deferred.

## Notes

- WebKit's `takeSnapshot` flattens CSS 3D transforms, so a spinning cube looks flat in `snapshot_slide` even though it renders correctly on screen.
- Dek keeps rendering while covered by other windows and opts out of App Nap so agents can drive it from a terminal.
