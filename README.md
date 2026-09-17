# Dek

A local, single-user macOS workspace for creating, editing and presenting HTML slide decks. Each deck remains one `.html` file with neighboring assets. Codex, Claude and other external agents work through MCP; the contextual editor handles everyday authoring by hand.

Native Swift/AppKit and WKWebView. No hosting, accounts, collaboration backend, or built-in agent conversation. The PowerPoint writer is pinned and bundled locally; no export service or runtime download is required.

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

Three regions: a slide **navigator** on the left (⌘\ hides it), the **stage** in the middle, and an **agent panel** on the right (⌘J). One floating pill carries the deck name, the `4 / 18` counter, an **Agent** button (a gold dot and the agent's name while one is connected, a count of edits you have not looked at), **Edit** and **Present**. A **Design** button (⌥⌘D) opens the design systems in the sidebar.

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
| ⇧⌘E | export PDF from the native File menu |

Present goes fullscreen with chrome hidden and the cursor auto-hiding; while presenting, nothing but navigation, black screen and the presenter view responds, so a stray ⌘⌫ or an agent edit never reaches the projector (file changes are applied when you stop). Past the last slide the screen goes black; one more click or → ends the presentation. Play → *Present on Second Display* puts the deck on the other screen and the presenter view on this one. Clicking advances (Settings turns it off). Speaker notes live in `<aside class="notes">` inside a slide and only show in the presenter view, whose timer counts elapsed time or down from a Settings countdown (double-click it to reset).

### Importing from Claude Design (and other HTML)

Open a Claude Design "standalone" export and Dek imports it: the bundled page is unpacked in the app, fonts are inlined, the deck's slides become top-level `<section>`s with their speaker notes, and the result is saved as `<name> (Dek).html` next to the original, which stays untouched. Re-opening the export reuses your Dek copy unless the export is newer. Pages whose slides are `.slide`, `[data-slide]` or `<article>` children are wrapped the same way. Agents get the same through `import_deck`. Claude Design decks keep their reveal animations because Dek marks the current slide with `data-deck-active` and reads `data-speaker-notes`.

### Reading and hot reload

Dek watches the deck file. When it changes on disk (agent, editor, git checkout) the stage reloads in place and stays on the same slide; a CSS-only change swaps styles live without a reload. Every change that lands this way is undoable with ⌘Z, including agent edits.

### Slides

Select slides with click, ⌘-click and ⇧-click. **Hide / Show** and **Duplicate** are visible above the navigator. The adjacent menu provides copy, move, section assignment and delete. Drag a selected set to reorder it while retaining its relative order. Named sections can collapse, rename and reorder; the overview offers the same batch actions. Deleting the last slide leaves an editable empty deck.

Copy slides and paste them into another open deck: Dek copies local assets and reusable components, resolves component-name collisions, and uses the destination's design. The source remains unchanged. Each batch action is one undo step.

Hidden slides stay available for editing. Presentation navigation skips them, and exports exclude them unless **Include hidden slides** is selected. During a talk, use the command palette's **Show hidden slide … now** action to show one explicitly. An all-hidden deck cannot start presenting.

### Design systems (⌥⌘D)

A design system is the deck's visual language as data — type, color, spacing, motion, chart and component preferences — kept outside any one deck so the same look dresses all of them.

**Design** in the pill is the way in: it turns the left sidebar into the list of systems, each with its palette, its type and its version. Clicking one puts its **composition** on the stage — the guidelines as a single self-contained HTML page, written in the system it documents: the palette as real swatches, type specimens at slide scale, the spacing rhythm, the motion language with its easing curve drawn, the chart defaults, every component rendered live beside its source, and the whole token list. *Save HTML…* writes that page next to the deck, so a system travels as one file.

Dek holds **five**. Each carries an append-only version history: every edit becomes a new version, *History* lists them with what changed, and *Restore* brings an old one back as a new version rather than erasing anything. Apply, duplicate, delete and hand-off-to-Claude-Code all live on the composition's bar. When a system moves ahead of the deck it dressed, the sidebar marks it and the bar offers to re-apply. Esc steps back out: composition, then list, then slides.

Claude Code writes them. Describe the look you want and it builds the token set, applies it, snapshots the result and refines it — each round a version you can roll back. *Capture This Deck's Look* goes the other way: it turns a deck you already like into a system, carrying its fonts, palette, type scale, spacing, transition and components across, plus any custom properties the system itself cannot express, so applying it back leaves the deck exactly as it was.

Applying one writes a single `<style id="dek-theme">` block, the transition and chart `<meta>`s, the components the system owns, and a `dek-theme` marker; the rest of the file is untouched and ⌘Z undoes it. The library lives in `~/Library/Application Support/Dek/design-systems.json`.

### Edit mode (⌘E or `e`)

The inspector appears in Edit mode. Double-click text to edit individual words; select a range before changing its font, exact size, color, highlight, weight or decoration. Paragraph controls include alignment, spacing, lists, links and case. Click an object for geometry, rotation, opacity, stacking, alignment, distribution and locking. ⇧-click selects multiple objects; group/ungroup keeps their HTML editable. Arrows nudge by 1 px, ⇧ by 10 px; Alt temporarily bypasses grid snapping while dragging.

The insertion bar adds text, headings, shapes and images. Choose images with the file picker, drag/drop, or clipboard paste. Assets are copied beside the deck. Image controls provide replacement, descriptions, proportional/free resizing, fit/fill, crop-frame ratios and crop position. Click **Slide settings** for the deck title, slide background, transition and speaker notes.

The deck-name menu exposes New, Open, Duplicate and the overview. The new-slide button offers blank, title, content, two-column and quote layouts. Charts, components, SVG and other complex HTML stay selectable as complete objects.

### Saving and export

Manual and agent changes share undo history and the same source mutation layer. “Saved” means the native writer acknowledged an atomic disk write. Typing is grouped into editing-session transactions. Deck switches and quitting flush active text first. Conflicting external changes stop saves and offer a recovered copy or a reload. Failed writes also retain recovery HTML in the app's support folder.

**Export** offers PDF, editable PowerPoint, and PowerPoint that preserves appearance. PDF keeps vector content where WebKit supports it. Editable PowerPoint contains ordinary text, shapes and images as native objects; complex visuals use image fallbacks listed in the result. The appearance mode uses one image per slide. All modes preserve order and aspect ratio, and both PowerPoint modes include speaker notes. Fragments export in their final state. Missing images and failed pages fail the job explicitly.

Exports and slide/overview snapshots use a separate renderer and preserve the current slide and selection. Native export shows progress and supports cancellation. MCP uses `export_deck`, `get_export_status` and `cancel_export`.

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

The runtime ships fragments (with variants), slide transitions (fade · slide · rise · zoom · flip), auto-animate between slides sharing `data-id` elements, thirteen enter animations with delay and stagger, animated counters and typewriters, SVG charts from JSON (bar · line · area · donut · pie, themed through `--dek-c1…c6`), CSS 3D helpers (cube, orbit, pointer tilt), components (`<template data-dek-component>` with live `data-dek-use` instances and `{{vars}}`), theme variables on `:root`, and deck-wide chart defaults from `<meta name="dek-chart">`. Decks may include any script (Three.js, D3) too.

## Agents · MCP

The app runs a loopback-only HTTP API (bearer token in `~/Library/Application Support/Dek/agent.json`, `0600`, rotated per launch). A dependency-free stdio bridge, [mcp/dek-mcp.js](mcp/dek-mcp.js), exposes it as MCP tools:

| Group | Tools |
| --- | --- |
| Read | `get_deck` · `get_slide` · `get_source` · `get_elements` · `get_theme` · `list_components` · `get_state` · `get_format_guide` |
| Design systems | `list_themes` · `list_theme_tokens` · `get_theme_system` · `preview_theme_css` · `create_theme` · `update_theme` · `revert_theme` · `duplicate_theme` · `delete_theme` · `apply_theme` · `remove_theme` · `capture_theme` · `export_theme` |
| Look | `snapshot_slide` (PNG of a slide at a fragment step) · `snapshot_overview` (light table) · `snapshot_window` (the app itself, optionally after running a shell command such as `settings`) |
| Write | `add_slide` · `update_slide` · `delete_slide` · `move_slide` · `duplicate_slide` · `set_notes` · `add_element` · `update_element` · `delete_element` · `set_theme` · `append_style` · `set_head` · `set_title` · `add_component` · `use_component` · `write_deck` · `create_deck` · `open_deck` · `import_deck` |
| Drive | `goto` · `navigate` · `present` · `overview` |

Writes go through the app, land in the file before the tool returns, preserve the rest of the file byte-for-byte, show up in the Agent panel, and are undoable with ⌘Z. Snapshots come back as images in the tool result so the agent sees exactly what the audience sees. The format guide is also an MCP resource (`dek://format-guide`), and three prompts ship with the server: `build-deck`, `design-system` and `polish-deck`.

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
web/test/ node:test suites for the deck model and the design systems (`npm test` in web/)
build.sh  web bundle + swiftc (universal) + .app assembly (ad-hoc signed)
```

`PRODUCT.md` and `DESIGN.md` hold the brief the interface follows. `npm test` inside `web/` runs the suites after `npm ci`. For web-only work, `npm run dev` inside `web/` watches and rebuilds; `.claude/launch.json` serves `web/` at `localhost:8742` with a dev harness that loads `decks/Welcome.html`.

## Reviews

`docs/reviews/` holds the design critiques run on the shell (`impeccable critique`, 28/40 before the fixes it prompted) and on the Welcome deck (`design-taste-frontend`), with what changed and what was deliberately deferred.

## Notes

- WebKit's `takeSnapshot` flattens CSS 3D transforms, so a spinning cube looks flat in `snapshot_slide` even though it renders correctly on screen.
- Dek keeps rendering while covered by other windows and opts out of App Nap so agents can drive it from a terminal.

## Acceptance checks

Run `npm --prefix web test` and `./build.sh`. Representative decks are in `web/test/fixtures`. `mac/test/native_acceptance.py` exercises persistence, shared edits, sections, cross-deck copying, hidden-slide presentation and all export modes against a separately launched app with `DEK_SUPPORT_DIR` set to a temporary profile. It refuses the normal app profile. Never replace or restart an active personal Dek session for QA.
