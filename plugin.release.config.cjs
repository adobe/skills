// The release of one plugin. scripts/release-plugins.mjs runs semantic-release in the
// plugin's directory with this file as its configuration (--extends).
//
// The version is computed from the commits that touch the plugin, so a change to one of
// its skills releases the plugin too. It is written to the root plugin.json, the manifests
// and marketplace entries are built from that, and all of it is one commit.
//
// The plugin's CHANGELOG.md is written here too, from the same commits: one line for each,
// with its pull request. Nobody edits that file in a pull request (check-versions.mjs), so
// two pull requests to one plugin no longer conflict in it. What a change is about goes
// into the title and the description of its pull request. Claude Code
// keeps an installed plugin at its version until the version changes, so this is what
// brings a merged change to the people who installed the plugin.
const fs = require("fs");
const path = require("path");
const name = JSON.parse(fs.readFileSync(path.resolve("plugin.json"), "utf8")).name;
const scripts = path.resolve(__dirname, "scripts");

module.exports = {
  branches: ["main"],
  // a skill is tagged <folder>-v<version>; no skill has a slash in its name
  tagFormat: "plugin/" + name + "/v${version}",
  plugins: [
    [path.join(scripts, "path-filtered-analyzer.cjs"), {
      releaseRules: [
        { type: "docs", release: "patch" },
        { type: "refactor", release: "patch" },
        { type: "style", release: "patch" },
        { type: "perf", release: "patch" }
      ]
    }],
    [path.join(scripts, "path-filtered-notes-generator.cjs"), {}],
    // puts the notes of this release below the title, above what the file has
    ["@semantic-release/changelog", {
      changelogFile: "CHANGELOG.md",
      changelogTitle: "# Changelog"
    }],
    ["@semantic-release/exec", {
      prepareCmd: 'node "' + path.join(scripts, "prepare-plugin-release.mjs") + '" "${nextRelease.version}"'
    }],
    ["@semantic-release/github", {
      successCommentCondition: false,
      releasedLabels: false
    }],
    ["@semantic-release/git", {
      // prepare-plugin-release.mjs has staged the generated manifests and the marketplace
      // files, which lie outside this directory; they go into the same commit
      assets: ["plugin.json", "CHANGELOG.md"],
      message: "chore(release): " + name + " plugin v${nextRelease.version} [skip ci]"
    }]
  ]
};
