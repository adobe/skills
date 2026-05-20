// Wraps @semantic-release/commit-analyzer with path filtering so only commits
// touching the current skill directory influence the version bump decision.
// Without this, a breaking change in an unrelated skill would force a major bump here.
const { execSync } = require("child_process");

module.exports = {
  async analyzeCommits(pluginConfig, context) {
    const { analyzeCommits } = await import("@semantic-release/commit-analyzer");
    const { commits, lastRelease } = context;

    try {
      const from = lastRelease && lastRelease.gitHead;
      const range = from ? `${from}..HEAD` : "HEAD";
      const out = execSync(`git log ${range} --format=%H -- .`, {
        cwd: process.cwd(),
        encoding: "utf8",
      });
      const relevant = new Set(out.trim().split("\n").filter(Boolean));
      const filteredContext = {
        ...context,
        commits: commits.filter((c) => relevant.has(c.hash)),
      };
      return analyzeCommits(pluginConfig, filteredContext);
    } catch {
      return analyzeCommits(pluginConfig, context);
    }
  },
};
