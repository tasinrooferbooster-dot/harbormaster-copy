/* Harbormaster app — wires the sim engine to the UI: filters, stat tiles,
   live map, activity chart, AI briefing, predictions, feed and toasts. */

(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  const WINDOWS = {
    live: { ms: 60 * 60000, bucketMin: 5, label: "last 60 min", bucketLabel: "5 min" },
    "3h": { ms: 3 * 3600000, bucketMin: 15, label: "last 3 h", bucketLabel: "15 min" },
    "12h": { ms: 12 * 3600000, bucketMin: 60, label: "last 12 h", bucketLabel: "hour" },
    "24h": { ms: 24 * 3600000, bucketMin: 60, label: "last 24 h", bucketLabel: "hour" },
  };

  const UI = {
    zone: "bandar", radius: 5,
    windowKey: "live",
    cats: null,            // null = all, else Set of category keys
    bell: true,
    selected: null,
    lastBriefingAt: 0,
    lastChartSig: "",
    booted: false,
    geo: null,             // { anchorLat, anchorLon, lat, lon, off:{x,y}, accMi }
    geoWatchId: null,
  };

  /* Observer position within the zone: live GPS offset when tracking,
     otherwise the zone anchor. All distances/bearings key off this. */
  function userOff() {
    return (UI.zone === "geo" && UI.geo && UI.geo.off) ? UI.geo.off : { x: 0, y: 0 };
  }
  function distMi(ev) {
    const o = userOff();
    return Math.hypot(ev.x - o.x, ev.y - o.y);
  }
  function bearingOf(ev) {
    const o = userOff();
    return bearingName(ev.x - o.x, ev.y - o.y);
  }

  /* ---------- helpers ---------- */

  function fmtClock(d) {
    return [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map((v) => String(v).padStart(2, "0")).join(":");
  }
  function fmtHM(d) {
    return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  }
  function timeAgo(t, now) {
    const s = Math.max(0, Math.round((now - t) / 1000));
    if (s < 60) return "just now";
    const m = Math.round(s / 60);
    if (m < 60) return m + " min ago";
    const h = Math.floor(m / 60);
    return h + " h " + (m % 60 ? (m % 60) + " min " : "") + "ago";
  }
  function compact(n) {
    if (n >= 10000) return Math.round(n / 1000) + "K";
    if (n >= 1000) return (n / 1000).toFixed(1) + "K";
    return String(n);
  }
  function bearingName(x, y) {
    const dirs = ["E", "NE", "N", "NW", "W", "SW", "S", "SE"];
    const a = Math.atan2(y, x);
    return dirs[Math.round(((a + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8];
  }
  function passes(ev) {
    return !UI.cats || UI.cats.has(ev.cat);
  }
  function visibleCats() {
    return SIM.CATS.filter((c) => !UI.cats || UI.cats.has(c));
  }
  /* Minimal **bold** renderer, everything else as text. */
  function mdPara(text) {
    const p = document.createElement("p");
    text.split("**").forEach((part, i) => {
      if (i % 2) {
        const b = document.createElement("strong");
        b.textContent = part;
        p.appendChild(b);
      } else {
        p.appendChild(document.createTextNode(part));
      }
    });
    return p;
  }
  function icon(name, cls) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    if (cls) svg.setAttribute("class", cls);
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", "#i-" + name);
    svg.appendChild(use);
    return svg;
  }

  /* ---------- stats ---------- */

  function renderStats(now) {
    const act = SIM.activeEvents(now).filter(passes);

    $("stat-active").textContent = act.length;
    const hourAgo = now - 3600000;
    const actThen = SIM.state.events.filter(
      (e) => !e.pendingUntil && e.t <= hourAgo && e.t + e.ttl > hourAgo && passes(e)
    ).length;
    const d = act.length - actThen;
    const de = $("stat-active-delta");
    de.className = "tile-delta " + (d > 0 ? "up-bad" : d < 0 ? "down-good" : "muted");
    de.textContent = (d > 0 ? "+" + d : d) + " vs 1 h ago";

    $("stat-people").textContent = compact(act.reduce((s, e) => s + e.people, 0));

    // Risk index over the filtered picture (storm counts via weather).
    const W = { 1: 2, 2: 5, 3: 12, 4: 22 };
    let risk = act.reduce((s, e) => s + W[e.sev], 0);
    const st = SIM.state.storm;
    if (st && (!UI.cats || UI.cats.has("weather")) &&
        Math.hypot(st.x, st.y) < UI.radius + st.r) risk += 14 * st.intensity;
    risk = Math.min(100, Math.round(risk));
    $("stat-risk").textContent = risk;
    const meter = $("risk-meter");
    meter.style.width = risk + "%";
    const col = risk >= 65 ? "var(--s-critical)" : risk >= 35 ? "var(--s-warning)" : "var(--accent)";
    meter.parentElement.style.setProperty("--meterc", col);
    $("stat-risk-note").textContent =
      risk >= 65 ? "severe — act on alerts" : risk >= 35 ? "elevated — watch closely" : "calm";

    const fo = SIM.state.feedsOnline, ft = SIM.state.feedsTotal;
    $("stat-feeds").textContent = fo + "/" + ft;
    $("stat-feeds-note").textContent = fo === ft ? "all sources reporting" : "one adapter reconnecting";
  }

  /* ---------- feed ---------- */

  function renderFeed(now) {
    const win = WINDOWS[UI.windowKey];
    const evs = SIM.windowEvents(now, win.ms)
      .filter(passes)
      .sort((a, b) => b.t - a.t)
      .slice(0, 50);

    $("feed-sub").textContent =
      `${SIM.activeEvents(now).filter(passes).length} active · showing ${win.label}`;

    const list = $("feed-list");
    const scroll = list.scrollTop;
    list.textContent = "";

    if (!evs.length) {
      const d = document.createElement("div");
      d.className = "feed-empty";
      d.textContent = "Nothing in this window — quiet zone, quiet feed.";
      list.appendChild(d);
      return;
    }

    for (const ev of evs) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "evt" + (UI.selected === ev.id ? " selected" : "") +
        (now - ev.t < 5000 ? " fresh" : "");
      card.dataset.cat = ev.cat;
      card.dataset.id = ev.id;

      const ic = document.createElement("span");
      ic.className = "evt-ic";
      ic.appendChild(icon(ev.cat));
      card.appendChild(ic);

      const main = document.createElement("span");
      main.className = "evt-main";
      const title = document.createElement("span");
      title.className = "evt-title";
      title.textContent = ev.title;
      const detail = document.createElement("span");
      detail.className = "evt-detail";
      detail.textContent = ev.detail;
      const meta = document.createElement("span");
      meta.className = "evt-meta";

      const sev = document.createElement("span");
      sev.className = "sev sev-" + ev.sev;
      sev.textContent = SIM.SEV_LABEL[ev.sev];
      meta.appendChild(sev);

      const resolved = ev.t + ev.ttl <= now;
      meta.appendChild(document.createTextNode(
        `${resolved ? "resolved · " : ""}${timeAgo(ev.t, now)} · ` +
        `${distMi(ev).toFixed(1)} mi ${bearingOf(ev)} · ${ev.sources.join(" + ")}`));

      if (!ev.confirmed) {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = "UNCONFIRMED";
        meta.appendChild(tag);
      }
      if (ev.cascade) {
        const tag = document.createElement("span");
        tag.className = "tag cascade";
        tag.textContent = "CASCADE · " + ev.cascade;
        meta.appendChild(tag);
      }

      main.append(title, detail, meta);
      card.appendChild(main);
      card.addEventListener("click", () => selectEvent(ev.id, "feed"));
      list.appendChild(card);
    }
    list.scrollTop = scroll;
  }

  function selectEvent(id, from) {
    UI.selected = UI.selected === id ? null : id;
    HMAP.select(UI.selected);
    renderFeed(Date.now());
    if (from === "map" && UI.selected) {
      const card = $("feed-list").querySelector(`[data-id="${id}"]`);
      if (card) card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  /* ---------- chart ---------- */

  function renderChart(now, force) {
    const win = WINDOWS[UI.windowKey];
    const bucketMs = win.bucketMin * 60000;
    const n = Math.round(win.ms / bucketMs);
    const cats = visibleCats();
    // Align buckets to clean boundaries (:00, :05, …) for readable labels.
    const start = Math.floor((now - win.ms) / bucketMs) * bucketMs;

    const buckets = [];
    for (let i = 0; i < n; i++) {
      const t0 = start + i * bucketMs;
      buckets.push({ label: fmtHM(new Date(t0)), counts: {} });
    }
    for (const ev of SIM.windowEvents(now, win.ms)) {
      if (!passes(ev)) continue;
      const i = Math.min(n - 1, Math.floor((ev.t - start) / bucketMs));
      buckets[i].counts[ev.cat] = (buckets[i].counts[ev.cat] || 0) + 1;
    }

    const sig = UI.windowKey + "|" + cats.join() + "|" +
      buckets.map((b) => cats.map((c) => b.counts[c] || 0).join(",")).join(";");
    if (!force && sig === UI.lastChartSig) return;
    UI.lastChartSig = sig;

    $("chart-sub").textContent = `new incidents per ${win.bucketLabel} · ${win.label}`;
    HCHART.render({
      host: $("chart"), tip: $("chart-tip"),
      legendEl: $("chart-legend"), tableEl: $("chart-table"),
      buckets, cats,
    });
  }

  /* ---------- briefing ---------- */

  function renderBriefing(now, manual) {
    if (!manual && now - UI.lastBriefingAt < 15000) return;
    UI.lastBriefingAt = now;
    const b = SIM.briefing(now);
    const body = $("briefing-body");
    body.classList.remove("fresh");
    void body.offsetWidth; // restart the entrance animation
    body.classList.add("fresh");
    body.textContent = "";
    b.paras.forEach((p) => body.appendChild(mdPara(p)));
    $("briefing-time").textContent =
      "Generated " + fmtClock(new Date(b.generatedAt)) + " · Watch AI";
    $("briefing-confidence").textContent = "Confidence " + b.confidence + "%";
  }

  /* ---------- predictions ---------- */

  function renderPredictions(now) {
    const preds = SIM.predictions(now).filter((p) => !UI.cats || UI.cats.has(p.cat));
    const list = $("predict-list");
    list.textContent = "";
    if (!preds.length) {
      const d = document.createElement("div");
      d.className = "pred-empty";
      d.textContent = "No model-flagged risks for the selected categories.";
      list.appendChild(d);
      return;
    }
    for (const p of preds) {
      const card = document.createElement("div");
      card.className = "pred";
      card.style.borderLeft = "3px solid " + SIM.CAT_COLOR[p.cat];

      const top = document.createElement("div");
      top.className = "pred-top";
      const title = document.createElement("span");
      title.className = "pred-title";
      title.textContent = p.title;
      const prob = document.createElement("span");
      prob.className = "pred-prob";
      prob.textContent = p.prob + "%";
      top.append(title, prob);

      const win = document.createElement("div");
      win.className = "pred-window";
      win.textContent = p.window;

      const meter = document.createElement("div");
      meter.className = "meter";
      const col = p.prob >= 70 ? "var(--s-critical)" : p.prob >= 45 ? "var(--s-warning)" : "var(--accent)";
      meter.style.setProperty("--meterc", col);
      const fill = document.createElement("div");
      fill.className = "meter-fill";
      fill.style.width = p.prob + "%";
      meter.appendChild(fill);

      const basis = document.createElement("div");
      basis.className = "pred-basis";
      basis.textContent = p.basis;

      card.append(top, win, meter, basis);
      list.appendChild(card);
    }
  }

  /* ---------- toasts ---------- */

  function toast(color, iconName, title, line) {
    const host = $("toasts");
    while (host.children.length >= 3) host.firstChild.remove();
    const t = document.createElement("div");
    t.className = "toast";
    t.style.setProperty("--tc", color);
    const ic = document.createElement("span");
    ic.className = "toast-ic";
    ic.appendChild(icon(iconName));
    const main = document.createElement("div");
    const tt = document.createElement("div");
    tt.className = "toast-title";
    tt.textContent = title;
    const tl = document.createElement("div");
    tl.className = "toast-line";
    tl.textContent = line;
    main.append(tt, tl);
    t.append(ic, main);
    host.appendChild(t);
    setTimeout(() => { t.classList.add("bye"); setTimeout(() => t.remove(), 350); }, 6000);
  }

  function notifySpawned(evs, now) {
    if (!UI.bell) return;
    for (const ev of evs) {
      if (ev.sev < 3 || !passes(ev)) continue;
      toast(SIM.CAT_COLOR[ev.cat], ev.cat, ev.title,
        `${SIM.SEV_LABEL[ev.sev]} · ${distMi(ev).toFixed(1)} mi ${bearingOf(ev)} · ${timeAgo(ev.t, now)}`);
    }
  }
  function notifyExpired(evs) {
    if (!UI.bell) return;
    for (const ev of evs) {
      if (ev.sev < 4 || !passes(ev)) continue;
      toast("var(--s-good)", ev.cat, "All clear — " + ev.title, "Incident resolved; zone returning to normal.");
    }
  }

  /* ---------- map legend ---------- */

  const SHAPES = {
    flights: "M6 .8 10.4 10.6 6 8.4 1.6 10.6Z",
    weather: "M6 .9 10.4 3.45 10.4 8.55 6 11.1 1.6 8.55 1.6 3.45Z",
    traffic: "M6 .7 11.3 6 6 11.3 .7 6Z",
    power: "M1.2 1.2H10.8V10.8H1.2Z",
    internet: "", // circle
    emergency: "M6 .8 11.2 10.7H.8Z",
  };

  function buildMapLegend() {
    const host = $("map-legend");
    host.textContent = "";
    for (const c of SIM.CATS) {
      const item = document.createElement("span");
      item.className = "lg";
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 12 12");
      if (c === "internet") {
        const ci = document.createElementNS("http://www.w3.org/2000/svg", "circle");
        ci.setAttribute("cx", 6); ci.setAttribute("cy", 6); ci.setAttribute("r", 5);
        ci.setAttribute("fill", SIM.CAT_COLOR[c]);
        svg.appendChild(ci);
      } else {
        const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
        p.setAttribute("d", SHAPES[c]);
        p.setAttribute("fill", SIM.CAT_COLOR[c]);
        svg.appendChild(p);
      }
      svg.setAttribute("stroke", "none");
      item.appendChild(svg);
      item.appendChild(document.createTextNode(SIM.CAT_LABEL[c]));
      host.appendChild(item);
    }
    const extra = document.createElement("span");
    extra.className = "lg";
    extra.textContent = "◉ your position (live GPS dot when tracking) · shaded ring = storm cell · outlined patch = outage area · darts = live aircraft";
    host.appendChild(extra);
  }

  /* ---------- geolocation ---------- */

  function fmtCoord(lat, lon) {
    return Math.abs(lat).toFixed(3) + "°" + (lat >= 0 ? "N" : "S") + " " +
           Math.abs(lon).toFixed(3) + "°" + (lon >= 0 ? "E" : "W");
  }

  /* Build a zone config for arbitrary coordinates. Geography and incident
     flavor are seeded from the coordinates, so your place always looks the
     same; names stay generic because there's no reverse geocoder on board. */
  function buildGeoZone(lat, lon) {
    const seed = Math.abs((Math.round(lat * 1000) * 31 + Math.round(lon * 1000) * 17)) % 100000 + 7;
    return {
      name: "Your location", seed,
      airport: "RGNL", airportBearing: seed % 360,
      water: ["west", "east", "south", "river"][seed % 4],
      gridAngle: (seed % 19) - 9,
      stormChance: 0.45, heat: Math.abs(lat) < 35, quakes: false,
      rate: { flights: 1, weather: 1, traffic: 1.1, power: 1, internet: 1, emergency: 1 },
      districts: ["North End", "Riverside", "Midtown", "East Side", "Hillcrest", "Old Town"],
      highways: ["Beltway", "Route 7", "Hwy 12"],
      roads: ["Main St", "1st Ave", "Park Rd", "Broadway", "Mill Rd"],
      isps: ["Comcast", "AT&T", "Spectrum"],
      creeks: ["Mill Creek", "Stone Creek"],
    };
  }

  function geoOffsets(lat, lon) {
    const g = UI.geo;
    const x = (lon - g.anchorLon) * 69 * Math.cos((g.anchorLat * Math.PI) / 180);
    const y = (lat - g.anchorLat) * 69;
    return { x, y };
  }

  function onGeoFix(pos) {
    const { latitude: lat, longitude: lon, accuracy } = pos.coords;
    const g = UI.geo;
    if (!g) return;
    g.lat = lat; g.lon = lon;
    g.off = geoOffsets(lat, lon);
    g.accMi = Math.min(2, (accuracy || 80) / 1609);
    SIM.setUserOffset(g.off.x, g.off.y);
  }

  function stopGeo() {
    if (UI.geoWatchId != null && navigator.geolocation) {
      navigator.geolocation.clearWatch(UI.geoWatchId);
    }
    UI.geoWatchId = null;
    UI.geo = null;
    SIM.setUserOffset(0, 0);
  }

  function startGeo() {
    if (!navigator.geolocation) {
      toast("var(--s-warning)", "emergency", "Location unavailable",
        "This browser doesn't expose geolocation. Pick a preset zone instead.");
      $("zone-select").value = UI.zone;
      return;
    }
    $("map-sub").textContent = "Locating you…";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lon } = pos.coords;
        SIM.registerZone("geo", buildGeoZone(lat, lon));
        UI.geo = { anchorLat: lat, anchorLon: lon, lat, lon, off: { x: 0, y: 0 }, accMi: 0.05 };
        UI.zone = "geo";
        onGeoFix(pos);
        applyZone();
        UI.geoWatchId = navigator.geolocation.watchPosition(onGeoFix, () => {}, {
          enableHighAccuracy: true, maximumAge: 2000, timeout: 20000,
        });
      },
      (err) => {
        const why = err.code === 1
          ? "Permission denied — allow location access for this site and try again."
          : err.code === 2 ? "Position unavailable — no GPS/Wi-Fi fix right now."
          : "Timed out getting a fix — try again.";
        toast("var(--s-warning)", "emergency", "Couldn't get your location", why);
        $("zone-select").value = UI.zone;
        const z = SIM.ZONES[UI.zone];
        $("map-sub").textContent = `${z.name} · ${UI.radius}-mile watch zone · ${z.airport} region`;
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 }
    );
  }

  /* ---------- zone lifecycle ---------- */

  function applyZone() {
    SIM.init(UI.zone, UI.radius);
    if (UI.geo && UI.zone === "geo") SIM.setUserOffset(UI.geo.off.x, UI.geo.off.y);
    HMAP.setZone(SIM.ZONES[UI.zone], UI.radius);
    UI.selected = null;
    HMAP.select(null);
    UI.lastChartSig = "";
    const z = SIM.ZONES[UI.zone];
    $("map-sub").textContent = UI.zone === "geo"
      ? `Your location · ${fmtCoord(UI.geo.anchorLat, UI.geo.anchorLon)} · ${UI.radius}-mile watch zone`
      : `${z.name}${z.anchor ? " · " + fmtCoord(z.anchor.lat, z.anchor.lon) : ""} · ${UI.radius}-mile watch zone · ${z.airport} region`;
    $("recenter-btn").hidden = UI.zone !== "geo";
    refresh(true);
    renderBriefing(Date.now(), true);
  }

  /* ---------- master refresh ---------- */

  function refresh(force) {
    const now = Date.now();
    const act = SIM.activeEvents(now).filter(passes);
    const showAircraft = !UI.cats || UI.cats.has("flights");
    const showStorm = !UI.cats || UI.cats.has("weather");
    const user = (UI.zone === "geo" && UI.geo)
      ? { x: UI.geo.off.x, y: UI.geo.off.y, accMi: UI.geo.accMi } : null;
    HMAP.setData(act, showAircraft ? SIM.state.aircraft : [], showStorm ? SIM.state.storm : null, user);
    renderStats(now);
    renderFeed(now);
    renderChart(now, force);
    renderPredictions(now);
  }

  /* ---------- wiring ---------- */

  function initControls() {
    $("zone-select").addEventListener("change", (e) => {
      if (e.target.value === "geo") {
        startGeo(); // UI.zone flips to "geo" only once a fix arrives
        return;
      }
      stopGeo();
      UI.zone = e.target.value;
      applyZone();
    });

    $("recenter-btn").addEventListener("click", () => {
      if (!UI.geo) return;
      UI.geo.anchorLat = UI.geo.lat;
      UI.geo.anchorLon = UI.geo.lon;
      UI.geo.off = { x: 0, y: 0 };
      SIM.registerZone("geo", buildGeoZone(UI.geo.anchorLat, UI.geo.anchorLon));
      applyZone();
    });
    $("radius-select").addEventListener("change", (e) => {
      UI.radius = parseInt(e.target.value, 10);
      applyZone();
    });

    $("window-seg").addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-window]");
      if (!btn) return;
      UI.windowKey = btn.dataset.window;
      for (const b of $("window-seg").children) b.classList.toggle("on", b === btn);
      refresh(true);
    });

    $("cat-chips").addEventListener("click", (e) => {
      const chip = e.target.closest("button[data-cat]");
      if (!chip) return;
      const cat = chip.dataset.cat;
      if (cat === "all") {
        UI.cats = null;
      } else {
        if (!UI.cats) UI.cats = new Set();
        if (UI.cats.has(cat)) UI.cats.delete(cat); else UI.cats.add(cat);
        if (!UI.cats.size || UI.cats.size === SIM.CATS.length) UI.cats = null;
      }
      for (const c of $("cat-chips").children) {
        const k = c.dataset.cat;
        c.classList.toggle("on", k === "all" ? !UI.cats : !!(UI.cats && UI.cats.has(k)));
      }
      refresh(true);
    });

    $("bell-btn").addEventListener("click", () => {
      UI.bell = !UI.bell;
      const b = $("bell-btn");
      b.setAttribute("aria-pressed", String(UI.bell));
      b.title = UI.bell ? "Notifications on" : "Notifications off";
    });

    $("briefing-refresh").addEventListener("click", () => renderBriefing(Date.now(), true));

    $("table-toggle").addEventListener("click", () => {
      const btn = $("table-toggle");
      const showTable = btn.getAttribute("aria-pressed") !== "true";
      btn.setAttribute("aria-pressed", String(showTable));
      $("chart").hidden = showTable;
      $("chart-table").hidden = !showTable;
    });
  }

  /* ---------- boot ---------- */

  function boot() {
    buildMapLegend();
    HMAP.init($("map"), $("map-tip"), { onSelect: (id) => selectEvent(id, "map") });
    initControls();
    applyZone();
    UI.booted = true;

    const tickChips = () => {
      const t = fmtClock(new Date());
      $("clock").textContent = t;
      $("map-updated").textContent = UI.zone === "geo" && UI.geo
        ? `LIVE · ${t} · ${fmtCoord(UI.geo.lat, UI.geo.lon)}`
        : `LIVE · ${t}`;
    };
    setInterval(tickChips, 1000);
    tickChips();

    let last = Date.now();
    setInterval(() => {
      const now = Date.now();
      const out = SIM.tick(now - last);
      last = now;
      notifySpawned(out.spawned, now);
      notifyExpired(out.expired);
      const material = [...out.spawned, ...out.expired].some((e) => e.sev >= 3);
      refresh(false);
      if (material) renderBriefing(now, false);
      else if (now - UI.lastBriefingAt > 90000) renderBriefing(now, false);
    }, 2000);
  }

  document.readyState === "loading"
    ? document.addEventListener("DOMContentLoaded", boot)
    : boot();
})();
