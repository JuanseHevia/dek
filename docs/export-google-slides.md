# PowerPoint → Google Slides fidelity

Dek's PowerPoint export targets Google Slides' Drive import (upload the `.pptx`, then Open with → Google Slides). This page records how Slides treats each PowerPoint feature the export relies on, so the writer (`web/src/pptx.js`) can pick what survives. Regenerate the probe with `node web/scripts/probe-pptx.mjs /tmp/probe.pptx`, upload it to Drive, open it in Slides, and fill in the table. Keynote is a useful local check for layout, but it lacks Google Fonts and ignores highlights, so only Slides decides this table.

| # | Feature (probe slide) | Export default | Slides result | Follow-up if it fails |
|---|---|---|---|---|
| 1 | Weights by typeface name (`Plus Jakarta Sans Medium`) | nearest shipped weight, named | ✅ each weight renders distinctly → the export names weights in the typeface | — |
| 2 | Line spacing in points vs multiple | points (`spcPts`) | ✅ identical; points kept | switch to multiples |
| 3 | Letter spacing | points | ❌ ignored: all three lines render the same → boxes widen by the lost negative tracking | — |
| 4 | Shape shadow, rounded corners | native shadow and radius | ✅ shadows and radii render; large radii clamp to a pill | drop the shadow silently |
| 5 | Image crop (`srcRect`) for `object-fit: cover` | crop | ⚠️ inconclusive (symmetric probe image); probe fixed to four color bands, re-check | pre-crop in the renderer |
| 6 | Width slack on wrapped text | +4% (+12% single line) | ✅ same break in all three; ❌ `wrap:false` ignored (the line wrapped) → single-line boxes get +12% | pick the smallest slack with no extra wraps |
| 7 | Shape and text transparency | native | ✅ shape transparency; ❌ text transparency renders opaque | — |
| 8 | No autofit | never shrink | ✅ both keep 32pt and overflow | — |
| 9 | Highlight, soft breaks, bullets | native | ✅ highlight, soft break and bullets all render | draw highlights as shapes behind the text |

Checked 2026-09-26 in Google Slides, both with the `.pptx` opened from Drive in Office-compatibility mode and after File → Save as Google Slides; the two render the same.
