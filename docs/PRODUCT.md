# Harbormaster — Product Strategy

> *Est. 1911. For a century, no ship entered Port Merrow without a pilot aboard.*
> *Now nothing happens around you without a watch officer on it.*

Harbormaster began as a night-watch dashboard for harbor pilotage: a handful of
people, nine floors above the breakwater, watching everything that moved on the
water and guiding it in safely. This document redesigns that idea for land: an
**AI-powered local monitoring platform** that watches everything happening in a
user's chosen area — flights, severe weather, internet outages, power failures,
traffic incidents, and emergency alerts — and turns raw feeds into calm,
actionable awareness.

The product promise, inherited from the pilot's oath: **you don't watch the
feeds; the watch officer does, and speaks only when it matters.**

---

## 1. Core concept

A user (or business) defines one or more **watch zones** — a point plus a
radius, e.g. "5 miles around home", "2 miles around each store". Harbormaster:

1. **Ingests** dozens of public and commercial real-time feeds.
2. **Fuses** them into deduplicated, geo-indexed *incidents* with confidence
   scores (three sources reporting the same outage = one incident, high
   confidence).
3. **Summarizes** the zone in plain language — a live "watch briefing"
   regenerated as conditions change.
4. **Predicts** near-term risk, especially *cascades*: a severe thunderstorm
   cell tracking toward aging overhead feeders raises power-outage probability;
   a power outage raises internet-outage probability; an airport ground stop
   propagates delays to tonight's arrivals.
