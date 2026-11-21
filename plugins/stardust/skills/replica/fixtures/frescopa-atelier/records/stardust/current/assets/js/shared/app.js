/* ============================================================
   FRÉSCOPA — shared page behaviour
   Vanilla JS, no dependencies. Progressive enhancement:
   everything renders without JS; this adds motion & interaction.
   ============================================================ */
(function () {
  "use strict";
  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---- Scroll reveal ---- */
  function initReveal() {
    var els = document.querySelectorAll(".reveal");
    if (!("IntersectionObserver" in window) || reduce) {
      els.forEach(function (e) { e.classList.add("is-in"); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-in");
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.14, rootMargin: "0px 0px -8% 0px" });
    els.forEach(function (e) { io.observe(e); });
  }

  /* ---- Header state on scroll ---- */
  function initHeader() {
    var header = document.querySelector("[data-header]");
    if (!header) return;
    var last = 0, ticking = false;
    function update() {
      var y = window.scrollY;
      header.classList.toggle("is-scrolled", y > 12);
      // hide when scrolling down past the hero, show when scrolling up
      if (y > 480 && y > last + 4) header.classList.add("is-hidden");
      else if (y < last - 4 || y < 480) header.classList.remove("is-hidden");
      last = y;
      ticking = false;
    }
    window.addEventListener("scroll", function () {
      if (!ticking) { requestAnimationFrame(update); ticking = true; }
    }, { passive: true });
    update();
  }

  /* ---- Mobile navigation ---- */
  function initNav() {
    var toggle = document.querySelector("[data-nav-toggle]");
    var nav = document.querySelector("[data-nav]");
    if (!toggle || !nav) return;
    function set(open) {
      nav.classList.toggle("is-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      document.documentElement.classList.toggle("nav-open", open);
    }
    toggle.addEventListener("click", function () {
      set(!nav.classList.contains("is-open"));
    });
    nav.addEventListener("click", function (e) {
      if (e.target.closest("a")) set(false);
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") set(false);
    });
  }

  /* ---- Mood-aware calendar → brew suggestion ---- */
  function initCalendar() {
    document.querySelectorAll("[data-calendar]").forEach(function (cal) {
      var days = Array.prototype.slice.call(cal.querySelectorAll("[data-day]"));
      // Output lives inside [data-brew]; scope the lookup there so it never
      // collides with the day buttons, which carry data-brew-* as their source.
      var out = cal.querySelector("[data-brew]") || cal;
      var titleEl = out.querySelector("[data-brew-title]");
      var noteEl = out.querySelector("[data-brew-note]");
      var tagEl = out.querySelector("[data-brew-tag]");
      if (!days.length) return;
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
      days.forEach(function (d) {
        d.addEventListener("click", function () { activate(d); });
      });
      var initial = cal.querySelector("[data-day].is-active") || days[0];
      activate(initial);

      // optional auto-demo: loop through days every ~3s until the user
      // takes over, at which point the cycle stops for good.
      if (cal.hasAttribute("data-autocycle") && !reduce) {
        var cycleIdx = Math.max(0, days.indexOf(initial));
        var cycleTimer = null;

        var stopCycle = function () {
          if (cycleTimer) { clearTimeout(cycleTimer); cycleTimer = null; }
        };

        var scheduleCycle = function () {
          cycleTimer = setTimeout(function () {
            cycleIdx = (cycleIdx + 1) % days.length;
            activate(days[cycleIdx]);
            scheduleCycle();
          }, 3000);
        };

        days.forEach(function (d) { d.addEventListener("click", stopCycle); });

        var alreadyOnScreen = function () {
          var r = cal.getBoundingClientRect();
          var vh = window.innerHeight || document.documentElement.clientHeight;
          return r.top < vh && r.bottom > 0;
        };

        if (alreadyOnScreen()) {
          scheduleCycle();
        } else if ("IntersectionObserver" in window) {
          var demoObs = new IntersectionObserver(function (e) {
            if (e[0].isIntersecting) {
              scheduleCycle();
              demoObs.disconnect();
            }
          }, { threshold: 0 });
          demoObs.observe(cal);
        } else {
          scheduleCycle();
        }
      }
    });
  }

  /* ---- Subtle parallax (transform only) ---- */
  function initParallax() {
    var items = document.querySelectorAll("[data-parallax]");
    if (!items.length || reduce || matchMedia("(hover: none)").matches) return;
    var ticking = false;
    function update() {
      var vh = window.innerHeight;
      items.forEach(function (item) {
        var rect = item.getBoundingClientRect();
        var mid = rect.top + rect.height / 2;
        var progress = (mid - vh / 2) / vh; // -1..1 roughly
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

  /* ---- Footer year ---- */
  function initYear() {
    var y = new Date().getFullYear();
    document.querySelectorAll("[data-year]").forEach(function (e) { e.textContent = y; });
  }

  /* ---- Hover-to-play video reveal (autoplays instead, below the mobile breakpoint) ---- */
  function initHoverVideo() {
    if (reduce) return; // respect prefers-reduced-motion: keep the still image only
    var isTouch = window.matchMedia("(max-width: 900px)").matches;
    document.querySelectorAll("[data-hover-video]").forEach(function (el) {
      var video = el.querySelector("video");
      if (!video) return;
      video.muted = true; // required for autoplay across browsers

      if (isTouch) {
        // no hover on mobile: crossfade in only once the clip actually starts,
        // so a blocked autoplay just leaves the still showing instead of a blank frame
        video.addEventListener("playing", function () { el.classList.add("is-playing"); }, { once: true });
        var auto = video.play();
        if (auto && auto.catch) auto.catch(function () {});
        return;
      }

      function start() {
        el.classList.add("is-playing");
        var p = video.play();
        if (p && p.catch) p.catch(function () {}); // ignore autoplay rejection
      }
      function stop() {
        el.classList.remove("is-playing");
        video.pause();
        video.currentTime = 0; // reset so the still and next hover always match frame one
      }
      el.addEventListener("mouseenter", start);
      el.addEventListener("mouseleave", stop);
    });
  }

  function init() {
    initReveal();
    initHeader();
    initNav();
    initCalendar();
    initParallax();
    initYear();
    initHoverVideo();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else { init(); }
})();
