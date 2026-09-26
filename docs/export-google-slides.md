# PowerPoint → Google Slides fidelity

Dek's PowerPoint export targets Google Slides' Drive import (upload the `.pptx`, then Open with → Google Slides). This page records how Slides treats each PowerPoint feature the export relies on, so the writer (`web/src/pptx.js`) can pick what survives. Regenerate the probe with `node web/scripts/probe-pptx.mjs /tmp/probe.pptx`, upload it to Drive, open it in Slides, and fill in the table. Keynote is a useful local check for layout, but it lacks Google Fonts and ignores highlights, so only Slides decides this table.

| # | Feature (probe slide) | Export default | Slides result | Follow-up if it fails |
|---|---|---|---|---|
| 1 | Weights by typeface name (`Plus Jakarta Sans Medium`) | not used; bold from weight ≥ 600 | _pending_ | if suffixed names render, map weights to them |
| 2 | Line spacing in points vs multiple | points (`spcPts`) | _pending_ | switch to multiples |
| 3 | Letter spacing | points | _pending_ | — |
| 4 | Shape shadow, rounded corners | native shadow and radius | _pending_ | drop the shadow silently |
| 5 | Image crop (`srcRect`) for `object-fit: cover` | crop | _pending_ | pre-crop in the renderer |
| 6 | Width slack on wrapped text | +4% | _pending_ | pick the smallest slack with no extra wraps |
| 7 | Shape and text transparency | native | _pending_ | — |
| 8 | No autofit | never shrink | _pending_ | — |
| 9 | Highlight, soft breaks, bullets | native | _pending_ | draw highlights as shapes behind the text |

Checked by: _name, date_
