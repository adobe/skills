// Wraps @semantic-release/release-notes-generator with path filtering so the
// generated release notes / CHANGELOG entry only include commits that
// touched the current skill directory.
const { execFileSync } = require("child_process");

module.exports = {
  async generateNotes(pluginConfig, context) {
    const { generateNotes } = await import("@semantic-release/release-notes-generator");
    const { commits, lastRelease, logger } = context;

    try {
      const from = lastRelease && lastRelease.gitHead;
      const args = ["log", "--format=%H", "--", "."];
      if (from) args.splice(1, 0, `${from}..HEAD`);
      const out = execFileSync("git", args, { cwd: process.cwd(), encoding: "utf8" });
      const relevant = new Set(out.trim().split("\n").filter(Boolean));
      const filteredContext = {
        ...context,
        commits: commits.filter((c) => relevant.has(c.hash)),
      };
      return generateNotes(pluginConfig, filteredContext);
    } catch (err) {
      logger.warn(
        "path-filtered-notes-generator: git log failed, falling back to all commits: %s",
        err.message
      );
      return generateNotes(pluginConfig, context);
    }
  },
};
