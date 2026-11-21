/* Fréscopa product-catalog — family filter pills (dynamic-features row 13).
   Mirrors the live component's setFilter state: one active pill (burgundy); "All machines"
   shows every family band, a family pill shows only that band. Band backgrounds alternate
   by VISIBLE index (even = paper, odd = paper-2), so a lone band is always paper.
   No scrolling and no animation on the bands (live re-renders in place). */
(function () {
  "use strict";
  function init() {
    var group = document.querySelector("[data-filter-pills]");
    if (!group) return;
    var pills = group.querySelectorAll("[data-filter]");
    var bands = document.querySelectorAll("[data-band]");
    group.addEventListener("click", function (e) {
      var pill = e.target.closest("[data-filter]");
      if (!pill) return;
      var f = pill.getAttribute("data-filter");
      pills.forEach(function (p) {
        var on = p === pill;
        p.classList.toggle("is-active", on);
        p.setAttribute("aria-pressed", on ? "true" : "false");
      });
      var i = 0;
      bands.forEach(function (b) {
        var show = f === "all" || b.getAttribute("data-band") === f;
        b.hidden = !show;
        if (show) { b.classList.toggle("machine-band--alt", i % 2 === 1); i++; }
      });
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
