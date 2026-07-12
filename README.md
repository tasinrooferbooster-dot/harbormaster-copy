# Harbormaster — AI Local Watch

**Redesign of the Port Merrow "Night Watch" pilotage dashboard as an AI-powered
local monitoring platform.** The harbor pilot who guided every ship safely in
becomes an AI watch officer for everything happening around you: flights
overhead, severe weather, internet outages, power failures, traffic incidents
and emergency alerts — fused into one calm, live picture of your chosen area.

> Every ship that entered, entered with one of us aboard.
> Now every event that enters your zone, enters with the watch on it.

## What this is

A fully client-side, **simulated** preview of the product. No build step, no
dependencies, no network calls — open `index.html` (or serve the folder) and
the in-browser simulation engine generates a plausible live picture for the
selected watch zone.

```
python3 -m http.server 8080   # then open http://localhost:8080/
```

## What's on the dashboard

- **Watch zone selection** — five preset zones (including Port Merrow, where it
  all began) with a 2–25 mile radius.
- **Live scope map** (`js/map.js`) — canvas-rendered local map (water, street
  grid, highways, airport) with incidents plotted by category (one marker
  *shape* per category as the colorblind-safe second channel), live aircraft,
  a drifting storm cell, outage areas and range rings. Hover for detail, click
  to pin an incident in the feed.
- **AI watch briefing** — a natural-language situation summary generated from
  the live incident set, with a confidence score derived from source
  corroboration. Regenerates when the picture materially changes.
- **Predictive alerts** — cascade-aware forecasts (storm cell → power outage
  risk → internet degradation; incidents → commute congestion peak) with
  probability, time window and a plain-language basis.
- **Incident feed** — severity, distance/bearing, source provenance,
  UNCONFIRMED tags for uncorroborated reports, and CASCADE tags linking
  downstream incidents to their cause.
- **Activity chart** (`js/chart.js`) — stacked columns of new incidents per
  time bucket, with hover tooltips and a table-view twin.
- **Filters** — time window (Live / 3 h / 12 h / 24 h) and category chips
  scope every panel below them.
- **Notifications** — toast alerts for serious/critical incidents and
  all-clear notices, with a bell toggle.

## Files

| Path | Role |
|---|---|
| `index.html` | page structure + SVG icon sprite |
| `styles.css` | dark mission-control theme; validated categorical palette |
| `js/sim.js` | simulation engine: zones, incident templates, diurnal rates, storm + cascade logic, predictions, briefing NLG |
| `js/map.js` | canvas live-scope renderer + hit-testing |
| `js/chart.js` | SVG stacked-column activity chart + table twin |
| `js/app.js` | UI orchestration: filters, stats, feed, toasts |
| `docs/PRODUCT.md` | full product strategy: data sources, AI layer, user flows, monetization, scalability |

## Design notes

- The six category colors are the dark-surface steps of a validated
  categorical palette (worst adjacent CVD ΔE 27.6 in the fixed order used);
  category identity is never color-alone — icons in the feed, marker shapes on
  the map, labels in legends.
- Severity uses a reserved status palette (minor/moderate/serious/critical)
  distinct from the category colors, always paired with a text label.
- The briefing and predictions are template-NLG over real simulation state —
  the same contract a production LLM layer would fill.
