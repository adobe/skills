/* Fréscopa — shared widgets (replica). Cross-archetype client tools
   lifted from the source: scroll reveal + parallax (app.js initReveal /
   initParallax = React behaviors.jsx, identical) and the flavour-DNA
   radar (flavor-dna.js = React FlavourDNA.jsx). Every init is a no-op
   when its markup is absent. Exposes window.FrescopaWidgets.whenOnScreen
   for page scripts (home calendar).
   DNA options: data-default, data-autocycle (3 s loop once on screen,
   stops on a click), data-dna-intro="mount" (React FlavourDNA: grows
   from zero on mount, 820 ms) — default is the home variant (grows on
   first 35 % visibility, 1100 ms). */
(function () {
  "use strict";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---- Scroll reveal (app.js initReveal: .reveal → .is-in, threshold .14, once) ---- */
  function initReveal() {
    var els = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window) || reduce) {
      els.forEach(function (e) { e.classList.add("is-in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) { entry.target.classList.add("is-in"); io.unobserve(entry.target); }
      });
    }, { threshold: 0.14, rootMargin: "0px 0px -8% 0px" });
    els.forEach(function (e) { io.observe(e); });
  }

  /* ---- Subtle parallax (app.js initParallax; transform only) ---- */
  function initParallax() {
    var items = document.querySelectorAll("[data-parallax]");
    if (!items.length || reduce || matchMedia("(hover: none)").matches) return;
    var ticking = false;
    function update() {
      var vh = window.innerHeight;
      items.forEach(function (item) {
        var rect = item.getBoundingClientRect();
        var progress = (rect.top + rect.height / 2 - vh / 2) / vh;
        var amount = parseFloat(item.getAttribute("data-parallax")) || 24;
        item.style.transform = "translate3d(0," + (-progress * amount).toFixed(1) + "px,0)";
      });
      ticking = false;
    }
    window.addEventListener("scroll", function () {
      if (!ticking) { requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    update();
  }

  /* ---- Shared helper: start an auto-demo once the element is on screen ---- */
  function whenOnScreen(el, fn) {
    var r = el.getBoundingClientRect();
    var vh = window.innerHeight || document.documentElement.clientHeight;
    if (r.top < vh && r.bottom > 0) { fn(); return; }
    if (!("IntersectionObserver" in window)) { fn(); return; }
    var obs = new IntersectionObserver(function (e) {
      if (e[0].isIntersecting) { fn(); obs.disconnect(); }
    }, { threshold: 0 });
    obs.observe(el);
  }

  /* ---- Flavour DNA radar (flavor-dna.js): SVG morphs between profiles ---- */
  var AXES = ["Strength", "Body", "Sweetness", "Smoothness", "Warmth", "Crema"];
  var PROFILES = {
    weekday: { title: "The weekday cup", note: "Brisk and a little bolder. Enough to meet the day, never so much it rushes you.", values: [0.92, 0.62, 0.34, 0.5, 0.66, 0.82] },
    sunday: { title: "The slow Sunday", note: "Softer and rounder, made for lingering. It knows there is nowhere you need to be.", values: [0.58, 0.8, 0.6, 0.88, 0.84, 0.62] },
    evening: { title: "The after-dinner cup", note: "Gentle and sweet, half the strength. A quiet close to the evening, not a second start.", values: [0.34, 0.7, 0.78, 0.74, 0.9, 0.5] }
  };
  var SIZE = 420, CX = 210, CY = 206, R = 138, NS = "http://www.w3.org/2000/svg";

  function svgEl(name, attrs) {
    var node = document.createElementNS(NS, name);
    for (var k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  }
  function angleFor(i) { return -Math.PI / 2 + (i / AXES.length) * Math.PI * 2; }
  function pointAt(i, v) { var a = angleFor(i); return [CX + Math.cos(a) * R * v, CY + Math.sin(a) * R * v]; }
  function polygonPath(values) {
    var d = "";
    for (var i = 0; i < values.length; i++) {
      var p = pointAt(i, values[i]);
      d += (i === 0 ? "M" : "L") + p[0].toFixed(2) + " " + p[1].toFixed(2) + " ";
    }
    return d + "Z";
  }
  function easeExpo(t) { return t === 1 ? 1 : 1 - Math.pow(2, -10 * t); }

  function buildRadar(svg) {
    svg.setAttribute("viewBox", "0 0 " + SIZE + " " + SIZE);
    svg.innerHTML = "";
    var gridG = svgEl("g", { "class": "dna-grid" });
    [0.25, 0.5, 0.75, 1].forEach(function (ring) {
      var pts = [];
      for (var i = 0; i < AXES.length; i++) { var p = pointAt(i, ring); pts.push(p[0].toFixed(1) + "," + p[1].toFixed(1)); }
      gridG.appendChild(svgEl("polygon", { points: pts.join(" "), fill: "none", stroke: "var(--dna-grid, rgba(0,0,0,.12))", "stroke-width": ring === 1 ? 1.4 : 1 }));
    });
    svg.appendChild(gridG);
    var axisG = svgEl("g", { "class": "dna-axes" });
    for (var i = 0; i < AXES.length; i++) {
      var end = pointAt(i, 1), a = angleFor(i);
      axisG.appendChild(svgEl("line", { x1: CX, y1: CY, x2: end[0].toFixed(1), y2: end[1].toFixed(1), stroke: "var(--dna-axis, rgba(0,0,0,.15))", "stroke-width": 1 }));
      var anchor = Math.abs(Math.cos(a)) < 0.3 ? "middle" : (Math.cos(a) > 0 ? "start" : "end");
      var label = svgEl("text", {
        x: (CX + Math.cos(a) * (R + 26)).toFixed(1), y: (CY + Math.sin(a) * (R + 26)).toFixed(1),
        "text-anchor": anchor, "dominant-baseline": "middle", "class": "dna-label", fill: "var(--dna-label, currentColor)"
      });
      label.textContent = AXES[i];
      axisG.appendChild(label);
    }
    svg.appendChild(axisG);
    var area = svgEl("path", { d: polygonPath([0, 0, 0, 0, 0, 0]), fill: "var(--dna-fill, rgba(183,97,62,.18))", stroke: "var(--dna-stroke, #b7613e)", "stroke-width": 2, "stroke-linejoin": "round", "class": "dna-area" });
    svg.appendChild(area);
    var dotsG = svgEl("g", { "class": "dna-dots" }), dots = [];
    for (var j = 0; j < AXES.length; j++) {
      var dot = svgEl("circle", { r: 3.6, cx: CX, cy: CY, fill: "var(--dna-dot, #b7613e)", stroke: "var(--dna-dot-ring, transparent)", "stroke-width": 2 });
      dotsG.appendChild(dot); dots.push(dot);
    }
    svg.appendChild(dotsG);
    return { area: area, dots: dots };
  }
  function draw(parts, values) {
    parts.area.setAttribute("d", polygonPath(values));
    for (var i = 0; i < values.length; i++) {
      var p = pointAt(i, values[i]);
      parts.dots[i].setAttribute("cx", p[0].toFixed(2));
      parts.dots[i].setAttribute("cy", p[1].toFixed(2));
    }
  }
  function animate(parts, from, to, dur) {
    if (reduce) { draw(parts, to); return; }
    var start = performance.now();
    function frame(now) {
      var e = easeExpo(Math.min(1, (now - start) / dur));
      draw(parts, to.map(function (v, i) { return from[i] + (v - from[i]) * e; }));
      if (e < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function initDNA() {
    document.querySelectorAll("[data-flavor-dna]").forEach(function (box) {
      var svg = box.querySelector("[data-dna-svg]");
      if (!svg) return;
      var parts = buildRadar(svg);
      var current = [0, 0, 0, 0, 0, 0];
      var titleEl = box.querySelector("[data-flavor-title]");
      var noteEl = box.querySelector("[data-flavor-note]");
      var buttons = Array.prototype.slice.call(box.querySelectorAll("[data-profile]"));
      var order = ["weekday", "sunday", "evening"];
      var activeKey = box.getAttribute("data-default") || "weekday";
      function setText(key) {
        if (titleEl) titleEl.textContent = PROFILES[key].title;
        if (noteEl) noteEl.textContent = PROFILES[key].note;
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
        activeKey = key; setActive(key); setText(key);
        if (immediate) { draw(parts, target); current = target.slice(); return; }
        animate(parts, current.slice(), target, 820);
        current = target.slice();
      }
      buttons.forEach(function (b) { b.addEventListener("click", function () { go(b.getAttribute("data-profile")); }); });
      setText(activeKey); setActive(activeKey);
      if (box.getAttribute("data-dna-intro") === "mount" && !reduce) {
        go(activeKey);
      } else if ("IntersectionObserver" in window && !reduce) {
        var seen = false;
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
        io.observe(box);
      } else {
        go(activeKey, true);
      }
      if (box.hasAttribute("data-autocycle") && !reduce) {
        var idx = Math.max(0, order.indexOf(activeKey)), timer = null;
        var schedule = function () {
          timer = setTimeout(function () { idx = (idx + 1) % order.length; go(order[idx]); schedule(); }, 3000);
        };
        buttons.forEach(function (b) {
          b.addEventListener("click", function () { if (timer) { clearTimeout(timer); timer = null; } });
        });
        whenOnScreen(box, schedule);
      }
    });
  }

  function init() { initReveal(); initParallax(); initDNA(); }
  window.FrescopaWidgets = { whenOnScreen: whenOnScreen };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
