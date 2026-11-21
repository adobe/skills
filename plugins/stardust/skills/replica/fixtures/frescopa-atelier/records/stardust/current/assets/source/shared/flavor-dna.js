/* ============================================================
   FRÉSCOPA — Flavour DNA
   A hand-built SVG radar that morphs between taste profiles.
   Geometry is drawn here; colour comes from CSS custom props
   (--dna-grid, --dna-axis, --dna-label, --dna-fill, --dna-stroke,
    --dna-dot) so each direction can style it differently.
   Markup:
     <div data-flavor-dna>
       <svg data-dna-svg></svg>
       <button data-profile="weekday">…</button> …
       <h4 data-flavor-title></h4><p data-flavor-note></p>
     </div>
   ============================================================ */
(function () {
  "use strict";

  var AXES = ["Strength", "Body", "Sweetness", "Smoothness", "Warmth", "Crema"];

  var PROFILES = {
    weekday: {
      label: "Weekday",
      title: "The weekday cup",
      note: "Brisk and a little bolder. Enough to meet the day, never so much it rushes you.",
      values: [0.92, 0.62, 0.34, 0.5, 0.66, 0.82]
    },
    sunday: {
      label: "Slow Sunday",
      title: "The slow Sunday",
      note: "Softer and rounder, made for lingering. It knows there is nowhere you need to be.",
      values: [0.58, 0.8, 0.6, 0.88, 0.84, 0.62]
    },
    evening: {
      label: "After dinner",
      title: "The after-dinner cup",
      note: "Gentle and sweet, half the strength. A quiet close to the evening, not a second start.",
      values: [0.34, 0.7, 0.78, 0.74, 0.9, 0.5]
    }
  };

  var SIZE = 420, CX = 210, CY = 206, R = 138;
  var NS = "http://www.w3.org/2000/svg";
  var TAU = Math.PI * 2;
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function el(name, attrs) {
    var node = document.createElementNS(NS, name);
    for (var k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  }

  // angle for axis i: start at top, clockwise
  function angleFor(i) { return -Math.PI / 2 + (i / AXES.length) * TAU; }

  function pointAt(i, value) {
    var a = angleFor(i);
    return [CX + Math.cos(a) * R * value, CY + Math.sin(a) * R * value];
  }

  function polygonPath(values) {
    var d = "";
    for (var i = 0; i < values.length; i++) {
      var p = pointAt(i, values[i]);
      d += (i === 0 ? "M" : "L") + p[0].toFixed(2) + " " + p[1].toFixed(2) + " ";
    }
    return d + "Z";
  }

  function easeExpo(t) { return t === 1 ? 1 : 1 - Math.pow(2, -10 * t); }

  function build(container) {
    var svg = container.querySelector("[data-dna-svg]");
    if (!svg) return;
    svg.setAttribute("viewBox", "0 0 " + SIZE + " " + SIZE);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Flavour profile radar showing six taste dimensions.");
    svg.innerHTML = "";

    // --- grid rings (concentric hexagons) ---
    var gridG = el("g", { "class": "dna-grid" });
    [0.25, 0.5, 0.75, 1].forEach(function (ring) {
      var pts = [];
      for (var i = 0; i < AXES.length; i++) {
        var p = pointAt(i, ring);
        pts.push(p[0].toFixed(1) + "," + p[1].toFixed(1));
      }
      gridG.appendChild(el("polygon", {
        points: pts.join(" "),
        fill: "none",
        stroke: "var(--dna-grid, rgba(0,0,0,.12))",
        "stroke-width": ring === 1 ? 1.4 : 1
      }));
    });
    svg.appendChild(gridG);

    // --- axis spokes + labels ---
    var axisG = el("g", { "class": "dna-axes" });
    for (var i = 0; i < AXES.length; i++) {
      var end = pointAt(i, 1);
      axisG.appendChild(el("line", {
        x1: CX, y1: CY, x2: end[0].toFixed(1), y2: end[1].toFixed(1),
        stroke: "var(--dna-axis, rgba(0,0,0,.15))", "stroke-width": 1
      }));
      var a = angleFor(i);
      var lx = CX + Math.cos(a) * (R + 26);
      var ly = CY + Math.sin(a) * (R + 26);
      var anchor = Math.abs(Math.cos(a)) < 0.3 ? "middle" : (Math.cos(a) > 0 ? "start" : "end");
      var label = el("text", {
        x: lx.toFixed(1), y: ly.toFixed(1),
        "text-anchor": anchor, "dominant-baseline": "middle",
        "class": "dna-label", fill: "var(--dna-label, currentColor)"
      });
      label.textContent = AXES[i];
      axisG.appendChild(label);
    }
    svg.appendChild(axisG);

    // --- value shape ---
    var area = el("path", {
      d: polygonPath([0, 0, 0, 0, 0, 0]),
      fill: "var(--dna-fill, rgba(183,97,62,.18))",
      stroke: "var(--dna-stroke, #b7613e)",
      "stroke-width": 2, "stroke-linejoin": "round",
      "class": "dna-area"
    });
    svg.appendChild(area);

    var dotsG = el("g", { "class": "dna-dots" });
    var dots = [];
    for (var j = 0; j < AXES.length; j++) {
      var dot = el("circle", { r: 3.6, cx: CX, cy: CY,
        fill: "var(--dna-dot, #b7613e)", stroke: "var(--dna-dot-ring, transparent)", "stroke-width": 2 });
      dotsG.appendChild(dot);
      dots.push(dot);
    }
    svg.appendChild(dotsG);

    return { svg: svg, area: area, dots: dots };
  }

  function draw(parts, values) {
    parts.area.setAttribute("d", polygonPath(values));
    for (var i = 0; i < values.length; i++) {
      var p = pointAt(i, values[i]);
      parts.dots[i].setAttribute("cx", p[0].toFixed(2));
      parts.dots[i].setAttribute("cy", p[1].toFixed(2));
    }
  }

  function animate(parts, from, to, dur, done) {
    if (reduceMotion) { draw(parts, to); if (done) done(); return; }
    var start = performance.now();
    function frame(now) {
      var t = Math.min(1, (now - start) / dur);
      var e = easeExpo(t);
      var cur = to.map(function (v, i) { return from[i] + (v - from[i]) * e; });
      draw(parts, cur);
      if (t < 1) requestAnimationFrame(frame);
      else if (done) done();
    }
    requestAnimationFrame(frame);
  }

  function initOne(container) {
    var parts = build(container);
    if (!parts) return;

    var current = [0, 0, 0, 0, 0, 0];
    var titleEl = container.querySelector("[data-flavor-title]");
    var noteEl = container.querySelector("[data-flavor-note]");
    var buttons = Array.prototype.slice.call(container.querySelectorAll("[data-profile]"));
    var order = ["weekday", "sunday", "evening"];
    var activeKey = container.getAttribute("data-default") || "weekday";

    function setText(key) {
      var p = PROFILES[key];
      if (titleEl) titleEl.textContent = p.title;
      if (noteEl) noteEl.textContent = p.note;
    }

    function setActive(key) {
      buttons.forEach(function (b) {
        var on = b.getAttribute("data-profile") === key;
        b.classList.toggle("is-active", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      });
    }

    function go(key, immediate) {
      var target = PROFILES[key].values;
      activeKey = key;
      setActive(key);
      setText(key);
      if (immediate) { draw(parts, target); current = target.slice(); return; }
      var from = current.slice();
      animate(parts, from, target, 820);
      current = target.slice();
    }

    buttons.forEach(function (b) {
      b.addEventListener("click", function () { go(b.getAttribute("data-profile")); });
    });

    setText(activeKey);
    setActive(activeKey);

    // reveal-on-scroll: bloom outward the first time it enters view
    var seen = false;
    if ("IntersectionObserver" in window && !reduceMotion) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting && !seen) {
            seen = true;
            animate(parts, [0, 0, 0, 0, 0, 0], PROFILES[activeKey].values, 1100);
            current = PROFILES[activeKey].values.slice();
            io.disconnect();
          }
        });
      }, { threshold: 0.35 });
      io.observe(container);
    } else {
      go(activeKey, true);
    }

    // optional auto-demo: loop through profiles every ~3s until the user
    // takes over, at which point the cycle stops for good.
    if (container.hasAttribute("data-autocycle") && !reduceMotion) {
      var cycleIdx = Math.max(0, order.indexOf(activeKey));
      var cycleTimer = null;

      function stopCycle() {
        if (cycleTimer) { clearTimeout(cycleTimer); cycleTimer = null; }
      }

      function scheduleCycle() {
        cycleTimer = setTimeout(function () {
          cycleIdx = (cycleIdx + 1) % order.length;
          go(order[cycleIdx]);
          scheduleCycle();
        }, 3000);
      }

      buttons.forEach(function (b) { b.addEventListener("click", stopCycle); });

      function alreadyOnScreen() {
        var r = container.getBoundingClientRect();
        var vh = window.innerHeight || document.documentElement.clientHeight;
        return r.top < vh && r.bottom > 0;
      }

      if (alreadyOnScreen()) {
        scheduleCycle();
      } else if ("IntersectionObserver" in window) {
        var demoObs = new IntersectionObserver(function (e) {
          if (e[0].isIntersecting) {
            scheduleCycle();
            demoObs.disconnect();
          }
        }, { threshold: 0 });
        demoObs.observe(container);
      } else {
        scheduleCycle();
      }
    }
  }

  function init() {
    document.querySelectorAll("[data-flavor-dna]").forEach(initOne);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.FrescopaFlavorDNA = { init: init, profiles: PROFILES, axes: AXES };
})();
