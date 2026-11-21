/* Fréscopa journal-index — filter pills over the post cards (dynamic-features row 13).
   Mirrors the live component's setFilter state: one active pill (burgundy), "All posts"
   shows every card, a category pill shows only that category's cards (none for
   "The Atelier" — the featured story is not in the list). No animation on the cards. */
(function () {
  "use strict";
  function init() {
    var group = document.querySelector("[data-filter-pills]");
    var list = document.querySelector("[data-filter-items]");
    if (!group || !list) return;
    var pills = group.querySelectorAll("[data-filter]");
    var cards = list.querySelectorAll("[data-cat]");
    group.addEventListener("click", function (e) {
      var pill = e.target.closest("[data-filter]");
      if (!pill) return;
      var f = pill.getAttribute("data-filter");
      pills.forEach(function (p) {
        var on = p === pill;
        p.classList.toggle("is-active", on);
        p.setAttribute("aria-pressed", on ? "true" : "false");
      });
      cards.forEach(function (c) { c.hidden = !(f === "all" || c.getAttribute("data-cat") === f); });
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
