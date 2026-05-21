#!/usr/bin/env node
// One-shot script: rewrites every skill's CHANGELOG.md using path-filtered
// git history so only commits that actually touched that skill appear.
// Run from anywhere in the repo: node scripts/regenerate-changelogs.cjs

const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const REPO_URL = "https://github.com/adobe/skills";
const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

function parseSubject(subject) {
  const m = subject.match(/^(\w+)(\(([^)]+)\))?(!)?:\s*(.+)$/);
  if (!m) return null;
  return { type: m[1], scope: m[3] || null, breaking: !!m[4], msg: m[5] };
}

function tagDate(tag) {
  return execFileSync("git", ["log", "-1", "--format=%as", tag], {
    cwd: ROOT,
    encoding: "utf8",
  }).trim();
}

function pathCommits(from, to, relDir) {
  const args = ["log", "--format=%x00%H%x01%h%x01%s%x01%b%x01"];
  if (from) args.push(`${from}..${to}`);
  else args.push(to);
  args.push("--", relDir);

  const raw = execFileSync("git", args, { cwd: ROOT, encoding: "utf8" });
  return raw
    .split("\x00")
    .filter(Boolean)
    .map((block) => {
      const [hash, short, subject, body] = block.split("\x01");
      if (!hash?.trim()) return null;
      const parsed = parseSubject((subject || "").trim());
      const isBreaking =
        parsed?.breaking || (body || "").includes("BREAKING CHANGE:");
      return {
        hash: hash.trim(),
        short: short.trim(),
        subject: (subject || "").trim(),
        parsed,
        isBreaking,
      };
    })
    .filter((c) => c && c.hash);
}

function entry(c) {
  const scope = c.parsed?.scope ? `**${c.parsed.scope}:** ` : "";
  const msg = c.parsed?.msg || c.subject;
  return `* ${scope}${msg} ([${c.short}](${REPO_URL}/commit/${c.hash}))`;
}

function buildChangelog(skillName, history) {
  let out = "";
  for (let i = history.length - 1; i >= 0; i--) {
    const { version, tag, date, commits } = history[i];
    const prev = i > 0 ? history[i - 1].tag : null;

    const breaking = commits.filter((c) => c.isBreaking);
    const feats = commits.filter((c) => !c.isBreaking && c.parsed?.type === "feat");
    const fixes = commits.filter((c) => !c.isBreaking && c.parsed?.type === "fix");

    out += prev
      ? `# [${version}](${REPO_URL}/compare/${prev}...${tag}) (${date})\n\n`
      : `# ${version} (${date})\n\n`;

    if (breaking.length) {
      breaking.forEach((c) => (out += entry(c) + "\n"));
      out += "\n";
    }
    if (fixes.length) {
      out += "### Bug Fixes\n\n";
      fixes.forEach((c) => (out += entry(c) + "\n"));
      out += "\n";
    }
    if (feats.length) {
      out += "### Features\n\n";
      feats.forEach((c) => (out += entry(c) + "\n"));
      out += "\n";
    }
  }
  return out;
}

const skillDirs = execFileSync(
  "find",
  ["plugins", "-name", "CHANGELOG.md"],
  { cwd: ROOT, encoding: "utf8" }
)
  .trim()
  .split("\n")
  .map((p) => path.dirname(p));

const allTags = execFileSync("git", ["tag", "--sort=version:refname"], {
  cwd: ROOT,
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter(Boolean);

for (const relDir of skillDirs) {
  const skillName = path.basename(relDir);
  const tags = allTags.filter((t) =>
    new RegExp(`^${skillName}-v\\d`).test(t)
  );

  if (!tags.length) {
    console.log(`skip: ${skillName} (no tags)`);
    continue;
  }

  const history = tags.map((tag, i) => ({
    version: tag.slice(skillName.length + 2),
    tag,
    date: tagDate(tag),
    commits: pathCommits(i > 0 ? tags[i - 1] : null, tag, relDir),
  }));

  const changelog = buildChangelog(skillName, history);
  fs.writeFileSync(path.join(ROOT, relDir, "CHANGELOG.md"), changelog);
  console.log(
    `regenerated: ${relDir}/CHANGELOG.md (${history.length} release(s))`
  );
}
