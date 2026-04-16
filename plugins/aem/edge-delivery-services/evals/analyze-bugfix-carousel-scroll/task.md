# Testimonial Carousel iOS Safari Scroll Bug — Analyze and Plan

## Bug Report

On the AEM Edge Delivery Services site, the `testimonial-carousel` block has a scrolling issue on iOS Safari. When a user swipes to the next testimonial, the carousel sometimes snaps back to the first item instead of advancing. This only happens on iOS Safari (works fine on Chrome, Firefox, and desktop Safari). The block uses CSS scroll-snap for navigation. The issue was introduced after a recent CSS refactor that changed the carousel container from `overflow-x: auto` to `overflow-x: scroll`.

## Output Specification

Analyze this bug and produce structured acceptance criteria for the fix. Do NOT write any code or propose a solution.

