# Dek

## Product Purpose
Dek is a macOS app that presents HTML slide decks. A deck is one `.html` file: each top-level `<section>` is a slide, the `<head>` carries the deck's CSS, and the slides are laid out on a fixed 1920×1080 canvas that Dek scales to any screen. The human directs, edits, rehearses and presents; the default creation loop is an agent (Codex, Claude Code, or another MCP client) connected over MCP, which creates and edits decks, slides and slide elements and can look at the result through snapshots. Dek is the stage, the remote and the review surface for that loop.

## Users
A single power user: a consultant/researcher who presents to clients and builds highly visual decks by directing an agent instead of dragging boxes. Fluent with keyboard shortcuts, allergic to visual noise, cares about typographic and motion quality on the slide more than about features in the chrome. Rehearses at night at a desk; presents the next morning on a projector or a meeting-room TV.

## register
product

## Brand & Tone
A quiet stage. The slide is the only thing that emits light; everything around it is a neutral, near-black theatre that never competes with the deck's colors or shifts how they read (the same reason photo and video tools are dark). Native macOS manners everywhere: real menus, Open Recent, sheets, fullscreen, system dark/light. Copy is short and literal: "Present", "4 / 18", "Saved".

## Strategic principles
- The slide is the UI. One floating pill of chrome; a navigator that can disappear; everything else is the deck.
- HTML in, presentation out. No proprietary format: a deck is a readable, diffable HTML file that any agent or browser can open.
- Agent-first editing. Every mutation Dek can do (add, duplicate, move, delete slides; edit elements) is available as an MCP tool, and every agent change lands in the file immediately and is undoable with ⌘Z. The agent can *see* its work through slide snapshots.
- Hot reload is the edit loop. When the file changes on disk (agent, editor, git) Dek reloads in place and stays on the same slide; CSS-only changes swap live without a reload.
- Design systems, not per-deck styling. A deck's visual language (type, color, spacing, motion, chart and component preferences) is data kept outside the deck, versioned, and shared across decks; the agent designs it in conversation, the human switches between five of them from the navigator and rolls back any version.
- Motion is a first-class citizen: fragments, slide transitions, auto-animate between slides, enter animations, animated charts and CSS 3D are built into the runtime so decks look alive without a framework.
- Never interrupt a presentation: no dialogs, no badges, no reload flashes while presenting.

## Anti-references
- Electron bulk, web-app chrome, toolbars of icons.
- Permanent walls of editing controls. Manual text, shape, image, layout and notes controls appear in Edit mode and leave the stage clear while reading or presenting.
- SaaS dashboard aesthetics; gradients in the chrome; glassmorphism; purple.
- reveal.js' visible framework look (default themes, progress bars, controls in the corner).

## Local personal workspace
Dek is a local macOS app for one person. No hosting, accounts, collaboration service or cloud persistence. HTML files on disk remain authoritative. Agents connect over the existing loopback MCP bridge; the app does not need an AI API key. Manual edits and agent changes share persistence and undo. Export to PDF and PowerPoint happens on this Mac. PowerPoint offers editable text, shapes and images with reported fallbacks for complex HTML, plus a separate appearance-preserving export. Speaker notes travel with both modes.