5. **Notifies** with ruthless relevance filtering — distance decay, severity
   floors, quiet hours, and personal context (your commute corridor, the
   flight you're tracking) — so a notification from Harbormaster is *never*
   noise.

The differentiator is not any single feed (each exists somewhere already) but
the **fusion + AI narration + prediction layer over a personal geography**.
Today a person checks six apps — FlightAware, a weather app, Downdetector,
their utility's outage map, Waze, and local news — and still has to do the
correlation in their head. Harbormaster is the correlation.

## 2. Event domains & data sources

| Domain | Primary sources | Notes |
|---|---|---|
| **Flights** | FAA SWIM (SFDPS/TFMS), OpenSky Network, ADS-B Exchange, FlightAware Firehose, airline status APIs, FAA airport delay/ground-stop (ASWS), NOTAMs | ADS-B gives positions; SWIM/TFMS gives delay programs. Local angle: aircraft overhead, noise complaints, diversions, nearby airport status. |
| **Severe weather** | NWS `api.weather.gov` CAP alerts, NEXRAD level-II radar, MRMS, GOES-East/West satellite, Open-Meteo, lightning networks (Blitzortung, Vaisala) | CAP alerts are authoritative & free; radar-derived storm-cell tracking (SCIT vectors) powers our cascade predictions. |
| **Internet outages** | ISP status pages (scraped), BGP monitoring (RIPE RIS, BGPStream), Cloudflare Radar, Ookla/M-Lab measurements, RIPE Atlas active probes, user reports in-app | User-reported signal (Downdetector model) is fastest; BGP/probe data confirms. Corroboration is the point of the fusion layer. |
| **Power failures** | Utility outage maps (scraped + partner APIs), PowerOutage.us aggregate, DOE EAGLE-I, EIA-930 grid data, ISO/RTO feeds (load, LMP spikes as strain signal), smart-home partner signals (e.g. devices going dark in a block) | Utility maps lag; a cluster of smart devices dropping offline in one feeder area beats the utility map by minutes. |
| **Traffic incidents** | State DOT 511 feeds, Waze for Cities (CCP), TomTom/HERE incident APIs, transit GTFS-RT, rail-crossing incident feeds | 511 feeds are free and structured; Waze CCP adds crowd speed/incident density. |
| **Emergency alerts** | FEMA IPAWS/CAP, USGS earthquake feed, wildfire (NIFC, NASA FIRMS hotspots), AirNow + PurpleAir (air quality), public-safety scanner audio (Broadcastify) transcribed by speech-to-text, Amber/Silver alerts, verified user reports | Scanner transcription + LLM extraction is the "hear it first" edge, always labeled *unconfirmed* until corroborated. |

**Source-tiering principle:** every incident carries its provenance. Tier A
(authoritative: NWS, USGS, FAA, utility), Tier B (measured: ADS-B, BGP, probes,
DOT), Tier C (crowd/scanner: user reports, transcribed audio). Confidence is a
function of tier mix and agreement; the UI always shows *why* we believe
something ("corroborated by 3 sources").

## 3. The AI layer

1. **Normalization** — every adapter emits a common `Event` schema: type,
   geometry (point/polygon), severity (minor→critical), confidence, sources,
   start/expiry, free-text detail. CAP alerts map nearly 1:1; scanner audio
   goes through STT → LLM extraction → schema.
2. **Fusion & dedup** — streaming clustering by (type, geo-cell, time window);
   incidents merge, confidence rises with corroboration, contradictions get
   flagged for the model to arbitrate.
3. **Briefings (LLM)** — a situation summary *per zone*, regenerated when the
   incident set changes materially, not on a timer. Tone: calm harbor-pilot
   professionalism, no clickbait. Key cost insight: **briefings are per-area,
   not per-user** — everyone watching overlapping cells shares the same cached
   generation, so LLM cost scales with active geography, not user count.
4. **Prediction** — gradient-boosted / statistical models per cascade type,
   trained on the historical archive: storm-cell vector × feeder-age ×
   canopy-density → outage probability; ground-stop → per-flight delay
   propagation; incident + time-of-day → congestion half-life. Every
   prediction ships with probability, time window, and its basis in plain
   language. LLMs narrate predictions; they don't make them.
5. **Relevance engine (anti-alert-fatigue)** — per-user scoring: severity ×
   distance decay × category weights × personal context (tracked flights,
   commute corridor, school zone) × quiet hours. The bar for waking a phone at
   2 a.m. is "you would want to be woken."
6. **Ask the Watch** — natural-language Q&A grounded in the live incident set
   and archive: "why is I-40 stopped?", "will my 6 p.m. flight board on time?",
   "how often does my block lose power in storms like this?"

## 4. User flows

**Onboarding (consumer)** — enter address (or use location) → radius slider
with live preview → toggle the six domains → notification calibration ("only
critical" / "balanced" / "everything") → first briefing generated on the spot.
Time-to-value target: under 90 seconds.

**Daily rhythm** — 7 a.m. briefing push ("Quiet night. One thing for today:
thunderstorms 4–7 p.m., 60% chance the 5:40 BOS arrival slips"). Glance at
dashboard; tap an incident for detail + map focus; share a public incident link.

**Event-driven** — predictive alert fires → user opens live tracking view (map
follows the storm cell / outage polygon) → cascade updates as they occur →
explicit **all-clear** notification closes the loop (the most loved and most
neglected notification in incident tooling).

**Business** — admin adds sites via CSV/API → per-site zones and escalation
policies (Slack/Teams/webhook/SMS, on-call rotations) → ops dashboard ranks
sites by live risk → weekly PDF/CSV exposure reports; API pulls incidents into
their own tooling.

## 5. Monetization

| Tier | Price | What you get |
|---|---|---|
| **Free** | $0 | 1 zone, 3 domains, live map + feed, daily briefing, delayed (5 min) feed |
| **Plus** | ~$6/mo | 3 zones, all 6 domains, real-time, predictive alerts, Ask the Watch, household sharing (4 seats) |
| **Pro** | ~$18/mo | 10 zones, commute & flight tracking, cascade predictions, 3-year history & analytics, calendar integration ("your 3 p.m. is in the storm path") |
| **Business** | from $99/site/mo | Multi-site fleet view, escalation policies, Slack/Teams/webhooks, SLA, audit exports, SSO |
| **Data & API** | usage-based | Incident firehose + prediction API for insurers (parametric triggers), logistics (routing), media (verified local incidents), real estate (risk profiles) |

Principles: consumers are never the product — **no sale of personal location
data, ever**; aggregate/derived data products only, and only from public-feed
fusion, not user telemetry. Free tier stays genuinely useful (it's the
acquisition engine and the crowd-report supply).

## 6. Scalability & architecture

```
source adapters (per-feed pollers/streams/scrapers)
        │  normalize → Event schema
        ▼
   Kafka (events.raw) ──► stream fusion (Flink): dedup, cluster, confidence
        │                                   │
        ▼                                   ▼
  events.incidents (geo-keyed by H3 cell)   archive (S3/Parquet → training)
        │
        ├─► hot store: Redis (live incidents per H3 cell, TTL)
        ├─► warm store: Postgres + PostGIS/Timescale (history, queries)
        ├─► prediction service (per-cascade models, cell-keyed outputs)
        ├─► briefing service (LLM, cached per cell-cluster, invalidated on change)
        └─► fan-out: pub/sub per H3 cell → WebSocket/SSE edge + APNs/FCM push
```

- **Geo-sharding via H3** — users subscribe to the hexagon cells covering
  their zones; incidents publish to their covering cells. Fan-out cost scales
  with *active cells*, not users × incidents.
- **LLM cost control** — briefings cached per cell-cluster and shared;
  regeneration only on material change; small models score relevance, a large
  model writes prose.
- **Priority lanes** — severity-tagged topics so a regional disaster
  (everyone's cells go loud at once) degrades gracefully: critical alerts
  never queue behind minor-traffic chatter; briefing regeneration sheds load
  first.
- **Trust & abuse** — user reports are rate-limited, reputation-weighted, and
  never surface uncorroborated above "unconfirmed"; scanner-derived content is
  filtered for personally identifying details before display.
- **Multi-region** — adapters run near their sources; fusion and fan-out are
  regional; the archive is global.

## 7. Consumer vs. business value

- **Consumers:** peace of mind and time — one calm briefing instead of six
  anxious apps; predictive heads-up ("charge your devices, outage risk 72%
  tonight"); household safety (kids' school zone, aging parents' zone).
- **Businesses:** downtime dollars — a retail chain seeing "power-outage risk
  at 3 stores tonight" staffs generators; a logistics firm reroutes before the
  interstate closes; an ISP's competitor-outage view is a sales tool; property
  managers document weather exposure for insurance with the archive.

## 8. What the demo in this repo shows

A fully client-side, simulated preview of the consumer dashboard: watch-zone
selection, live canvas map with all six domains, the AI watch briefing,
cascade-aware predictive alerts, a corroboration-labeled incident feed, a 24-h
activity chart, and relevance-filtered notifications. Every number on screen is
generated by the in-browser simulation engine (`js/sim.js`) — the point is to
make the product thesis tangible, not to ship the ingestion pipeline.
