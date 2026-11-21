/* Fréscopa canon — chrome behaviour only (lifted from source app.js:
   initHeader thresholds 12 / 480 / ±4px, initNav, initYear). */
(function () {
  "use strict";

  function initHeader() {
    var header = document.querySelector("[data-header]");
    if (!header || header.classList.contains("header--solid")) return; // React types: no morph
    var noHide = header.classList.contains("header--app"); // React chrome: morph only, never hides
    var last = 0, ticking = false;
    function update() {
      var y = window.scrollY;
      header.classList.toggle("is-scrolled", y > 12);
      if (!noHide && y > 480 && y > last + 4) header.classList.add("is-hidden");
      else if (y < last - 4 || y < 480) header.classList.remove("is-hidden");
      last = y;
      ticking = false;
    }
    window.addEventListener("scroll", function () {
      if (!ticking) { requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
    update();
  }

  function initNav() {
    var toggle = document.querySelector("[data-nav-toggle]");
    var nav = document.querySelector("[data-nav]");
    if (!toggle || !nav) return;
    function set(open) {
      nav.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      document.documentElement.classList.toggle("nav-open", open);
    }
    toggle.addEventListener("click", function () { set(!nav.classList.contains("is-open")); });
    nav.addEventListener("click", function (e) { if (e.target.closest("a")) set(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") set(false); });
  }

  function initYear() {
    var y = new Date().getFullYear();
    document.querySelectorAll("[data-year]").forEach(function (e) { e.textContent = y; });
  }

  function init() { initHeader(); initNav(); initYear(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
