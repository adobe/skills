# Repository restructuring: the five steps (Branch I, beta)

> **Beta**: This branch is in beta and under active development.
> Results should be reviewed carefully before use in production.
> Report issues at https://github.com/adobe/skills/issues

A legacy AEM Maven project to the package layout of AEM as a Cloud Service: `ui.apps` for code, `ui.apps.structure`, `ui.config` for OSGi configuration, `ui.content` for content, and the `all` container that embeds them and the bundles. No Java BPA pattern in this session.

Paths that start with `scripts/` are relative to the migration skill directory, the folder of `SKILL.md`.

If the user asks to **restructure the project for AEM as a Cloud Service**, to split a content package into code and content, to create `ui.config` or `all`, or mentions the **Repository Modernizer**, follow the **five steps**. Adobe's [Repository Modernizer](https://github.com/adobe/aem-cloud-service-source-migration/tree/master/packages/repository-modernizer) (`@adobe/aem-cs-source-migration-repository-modernizer` 1.2.3, installed on first run) makes the change. The skill prepares its configuration, runs it, checks its output and guides the review; it adds no transformation of its own. **Skip** Branch B.

Run this branch **before** the per-pattern branches: A expects `ui.config`, and the others expect the code in `ui.apps`. It needs Node.js and git; the build in step 5 needs Maven and JDK 11 or newer.

1. **Plan** — `node scripts/repo-modernizer-run.js plan <project>`. Read-only: it writes `<project>/target/repository-modernizer/plan.json`, a folder that ignores itself. The file holds the tool's configuration (`repositoryModernizer`) and what the script found for you to decide (`review`). If it prints `Layout: cloud`, the project already has the layout: STOP, unless the user says otherwise.
2. **Review the plan with the user — required. STOP here.** Show the user [the decisions](review.md#the-plan) the plan needs: the content packages, the bundles, the `appId`, and every run-mode folder Cloud Service ignores. Then end your turn and wait for the answer. Do not run step 3 in the turn in which you show the plan, also when the plan looks right to you and when nobody is there to answer: a run-mode mapping and the list of deployed packages are the user's to decide. With the answers, edit `plan.json`. The tool restructures exactly the content packages and bundles the plan names, and nothing else.
3. **Run** — `node scripts/repo-modernizer-run.js run <plan.json>`. The tool writes a restructured copy below the plan's folder; **the project is not changed.** Exit `0` = the tool finished and the findings are printed; `1` = the tool failed, and its output is not to be used; `2` = the plan is not ready, nothing ran. Never present a failed run as done.
4. **Work through the findings with the user** — each has an id, a place and a next step; [review.md](review.md#the-findings) says what each means. A finding about the plan (a run mode, a content package that was left out) is fixed in `plan.json` and by running again. A finding about the output is fixed in the output, under `target/repository-modernizer/target/project/src/`. Do not hide a finding: what the user decides to leave goes into the final report.
5. **Adopt and build** — only after the user has seen the findings and said to go on. This step changes the project; without that answer, STOP after step 4 and report the findings.
   1. Create a branch: `git checkout -b repo-modernize/<YYYY-MM-DD>-<short-sha>`.
   2. `node scripts/repo-modernizer-run.js adopt <plan.json>` copies the output over the project. It needs a clean working tree and prints the undo line. Modules the tool did not handle stay as they are.
   3. Review `git status` and `git diff --stat -M` with the user: content moved, nothing lost.
   4. Build with `mvn clean install`. [What a failure means](review.md#the-build): a problem of the restructuring is fixed here; a problem in legacy code goes to the branch or skill that owns it, as its own session.
   5. Report what was restructured, each finding and what became of it, and the hand-offs. Do not commit for the user.
