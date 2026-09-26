# PowerPoint → Google Slides fidelity

Dek's PowerPoint export targets Google Slides' Drive import (upload the `.pptx`, then Open with → Google Slides). This page records how Slides treats each PowerPoint feature the export relies on, so the writer (`web/src/pptx.js`) can pick what survives. Regenerate the probe with `node web/scripts/probe-pptx.mjs /tmp/probe.pptx`, upload it to Drive, open it in Slides, and fill in the table. Keynote is a useful local check for layout, but it lacks Google Fonts and ignores highlights, so only Slides decides this table.

| # | Feature (probe slide) | Export default | Slides result | Follow-up if it fails |
|---|---|---|---|---|
| 1 | Weights by typeface name (`Plus Jakarta Sans Medium`) | nearest shipped weight, named | ✅ each weight renders distinctly → the export names weights in the typeface | — |
| 2 | Line spacing in points vs multiple | multiple of the font's natural line height | ✅ both render alike, but relative to the font's natural line height (the real deck's 1.1 headings came out ~1.2 and overlapped) → the export divides by the natural line height from Google Fonts metadata | — |
| 3 | Letter spacing | points | ❌ ignored: all three lines render the same → boxes widen by the lost negative tracking | — |
| 4 | Shape shadow, rounded corners | native shadow and radius | ✅ shadows and radii render; large radii clamp to a pill | drop the shadow silently |
| 5 | Image crop (`srcRect`) for `object-fit: cover` | crop | ✅ the right image shows only the two middle bands, undistorted; crops survive | pre-crop in the renderer |
| 6 | Width slack on wrapped text | +4% (+12% single line) | ✅ same break in all three; ❌ `wrap:false` ignored (the line wrapped) → single-line boxes get +12% | pick the smallest slack with no extra wraps |
| 7 | Shape and text transparency | native | ✅ shape transparency; ❌ text transparency renders opaque | — |
| 8 | No autofit | never shrink | ✅ both keep 32pt and overflow | — |
| 9 | Highlight, soft breaks, bullets | native | ✅ highlight, soft break and bullets all render | draw highlights as shapes behind the text |

Checked 2026-09-26 in Google Slides, both with the `.pptx` opened from Drive in Office-compatibility mode and after File → Save as Google Slides; the two render the same.

A real 13-slide deck converted with Save as Google Slides also showed that balanced headings wrapped early (fixed lines now get up to +30% width) and that leaf visuals crossing the slide edge left blank canvas outside it (captures are now clipped to the slide).
