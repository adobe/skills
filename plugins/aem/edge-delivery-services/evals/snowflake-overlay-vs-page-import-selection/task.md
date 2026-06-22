# Overlay conversion vs. canonical block migration

## Context

A user provides the following prompt to the agent:

> I have a polished static landing page at https://example.com/promo built with Stardust. I want to publish it through AEM Edge Delivery Services so my marketing team can edit the copy and swap images in DA, but I do **not** want the existing animations, layout, or markup changed — the page should look exactly the same as the source. How do we do this?

The repo is an empty `adobe/aem-boilerplate` clone with no prior conversion work.

## Output Specification

Respond as the agent would. Your response must:

1. Identify which skill is the correct choice for this request.
2. Briefly explain *why* (one or two sentences) — what distinguishes this from a canonical EDS block migration.
3. Outline the high-level phases the chosen skill will execute, naming the phases.
4. State what the user needs to provide before the work can start.

Do NOT execute the conversion. Do NOT write any code. Do NOT modify any files. Produce a planning response only.
