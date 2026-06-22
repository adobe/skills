# Generate DA-compliant block HTML

## Context

You have been asked to produce DA-uploadable HTML for a new "feature comparison" block on an EDS site. The block should display three feature cards side-by-side, each with a title, a short description, and a "Learn more" link.

The HTML will be uploaded to `https://admin.da.live/source/<org>/<repo>/products/compare.html` and previewed at `https://main--<repo>--<org>.aem.page/products/compare`.

## Output Specification

Produce the complete HTML content that will be the body of the `compare.html` file uploaded to DA. The HTML must follow all DA + EDS rules so that:

1. The pipeline accepts the upload without rejection.
2. The block is correctly identified by the EDS decorator and loads `/blocks/feature-comparison/feature-comparison.{js,css}`.
3. The three feature cards are authorable in the DA editor.
4. Page metadata (title and description) is captured for SEO.

Do NOT include any `<html>`, `<head>`, `<body>`, `<script>`, `<style>`, or inline `style=` attributes. Do NOT use absolute URLs for images unless they are reachable by the EDS preview infrastructure.

You may use placeholder text and a single reachable external image URL (`https://picsum.photos/seed/feature/600/400` is fine).
