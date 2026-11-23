# Repository restructuring: what to review (Branch I)

Read with [flow.md](flow.md).

Checked on 2026-11-15 with Repository Modernizer 1.2.3 on the public `aem-guides-wknd-legacy` sample, Maven 3.9.9 and JDK 21. The tool's output does not build as it is. After the findings below were worked through, and one legacy class was moved off an API that Cloud Service no longer has, `mvn clean install` built every module, with `all` embedding the packages and the bundles, and the AEM analyser reported no error.

## The plan

`plan.json` has two parts. `repositoryModernizer` is the tool's configuration, as [its README](https://github.com/adobe/aem-cloud-service-source-migration/tree/master/packages/repository-modernizer#configurations) describes it. `review` is what the script found; the tool does not read it.

| In `review` | Decide with the user | Where the answer goes |
|---|---|---|
| `appId` | It names `/apps/<appId>/osgiconfig` and `/apps/<appId>-packages`. The script proposes the app folder below `/apps`. | `projects[].appId` |
| `contentPackages` | Every legacy content package that is deployed must be listed: the tool moves the content of the listed ones only. | `projects[].existingContentPackageFolder` |
| `contentPackagesOutsideTheReactor` | A content package in a folder the reactor pom does not list. Ask whether it is deployed (index definitions and permissions often live in one). | Add it to `existingContentPackageFolder`, or leave it out |
| `bundles`, `testBundles` | Bundles are embedded in `all`. A test bundle is not: the script keeps those apart by their name. | `projects[].coreBundles` |
| `unsupportedRunModeFolders` | AEM as a Cloud Service reads `config`, `config.author`, `config.publish` and those with `.dev`, `.rde`, `.stage` or `.prod`, and ignores every other folder. The user says which of these each legacy folder becomes. Never guess: `config.qa` may be `config.stage` or `config.dev`. | `projects[].osgiFoldersToRename`, as `"/apps/<app>/config.qa": "config.stage"` |
| `modulesTheToolLeavesOut` | The tool writes a new reactor pom with its own modules only. These stay in the project and are not built until someone lists them again. | After the run: `<modules>` of the new `pom.xml` |
| `subProjects` | A reactor module with modules of its own. The tool takes it as a sub-project when the plan describes it. | `projects[].subProjects[]`, with the same keys as a project |

Folders that get the same new name are merged. When two of them hold the same PID, the tool keeps the first, leaves the other where it was and warns (`osgi-config-conflict`).

For several projects in one repository, add one entry to `projects` for each. The tool then puts `all`, `analyse` and the parent `pom.xml` next to the project folders.

## The findings

`run` prints them and writes them to `findings.json` next to the plan. The tool's own report is `target/project/repository-modernizer-report.md`; its log is `target/result.log`.

| Id | What it means | What to do |
|---|---|---|
| `bundle-version-missing` | `all/pom.xml` has a dependency with an empty `<version>`: the tool reads a bundle's own version, and most bundles inherit theirs. Maven refuses the whole project. | Set the bundle's version; `${project.version}` when the bundle has the reactor's. |
| `module-not-in-reactor` | The tool created `ui.apps.structure` and did not list it in the reactor. `ui.apps` depends on it. | Add `<module>ui.apps.structure</module>` before `ui.apps`. |
| `bundle-dependency-dropped` | A legacy package depended on the project's own bundle; the new `ui.apps` does not. The build compiles HTL scripts, and those that use the bundle's classes fail with `package … does not exist`. | Add the bundle as a dependency of `ui.apps` with scope `provided`. |
| `module-left-out` | The legacy reactor built modules that the new one does not list (integration tests, Dispatcher). | For each: list it again, or drop it. A Dispatcher module is converted by Branch E, not here. |
| `run-mode-unsupported` | `ui.config` has a folder Cloud Service ignores. The AEM analyser fails the build for one it can reorder (`Invalid runmode prod.author. Please use this runmode instead: author.prod`). | Decide the mapping (see the plan), set `osgiFoldersToRename`, run again. Values that differ per environment go to Cloud Manager variables: Branch A. |
| `osgi-config-conflict` | Two merged folders hold the same PID. | The user says which values apply. Delete the other file and its now-empty folder. |
| `osgi-config-not-converted` | A configuration in `ui.config` is not `.cfg.json`. Repoinit configurations are left as they are on purpose and are not reported. | Convert it with the user, with each value typed as AEM read the legacy file. |
| `libs-content` | The project deploys content under `/libs`, which is read-only in Cloud Service. The tool moves it to `ui.apps` unchanged. | Decide each item: overlay under `/apps`, or drop. |
| `oak-index` | The project deploys Oak index definitions. The tool moves them unchanged and allows them in `ui.apps.structure`. | Convert them with Branch F, as its own session. |
| `felix-build` | A bundle builds with `maven-scr-plugin` or `maven-bundle-plugin`. The tool changes bundles only to replace `uber-jar` with `aem-sdk-api`. | Hand to `code-assessment`: SCR annotations to OSGi DS, `bnd-maven-plugin`. |
| `third-party-dependency` | The tool's list of third-party dependencies. It is built from the group id alone and is wrong both ways. | Review the bundles' dependencies with the user, not only the list. Embed what AEM does not provide in `all`. |
| `build-versions` | The new parent pom comes from the tool's template, which is older than the current AEM Project Archetype. The AEM analyser version it sets fails against a current SDK (`Importing java.* packages not allowed`). | Update the AEM analyser and the AEM SDK API to current releases; review the others with the user. |
| `tool-warning` | Any other warning of the tool's log. | Read it with the user. |

## The build

`mvn clean install` after adopting. Tell these apart:

| The build stops with | It is | Do |
|---|---|---|
| `'dependencies.dependency.version' … is missing`, a module that is not found, `package … does not exist` in a generated HTL class | An open finding of this branch | Fix it here (see the table above) |
| `Invalid runmode`, or an analyser error about a configuration | An open run-mode or OSGi finding | Fix it here, or with Branch A |
| A compile error in a bundle or in Java below `jcr_root` (`cannot find symbol`), a failing unit test, an SCR plugin error | Legacy code that the Cloud Service API does not accept. The restructuring is not the cause. | Hand to Branch B or `code-assessment`, one pattern per session |
| `Node '/oak:index/…' is not contained in any of the filter rules` | An index definition the legacy filter never covered. FileVault validates this from plugin version 1.4.0 on; the tool's template has an older one. | If the user wants it deployed, add its root to the filter of `ui.apps`; then Branch F |

A build that stops in legacy code is the expected state of a legacy project after this branch, not a failure of it. Say which modules built and which hand-off each of the others needs.

## What the tool does not do

These are gaps of the tool. They belong in its issue tracker, <https://github.com/adobe/aem-cloud-service-source-migration/issues>, and are fixed there, not with code in this skill. Until then, the findings above cover them:

- It writes a copy and never changes the project; `adopt` copies the result over the project for a reviewable diff.
- Its own executor finds its templates only when it runs inside its package folder. The script calls the same functions with that folder as the base.
- It exits 0 after an error it logged. The script fails a run that logged an error or wrote no report.
- It does not touch a bundle's build (Felix plugins, Java level) or any Java code.
- It does not convert Dispatcher configurations or Oak index definitions: Branches E and F.
