# Shared Skill Resources

## Purpose
Cross-skill shared resources used by multiple Adobe App Builder skills, including guardrails, validation scripts, and runtime references.

## Contents
- `categories/architecture-runtime.md` — Adobe I/O Runtime architecture reference covering constraints, runtimes, SDK services, and auth patterns.
- `references/appbuilder-manifest-guardrail.md` — Critical manifest structure guardrail with valid and invalid examples.
- `scripts/validate_manifest_structure.py` — Python validator for `app.config.yaml` manifest structure patterns.

## Usage
Skills reference these files with `../_shared/` relative paths from their own directories, for example `../_shared/references/appbuilder-manifest-guardrail.md`.

## Convention
This folder is intentionally shared across skills to avoid duplicating critical guardrails and reference material in each skill.