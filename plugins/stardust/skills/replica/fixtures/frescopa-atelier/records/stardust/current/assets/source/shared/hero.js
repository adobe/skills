/* ============================================================
   FRÉSCOPA — Art-directed hero
   Reads per-image metadata (added by analysing the photo) and
   composes the hero copy around the product: the copy aligns to
   the top of the appliance and never runs into it.

   Authoring (on the hero <img>, all optional):
     data-hero-focal="50% 44%"     object-position for the cover crop
     data-hero-product-top="0.20"  top of the product, 0–1 of image height
     data-hero-product-left="0.43" left of the product, 0–1 of image width

   The hero <section> is marked with data-hero-art. This script maps
   those normalised points through the object-fit: cover geometry to
   real pixels and sets two custom properties the CSS consumes:
     --hero-copy-top   vertical start of the copy (aligns to product top)
     --hero-copy-max   width of the clear column left of the product
   Recomputed on load, image decode, and resize.
   ============================================================ */
(function () {
  "use strict";

  var MOBILE = 760;      // below this, defer to the stacked CSS layout
  var GAP = 28;          // breathing room between copy and product (px)
  var MIN_COL = 280, MAX_COL = 560;

  function focal(str) {
    var p = (str || "50% 50%").trim().split(/\s+/);
    var f = function (v) { return v.indexOf("%") > -1 ? parseFloat(v) / 100 : parseFloat(v); };
    return { x: f(p[0]), y: f(p[1] != null ? p[1] : p[0]) };
  }

  // Map a normalised image point to rendered px under object-fit: cover.
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

    // On small screens, hand back to the stacked CSS layout.
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
      var col = x - (ci.left + padL) - GAP;
      col = Math.max(MIN_COL, Math.min(MAX_COL, col));
      hero.style.setProperty("--hero-copy-max", Math.round(col) + "px");
    }
  }

  function init() {
    var heroes = document.querySelectorAll("[data-hero-art]");
    if (!heroes.length) return;
    var run = function () { heroes.forEach(apply); };

    heroes.forEach(function (h) {
      var img = h.querySelector("img");
      if (img && !img.complete) img.addEventListener("load", run, { once: true });
    });
    run();

    var t;
    window.addEventListener("resize", function () {
      clearTimeout(t); t = setTimeout(run, 120);
    }, { passive: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }
})();
