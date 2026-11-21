/* Fréscopa Atelier — home page client tools (lifted from source
   hero.js and app.js initCalendar). */
(function () {
  "use strict";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  /* Reveal, parallax and the flavour-DNA radar live in shared/widgets.js. */
  function whenOnScreen(el, fn) { window.FrescopaWidgets.whenOnScreen(el, fn); }

  /* ---- Hero copy positioning (hero.js): copy aligns to the product top ---- */
  function initHero() {
    var MOBILE = 760, GAP = 28, MIN_COL = 280, MAX_COL = 560;
    var heroes = document.querySelectorAll("[data-hero-art]");
    if (!heroes.length) return;
    function focal(str) {
      var p = (str || "50% 50%").trim().split(/\s+/);
      var f = function (v) { return v.indexOf("%") > -1 ? parseFloat(v) / 100 : parseFloat(v); };
      return { x: f(p[0]), y: f(p[1] != null ? p[1] : p[0]) };
    }
    function cover(iw, ih, cw, ch, fx, fy, nx, ny) {
      var scale = Math.max(cw / iw, ch / ih);
      var dw = iw * scale, dh = ih * scale;
      return { x: (cw - dw) * fx + nx * dw, y: (ch - dh) * fy + ny * dh };
    }
    function apply(hero) {
      var img = hero.querySelector("img[data-hero-product-top], img[data-hero-product-left]");
      if (!img) return;
      var rect = hero.getBoundingClientRect();
      var cw = rect.width, ch = rect.height;
      if (cw < MOBILE) {
        hero.style.removeProperty("--hero-copy-top");
        hero.style.removeProperty("--hero-copy-max");
        return;
      }
      var f = focal(img.getAttribute("data-hero-focal"));
      img.style.objectPosition = (f.x * 100) + "% " + (f.y * 100) + "%";
      var iw = img.naturalWidth || parseFloat(img.getAttribute("width")) || 1;
      var ih = img.naturalHeight || parseFloat(img.getAttribute("height")) || 1;
      var pTop = parseFloat(img.getAttribute("data-hero-product-top"));
      if (!isNaN(pTop)) {
        var y = cover(iw, ih, cw, ch, f.x, f.y, 0, pTop).y;
        hero.style.setProperty("--hero-copy-top", Math.max(0, Math.round(y)) + "px");
      }
      var pLeft = parseFloat(img.getAttribute("data-hero-product-left"));
      if (!isNaN(pLeft)) {
        var x = cover(iw, ih, cw, ch, f.x, f.y, pLeft, 0).x;
        var inner = hero.querySelector(".hero__inner") || hero;
        var ci = inner.getBoundingClientRect();
        var padL = parseFloat(getComputedStyle(inner).paddingLeft) || 0;
        var col = Math.max(MIN_COL, Math.min(MAX_COL, x - (ci.left + padL) - GAP));
        hero.style.setProperty("--hero-copy-max", Math.round(col) + "px");
      }
    }
    var run = function () { heroes.forEach(apply); };
    heroes.forEach(function (h) {
      var img = h.querySelector("img");
      if (img && !img.complete) img.addEventListener("load", run, { once: true });
    });
    run();
    var t;
    window.addEventListener("resize", function () { clearTimeout(t); t = setTimeout(run, 120); }, { passive: true });
  }



  /* ---- Mood-aware calendar → brew suggestion (app.js initCalendar) ---- */
  function initCalendar() {
    document.querySelectorAll("[data-calendar]").forEach(function (cal) {
      var days = Array.prototype.slice.call(cal.querySelectorAll("[data-day]"));
      if (!days.length) return;
      var out = cal.querySelector("[data-brew]") || cal;
      var titleEl = out.querySelector("[data-brew-title]");
      var noteEl = out.querySelector("[data-brew-note]");
      var tagEl = out.querySelector("[data-brew-tag]");
      function activate(day) {
        days.forEach(function (d) {
          var on = d === day;
          d.classList.toggle("is-active", on);
          d.setAttribute("aria-pressed", on ? "true" : "false");
        });
        if (titleEl && day.dataset.brewTitle) titleEl.textContent = day.dataset.brewTitle;
        if (noteEl && day.dataset.brewNote) noteEl.textContent = day.dataset.brewNote;
        if (tagEl && day.dataset.brewTag) tagEl.textContent = day.dataset.brewTag;
      }
      days.forEach(function (d) { d.addEventListener("click", function () { activate(d); }); });
      var initial = cal.querySelector("[data-day].is-active") || days[0];
      activate(initial);
      if (cal.hasAttribute("data-autocycle") && !reduce) {
        var idx = Math.max(0, days.indexOf(initial)), timer = null;
        var schedule = function () {
          timer = setTimeout(function () {
            idx = (idx + 1) % days.length;
            activate(days[idx]);
            schedule();
          }, 3000);
        };
        days.forEach(function (d) {
          d.addEventListener("click", function () { if (timer) { clearTimeout(timer); timer = null; } });
        });
        whenOnScreen(cal, schedule);
      }
    });
  }

  function init() { initHero(); initCalendar(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
