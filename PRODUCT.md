# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

(The chrome is HTML/CSS rendered in a WKWebView inside a native Swift/AppKit macOS app, with real macOS menus, sheets and fullscreen; see Operating Context.)

## Users
Two people, each running Dek on their own Mac: the owner and a close collaborator. They present to clients and build highly visual decks by directing an agent instead of dragging boxes. Fluent with keyboard shortcuts, allergic to visual noise, they care about typographic and motion quality on the slide more than about features in the chrome. They rehearse at night at a desk and present the next morning on a projector or a meeting-room TV. When they need to co-edit the same deck, they do it in Google Slides from Dek's PowerPoint export.

## Product Purpose
Dek is a macOS app that presents HTML slide decks. A deck is one `.html` file: each top-level `<section>` is a slide, the `<head>` carries the deck's CSS, and the slides are laid out on a fixed 1920×1080 canvas that Dek scales to any screen. The human directs, edits, rehearses and presents; the default creation loop is an agent (Claude Code, Codex, or another MCP client) connected over MCP, which creates and edits decks, slides and slide elements and can look at the result through snapshots. Dek is the stage, the remote and the review surface for that loop. Success is a deck that looks and moves better than a slide tool allows, and that still reaches collaborators in Google Slides without redoing the design.

## Positioning
Presentations with animation and visual quality a slide editor can't reach, because the deck is HTML and Claude Code builds it: the flexibility of HTML/CSS combined with an agent that writes it, and Dek as the stage that presents it.

## Operating Context
- Native Swift/AppKit shell with a WKWebView chrome, an esbuild-bundled web layer (`web/`), and a loopback MCP bridge (`mcp/dek-mcp.js`) that agents connect to. No AI API key in the app.
- Decks live as HTML files on disk; hot reload keeps Dek on the same slide when the agent, an editor or git changes the file.
- Sharing and co-editing happen outside Dek: Export → PowerPoint → upload to Google Drive → Open with Google Slides (or Save as Google Slides). The PowerPoint export is built for that import; what Slides keeps and drops is tracked in `docs/export-google-slides.md`.
- Claude Design "standalone" exports open directly and are converted into Dek decks.

## Capabilities and Constraints
- Local only: no hosting, accounts, collaboration service or cloud persistence. HTML files on disk remain authoritative. Two users means two local installs, not shared state.
- Manual edits and agent changes share persistence and undo (⌘Z undoes agent writes).
- Export happens on the Mac: PDF (one page per slide, vector where WebKit allows) and PowerPoint (native, editable text, shapes and images, fonts mapped to Google Fonts, effects PowerPoint can't hold simplified and listed before saving). The appearance-only PowerPoint mode was removed. Speaker notes travel with PowerPoint.
- Every mutation available in the UI is also an MCP tool; agents see their work through slide snapshots.
- Presentation is never interrupted: no dialogs, badges or reload flashes while presenting.

## Brand Commitments
A quiet stage. The slide is the only thing that emits light; everything around it is a neutral, near-black theatre that never competes with the deck's colors or shifts how they read (the same reason photo and video tools are dark). Native macOS manners everywhere: real menus, Open Recent, sheets, fullscreen, system dark/light. Copy is short and literal: "Present", "4 / 18", "Saved", "Export".

## Anti-references
- Electron bulk, web-app chrome, toolbars of icons.
- Permanent walls of editing controls. Manual text, shape, image, layout and notes controls appear in Edit mode and leave the stage clear while reading or presenting.
- SaaS dashboard aesthetics; gradients in the chrome; glassmorphism; purple.
- reveal.js' visible framework look (default themes, progress bars, controls in the corner).

## Evidence on Hand
- Real client decks the users built with Dek (kept on the owner's Mac, outside the repo) are the private reference for export and design fidelity. They stay outside this public repo and are never cited by client name in committed files; tests reach them through `DEK_GOLDEN_DECK`.
- Public fixtures: `web/test/fixtures/` (including `export-kitchen-sink.html`), `decks/`, `templates/`, `web/dev/welcome.html`.
- No testimonials, customers, benchmarks or pricing exist; future work must not invent them.

## Product Principles
- The slide is the UI. One floating pill of chrome; a navigator that can disappear; everything else is the deck.
- HTML in, presentation out. No proprietary format: a deck is a readable, diffable HTML file any agent or browser can open.
- Agent-first editing. Every mutation lands in the file immediately, is undoable, and the agent can see its result.
- Motion and visual quality are the point: fragments, transitions, auto-animate, charts and CSS 3D are built into the runtime, and design systems keep a deck's visual language as versioned data outside the deck.
- Leaving Dek must not cost the design. Exports to PowerPoint/Google Slides and PDF stay faithful and editable, and say plainly what they had to simplify.
