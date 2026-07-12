/* Harbormaster simulation engine.
   Generates a plausible live picture for a watch zone: incidents across six
   domains, moving aircraft, a drifting storm cell, cascade effects
   (storm → power → internet) and model-style predictions. Everything is
   seeded per zone so a zone looks consistent between visits in a session. */

(function () {
  "use strict";

  const CATS = ["flights", "weather", "traffic", "power", "internet", "emergency"];

  const CAT_LABEL = {
    flights: "Flights", weather: "Weather", traffic: "Traffic",
    power: "Power", internet: "Internet", emergency: "Emergency",
  };

  const CAT_COLOR = {
    flights: "#3987e5", weather: "#c98500", traffic: "#199e70",
    power: "#d95926", internet: "#9085e9", emergency: "#e66767",
  };

  const SEV_LABEL = { 1: "MINOR", 2: "MODERATE", 3: "SERIOUS", 4: "CRITICAL" };

  const MIN = 60 * 1000;
  const HOUR = 60 * MIN;

  /* ---------- seeded rng ---------- */

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---------- zone catalogue ---------- */

  const ZONES = {
    bandar: {
      name: "Bandar, Narayanganj", seed: 880, airport: "DAC", airportBearing: 305,
      water: "west", gridAngle: 6, stormChance: 0.55, heat: true, quakes: false,
      anchor: { lat: 23.610, lon: 90.520 }, // Rupali Abasik Elaka
      rate: { flights: 0.7, weather: 1.4, traffic: 1.3, power: 1.4, internet: 1.1, emergency: 1.0 },
      districts: ["Rupali Abasik", "Nabiganj", "Madanganj", "Kadam Rasul", "Sonakanda", "Bandar Bazar"],
      highways: ["N1 Dhk–Ctg Hwy", "Bandar Rd", "Madanganj Rd"],
      roads: ["Nabiganj Rd", "Sonakanda Rd", "College Rd", "Ferry Ghat Rd", "Rupali Rd"],
      isps: ["Link3", "Carnival", "BTCL"],
      carriers: ["Grameenphone", "Robi", "Banglalink"],
      creeks: ["Shitalakshya bank", "Kanchpur khal"],
    },
    seattle: {
      name: "Seattle, WA", seed: 11, airport: "SEA", airportBearing: 195,
      water: "west", gridAngle: 4, stormChance: 0.3, heat: false, quakes: true,
      rate: { flights: 1.0, weather: 0.9, traffic: 1.1, power: 0.9, internet: 1.1, emergency: 1.0 },
      districts: ["Ballard", "Fremont", "Capitol Hill", "SoDo", "West Seattle", "Northgate"],
      highways: ["I-5", "I-90", "SR-99", "SR-520"],
      roads: ["Aurora Ave", "Denny Way", "Rainier Ave", "45th St", "Mercer St"],
      isps: ["Comcast", "CenturyLink", "Ziply Fiber"],
      creeks: ["Thornton Creek", "Longfellow Creek"],
    },
    austin: {
      name: "Austin, TX", seed: 27, airport: "AUS", airportBearing: 130,
      water: "river", gridAngle: -7, stormChance: 0.5, heat: true, quakes: false,
      rate: { flights: 0.8, weather: 1.2, traffic: 1.2, power: 1.2, internet: 1.0, emergency: 1.0 },
      districts: ["Downtown", "Mueller", "Zilker", "East Austin", "The Domain", "Riverside"],
      highways: ["I-35", "MoPac", "US-183", "TX-71"],
      roads: ["Lamar Blvd", "Congress Ave", "Burnet Rd", "Cesar Chavez St", "Airport Blvd"],
      isps: ["Spectrum", "AT&T Fiber", "Google Fiber"],
      creeks: ["Shoal Creek", "Waller Creek", "Onion Creek"],
    },
    chicago: {
      name: "Chicago, IL", seed: 43, airport: "ORD", airportBearing: 305,
      water: "east", gridAngle: 0, stormChance: 0.4, heat: false, quakes: false,
      rate: { flights: 1.6, weather: 1.0, traffic: 1.3, power: 1.0, internet: 1.0, emergency: 1.1 },
      districts: ["The Loop", "Wicker Park", "Hyde Park", "Logan Square", "Pilsen", "Uptown"],
      highways: ["I-90/94", "I-290", "I-55", "Lake Shore Dr"],
      roads: ["Ashland Ave", "Western Ave", "Fullerton Ave", "Cermak Rd", "Irving Park Rd"],
      isps: ["Xfinity", "RCN", "AT&T"],
      creeks: ["Chicago River", "North Branch"],
    },
    miami: {
      name: "Miami, FL", seed: 61, airport: "MIA", airportBearing: 280,
      water: "east", gridAngle: 2, stormChance: 0.65, heat: true, quakes: false,
      rate: { flights: 1.2, weather: 1.5, traffic: 1.2, power: 1.1, internet: 1.0, emergency: 1.1 },
      districts: ["Brickell", "Wynwood", "Little Havana", "Coral Gables", "Doral", "Miami Beach"],
      highways: ["I-95", "US-1", "Dolphin Expy", "Palmetto Expy"],
      roads: ["Biscayne Blvd", "Flagler St", "Coral Way", "NW 36th St", "Alton Rd"],
      isps: ["Xfinity", "AT&T", "Breezeline"],
      creeks: ["Miami River", "Little River"],
    },
    merrow: {
      name: "Port Merrow", seed: 1911, airport: "MRW", airportBearing: 40,
      water: "south", gridAngle: 9, stormChance: 0.45, heat: false, quakes: false,
      rate: { flights: 0.5, weather: 1.2, traffic: 0.8, power: 1.0, internet: 0.9, emergency: 1.2 },
      districts: ["Breakwater", "The Narrows", "Quayside", "Merrow Roads", "Hillcrest", "Old Port"],
      highways: ["Coast Hwy", "Harbor Rd", "Route 9"],
      roads: ["Pilot St", "Beacon Way", "Drydock Ave", "Signal Hill Rd", "Ferry Lane"],
      isps: ["MerrowNet", "Coastal Cable"],
      creeks: ["Merrow Cut", "Old Sluice"],
    },
  };

  /* ---------- incident templates ---------- */
  /* Each entry: sev range, ttl range (minutes), people range, source pool,
     and a text builder fed with zone + rng helpers. */

  function templates(z, pick, ri) {
    return {
      flights: [
        { w: 3, sev: [1, 2], ttl: [25, 80], people: [60, 240], src: ["FAA ASWS", "ADS-B"], t: () => [`Arrival delays ${ri(15, 45)} min — ${z.airport}`, `Averaging ${ri(15, 45)} minutes on inbound flow; departure flow normal.`] },
        { w: 1.2, sev: [3, 3], ttl: [40, 110], people: [400, 1400], src: ["FAA ASWS", "FlightAware"], t: () => [`Ground stop — ${z.airport}`, `Traffic management program in effect; inbound aircraft holding at origin.`] },
        { w: 2, sev: [1, 1], ttl: [15, 45], people: [0, 40], src: ["ADS-B"], t: () => [`Aircraft holding over ${pick(z.districts)}`, `Published hold at ${ri(6, 11) * 1000} ft; expect pattern noise below.`] },
        { w: 1, sev: [2, 3], ttl: [25, 60], people: [120, 300], src: ["ADS-B", "FlightAware"], t: () => [`Diversion inbound — ${z.airport}`, `Flight diverted from en-route weather; emergency services on standby.`] },
        { w: 1.4, sev: [1, 2], ttl: [60, 180], people: [0, 100], src: ["FAA ASWS"], t: () => [`Runway configuration change — ${z.airport}`, `Pattern shift puts approaches over ${pick(z.districts)} for the next hours.`] },
      ],
      weather: [
        { w: 2.5, sev: [2, 3], ttl: [45, 150], people: [800, 4000], src: ["NWS CAP", "NEXRAD"], t: () => [`Severe thunderstorm warning`, `60 mph gusts and heavy rain along the leading edge; storm tracking across the zone.`] },
        { w: 1.6, sev: [2, 2], ttl: [90, 240], people: [500, 2500], src: ["NWS CAP"], t: () => [`Flash flood watch — ${pick(z.creeks)} basin`, `Ground saturated from earlier rain; low crossings may flood quickly.`] },
        { w: 1.6, sev: [2, 2], ttl: [120, 300], people: [300, 1500], src: ["NWS CAP"], t: () => [`Wind advisory — gusts ${ri(40, 58)} mph`, `Secure loose objects; scattered limb damage likely near mature trees.`] },
        { w: 1.4, sev: [2, 2], ttl: [20, 50], people: [100, 700], src: ["NEXRAD", "Lightning net"], t: () => [`Lightning cluster — ${ri(40, 160)} strikes/5 min`, `Dense cell ${ri(2, 6)} mi out; outdoor activities should pause.`] },
        { w: 0.5, sev: [3, 3], ttl: [25, 60], people: [500, 2200], src: ["NWS CAP", "Spotter"], t: () => [`Hail reported — ${pick(["quarter", "half-dollar", "golf-ball"])} size`, `Spotter-confirmed hail with the cell over ${pick(z.districts)}.`] },
        ...(z.heat ? [{ w: 1.6, sev: [2, 2], ttl: [240, 420], people: [2000, 6000], src: ["NWS CAP"], t: () => [`Heat advisory — index ${ri(103, 112)}°F`, `Peak load hours ahead; check on neighbors without cooling.`] }] : []),
      ],
      traffic: [
        { w: 3, sev: [2, 2], ttl: [25, 75], people: [80, 350], src: ["DOT 511", "Waze"], t: () => [`Collision — ${pick(z.roads)} at ${pick(z.roads)}`, `Two vehicles, one lane blocked; delays building on the approach.`] },
        { w: 1.6, sev: [3, 3], ttl: [40, 120], people: [300, 900], src: ["DOT 511", "Camera AI"], t: () => [`Multi-vehicle collision — ${pick(z.highways)} ${pick(["NB", "SB", "EB", "WB"])}`, `Three lanes blocked; emergency crews on scene, queue growing ${ri(1, 3)} mi.`] },
        { w: 2.2, sev: [1, 1], ttl: [15, 45], people: [40, 150], src: ["Waze"], t: () => [`Stalled vehicle — ${pick(z.highways)}`, `Shoulder blocked near the ${pick(z.districts)} exit; brief slowdowns.`] },
        { w: 1.2, sev: [2, 2], ttl: [90, 240], people: [150, 600], src: ["DOT 511"], t: () => [`Road closure — ${pick(z.roads)}`, `Utility work closes the block through the evening; use parallel routes.`] },
        { w: 1, sev: [2, 2], ttl: [30, 90], people: [100, 400], src: ["City ops", "Waze"], t: () => [`Signal outage — ${pick(z.roads)} corridor`, `Intersections dark at ${ri(2, 5)} crossings; treat as all-way stop.`] },
        { w: 0.3, sev: [4, 4], ttl: [60, 180], people: [800, 2000], src: ["DOT 511", "Camera AI"], t: () => [`Overturned truck — ${pick(z.highways)}`, `Full directional closure; hazmat team evaluating. Seek alternates now.`] },
      ],
      power: [
        { w: 2.4, sev: [2, 3], ttl: [45, 240], people: [400, 3200], src: ["Utility map", "PowerOutage.us"], t: () => { const n = ri(4, 32) * 100; return [`Outage — ${n.toLocaleString()} customers, ${pick(z.districts)}`, `Crews dispatched; cause under investigation. Estimated restore in ${ri(1, 4)} h.`]; } },
        { w: 1.4, sev: [2, 2], ttl: [30, 120], people: [200, 900], src: ["Smart-meter signal"], t: () => [`Feeder fault — ${pick(z.districts)}`, `Cluster of meters dropped in one block pattern; ahead of the utility map.`] },
        { w: 0.8, sev: [3, 3], ttl: [90, 300], people: [1000, 4000], src: ["Utility map"], t: () => [`Transformer failure — ${pick(z.districts)}`, `Equipment replacement required; extended restoration window expected.`] },
        ...(z.heat ? [{ w: 1.4, sev: [2, 2], ttl: [120, 300], people: [3000, 9000], src: ["ISO grid data"], t: () => [`Grid strain — conservation appeal`, `Reserve margin thinning into the evening peak; voluntary reduction requested.`] }] : []),
        { w: 0.6, sev: [1, 1], ttl: [90, 240], people: [100, 500], src: ["Utility map"], t: () => [`Planned maintenance outage — ${pick(z.districts)}`, `Scheduled work window; affected addresses were notified.`] },
      ],
      internet: [
        { w: 2.4, sev: [2, 3], ttl: [30, 150], people: [500, 2600], src: ["User reports", "ISP status"], t: () => [`${pick(z.isps)} outage reports spiking — ${ri(40, 260)}/15 min`, `Report velocity ${ri(4, 9)}× baseline for the area; ISP has not yet acknowledged.`] },
        { w: 1, sev: [3, 3], ttl: [90, 300], people: [1200, 4000], src: ["RIPE probes", "ISP status"], t: () => [`Fiber cut suspected — ${pick(z.districts)}`, `Active probes losing paths through one aggregation point; splice crew likely needed.`] },
        { w: 1, sev: [2, 2], ttl: [20, 80], people: [300, 1200], src: ["BGP monitors"], t: () => [`BGP route withdrawal — ${pick(z.isps)}`, `Prefixes covering part of the zone withdrawn and re-announced; watching for flap.`] },
        { w: 1.6, sev: [1, 2], ttl: [30, 120], people: [150, 700], src: ["User reports"], t: () => [`Cell service degraded — ${pick(z.carriers || ["AT&T", "Verizon", "T-Mobile"])} LTE`, `Slow data and failed calls clustering near ${pick(z.districts)}.`] },
        { w: 0.8, sev: [1, 1], ttl: [20, 60], people: [100, 400], src: ["RIPE probes"], t: () => [`DNS latency elevated — regional`, `Resolution times ${ri(2, 5)}× normal on one resolver cluster; most users unaffected.`] },
      ],
      emergency: [
        { w: 2, sev: [3, 3], ttl: [30, 110], people: [30, 200], src: ["Scanner (AI)", "City CAD"], t: () => [`Structure fire — ${ri(2, 5)} units responding`, `Working fire reported off ${pick(z.roads)}; avoid the block, expect closures.`] },
        { w: 1.4, sev: [2, 2], ttl: [25, 90], people: [20, 120], src: ["Scanner (AI)"], t: () => [`EMS surge — ${pick(z.districts)}`, `Multiple concurrent medical calls; response times may stretch nearby.`] },
        { w: 0.9, sev: [3, 3], ttl: [40, 120], people: [100, 600], src: ["City CAD", "Scanner (AI)"], t: () => [`Gas leak — ${pick(z.roads)}`, `Utility and fire on scene; small evacuation radius while the line is secured.`] },
        { w: 0.9, sev: [2, 2], ttl: [120, 360], people: [0, 50], src: ["IPAWS"], t: () => [`Missing person alert`, `Regional alert active; description pushed to phones in the area.`] },
        { w: 1.2, sev: [2, 2], ttl: [180, 420], people: [2000, 8000], src: ["AirNow"], t: () => [`Air quality alert — AQI ${ri(110, 170)}`, `Sensitive groups should limit prolonged outdoor exertion today.`] },
        ...(z.quakes ? [{ w: 0.25, sev: [3, 3], ttl: [30, 90], people: [1000, 6000], src: ["USGS"], t: () => [`Earthquake M${(ri(28, 45) / 10).toFixed(1)} — ${ri(4, 30)} mi ${pick(["N", "NE", "E", "SE", "S", "SW", "W", "NW"])}`, `Light shaking possible; no tsunami threat. Aftershock watch for 24 h.`] }] : []),
        ...(z.airport === "MRW" ? [{ w: 1, sev: [2, 3], ttl: [60, 180], people: [10, 80], src: ["Harbor watch", "Scanner (AI)"], t: () => [`Vessel aground — ${pick(["Merrow Roads", "The Narrows"])}`, `Pilot dispatched from the old watch office. Some habits survive a century.`] }] : []),
      ],
    };
  }

  /* Diurnal rate multiplier: how likely each category is at a given hour. */
  function diurnal(cat, hour) {
    switch (cat) {
      case "traffic":
        if ((hour >= 7 && hour <= 9) || (hour >= 16 && hour <= 18)) return 2.3;
        if (hour >= 22 || hour <= 5) return 0.35;
        return 1;
      case "flights":
        if (hour >= 6 && hour <= 22) return 1.3;
        return 0.25;
      case "emergency":
        if (hour >= 17 && hour <= 23) return 1.5;
        return 1;
      case "power":
        if (hour >= 15 && hour <= 20) return 1.4;
        return 1;
      default:
        return 1;
    }
  }

  /* Base spawn rates, events per hour, before zone/diurnal/storm multipliers. */
  const BASE_RATE = { flights: 0.7, weather: 0.28, traffic: 1.15, power: 0.35, internet: 0.4, emergency: 0.55 };

  const SOURCE_TIER_A = new Set(["NWS CAP", "NEXRAD", "FAA ASWS", "IPAWS", "USGS", "Utility map", "DOT 511", "City CAD", "ISO grid data", "AirNow", "City ops", "ISP status", "Harbor watch"]);

  /* ---------- engine state ---------- */

  const S = {
    zoneKey: null, zone: null, radius: 5, rng: Math.random,
    events: [], aircraft: [], storm: null,
    feedsTotal: 15, feedsOnline: 15, feedBlipUntil: 0,
    nextId: 1, tmpl: null, lastTickAt: 0,
    userOff: { x: 0, y: 0 }, // observer offset from zone anchor, miles E/N
  };

  function pick(arr) { return arr[Math.floor(S.rng() * arr.length)]; }
  function ri(a, b) { return a + Math.floor(S.rng() * (b - a + 1)); }
  function rf(a, b) { return a + S.rng() * (b - a); }

  /* Random point in the zone disc, in miles east/north of center. */
  function randPoint(maxR) {
    const r = Math.sqrt(S.rng()) * maxR;
    const a = S.rng() * Math.PI * 2;
    return { x: r * Math.cos(a), y: r * Math.sin(a) };
  }

  const AIRLINES = ["ASA", "SWA", "UAL", "AAL", "DAL", "SKW", "JBU", "FDX"];

  function makeAircraft() {
    const edge = S.rng() * Math.PI * 2;
    const R = S.radius * 1.35;
    const kind = pick(["arrival", "departure", "overflight", "overflight"]);
    const x = R * Math.cos(edge), y = R * Math.sin(edge);
    const toward = Math.atan2(-y + rf(-S.radius, S.radius) * 0.4, -x + rf(-S.radius, S.radius) * 0.4);
    return {
      id: "ac" + S.nextId++,
      callsign: pick(AIRLINES) + ri(180, 2450),
      x, y, heading: toward,
      speed: kind === "overflight" ? rf(380, 470) : rf(150, 260), // mph
      alt: kind === "overflight" ? ri(28, 38) * 1000 : ri(3, 11) * 1000,
      kind,
    };
  }

  function maybeStorm(force) {
    if (!force && S.rng() > S.zone.stormChance) { S.storm = null; return; }
    const a = S.rng() * Math.PI * 2;
    const d = S.radius * rf(0.8, 1.25);
    const driftA = a + Math.PI + rf(-0.5, 0.5); // roughly toward the zone
    S.storm = {
      x: d * Math.cos(a), y: d * Math.sin(a),
      vx: Math.cos(driftA) * rf(14, 26), vy: Math.sin(driftA) * rf(14, 26), // mph
      r: rf(1.4, 2.6) * Math.max(1, S.radius / 5),
      intensity: rf(0.55, 1),
    };
  }

  function spawnEvent(cat, t, opts = {}) {
    const list = S.tmpl[cat];
    const totalW = list.reduce((s, e) => s + e.w, 0);
    let roll = S.rng() * totalW, entry = list[0];
    for (const e of list) { roll -= e.w; if (roll <= 0) { entry = e; break; } }

    const sev = opts.sev || ri(entry.sev[0], entry.sev[1]);
    const [title, detail] = entry.t();
    const ttl = ri(entry.ttl[0], entry.ttl[1]) * MIN;
    const nSrc = Math.min(entry.src.length, sev >= 3 ? ri(2, 3) : ri(1, 2));
    const sources = [...entry.src].sort(() => S.rng() - 0.5).slice(0, Math.max(1, nSrc));
    const tierA = sources.some((s) => SOURCE_TIER_A.has(s));

    let pos = opts.pos || randPoint(S.radius * 0.92);
    const ev = {
      id: "EV-" + (1000 + S.nextId++),
      cat, sev, title, detail,
      x: pos.x, y: pos.y,
      t, ttl,
      sources, confirmed: tierA || sources.length > 1,
      people: ri(entry.people[0], entry.people[1]),
      cascade: opts.cascade || null,
    };
    S.events.push(ev);
    return ev;
  }

  /* Chance-per-tick spawner. dtMs of simulated time elapsed. */
  function rollSpawns(now, dtMs) {
    const spawned = [];
    const hour = new Date(now).getHours();
    const stormNear = S.storm && Math.hypot(S.storm.x, S.storm.y) < S.radius + S.storm.r;

    for (const cat of CATS) {
      let rate = BASE_RATE[cat] * S.zone.rate[cat] * diurnal(cat, hour);
      if (stormNear) {
        if (cat === "weather") rate *= 4;
        if (cat === "power") rate *= 3;
        if (cat === "internet") rate *= 1.8;
        if (cat === "traffic") rate *= 1.6;
      }
      const p = rate * (dtMs / HOUR);
      if (S.rng() < p) {
        const ev = spawnEvent(cat, now, {
          cascade: stormNear && (cat === "power" || cat === "internet") ? "storm cell" : null,
        });
        spawned.push(ev);
        // Cascade: a serious power hit often degrades internet minutes later.
        if (cat === "power" && ev.sev >= 3 && S.rng() < 0.6) {
          const lag = ri(2, 7) * MIN;
          const child = spawnEvent("internet", now + lag, {
            pos: { x: ev.x + rf(-0.8, 0.8), y: ev.y + rf(-0.8, 0.8) },
            cascade: ev.id,
          });
          child.pendingUntil = now + lag; // surfaces when its time arrives
          spawned.push(child);
        }
      }
    }
    return spawned;
  }

  /* ---------- public engine ---------- */

  function init(zoneKey, radius) {
    S.zoneKey = zoneKey;
    S.zone = ZONES[zoneKey];
    S.radius = radius;
    S.rng = mulberry32(S.zone.seed * 7919 + radius * 131);
    S.tmpl = templates(S.zone, pick, ri);
    S.events = [];
    S.nextId = 1;
    S.feedsOnline = S.feedsTotal;
    S.feedBlipUntil = 0;

    const now = Date.now();

    // Backfill the past 24 h in 5-minute steps so history/chart has texture.
    const STEP = 5 * MIN;
    for (let t = now - 24 * HOUR; t < now; t += STEP) rollSpawns(t, STEP);
    // Strip cascade children that would only "arrive" pre-now anyway, and
    // mark already-ended history as resolved so the first live tick doesn't
    // fire a flood of stale "all clear" notifications.
    S.events.forEach((e) => {
      if (e.pendingUntil && e.pendingUntil < now) delete e.pendingUntil;
      if (!e.pendingUntil && e.t + e.ttl < now) e.resolved = true;
    });
    predCache.at = 0;

    S.aircraft = [];
    const nAc = Math.round(3 + S.zone.rate.flights * 2.5);
    for (let i = 0; i < nAc; i++) {
      const ac = makeAircraft();
      // Scatter initial positions through the zone rather than all at edges.
      const p = randPoint(S.radius * 1.1);
      ac.x = p.x; ac.y = p.y;
      S.aircraft.push(ac);
    }
    maybeStorm(false);
    S.lastTickAt = now;
    S.userOff = { x: 0, y: 0 };
  }

  function tick(dtMs) {
    const now = Date.now();
    const out = { spawned: [], expired: [] };
    const dtH = dtMs / HOUR;

    // Aircraft motion.
    for (const ac of S.aircraft) {
      ac.x += Math.cos(ac.heading) * ac.speed * dtH;
      ac.y += Math.sin(ac.heading) * ac.speed * dtH;
      ac.heading += rf(-0.018, 0.018);
      if (Math.hypot(ac.x, ac.y) > S.radius * 1.45) {
        const fresh = makeAircraft();
        Object.assign(ac, fresh, { id: ac.id });
      }
    }

    // Storm drift + lifecycle.
    if (S.storm) {
      S.storm.x += S.storm.vx * dtH;
      S.storm.y += S.storm.vy * dtH;
      S.storm.intensity -= dtH * 0.25;
      if (S.storm.intensity <= 0.1 || Math.hypot(S.storm.x, S.storm.y) > S.radius * 2.2) S.storm = null;
    } else if (S.rng() < S.zone.stormChance * dtH * 0.5) {
      maybeStorm(true);
    }

    // Feed blips: rarely a source adapter drops for a few minutes.
    if (S.feedBlipUntil && now > S.feedBlipUntil) { S.feedsOnline = S.feedsTotal; S.feedBlipUntil = 0; }
    else if (!S.feedBlipUntil && S.rng() < dtH * 0.6) { S.feedsOnline = S.feedsTotal - 1; S.feedBlipUntil = now + ri(2, 8) * MIN; }

    // New incidents.
    for (const ev of rollSpawns(now, dtMs)) {
      if (!ev.pendingUntil) out.spawned.push(ev);
    }
    // Cascade children whose arrival time has come.
    for (const ev of S.events) {
      if (ev.pendingUntil && ev.pendingUntil <= now) { delete ev.pendingUntil; out.spawned.push(ev); }
    }

    // Expiry: mark, report once, and drop events older than 26 h entirely.
    for (const ev of S.events) {
      if (!ev.resolved && !ev.pendingUntil && ev.t + ev.ttl < now) { ev.resolved = true; out.expired.push(ev); }
    }
    S.events = S.events.filter((e) => e.t > now - 26 * HOUR);

    S.lastTickAt = now;
    return out;
  }

  function activeEvents(now) {
    now = now || Date.now();
    return S.events.filter((e) => !e.pendingUntil && e.t <= now && e.t + e.ttl > now);
  }

  function windowEvents(now, windowMs) {
    now = now || Date.now();
    return S.events.filter((e) => !e.pendingUntil && e.t > now - windowMs && e.t <= now);
  }

  function riskIndex(now) {
    const W = { 1: 2, 2: 5, 3: 12, 4: 22 };
    let r = 0;
    for (const e of activeEvents(now)) r += W[e.sev];
    if (S.storm && Math.hypot(S.storm.x, S.storm.y) < S.radius + S.storm.r) r += 14 * S.storm.intensity;
    return Math.min(100, Math.round(r));
  }

  function peopleAffected(now) {
    return activeEvents(now).reduce((s, e) => s + e.people, 0);
  }

  /* ---------- predictions ---------- */

  function bearingName(x, y) {
    const dirs = ["E", "NE", "N", "NW", "W", "SW", "S", "SE"];
    const a = Math.atan2(y, x);
    return dirs[Math.round(((a + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8];
  }

  function fmtHour(d) {
    let h = d.getHours(); const ap = h >= 12 ? "p.m." : "a.m.";
    h = h % 12 || 12;
    return h + (d.getMinutes() >= 30 ? ":30" : ":00") + " " + ap;
  }

  /* Predictions carry randomized model components, so cache them briefly —
     probabilities must not re-roll on every render, and the briefing must
     agree with the cards. */
  const predCache = { at: 0, preds: [] };

  function predictions(now) {
    now = now || Date.now();
    if (now - predCache.at < 45000) return predCache.preds;
    const act = activeEvents(now);
    const preds = [];
    const hour = new Date(now).getHours();

    if (S.storm) {
      const d = Math.hypot(S.storm.x, S.storm.y);
      const speed = Math.hypot(S.storm.vx, S.storm.vy);
      const etaMin = Math.max(5, Math.round((d / Math.max(speed, 5)) * 60));
      const inZone = d < S.radius + S.storm.r;
      const prob = Math.round(Math.min(0.92, 0.35 + S.storm.intensity * 0.45 + (inZone ? 0.15 : 0)) * 100);
      preds.push({
        cat: "power", prob,
        title: "Power outages — overhead feeder areas",
        window: inZone ? "next 1–2 h" : `storm arrival ~${etaMin} min`,
        basis: `Storm cell ${d.toFixed(1)} mi ${bearingName(S.storm.x, S.storm.y)}, moving ${Math.round(speed)} mph; gust front vs. tree canopy density.`,
      });
      preds.push({
        cat: "flights", prob: Math.round(Math.min(0.9, 0.3 + S.storm.intensity * 0.5) * 100),
        title: `Arrival delays — ${S.zone.airport}`,
        window: "next 2–4 h",
        basis: "Convective cell intersects the approach corridor; delay programs typically follow.",
      });
    }

    const powerCrit = act.filter((e) => e.cat === "power" && e.sev >= 3);
    if (powerCrit.length) {
      preds.push({
        cat: "internet", prob: ri(58, 82),
        title: "Internet degradation — cascade from grid",
        window: "next 30–90 min",
        basis: `${powerCrit.length} serious power incident${powerCrit.length > 1 ? "s" : ""} active; node batteries deplete in ~45 min.`,
      });
    }

    const trafficNow = act.filter((e) => e.cat === "traffic").length;
    if (hour >= 14 && hour <= 17) {
      preds.push({
        cat: "traffic", prob: Math.min(88, 45 + trafficNow * 9),
        title: "Congestion peak — evening commute",
        window: `${fmtHour(new Date(now + (17 - hour) * HOUR))}–6:30 p.m.`,
        basis: `${trafficNow} active incident${trafficNow === 1 ? "" : "s"} feeding the corridor; recovery half-life ~40 min per blocked lane.`,
      });
    }

    if (S.zone.heat && hour >= 12 && hour <= 19) {
      preds.push({
        cat: "power", prob: ri(55, 78),
        title: "Grid strain — evening heat peak",
        window: "5:00–8:00 p.m.",
        basis: "Heat index above advisory level; ISO reserve margin trending thin for the peak.",
      });
    }

    if (!preds.length) {
      const q = act.length;
      preds.push({
        cat: "traffic", prob: Math.min(45, 18 + q * 4),
        title: "Background risk — no active drivers",
        window: "next 6 h",
        basis: "No storm cell, grid stress or cascade precursors in the zone; baseline incident rates only.",
      });
    }

    preds.sort((a, b) => b.prob - a.prob);
    predCache.at = now;
    predCache.preds = preds.slice(0, 4);
    return predCache.preds;
  }

  /* ---------- AI briefing (template NLG over live state) ---------- */

  /* Distance from the observer (live GPS position when tracking, else the
     zone anchor) — so "2.1 mi NE of you" stays true as the user moves. */
  function miles(e) { return Math.hypot(e.x - S.userOff.x, e.y - S.userOff.y); }

  function briefing(now) {
    now = now || Date.now();
    const act = activeEvents(now).sort((a, b) => b.sev - a.sev || a.t - b.t);
    const zone = S.zone;
    const paras = [];
    const crit = act.filter((e) => e.sev >= 3);
    const preds = predictions(now);

    // Opening: overall posture.
    if (!act.length) {
      paras.push(`**All quiet** across your ${S.radius}-mile zone around ${zone.name}. No active incidents on any watched domain; feeds are reporting normally.`);
    } else if (!crit.length) {
      paras.push(`**Routine picture** in your ${S.radius}-mile zone: ${act.length} minor-to-moderate incident${act.length > 1 ? "s" : ""} active, none requiring action from you.`);
    } else {
      const lead = crit[0];
      paras.push(`**${crit.length} incident${crit.length > 1 ? "s" : ""} worth your attention** in the ${S.radius}-mile zone. Leading: ${lead.title}, ${miles(lead).toFixed(1)} mi ${bearingName(lead.x - S.userOff.x, lead.y - S.userOff.y)} of you (${lead.sources.join(" + ")}).`);
      if (crit[1]) paras.push(`Also tracking: ${crit[1].title} — ${miles(crit[1]).toFixed(1)} mi ${bearingName(crit[1].x - S.userOff.x, crit[1].y - S.userOff.y)}${crit[2] ? `, and ${crit[2].title}` : ""}.`);
    }

    // Storm narrative.
    if (S.storm) {
      const d = Math.hypot(S.storm.x, S.storm.y);
      const speed = Math.hypot(S.storm.vx, S.storm.vy);
      if (d < S.radius) {
        paras.push(`A storm cell is **over the zone now**, moving ${Math.round(speed)} mph ${bearingName(S.storm.vx, S.storm.vy)}. Expect the power and internet picture to change fast for the next hour.`);
      } else {
        paras.push(`A storm cell sits ${d.toFixed(1)} mi ${bearingName(S.storm.x, S.storm.y)}, tracking toward the zone at ${Math.round(speed)} mph — the main driver behind tonight's outage risk.`);
      }
    }

    // Cascade note.
    const cascades = act.filter((e) => e.cascade);
    if (cascades.length) {
      paras.push(`Cascade watch: ${cascades.length} active incident${cascades.length > 1 ? "s are" : " is"} downstream of another event — the fusion layer links them so you see one story, not ${cascades.length + 1} alerts.`);
    }

    // Forward look from the top prediction.
    const top = preds[0];
    if (top && top.prob >= 50) {
      paras.push(`Next likely development: **${top.title}** (${top.prob}%, ${top.window}). Basis: ${top.basis}`);
    } else if (act.length) {
      paras.push(`Nothing significant expected in the next six hours beyond what's already in the feed.`);
    }

    // Confidence from source-tier mix.
    const confirmed = act.filter((e) => e.confirmed).length;
    const conf = act.length ? Math.round(60 + 38 * (confirmed / act.length)) : 97;

    return { paras, confidence: Math.min(98, conf), generatedAt: now };
  }

  /* ---------- export ---------- */

  window.SIM = {
    CATS, CAT_LABEL, CAT_COLOR, SEV_LABEL, ZONES,
    init, tick, activeEvents, windowEvents,
    riskIndex, peopleAffected, predictions, briefing,
    registerZone(key, cfg) { ZONES[key] = cfg; },
    setUserOffset(x, y) { S.userOff.x = x; S.userOff.y = y; },
    state: S,
  };
})();
