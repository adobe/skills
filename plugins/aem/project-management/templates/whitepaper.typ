// Professional Whitepaper typst template for pandoc
// Usage: TYPST_FONT_PATHS=<fonts-dir> pandoc input.md -o output.pdf --pdf-engine=typst -V template=whitepaper.typ
//
// Fonts: Uses Source Sans 3 (open source, bundled) and Source Code Pro (bundled)
// Both fonts are from the Adobe Source font family, released under SIL Open Font License

#let conf(
  title: none,
  subtitle: none,
  authors: (),
  keywords: (),
  date: none,
  abstract: none,
  abstract-title: none,
  thanks: none,
  lang: "en",
  region: "US",
  margin: (:),
  paper: "a4",
  font: (),
  fontsize: 10pt,
  mathfont: (),
  codefont: (),
  linestretch: auto,
  sectionnumbering: none,
  pagenumbering: none,
  linkcolor: auto,
  citecolor: auto,
  filecolor: auto,
  cols: 1,
  doc,
) = {
  // Font stack: Source Sans 3 (bundled), with system fallbacks
  let main-font = ("Source Sans 3", "Helvetica Neue", "Arial")
  let code-font = ("Source Code Pro", "Menlo", "Courier New")

  // Accent color (professional blue)
  let accent-color = rgb("#0066cc")
  let text-dark = rgb("#2c2c2c")
  let text-medium = rgb("#333333")
  let text-light = rgb("#555555")

  // Page setup
  set page(
    paper: paper,
    margin: (top: 2.8cm, bottom: 2.5cm, left: 2.5cm, right: 2.5cm),
    header: context {
      if counter(page).get().first() > 1 {
        set text(size: 8pt, fill: rgb("#888888"), font: main-font)
        if title != none and subtitle != none {
          grid(
            columns: (1fr, 1fr),
            align(left)[#title],
            align(right)[#subtitle],
          )
        } else if title != none {
          align(left)[#title]
        }
      }
    },
    footer: context {
      if counter(page).get().first() > 1 {
        set text(size: 8pt, fill: rgb("#888888"), font: main-font)
        line(length: 100%, stroke: 0.4pt + rgb("#cccccc"))
        v(4pt)
        grid(
          columns: (1fr, 1fr),
          align(left)[
            #if date != none [#date]
          ],
          align(right)[Page #counter(page).display() of #counter(page).final().first()],
        )
      }
    },
  )

  // Base text
  set text(
    font: main-font,
    size: fontsize,
    fill: text-medium,
    lang: lang,
  )

  // Paragraph
  set par(
    leading: 0.75em,
    justify: true,
  )

  // Heading styles
  // H1: Black weight, tracking -20, leading 90%
  show heading.where(level: 1): it => {
    pagebreak(weak: true)
    v(0.3cm)
    block(
      below: 0.4cm,
      {
        set par(leading: 0.45em)
        text(size: 22pt, weight: "black", tracking: -0.02em, fill: text-dark, font: main-font, it.body)
      }
    )
  }

  // H2: Bold weight, tracking -20, leading 110%
  show heading.where(level: 2): it => {
    v(0.4cm)
    block(
      below: 0.3cm,
      {
        line(length: 100%, stroke: 0.75pt + accent-color)
        v(0.15cm)
        set par(leading: 0.55em)
        text(size: 15pt, weight: "bold", tracking: -0.02em, fill: text-dark, font: main-font, it.body)
      }
    )
  }

  // H3: Bold weight, tracking -20, leading 110%
  show heading.where(level: 3): it => {
    v(0.35cm)
    block(
      below: 0.2cm,
      text(size: 12.5pt, weight: "bold", tracking: -0.02em, fill: text-medium, font: main-font, it.body)
    )
  }

  // H4: Bold weight, tracking -20, leading 110%
  show heading.where(level: 4): it => {
    v(0.25cm)
    block(
      below: 0.15cm,
      text(size: 11pt, weight: "bold", tracking: -0.02em, fill: rgb("#444444"), font: main-font, it.body)
    )
  }

  // Code blocks
  show raw.where(block: true): it => {
    set text(size: 8pt, font: code-font)
    block(
      fill: rgb("#f5f5f5"),
      stroke: 0.5pt + rgb("#e0e0e0"),
      inset: 10pt,
      radius: 3pt,
      width: 100%,
      it,
    )
  }

  // Inline code
  show raw.where(block: false): it => {
    text(size: 8.5pt, font: code-font, it)
  }

  // Blockquotes
  show quote: it => {
    block(
      inset: (left: 12pt, top: 8pt, bottom: 8pt, right: 10pt),
      stroke: (left: 3pt + accent-color),
      fill: rgb("#f0f7ff"),
      radius: (right: 3pt),
      width: 100%,
      text(size: 9.5pt, fill: rgb("#444444"), it.body),
    )
  }

  // Tables - allow breaking across pages with proper text wrapping
  set table(
    inset: (x: 6pt, y: 7pt),
    stroke: 0.5pt + rgb("#dddddd"),
  )
  // Enable cell content to wrap and break
  set table.cell(breakable: true)
  show table.cell: it => {
    set text(hyphenate: true)
    set par(justify: false, leading: 0.55em)
    it
  }
  // Figure and table breakability
  show figure.where(kind: table): set figure.caption(position: top)
  show figure.where(kind: table): set block(breakable: true)
  show table: set block(breakable: true)
  show table: set text(size: 9pt)
  show table.cell.where(y: 0): set text(weight: "bold", fill: text-dark)

  // Links
  show link: it => {
    set text(fill: accent-color)
    it
  }

  // Lists
  set list(indent: 1em, body-indent: 0.5em)
  set enum(indent: 1em, body-indent: 0.5em)

  // Section numbering
  if sectionnumbering != none {
    set heading(numbering: sectionnumbering)
  }

  // Hide horizontal rules from markdown ---
  show line: it => {
    // Only hide standalone horizontal rules, not our styled lines
    if it.length == 100% and it.stroke.paint == black {
      none
    } else {
      it
    }
  }

  // ---- Title Page ----
  set par(justify: false)

  v(3cm)
  align(center)[
    #block(width: 80%)[
      // Title: Black weight
      #text(size: 30pt, weight: "black", tracking: -0.02em, fill: text-dark, font: main-font)[
        #if title != none [#title] else [Untitled Document]
      ]
      #v(0.6cm)
      #line(length: 40%, stroke: 2pt + accent-color)
      #v(0.6cm)
      #if subtitle != none {
        text(size: 17pt, fill: text-light, weight: "regular", font: main-font)[
          #subtitle
        ]
      }
      #v(1.5cm)
      #if date != none or authors.len() > 0 {
        text(size: 10.5pt, fill: rgb("#777777"), font: main-font)[
          #if date != none [*Date:* #date]
          #if authors.len() > 0 {
            linebreak()
            v(0.3cm)
            for author in authors [
              #author.name #if "affiliation" in author [-- #author.affiliation] \
            ]
          }
        ]
      }
    ]
  ]

  v(1fr)
  v(2cm)

  set par(justify: true)

  pagebreak()

  // ---- Table of Contents ----
  {
    set par(leading: 0.65em)
    text(size: 22pt, weight: "black", tracking: -0.02em, fill: text-dark, font: main-font)[Table of Contents]
    v(0.5cm)
    outline(indent: 1em, depth: 2, title: none)
  }

  pagebreak()

  // ---- Body ----
  if cols == 1 {
    doc
  } else {
    columns(cols, doc)
  }
}
