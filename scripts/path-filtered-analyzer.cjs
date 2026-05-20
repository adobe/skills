// Wraps @semantic-release/commit-analyzer with path filtering so only commits
// touching the current skill directory influence the version bump decision.
// Without this, a breaking change in an unrelated skill would force a major bump here.
const { execFileSync } = require("child_process");

module.exports = {
  async analyzeCommits(pluginConfig, context) {
    const { analyzeCommits } = await import("@semantic-release/commit-analyzer");
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
      return analyzeCommits(pluginConfig, filteredContext);
    } catch (err) {
      logger.warn("path-filtered-analyzer: git log failed, falling back to all commits: %s", err.message);
      return analyzeCommits(pluginConfig, context);
    }
  },
};
