/* Fréscopa café — page client tools, mirroring what fires on live cafe.html (observed by probe).
   1. Location finder (dynamic-features row 13): one active region pill (burgundy) + free-text search
      over café name and city (trimmed, case-insensitive), combined with AND. The count line reads
      "N cafés near you" / "1 café near you" / "No matches"; zero results swap the list for a dashed
      "No cafés match “q”." note. No animation (live re-renders in place).
   2. Tour request (dynamic-features row 4, client-only): interest chips toggle (burgundy when on);
      submit validates in order café → date → time → name → email, one terracotta-deep message above
      the button; success replaces the form with a confirmation; "Book another tour" resets it. */
(function () {
  "use strict";

  function initFinder() {
    var root = document.querySelector("[data-finder]");
    if (!root) return;
    var input = root.querySelector("[data-finder-search]");
    var pills = root.querySelectorAll("[data-region]");
    var list = root.querySelector("[data-finder-list]");
    var count = root.querySelector("[data-finder-count]");
    var cards = list.querySelectorAll(".loc");
    var region = "all";
    var empty = document.createElement("div");
    empty.className = "finder__empty";
    empty.innerHTML = '<p class="finder__empty-title"></p><p class="finder__empty-text">Try a nearby city, or clear your search to see them all.</p>';

    function render() {
      var q = input.value.trim().toLowerCase();
      var n = 0;
      cards.forEach(function (c) {
        var hay = (c.querySelector(".loc__name").textContent + " " + c.querySelector(".loc__city").textContent).toLowerCase();
        var show = (region === "all" || c.getAttribute("data-region") === region) && (!q || hay.indexOf(q) !== -1);
        c.hidden = !show;
        if (show) n++;
      });
      if (n === 0) {
        var raw = input.value.trim();
        count.textContent = "No matches";
        empty.querySelector(".finder__empty-title").textContent = "No cafés match “" + raw + "”.";
        if (!empty.parentNode) list.appendChild(empty);
      } else {
        count.textContent = n + (n === 1 ? " café near you" : " cafés near you");
        if (empty.parentNode) empty.remove();
      }
    }
    root.addEventListener("click", function (e) {
      var pill = e.target.closest("[data-region]");
      if (!pill) return;
      region = pill.getAttribute("data-region");
      pills.forEach(function (p) {
        var on = p === pill;
        p.classList.toggle("is-active", on);
        p.setAttribute("aria-pressed", on ? "true" : "false");
      });
      render();
    });
    input.addEventListener("input", render);
  }

  function initTour() {
    var card = document.querySelector("[data-tour]");
    if (!card) return;
    var form = card.querySelector("[data-tour-form]");
    var submitWrap = form.querySelector(".tour-form__submit");
    var error = document.createElement("p");
    error.className = "tour-form__error";
    error.setAttribute("role", "alert");

    form.addEventListener("click", function (e) {
      var chip = e.target.closest(".chip");
      if (!chip) return;
      var on = chip.getAttribute("aria-pressed") !== "true";
      chip.setAttribute("aria-pressed", on ? "true" : "false");
      chip.classList.toggle("is-on", on);
    });

    function fail(msg) {
      error.textContent = msg;
      if (!error.parentNode) form.insertBefore(error, submitWrap);
    }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var f = {};
      form.querySelectorAll("[data-field]").forEach(function (el) { f[el.getAttribute("data-field")] = el; });
      var email = f.email.value.trim();
      if (!f.cafe.value) return fail("Please choose which café you’d like to visit.");
      if (!f.date.value) return fail("Please pick a date for your tour.");
      if (!f.time.value) return fail("Please choose a time slot.");
      if (!f.name.value.trim()) return fail("Please add your name.");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail("Please enter a valid email address.");
      if (error.parentNode) error.remove();
      var when = new Date(f.date.value + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
      var done = document.createElement("div");
      done.className = "tour-done";
      done.innerHTML =
        '<div class="tour-done__mark"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--burgundy)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12 5 5 9-10"/></svg></div>' +
        '<h3 class="tour-done__title"></h3><p class="tour-done__text"></p>' +
        '<p class="tour-done__note">We\'ve sent a confirmation to <strong></strong>. See you soon.</p>' +
        '<div class="tour-done__cta"><button class="btn btn--ghost" type="button">Book another tour</button></div>';
      done.querySelector(".tour-done__title").textContent = "You're on the list, " + f.name.value.trim() + ".";
      done.querySelector(".tour-done__text").textContent = "Your Atelier tour at " + f.cafe.value.split(" — ")[0] +
        " is requested for " + when + " at " + f.time.value + ", for " + f.guests.value.toLowerCase() + ".";
      done.querySelector("strong").textContent = email;
      done.querySelector("button").addEventListener("click", function () {
        form.reset();
        form.querySelectorAll(".chip").forEach(function (c) { c.setAttribute("aria-pressed", "false"); c.classList.remove("is-on"); });
        done.remove();
        form.hidden = false;
      });
      form.hidden = true;
      card.appendChild(done);
    });
  }

  function init() { initFinder(); initTour(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
