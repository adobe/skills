# Conventions for this skill tree

## Beta skills

Skills that are not yet production-ready are marked with beta status using three mechanisms.
All three must be applied together. To check whether a skill is beta, look for `status: beta`
in its SKILL.md frontmatter.

1. **Frontmatter `status: beta`** -- machine-readable field for tooling
2. **`[BETA]` prefix in `description`** -- visible to the LLM during skill selection,
   followed by a caveat line: "This skill is in beta. Verify all outputs before
   applying them to production projects."
3. **Blockquote in body** -- visible to the LLM during skill execution:
   ```
   > **Beta Skill**: This skill is in beta and under active development.
   > Results should be reviewed carefully before use in production.
   > Report issues at https://github.com/adobe/skills/issues
   ```

When creating or modifying skills, preserve these markers. Do not remove beta
status without explicit instruction.
