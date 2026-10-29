# Migrate the Leadership Page

## Problem/Feature Description

Corvane Bio is migrating its corporate site from a legacy CMS to AEM Edge Delivery Services, authored in Google Docs by the communications team. You are migrating the "Our Leadership" page and defining the content model the communications team will use from now on. The team updates this page several times a year: executives join and leave, titles change, people get reordered when the org chart changes, and new hires sometimes don't have a headshot yet. The board of directors section has no photos at all.

The legacy page's HTML is in the input file. Reproduce the same content and visual intent (stats strip, executive grid, board grid) — the old CMS's markup and class names do not need to be kept.

## Output Specification

- Write `MODEL.md` showing how the whole page is authored in the document (default content and blocks, as text tables / markdown grids, with `---` for section breaks if used). Include the intro, the stats strip, at least two executives (one of them without a photo) and at least two board members. Follow with a 2–5 sentence rationale.
- Write the JavaScript for the block that renders the people grid at `blocks/<block-name>/<block-name>.js` (default-exported `decorate(block)`). CSS is not needed.

## Input Files

The following files are provided as inputs. Extract them before beginning.

=============== FILE: legacy/leadership.html ===============
<main class="page-leadership">
  <div class="page-intro">
    <h1>Our Leadership</h1>
    <p>Corvane's leadership team brings decades of experience in biologics, manufacturing and patient advocacy.</p>
  </div>

  <div class="stats-strip">
    <div class="stat"><span class="stat-value">1,200+</span><span class="stat-label">Employees</span></div>
    <div class="stat"><span class="stat-value">14</span><span class="stat-label">Countries</span></div>
    <div class="stat"><span class="stat-value">38</span><span class="stat-label">Clinical programs</span></div>
  </div>

  <h2 class="grid-title">Executive Team</h2>
  <div class="team-grid">
    <div class="team-member">
      <img class="member-photo" src="/media/okafor.jpg" alt="Ngozi Okafor">
      <span class="member-name">Ngozi Okafor</span>
      <span class="member-title">Chief Executive Officer</span>
      <span class="member-dept">Executive Office</span>
      <p class="member-bio">Ngozi joined Corvane in 2016 after leading global operations at Halcyon Pharma. She holds an MD from the University of Lagos.</p>
      <a class="member-linkedin" href="https://www.linkedin.com/in/ngoziokafor">LinkedIn</a>
      <a class="member-email" href="mailto:n.okafor@corvane.example">Email</a>
    </div>
    <div class="team-member">
      <img class="member-photo" src="/media/lindqvist.jpg" alt="Erik Lindqvist">
      <span class="member-name">Erik Lindqvist</span>
      <span class="member-title">Chief Scientific Officer</span>
      <span class="member-dept">Research &amp; Development</span>
      <p class="member-bio">Erik leads Corvane's research organization across three sites.</p>
      <p class="member-bio">Previously he was VP of Discovery at Norrland Biotech.</p>
      <a class="member-linkedin" href="https://www.linkedin.com/in/eriklindqvist">LinkedIn</a>
    </div>
    <div class="team-member">
      <img class="member-photo placeholder" src="/media/placeholder-person.png" alt="">
      <span class="member-name">Priya Raman</span>
      <span class="member-title">Chief Financial Officer</span>
      <span class="member-dept">Finance</span>
      <p class="member-bio">Priya joined in 2025 from Meridian Capital.</p>
      <a class="member-email" href="mailto:p.raman@corvane.example">Email</a>
    </div>
    <!-- 5 more executives with the same structure -->
  </div>

  <h2 class="grid-title">Board of Directors</h2>
  <div class="team-grid board">
    <div class="team-member">
      <span class="member-name">Dr. Helen Ward</span>
      <span class="member-title">Chair of the Board</span>
      <p class="member-bio">Former President, Ward Institute for Health Policy.</p>
    </div>
    <div class="team-member">
      <span class="member-name">Tomás Ibarra</span>
      <span class="member-title">Independent Director</span>
      <p class="member-bio">Partner, Ibarra &amp; Cole LLP.</p>
      <a class="member-linkedin" href="https://www.linkedin.com/in/tomasibarra">LinkedIn</a>
    </div>
    <!-- 2 more board members -->
  </div>
</main>
