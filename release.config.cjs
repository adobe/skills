const path = require("path");
const pkg = require(path.resolve("package.json"));
const name = pkg.name;
const pathFilteredAnalyzer = path.resolve(__dirname, "scripts/path-filtered-analyzer.cjs");
const pathFilteredNotesGenerator = path.resolve(__dirname, "scripts/path-filtered-notes-generator.cjs");

module.exports = {
  branches: ["main"],
  tagFormat: name + "-v${version}",
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
    ["@semantic-release/changelog", {
      changelogFile: "CHANGELOG.md"
    }],
    ["@semantic-release/exec", {
      prepareCmd: 'bash "$(git rev-parse --show-toplevel)/scripts/prepare-release.sh" "$PWD" "${nextRelease.version}"'
    }],
    ["@semantic-release/github", {
      assets: [{ path: "*.skill", label: "Skill package" }],
      // A release would comment on and label every PR since the skill's last tag, and every
      // PR in the repository's history on its first release, related to the skill or not.
      successCommentCondition: false,
      releasedLabels: false
    }],
    ["@semantic-release/git", {
      assets: ["CHANGELOG.md", "SKILL.md"],
      message: "chore(release): " + name + "-v${nextRelease.version} [skip ci]"
    }]
  ]
};

