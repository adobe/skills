const path = require("path");
const root = path.resolve(__dirname, "../../..");
const pathFilteredAnalyzer = path.join(root, "scripts/path-filtered-analyzer.cjs");
const pathFilteredNotesGenerator = path.join(root, "scripts/path-filtered-notes-generator.cjs");

// No @semantic-release/npm until @adobe scope publish access is confirmed.
module.exports = {
  branches: ["main"],
  tagFormat: "web-cli-v${version}",
  plugins: [
    [pathFilteredAnalyzer, {
      releaseRules: [
        { type: "docs", release: "patch" },
        { type: "refactor", release: "patch" },
        { type: "style", release: "patch" },
        { type: "perf", release: "patch" }
      ]
    }],
    [pathFilteredNotesGenerator, {}],
    ["@semantic-release/changelog", { changelogFile: "CHANGELOG.md" }],
    ["@semantic-release/git", {
      assets: ["CHANGELOG.md", "package.json", "dist/web.mjs"],
      message: "chore(release): web-cli-v${nextRelease.version} [skip ci]"
    }],
    ["@semantic-release/github", {}]
  ]
};
