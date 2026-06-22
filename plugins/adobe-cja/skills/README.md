# Skills Framework

## Overview

This folder contains the Adobe Customer Journey Analytics agent skills shipped with this plugin. Each skill packages instructions, references, and helper assets for a focused CJA analytics workflow. This README is for human maintainers; agents should start from each skill's `SKILL.md`.

## Skills inventory

| Name | Purpose | Status |
| --- | --- | --- |
| cja-kpi-pulse | KPI digest with period-over-period change, trend direction, and dimension breakdown. | Active |
| cja-top-movers-watchlist | Ranks dimension items by biggest gain or loss for a metric. | Active |
| cja-funnel-health-check | Step-by-step fallout analysis across a multi-step conversion funnel. | Active |
| cja-dimension-analysis | Cardinality, distribution, trends, anomalies, and data quality for a dimension. | Active |
| cja-segment-performance-comparator | Side-by-side KPI comparison across two or more audience segments. | Active |
| cja-executive-briefing | Narrative performance summary ready for leadership or QBR. | Active |

## Architecture

Each skill lives in `skills/<skill-name>/` and is organized as:

- `SKILL.md` — canonical skill entry point with frontmatter (`name`, `description`, `metadata`)
- `evals/` — sample prompts and expected outputs used to validate skill behavior
- `scripts/` — helper automation (Python) where the workflow benefits from deterministic processing

## Spec compliance

These skills follow the Agent Skills spec at [agentskills.io](https://agentskills.io/specification). In practice, that means each skill is centered on a `SKILL.md` file with YAML frontmatter and keeps supporting materials close by in standard subdirectories.

## Adding a new skill

1. Create a new directory at `skills/<new-skill-name>/`.
2. Add `SKILL.md` with the required frontmatter (`name`, `description`, `metadata.author`, `metadata.version`) and a phased workflow body.
3. Add `evals/evals.json` with at least one representative prompt and expected output.
4. Put deterministic automation in `scripts/` when needed; otherwise keep files local to the skill.
5. Check the finished layout against the Agent Skills spec before merging.
