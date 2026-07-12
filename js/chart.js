/* Activity chart — stacked columns per time bucket, SVG.
   Follows the house dataviz rules: ≤24px columns, 4px rounded data-end at the
   top of each column only, 2px surface gaps between stacked segments, solid
   hairline gridlines, a legend for the multi-series identity channel, a
   per-column hover tooltip listing every series, and a table-view twin. */

(function () {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";
  const PLOT_H = 185, AXIS_H = 24, TOP = 12, LEFT = 34, RIGHT = 8;

  function el(name, attrs) {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    return n;
  }

  function niceStep(max) {
    for (const s of [1, 2, 5, 10, 20, 50, 100]) {
      if (max / s <= 5) return s;
    }
    return Math.ceil(max / 5);
  }

  let state = null; // last render args, for resize re-render
  let ro = null;

  function render(args) {
    state = args;
    const { host, tip, legendEl, tableEl, buckets, cats } = args;

    /* ----- legend ----- */
    legendEl.textContent = "";
    for (const c of cats) {
      const item = document.createElement("span");
      item.className = "lgd";
      const key = document.createElement("i");
      key.style.background = SIM.CAT_COLOR[c];
      item.appendChild(key);
      item.appendChild(document.createTextNode(SIM.CAT_LABEL[c]));
      legendEl.appendChild(item);
    }

    /* ----- geometry ----- */
    const W = Math.max(280, host.getBoundingClientRect().width || 600);
    const H = TOP + PLOT_H + AXIS_H;
    const plotW = W - LEFT - RIGHT;
    const n = buckets.length;
    const slot = plotW / n;
    const barW = Math.min(24, slot * 0.62);

    const totals = buckets.map((b) => cats.reduce((s, c) => s + (b.counts[c] || 0), 0));
    const rawMax = Math.max(4, ...totals);
    const step = niceStep(rawMax);
    const yMax = Math.ceil(rawMax / step) * step;
    const ky = PLOT_H / yMax;
    const baseY = TOP + PLOT_H;

    const svg = el("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": "Incidents per time bucket by category" });

    /* gridlines + y ticks (solid hairlines, clean numbers) */
    for (let v = 0; v <= yMax; v += step) {
      const y = baseY - v * ky;
      svg.appendChild(el("line", { x1: LEFT, x2: W - RIGHT, y1: y, y2: y, stroke: v === 0 ? "#383835" : "#2c2c2a", "stroke-width": 1 }));
      const t = el("text", { x: LEFT - 7, y: y + 3.5, "text-anchor": "end", fill: "#898781", "font-size": 10, style: "font-variant-numeric: tabular-nums" });
      t.textContent = v;
      svg.appendChild(t);
    }

    /* columns */
    const hits = [];
    buckets.forEach((b, i) => {
      const x = LEFT + i * slot + (slot - barW) / 2;
      let yCur = baseY;
      let topSeg = null;
      for (const c of cats) {
        const v = b.counts[c] || 0;
        if (!v) continue;
        const hpx = v * ky;
        const segTop = yCur - hpx;
        const drawH = Math.max(1, hpx - 2); // 2px surface gap above each segment
        const r = el("rect", { x, y: segTop, width: barW, height: drawH, fill: SIM.CAT_COLOR[c] });
        svg.appendChild(r);
        topSeg = { el: r, y: segTop, h: drawH };
        yCur = segTop;
      }
      // Rounded 4px data-end on the very top of the column only.
      if (topSeg) {
        const rr = Math.min(4, topSeg.h / 2);
        topSeg.el.setAttribute("rx", rr);
        // Re-square the bottom of the top segment by overlaying its lower half.
        if (topSeg.h > rr * 2) {
          const patch = el("rect", {
            x, y: topSeg.y + rr, width: barW, height: topSeg.h - rr,
            fill: topSeg.el.getAttribute("fill"),
          });
          svg.insertBefore(patch, topSeg.el.nextSibling);
        }
      }

      /* x labels — every k-th to stay uncrowded */
      const every = n > 16 ? 4 : n > 8 ? 3 : 2;
      if (i % every === 0) {
        const t = el("text", { x: LEFT + i * slot + slot / 2, y: baseY + 15, "text-anchor": "middle", fill: "#898781", "font-size": 10 });
        t.textContent = b.label;
        svg.appendChild(t);
      }

      /* hover hit target: the full slot, taller than the marks */
      const hit = el("rect", {
        x: LEFT + i * slot, y: TOP, width: slot, height: PLOT_H,
        class: "col-hit", tabindex: 0, role: "img",
        "aria-label": `${b.label}: ${totals[i]} incidents`,
      });
      hits.push({ hit, i });
      svg.appendChild(hit);
    });

    host.textContent = "";
    host.appendChild(svg);

    /* ----- tooltip ----- */
    function fillTip(i) {
      const b = buckets[i];
      tip.textContent = "";
      const title = document.createElement("div");
      title.className = "tip-title";
      title.textContent = b.label;
      tip.appendChild(title);
      for (const c of cats) {
        const row = document.createElement("div");
        row.className = "tip-row";
        const k = document.createElement("span");
        k.className = "k";
        k.style.background = SIM.CAT_COLOR[c];
        const v = document.createElement("span");
        v.className = "v";
        v.textContent = b.counts[c] || 0;
        const nm = document.createElement("span");
        nm.className = "n";
        nm.textContent = SIM.CAT_LABEL[c];
        row.append(k, v, nm);
        tip.appendChild(row);
      }
      const tot = document.createElement("div");
      tot.className = "tip-meta";
      tot.textContent = `Total ${totals[i]}`;
      tip.appendChild(tot);
    }

    function placeTip(i) {
      const card = tip.parentElement;
      const cardR = card.getBoundingClientRect();
      const hostR = host.getBoundingClientRect();
      fillTip(i);
      tip.hidden = false;
      const cx = hostR.left - cardR.left + LEFT + i * slot + slot / 2;
      let x = cx - tip.offsetWidth / 2;
      x = Math.max(8, Math.min(x, cardR.width - tip.offsetWidth - 8));
      const y = hostR.top - cardR.top + TOP - 6;
      tip.style.left = x + "px";
      tip.style.top = Math.max(4, y - tip.offsetHeight) + "px";
    }

    for (const { hit, i } of hits) {
      hit.addEventListener("pointerenter", () => placeTip(i));
      hit.addEventListener("focus", () => placeTip(i));
      hit.addEventListener("pointerleave", () => { tip.hidden = true; });
      hit.addEventListener("blur", () => { tip.hidden = true; });
    }

    /* ----- table twin ----- */
    tableEl.textContent = "";
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const hr = document.createElement("tr");
    for (const htxt of ["Time", ...cats.map((c) => SIM.CAT_LABEL[c]), "Total"]) {
      const th = document.createElement("th");
      th.textContent = htxt;
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    table.appendChild(thead);
    const tbody = document.createElement("tbody");
    buckets.forEach((b, i) => {
      const tr = document.createElement("tr");
      const td0 = document.createElement("td");
      td0.textContent = b.label;
      tr.appendChild(td0);
      for (const c of cats) {
        const td = document.createElement("td");
        td.textContent = b.counts[c] || 0;
        tr.appendChild(td);
      }
      const tdT = document.createElement("td");
      tdT.textContent = totals[i];
      tr.appendChild(tdT);
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tableEl.appendChild(table);

    if (!ro) {
      ro = new ResizeObserver(() => { if (state) render(state); });
      ro.observe(host);
    }
  }

  window.HCHART = { render };
})();
