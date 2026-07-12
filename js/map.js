/* Live scope map — canvas renderer.
   Draws a stylized local map (water, street grid, highways, airport) for the
   selected zone, then the live picture on top: incidents (one marker shape
   per category — shape is the colorblind-safe secondary channel), moving
   aircraft, the storm cell, outage areas, range rings. Hover = nearest
   entity within 24 px; click pins the incident in the feed. */

(function () {
  "use strict";

  const BG = "#141513", WATER = "#152230", COASTLINE = "#263a4d",
    PARK = "#1a231b", STREET = "#232522", HIGHWAY = "#373732",
    RING = "#383835", INK3 = "#898781", INK = "#e8e7e0";

  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const M = {
    canvas: null, ctx: null, wrap: null, tip: null,
    w: 0, h: 0, dpr: 1,
    zone: null, radius: 5, geo: null,
    data: { events: [], aircraft: [], storm: null },
    hover: null, selected: null, onSelect: null,
    raf: 0,
  };

  /* ---------- geography ---------- */

  function buildGeo() {
    const rng = mulberry32((M.zone.seed + 77) * 2654435761);
    const geo = { parks: [], highways: [], waves: [] };
    for (let i = 0; i < 24; i++) geo.waves.push(rng());

    // Parks: irregular blobs, positions in mile-space.
    const nParks = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < nParks; i++) {
      const cx = (rng() * 2 - 1) * M.radius * 0.75;
      const cy = (rng() * 2 - 1) * M.radius * 0.75;
      const r = M.radius * (0.08 + rng() * 0.12);
      const pts = [];
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2;
        const rr = r * (0.7 + rng() * 0.6);
        pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
      }
      geo.parks.push(pts);
    }

    // Highways: 2–3 gentle curves across the zone, in mile-space.
    const n = Math.min(3, M.zone.highways.length);
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2;
      const b = a + Math.PI + (rng() - 0.5) * 1.1;
      const R = M.radius * 1.5;
      const p0 = [Math.cos(a) * R, Math.sin(a) * R];
      const p2 = [Math.cos(b) * R, Math.sin(b) * R];
      const pc = [(rng() * 2 - 1) * M.radius * 0.5, (rng() * 2 - 1) * M.radius * 0.5];
      const pts = [];
      for (let t = 0; t <= 1.001; t += 0.05) {
        const u = 1 - t;
        pts.push([
          u * u * p0[0] + 2 * u * t * pc[0] + t * t * p2[0],
          u * u * p0[1] + 2 * u * t * pc[1] + t * t * p2[1],
        ]);
      }
      geo.highways.push({ pts, name: M.zone.highways[i] });
    }
    M.geo = geo;
  }

  /* mile-space (x east, y north) → pixel */
  function px(x, y) {
    const s = scale();
    return [M.w / 2 + x * s, M.h / 2 - y * s];
  }
  function scale() {
    return (Math.min(M.w, M.h) / 2 - 30) / M.radius;
  }

  /* ---------- drawing ---------- */

  function drawWater(ctx) {
    const side = M.zone.water;
    const wv = M.geo.waves;
    ctx.fillStyle = WATER;
    ctx.strokeStyle = COASTLINE;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    const amp = Math.min(M.w, M.h) * 0.045;

    if (side === "river") {
      const yMid = M.h * 0.58;
      ctx.moveTo(0, yMid + Math.sin(0) * amp);
      for (let x = 0; x <= M.w; x += 14) {
        const k = x / M.w;
        ctx.lineTo(x, yMid + Math.sin(k * 5.2 + wv[0] * 6) * amp + Math.sin(k * 11 + wv[1] * 6) * amp * 0.4);
      }
      const bw = Math.max(16, M.h * 0.05);
      for (let x = M.w; x >= 0; x -= 14) {
        const k = x / M.w;
        ctx.lineTo(x, yMid + bw + Math.sin(k * 5.2 + wv[0] * 6) * amp + Math.sin(k * 11 + wv[1] * 6) * amp * 0.4);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      return;
    }

    // Coast: water beyond ~64% toward one side, wavy edge.
    const frac = 0.64;
    if (side === "west" || side === "east") {
      const base = side === "west" ? M.w * (1 - frac) : M.w * frac;
      const dir = side === "west" ? -1 : 1;
      ctx.moveTo(base + Math.sin(wv[2] * 6) * amp, 0);
      for (let y = 0; y <= M.h; y += 14) {
        const k = y / M.h;
        ctx.lineTo(base + (Math.sin(k * 4.5 + wv[2] * 6) + Math.sin(k * 9 + wv[3] * 6) * 0.5) * amp, y);
      }
      ctx.lineTo(base + dir * M.w, M.h);
      ctx.lineTo(base + dir * M.w, 0);
      ctx.closePath();
    } else { // south
      const base = M.h * frac;
      ctx.moveTo(0, base + Math.sin(wv[2] * 6) * amp);
      for (let x = 0; x <= M.w; x += 14) {
        const k = x / M.w;
        ctx.lineTo(x, base + (Math.sin(k * 4.5 + wv[2] * 6) + Math.sin(k * 9 + wv[3] * 6) * 0.5) * amp);
      }
      ctx.lineTo(M.w, M.h * 2);
      ctx.lineTo(0, M.h * 2);
      ctx.closePath();
    }
    ctx.fill();
    ctx.stroke();
  }

  function drawStreets(ctx) {
    const ang = (M.zone.gridAngle * Math.PI) / 180;
    const s = scale();
    const spacing = Math.max(24, (M.radius / 6) * s);
    const ext = Math.max(M.w, M.h);
    ctx.save();
    ctx.translate(M.w / 2, M.h / 2);
    ctx.rotate(ang);
    ctx.strokeStyle = STREET;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let d = -ext; d <= ext; d += spacing) {
      ctx.moveTo(d, -ext); ctx.lineTo(d, ext);
      ctx.moveTo(-ext, d); ctx.lineTo(ext, d);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawHighways(ctx) {
    ctx.lineWidth = 3;
    ctx.strokeStyle = HIGHWAY;
    ctx.lineCap = "round";
    for (const hw of M.geo.highways) {
      ctx.beginPath();
      hw.pts.forEach(([x, y], i) => {
        const [X, Y] = px(x, y);
        i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
      });
      ctx.stroke();
      // Name label near the 20% point, kept on-canvas.
      const p = hw.pts[Math.floor(hw.pts.length * 0.2)];
      let [lx, ly] = px(p[0], p[1]);
      lx = Math.min(Math.max(lx, 26), M.w - 26);
      ly = Math.min(Math.max(ly, 14), M.h - 8);
      ctx.fillStyle = INK3;
      ctx.font = "10px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(hw.name, lx, ly);
    }
  }

  function drawParks(ctx) {
    ctx.fillStyle = PARK;
    for (const pts of M.geo.parks) {
      ctx.beginPath();
      pts.forEach(([x, y], i) => {
        const [X, Y] = px(x, y);
        i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y);
      });
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawRings(ctx) {
    const s = scale();
    ctx.strokeStyle = RING;
    ctx.lineWidth = 1;
    ctx.fillStyle = INK3;
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "left";
    for (const f of [0.5, 1]) {
      const r = M.radius * f * s;
      ctx.beginPath();
      ctx.arc(M.w / 2, M.h / 2, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillText((M.radius * f) + " mi", M.w / 2 + r * 0.7071 + 5, M.h / 2 - r * 0.7071 - 4);
    }
  }

  function drawAirport(ctx) {
    const b = ((90 - M.zone.airportBearing) * Math.PI) / 180; // compass → math angle
    const d = M.radius * 0.82;
    const [X, Y] = px(Math.cos(b) * d, Math.sin(b) * d);
    ctx.save();
    ctx.translate(X, Y);
    ctx.rotate(0.5);
    ctx.fillStyle = HIGHWAY;
    ctx.fillRect(-13, -2.5, 26, 5);
    ctx.rotate(1.4);
    ctx.fillRect(-10, -2, 20, 4);
    ctx.restore();
    ctx.fillStyle = INK3;
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(M.zone.airport, X, Y + 18);
  }

  function drawStorm(ctx, t) {
    const st = M.data.storm;
    if (!st) return;
    const s = scale();
    const [X, Y] = px(st.x, st.y);
    const R = st.r * s;
    const g = ctx.createRadialGradient(X, Y, R * 0.1, X, Y, R);
    const a = 0.30 * st.intensity;
    g.addColorStop(0, `rgba(201,133,0,${a})`);
    g.addColorStop(0.65, `rgba(201,133,0,${a * 0.5})`);
    g.addColorStop(1, "rgba(201,133,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(X, Y, R, 0, Math.PI * 2);
    ctx.fill();

    // Lightning flicker inside the core.
    if (st.intensity > 0.4 && Math.sin(t / 130) > 0.86) {
      ctx.fillStyle = "rgba(250,214,130,0.9)";
      const fx = X + Math.sin(t / 91) * R * 0.4, fy = Y + Math.cos(t / 77) * R * 0.4;
      ctx.beginPath(); ctx.arc(fx, fy, 2.2, 0, Math.PI * 2); ctx.fill();
    }

    // Motion vector.
    const sp = Math.hypot(st.vx, st.vy);
    if (sp > 1) {
      const [dx, dy] = [st.vx / sp, st.vy / sp];
      ctx.strokeStyle = "rgba(201,133,0,0.8)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(X, Y);
      ctx.lineTo(X + dx * (R + 14), Y - dy * (R + 14));
      ctx.stroke();
      ctx.beginPath();
      const hx = X + dx * (R + 20), hy = Y - dy * (R + 20);
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx - dx * 7 - dy * 4, hy + dy * 7 - dx * 4);
      ctx.lineTo(hx - dx * 7 + dy * 4, hy + dy * 7 + dx * 4);
      ctx.closePath();
      ctx.fillStyle = "rgba(201,133,0,0.8)";
      ctx.fill();
    }
  }

  function drawOutageAreas(ctx) {
    const rngBase = 104729;
    for (const ev of M.data.events) {
      if (ev.cat !== "power" || ev.sev < 3) continue;
      const rng = mulberry32(rngBase + ev.x * 1000 + ev.y * 500);
      const s = scale();
      const [X, Y] = px(ev.x, ev.y);
      const R = (0.45 + rng() * 0.5) * s;
      ctx.beginPath();
      for (let k = 0; k <= 8; k++) {
        const a = (k / 8) * Math.PI * 2;
        const rr = R * (0.7 + rng() * 0.55);
        const xx = X + Math.cos(a) * rr, yy = Y + Math.sin(a) * rr;
        k ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
      }
      ctx.closePath();
      ctx.fillStyle = "rgba(217,89,38,0.13)";
      ctx.fill();
      ctx.strokeStyle = "rgba(217,89,38,0.55)";
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }

  /* Marker shapes — one per category (the CVD-safe second channel). */
  function tracePath(ctx, cat, X, Y, r) {
    ctx.beginPath();
    switch (cat) {
      case "internet": ctx.arc(X, Y, r, 0, Math.PI * 2); break;
      case "power": ctx.rect(X - r * 0.9, Y - r * 0.9, r * 1.8, r * 1.8); break;
      case "traffic":
        ctx.moveTo(X, Y - r * 1.15); ctx.lineTo(X + r * 1.15, Y);
        ctx.lineTo(X, Y + r * 1.15); ctx.lineTo(X - r * 1.15, Y); ctx.closePath(); break;
      case "emergency":
        ctx.moveTo(X, Y - r * 1.2); ctx.lineTo(X + r * 1.15, Y + r * 0.95);
        ctx.lineTo(X - r * 1.15, Y + r * 0.95); ctx.closePath(); break;
      case "weather":
        for (let k = 0; k < 6; k++) {
          const a = (k / 6) * Math.PI * 2 - Math.PI / 2;
          const xx = X + Math.cos(a) * r * 1.1, yy = Y + Math.sin(a) * r * 1.1;
          k ? ctx.lineTo(xx, yy) : ctx.moveTo(xx, yy);
        }
        ctx.closePath(); break;
      case "flights":
        ctx.moveTo(X, Y - r * 1.25); ctx.lineTo(X + r * 0.95, Y + r * 1.05);
        ctx.lineTo(X, Y + r * 0.45); ctx.lineTo(X - r * 0.95, Y + r * 1.05); ctx.closePath(); break;
    }
  }

  function drawEvents(ctx, t) {
    for (const ev of M.data.events) {
      const [X, Y] = px(ev.x, ev.y);
      const r = ev.sev >= 3 ? 7 : 5.5;
      const color = SIM.CAT_COLOR[ev.cat];

      if (ev.sev === 4) { // critical pulse
        const ph = (t % 1600) / 1600;
        ctx.beginPath();
        ctx.arc(X, Y, r + 4 + ph * 13, 0, Math.PI * 2);
        ctx.strokeStyle = color + Math.round((1 - ph) * 110).toString(16).padStart(2, "0");
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // 2px surface ring, then the colored mark.
      tracePath(ctx, ev.cat, X, Y, r + 2);
      ctx.fillStyle = BG;
      ctx.fill();
      tracePath(ctx, ev.cat, X, Y, r);
      ctx.fillStyle = color;
      ctx.fill();

      const isFocus = (M.hover && M.hover.type === "event" && M.hover.ev === ev) ||
        (M.selected && M.selected === ev.id);
      if (isFocus) {
        ctx.beginPath();
        ctx.arc(X, Y, r + 6, 0, Math.PI * 2);
        ctx.strokeStyle = INK;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }
    }
  }

  function drawAircraft(ctx) {
    for (const ac of M.data.aircraft) {
      const [X, Y] = px(ac.x, ac.y);
      if (X < -20 || X > M.w + 20 || Y < -20 || Y > M.h + 20) continue;
      const a = -ac.heading; // canvas y is flipped
      // Trail.
      ctx.strokeStyle = "rgba(57,135,229,0.35)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(X - Math.cos(a) * 16, Y - Math.sin(a) * 16);
      ctx.lineTo(X, Y);
      ctx.stroke();
      // Dart with surface ring.
      ctx.save();
      ctx.translate(X, Y);
      ctx.rotate(a + Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(0, -8); ctx.lineTo(5.5, 6.5); ctx.lineTo(0, 3.4); ctx.lineTo(-5.5, 6.5);
      ctx.closePath();
      ctx.lineWidth = 3;
      ctx.strokeStyle = BG;
      ctx.stroke();
      ctx.fillStyle = SIM.CAT_COLOR.flights;
      ctx.fill();
      ctx.restore();
      if (M.hover && M.hover.type === "aircraft" && M.hover.ac === ac) {
        ctx.fillStyle = INK;
        ctx.font = "10px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(ac.callsign, X, Y - 13);
      }
    }
  }

  function drawCenter(ctx) {
    const [X, Y] = px(0, 0);
    ctx.beginPath(); ctx.arc(X, Y, 6.5, 0, Math.PI * 2);
    ctx.fillStyle = BG; ctx.fill();
    ctx.beginPath(); ctx.arc(X, Y, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = INK; ctx.fill();
    ctx.beginPath(); ctx.arc(X, Y, 2, 0, Math.PI * 2);
    ctx.fillStyle = BG; ctx.fill();
  }

  function drawChrome(ctx) {
    ctx.fillStyle = INK3;
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.fillText("N ↑", M.w - 12, 20);
    // Scale bar = 1 mile.
    const s = scale();
    ctx.strokeStyle = INK3;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(14, M.h - 14); ctx.lineTo(14 + s, M.h - 14);
    ctx.moveTo(14, M.h - 18); ctx.lineTo(14, M.h - 10);
    ctx.moveTo(14 + s, M.h - 18); ctx.lineTo(14 + s, M.h - 10);
    ctx.stroke();
    ctx.textAlign = "left";
    ctx.fillText("1 mi", 20 + s, M.h - 10);
  }

  function draw(t) {
    const ctx = M.ctx;
    ctx.setTransform(M.dpr, 0, 0, M.dpr, 0, 0);
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, M.w, M.h);
    drawWater(ctx);
    drawParks(ctx);
    drawStreets(ctx);
    drawHighways(ctx);
    drawAirport(ctx);
    drawRings(ctx);
    drawOutageAreas(ctx);
    drawStorm(ctx, t);
    drawEvents(ctx, t);
    drawAircraft(ctx);
    drawCenter(ctx);
    drawChrome(ctx);
  }

  function loop(t) {
    draw(t);
    M.raf = requestAnimationFrame(loop);
  }

  /* ---------- interaction ---------- */

  function nearest(mx, my) {
    let best = null, bd = 24;
    for (const ev of M.data.events) {
      const [X, Y] = px(ev.x, ev.y);
      const d = Math.hypot(mx - X, my - Y);
      if (d < bd) { bd = d; best = { type: "event", ev }; }
    }
    for (const ac of M.data.aircraft) {
      const [X, Y] = px(ac.x, ac.y);
      const d = Math.hypot(mx - X, my - Y);
      if (d < bd) { bd = d; best = { type: "aircraft", ac }; }
    }
    if (M.data.storm) {
      const [X, Y] = px(M.data.storm.x, M.data.storm.y);
      const d = Math.hypot(mx - X, my - Y);
      if (d < Math.max(24, M.data.storm.r * scale() * 0.5) && (!best || d < bd)) {
        best = { type: "storm" };
      }
    }
    return best;
  }

  function tipRow(cls, text) {
    const d = document.createElement("div");
    d.className = cls;
    d.textContent = text;
    return d;
  }

  function showTip(mx, my) {
    const h = M.hover;
    const tip = M.tip;
    if (!h) { tip.hidden = true; return; }
    tip.textContent = "";
    if (h.type === "event") {
      const ev = h.ev;
      tip.appendChild(tipRow("tip-title", ev.title));
      tip.appendChild(tipRow("tip-line", ev.detail));
      tip.appendChild(tipRow("tip-meta",
        `${SIM.SEV_LABEL[ev.sev]} · ${Math.hypot(ev.x, ev.y).toFixed(1)} mi out · ${ev.sources.join(" + ")}`));
    } else if (h.type === "aircraft") {
      const ac = h.ac;
      tip.appendChild(tipRow("tip-title", ac.callsign));
      tip.appendChild(tipRow("tip-line",
        `${ac.kind === "overflight" ? "Overflight" : ac.kind === "arrival" ? "Arrival" : "Departure"} · ${ac.alt.toLocaleString()} ft · ${Math.round(ac.speed)} mph`));
      tip.appendChild(tipRow("tip-meta", "ADS-B live track"));
    } else {
      const st = M.data.storm;
      tip.appendChild(tipRow("tip-title", "Storm cell"));
      tip.appendChild(tipRow("tip-line",
        `Intensity ${Math.round(st.intensity * 100)}% · moving ${Math.round(Math.hypot(st.vx, st.vy))} mph`));
      tip.appendChild(tipRow("tip-meta", "NEXRAD cell tracking"));
    }
    tip.hidden = false;
    const wr = M.wrap.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = mx + 14, y = my + 14;
    if (x + tw > wr.width - 8) x = mx - tw - 14;
    if (y + th > wr.height - 8) y = my - th - 14;
    tip.style.left = Math.max(8, x) + "px";
    tip.style.top = Math.max(8, y) + "px";
  }

  function onMove(e) {
    const r = M.canvas.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    M.hover = nearest(mx, my);
    M.canvas.classList.toggle("hit", !!M.hover);
    showTip(mx, my);
  }

  function onLeave() {
    M.hover = null;
    M.tip.hidden = true;
    M.canvas.classList.remove("hit");
  }

  function onClick() {
    if (M.hover && M.hover.type === "event" && M.onSelect) {
      M.onSelect(M.hover.ev.id);
    }
  }

  function resize() {
    const r = M.wrap.getBoundingClientRect();
    M.dpr = window.devicePixelRatio || 1;
    M.w = Math.max(200, r.width);
    M.h = 460;
    M.canvas.width = Math.round(M.w * M.dpr);
    M.canvas.height = Math.round(M.h * M.dpr);
    M.canvas.style.height = M.h + "px";
  }

  /* ---------- public ---------- */

  window.HMAP = {
    init(canvas, tip, opts) {
      M.canvas = canvas;
      M.ctx = canvas.getContext("2d");
      M.wrap = canvas.parentElement;
      M.tip = tip;
      M.onSelect = opts.onSelect || null;
      canvas.addEventListener("pointermove", onMove);
      canvas.addEventListener("pointerleave", onLeave);
      canvas.addEventListener("click", onClick);
      new ResizeObserver(() => { resize(); }).observe(M.wrap);
      resize();
      if (!M.raf) M.raf = requestAnimationFrame(loop);
    },
    setZone(zone, radius) {
      M.zone = zone;
      M.radius = radius;
      M.selected = null;
      buildGeo();
    },
    setData(events, aircraft, storm) {
      M.data.events = events;
      M.data.aircraft = aircraft;
      M.data.storm = storm;
    },
    select(id) { M.selected = id; },
  };
})();
