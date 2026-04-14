const path = require("path");
const pkg = require(path.resolve("package.json"));
const name = pkg.name;

module.exports = {
  branches: ["main"],
  tagFormat: name + "-v${version}",
  plugins: [
    ["@semantic-release/commit-analyzer", {
      releaseRules: [
        { type: "docs", release: "patch" },
        { type: "refactor", release: "patch" },
        { type: "style", release: "patch" },
        { type: "perf", release: "patch" }
      ]
    }],
    "@semantic-release/release-notes-generator",
    ["@semantic-release/changelog", {
      changelogFile: "CHANGELOG.md"
    }],
    ["@semantic-release/exec", {
      prepareCmd: 'bash "$(git rev-parse --show-toplevel)/scripts/prepare-release.sh" "$PWD" "${nextRelease.version}"'
    }],
    ["@semantic-release/github", {
      assets: [{ path: "*.skill", label: "Skill package" }]
    }],
    ["@semantic-release/exec", {
      publishCmd: "if [ -f tile.json ]; then tessl skill publish . --workspace adobe; fi"
    }],
    ["@semantic-release/git", {
      assets: ["CHANGELOG.md", "SKILL.md"],
      message: "chore(release): " + name + "-v${nextRelease.version} [skip ci]"
    }]
  ]
};

