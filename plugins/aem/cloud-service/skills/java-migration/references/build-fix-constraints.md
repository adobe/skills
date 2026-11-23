# Bounded build repair

The runner stops at the first failure and makes zero automatic repair attempts.
The agent may make at most **two** focused repair-and-rebuild attempts after
comparing the failing target build to the source baseline. Report each attempt,
its evidence, changed files, command, exit code and remaining failure.

Only fix failures caused by this migration. Stop for unresolved platform support,
external credentials/repositories, unrelated baseline failures, incompatible
third-party bundles, or a repair needing broader design decisions.

Never:

- Remove, disable, weaken or skip tests, package validation, analyser rules,
  code-quality gates or test coverage to produce a pass.
- Blanket-convert `javax.servlet` to `jakarta.servlet`, expand into general
  deprecated-API cleanup, change business behavior, or perform AEM platform migration.
- Advertise JavaSE-21 in bnd while compiling Java 25, force bundle resolution,
  downgrade bytecode silently or substitute a different target JDK.
- Add `net.bytebuddy.experimental` blindly or overwrite an existing Surefire
  `argLine`. Investigate the actual Mockito/Byte Buddy/JDK combination first;
  preserve agent arguments and append/late-evaluation behavior.
- Commit, push, create PRs, deploy, run pipelines, or obtain credentials without
  explicit user authorization.

On failure leave the diff intact for review. Do not reset the user's files.
The final report is mandatory even if no recipe ran or the process partially
modified the project. Nonzero exit codes and blocked checks are not success.
