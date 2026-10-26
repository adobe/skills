#!/usr/bin/env node
// skills/reskin/scripts/deployed-gate.mjs — checks of a deployed reskin page on its aem.page branch preview. One CLI,
// steps in ./deployed/, the Figma helpers it shares with figma-gate.mjs in ./figma/:
//   preview  A0: the branch preview of the page: the project can have one, its authored form (.plain.html) and
//            delivered page answer 200, and the page keeps to its namespace in a shared repo (its path, and the
//            nav and footer metas of its head). Writes preview.json.
//   content  A1: the preview's text and images against the live source (dom-equality) and the content model slot by
//            slot (slot-coverage), with the page's declared deltas. Blocking unless the delta file says otherwise.
//   tokens   A2: the donor tokens asserted on the EDS DOM of the preview, through donor-probe.mjs. Blocking.
//   parity   A3: the preview held to the local reskin page with replica's instruments (stitch-shot, pixel-compare,
//            crop-compare, chrome-parity, cap-probe) at 1440 and 360. Blocking.
//   sanity   A4: the hard asserts on the preview at 1440 and 360 (overflow, decoration, broken images, page errors,
//            clip-probe, content-presence). Blocking and never waivable.
//   inherited  A5: deploy's delivered-page gates on the preview: the .plain.html asserts, ai-readability, qa-gate; the
//            pre-delivery gates are recorded as run by deploy. Blocking.
//   chrome   A6: the header and footer at 1440 and 360 against the mapped chrome (links, logo, text, menu toggle, no raw
//            icon words, no header covering main). Blocking and never waivable.
//   all      The whole leg in one run: content, tokens, parity, sanity, inherited, chrome in this process, then figma-gate
//            all --target preview as a child process when the page has a figma-checks file. One verdict line per
//            step, and summary.json with the ledger fragment for pages.<slug>.gates.deployed.
//   stamp    Whether summary.json's codeStamp still matches the project's code: current, or stale (re-run the leg).
// Writes go only under <dir>/.work/reskin/gates/<slug>/deployed/ (and, for the figma-gate child, its own figma-preview/).
// --help answers before any helper import, so it works even from a partial copy of the scripts.
// Exit codes: 0 pass, advisory or skipped · 1 a blocking check failed · 2 usage or setup · 3 bot challenge
// · 124 no verdict (re-run once, never a fix iteration). `all` reports the first present of 2, 3, 124, 1, 0.
import { existsSync, realpathSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
// figma-gate.mjs sits beside this script in both layouts (plugin tree and project copy).
const FIGMA_GATE = join(dirname(SELF), 'figma-gate.mjs');

export const HELP = `Usage:
  node deployed-gate.mjs preview --page <slug> --org <o> --repo <r> --branch <b> --path </ns/slug>
                         (--namespace <ns> | --sandbox) [--max-wait 120] [--dir stardust]
  node deployed-gate.mjs content --page <slug> [--dir stardust]
  node deployed-gate.mjs tokens --page <slug> [--dir stardust]
  node deployed-gate.mjs parity --page <slug> [--reskin <file>] [--dir stardust]
  node deployed-gate.mjs sanity --page <slug> [--reskin <file>] [--dir stardust]
  node deployed-gate.mjs inherited --page <slug> [--dir stardust]
  node deployed-gate.mjs chrome --page <slug> [--dir stardust]
  node deployed-gate.mjs all --page <slug> [--reskin <file>] [--dir stardust]
  node deployed-gate.mjs stamp --page <slug> [--dir stardust]

Checks of a deployed reskin page on its aem.page branch preview. Run preview first, then the checks one by one or all
at once; every step reads the record preview wrote and writes under <dir>/.work/reskin/gates/<slug>/deployed/.
The preview must be reachable without auth: a protected preview is out of scope.

preview  A0. Finds the preview and refuses a page that touches shared documents.
         Runs only in an aem-boilerplate project: stardust/runtime-contract.json (deploy's runtime probe),
         head.html and scripts/aem.js at the project root, the parent of --dir. Otherwise it prints
         "SKIPPED deployed leg: <reason>", records that and exits 0.
         Polls https://<branch>--<repo>--<org>.aem.page<path>.plain.html (<path>index.plain.html for a folder path,
         one that ends in /; a host label over 63 characters is a setup error: shorten the branch) every second until
         it answers 200, then the delivered page <path> the same way, at most --max-wait seconds in all (default 120;
         each request is cut off at the time left): no 200 is "ERROR (exit 124) preview: <path>[.plain.html] not 200
         after <n> s".
         A 401 or 403 says the preview is protected: exit 2 "the preview refused an anonymous request (HTTP 401): a
         protected preview is out of scope, make it reachable without auth", never polled until 124; a 404 or a page
         not authored yet still polls.
         Then, in a shared repo, the path must be a plain path (no %, \\, ., .. or empty segment) starting
         with /<ns>/, and the head of the delivered page must carry <meta name="nav"> and <meta name="footer">
         naming /<ns>/nav and /<ns>/footer (a full URL on the preview origin is the same path; EDS strips the
         metadata block from the authored form and emits head metas): "FAIL preview: <problem>" per finding, exit 1.
         --sandbox (a repo of one's own) waives both and is recorded; give --namespace or --sandbox, not both.
         Prints "PASS preview <url>" (with DEPLOY_VERIFY_ORIGIN set, "… (origin override: DEPLOY_VERIFY_ORIGIN, not the
         branch preview)"). Writes <dir>/.work/reskin/gates/<slug>/deployed/preview.json:
           { skipped?, reason?, url, origin, path, plain, namespace, sandbox, originOverride?, checkedAt, problems? }
content  A1. Checks the preview's content against the live source, through two gates run one after the other, each with the
         decoration settled first (--wait-eds): dom-equality (the text and images of the preview's main against the
         source page, <_provenance.url> and <_provenance.scope> of the content model, normalized by
         <dir>/reskin/normalize/<slug>.mjs when that file exists) and slot-coverage (the content model slot by slot,
         with the metadata). A Figma-sourced model (a Figma-only page, no live source) runs figma-text-gate in place
         of dom-equality (content-figma-text.json; content.json records figmaText). Reads preview.json (no record, or one with problems, is exit 2; a skipped leg prints
         "not run: skipped", exit 0), <dir>/reskin/content-model/<slug>/content-model.json (missing is exit 2) and,
         when it exists, the page's declared differences <dir>/reskin/deltas/<slug>.json, handed to both gates as
         --deltas. Without that file nothing is allowed for and a failed check blocks; with it, "blocking": false
         makes a failed check advisory and the key left out means true. Prints "PASS content", "ADVISORY content:
         <gate> …" (exit 0: a check failed, deltas.blocking is false) or "FAIL content: <gate> …" (exit 1) for each
         gate that failed, with the report and its findings, then one "WARNING unused delta <id>" per declared
         entry that matched nothing in either gate. Writes content-dom-equality.md, content-slot-coverage.md and
         content.json ({ verdict, domEquality: { exit, report }, slotCoverage: { exit, report }, unusedDeltas })
         beside preview.json. A gate that cannot run is exit 2 (a stalled decoration, an unreachable or protected
         page, an invalid delta file), 3 (a bot challenge) or 124 (no verdict).
tokens   A2. Asserts the donor tokens on the EDS DOM of the preview, through donor-probe.mjs (the decoration
         settled first, no overflow sanity): palette and type on body, main h1 and main h2, the primary button
         on main a.button.primary (the runtime contract's buttonClasses must name .button.primary), then each
         :root token of the block the reskin renders from the sheet, verbatim (the optional --card-*,
         --button-height, --section-padding-mobile and --gutter-mobile too, when the sheet carries them; the probe
         runs at 1440 only, so the mobile ones are asserted as :root values). Reads preview.json (no record, or
         one with problems, is exit 2; a skipped leg prints "not run: skipped", exit 0), the donor token sheet
         <dir>/reskin/donor-tokens.json and the runtime contract stardust/runtime-contract.json at the project
         root (missing either is exit 2). layout.sectionPaddingY, when the sheet carries it (a px length, else exit
         2), is asserted as the top and bottom padding of every non-empty main > .section, each within 16px (a
         failure names the match: "match 4 of 7: 80px"). layout.containerMaxWidth (measured by parity's
         cap-probe) is not asserted: it prints a SKIP line. Prints "PASS tokens n/n" or "FAIL tokens k/n" (k of the n
         assertions failing) plus one
         indented line per failing assertion (exit 1). Writes tokens-spec.json, tokens-probe.md,
         tokens-probe.json and tokens.json ({ verdict, exit, report, json, skipped }) beside preview.json. A probe that
         cannot run is exit 2 (a stalled
         decoration, an unreachable or protected page), 3 (a bot challenge) or 124 (no verdict).
parity   A3. Holds the preview to the local reskin page with replica's instruments, as shipped, at 1440 and 360.
         The reskin page (--reskin, default <dir>/reskin/pages/<slug>.html) is served by a local server for the
         run, its own directory, never file://. Reads preview.json (no record, or one with problems, is exit 2;
         a skipped leg prints "not run: skipped", exit 0) and needs replica's scripts beside the reskin ones
         (stitch-shot, pixel-compare, crop-compare, chrome-parity, cap-probe; and the diff skill's live-session).
         Per width, stitch-shot of both sides (--settle; the preview with --wait 3000 for the decoration), then:
           pixel          pixel-compare: differing pixels at most 10%
           height         |Δh| at most 5% of the reskin page's height (Δh = the preview's height − the reskin page's)
           section-height the reskin page's main section[data-slot] paired in order with the preview's non-empty
                          main > .section: the worst |Δh| at most 10% of its reskin section's height, naming the
                          slot; "n/a: section counts differ (reskin N, preview M)" when the counts differ
           header crop    crop-compare of the header band, at most 2%: the reskin page's measured header height
           footer crop    the same for the footer, counted from the bottom of each capture
         a crop is "n/a: reskin page renders no chrome" where the reskin page has no such element, and a FAIL,
         "preview renders no <header>", where only the preview has none. A header or footer the reskin page does
         not render at that width is left out of the preview's capture (stitch-shot --hide), so pixel and height
         compare main to main and their detail says what was excluded. At 1440 also:
           chrome-parity  computed-style parity of the regions the reskin page has: ADVISORY, never a FAIL
           cap-probe      the reskin page's content caps, captured to design.json, against the preview's: a
                          cap outside ±20px, or missing, is a FAIL
         A preview that answers HTTP 401 or 403 to this step's browser is exit 2 (a protected preview is out of
         scope), never rows. The step prints "PASS parity", or "FAIL parity" and one indented line per
         failing row (a finding of the instrument below it), then an "ADVISORY …" line per advisory row and one
         "n/a: <reason> (<rows>)" line per reason; "ERROR (exit 124) parity: <n> checks gave no verdict" and a line
         per row in error when an instrument gave no verdict (exit 124, 1 or another: re-run once). Writes
         parity.json ({ verdict, rows: [{ check, width, value, bar, status, artifact, detail }] }), the captures and
         diffs under parity/ and design.json beside preview.json. Exit 1 on a FAIL row, 3 on a bot challenge, 124
         on a row in error (the rows measured stay in parity.json).
sanity   A4. The hard asserts on the preview, at 1440 and 360. Never waivable: no delta file, no residual
         accepts a failure here. Reads preview.json (no record, or one with problems, is exit 2; a skipped
         leg prints "not run: skipped", exit 0) and needs the diff skill's scripts beside the reskin ones
         (measure-live, live-session, clip-probe, content-presence). In one Chromium launch, at each width, the
         preview is loaded, its decoration settled (--wait-eds semantics, 20 s) and read:
           overflow       scrollWidth − clientWidth of the document at most 4px
           decoration     body.appear, every data-section-status and every data-block-status "loaded";
                          a stall is named ("decoration: block cards")
           broken images  no <img> that is complete with no natural width, counted after one scroll pass
                          (lazy images load), among those with a box or in the viewport; none at all
           page errors    no uncaught error (pageerror) from the navigation until after the settle
         then, once, at 1440, as shipped (bundled Chromium):
           clip-probe         text or a control cut or hidden by an overflow ancestor of the preview: count 0
           content-presence   the reskin page (--reskin, default <dir>/reskin/pages/<slug>.html, served by a
                              local server for the run) against the preview: HIDDEN + MISSING headings and
                              links 0
         A page that answers HTTP 400 or more is a row in error, never a pass. The step prints "PASS sanity", or "FAIL sanity (hard)" and one indented line per failing row
         ("overflow 240px > 4px @360", the instrument's findings below it); "ERROR (exit 124) sanity: <n> checks
         gave no verdict" and a line per row in error when a check gave no verdict (an instrument exiting 124,
         1 or another, a page the browser could not load, or one that answered HTTP 400 or more, "HTTP <n> at
         <url>": an error page measures nothing about the page; re-run once). Writes sanity.json ({ verdict, hard: true, rows: [{ check, width, value, bar,
         status, artifact, detail }] }) and sanity/ (clip-probe-1440.json, content-presence-1440.json) beside
         preview.json. Exit 1 on a FAIL row, 3 on a bot challenge, 124 on a row in error (the rows measured stay
         in sanity.json).
inherited  A5. Deploy's own delivered-page gates, run on the preview. Reads preview.json (no record, or one with
         problems, is exit 2; a skipped leg prints "not run: skipped", exit 0) and needs the deploy skill's scripts
         beside the reskin ones (ai-readability, qa-gate). Rows, in order:
           .plain.html     the authored form (the record's plain URL) fetched directly: 200, exactly one <h1>, no
                           about:error, no src, srcset candidate or poster starting with /img/ (a repo-relative image
                           the ingester could not take) and a top-level <div> (the sections EDS delivers); each
                           problem is named. Tags and attribute values are read, never text that looks like them. A
                           5xx or 429 answer is no verdict (re-run once), a 404 or another answer a FAIL
           ai-readability  ai-readability.mjs on the preview's origin and path, --min 98: the page's code score
                           (its --json report); under 98 is "ai-readability <score> < 98", the blocks the served
                           HTML lacks most below it
           qa-gate         qa-gate.mjs on the delivered page with --schema <dir>/eds-schema/<slug>.json (deploy
                           Step 2b) and --design <deployed>/design.json (parity's cap-probe capture): its exit is
                           the verdict, its ✗ lines the findings. It runs on the inputs there are; one missing is a FAIL
                           ("incomplete: no eds-schema/<slug>.json (run deploy Step 2b)", "incomplete: no design.json
                           (run deployed-gate parity first)"), never a pass, with what qa-gate measured below it
           by deploy       localize-links --check, davids-model-lint and block-roundtrip --ew run in deploy's own
                           loop before the push and are not re-run: recorded as "by deploy", never PASS or FAIL,
                           and no part of the verdict
         HTTP 401 or 403 on the .plain.html is exit 2 (a protected preview is out of scope).
         Prints "PASS inherited", or "FAIL inherited" and one indented line per failing row (".plain.html: 2 <h1>",
         "ai-readability 97 < 98", the findings below it) and one "by
         deploy (<rows>)" line; "ERROR (exit 124) inherited: <n> checks gave no verdict" and a line per row in error when
         a check gave no verdict (no answer or a 5xx or 429 from the preview, an instrument exiting other than 0 or
         1, no score in ai-readability's report, no QA GATE line from qa-gate: re-run once). Writes inherited.json
         ({ verdict, rows: [{ check, value, bar, status, detail? }] }) and inherited/ (ai-readability.json,
         qa-gate.txt) beside preview.json. Exit 1 on a FAIL row, 3 on a bot challenge, 124 on a row in error (the
         rows measured stay in inherited.json).
chrome   A6. The header and footer every page inherits, at 1440 and 360. Never waivable, as sanity: no delta file,
         no residual accepts a failure here. The contract is <dir>/reskin/mapping.json's chrome record and the
         content model it names (its header and footer slots' links, images and, for the footer, headings,
         paragraphs and list items); a mapping without one makes the contract rows "n/a: no chrome in the
         mapping", a chrome record whose model is missing is exit 2. Each width, decoration settled, menu closed:
           header, footer   the element has a box and its blocks are decorated
           header logo, footer logo   a loaded image or svg ≥ 16px, when the mapped region has an image
           header height    ≤ 240px with the menu closed
           header/main      the header's content covers main by ≤ 4px and leaves a band ≤ 48px above it
           header links, footer links   every mapped link rendered and visible, compared by destination (the
                            source origin's links by path, a shared repo's /<ns> prefix aside)
           menu toggle      at 360, when a mapped header link is hidden closed: a header control whose click shows
                            them (aria-expanded "true" after, when it has the attribute)
           icon text        no icon-font ligature word (keyboard_arrow_right, expand_more …) as visible text
           footer text      every mapped footer text in the footer, case and spacing aside
         Prints "PASS chrome" or "FAIL chrome (hard)" and one indented line per failing row, the lost links below
         it. Writes chrome.json ({ verdict, hard: true, mapped, rows }) beside preview.json. Exit 1 on a FAIL
         row, 3 on a bot challenge, 124 on a row in error. A page that answers HTTP 400 or more is a row in error,
         never a pass.
all      The whole leg: content, tokens, parity, sanity, inherited and chrome in turn, each as above and in this process,
         then figma-gate.mjs all --target preview as a child process (the one beside this script) when
         <dir>/reskin/figma-checks/<slug>.json exists, else "ADVISORY figma not run: no figma checks". Reads
         preview.json once: no record, or one with problems, is exit 2, before any step starts; a skipped leg is one "ADVISORY <step> not
         run: skipped" line per step (figma included) and exit 0. First it deletes the previous content.json,
         tokens.json, parity.json, sanity.json, inherited.json, chrome.json and summary.json, so a stale file never feeds the
         ledger fragment. A setup error in a step (its own exit 2) stops the run with exit 2 and no summary.json,
         except a stalled decoration, "stalled decoration: <what>": the gate measured nothing because blocks of the
         preview never decorated, and that is the step's FAIL, "FAIL <step>: stalled decoration: <what>", with the
         run going on (sanity then records its own hard decoration FAIL).
         A step that throws anything else is "ERROR (exit 124) <step>: <message>" and the run goes on; a bot
         challenge (exit 3) in any step stops the rest: "ERROR (exit 3) <step> not run: bot challenge".
         The figma-gate child gets --url (the preview URL), --target preview, --reskin and --dir. Its exit maps the
         same way: 2 a setup error (exit 2, no summary.json), 3 an ERROR line, 124 an ERROR line unless the
         line is a stalled decoration ("<step> CRASH: stalled decoration: <what>", how figma-gate says a preview
         never decorated), which is FAIL figma as it is for the other steps, 1 FAIL, 0 PASS; an exit 0 or 1 that
         left no summary.json of the preview regime, or any other exit, is ERROR (exit 124).
         Prints one verdict line per step, in the order content, tokens, parity, sanity, inherited, chrome, figma, each
         matching run-bg's default verdict filter, with the step's findings indented below it:
           PASS <step>            FAIL <step> <k/n, or the failing gates or steps>      ERROR (exit N) <step>: <why>
           FAIL <step>: stalled decoration: <what>      a gate that stalled on the preview's decoration
           ADVISORY <step> …      an advisory content gate; not run: skipped, no figma checks
         then "summary written: <path>". Exit: the first present of 2, 3, 124, 1, 0.
         Writes <deployed>/summary.json:
           { _provenance, page, url, regime: "preview", originOverride?, steps: { <step>: { verdict, exit, detail } },
             codeStamp, ledgerFragment, invocation }
         ledgerFragment is what the agent copies to ledger.json pages.<slug>.gates.deployed:
           { regime: "preview", url, originOverride?, content, tokens, parity, sanity: { verdict, hard: true },
             inherited, chrome: { verdict, hard: true }, figma, codeStamp, invocation }
         codeStamp is sha256 (hex, first 16 characters) over the sorted relative paths and contents of the project
         root's blocks/, styles/, scripts/ (node_modules and .DS_Store ignored) and head.html, taken as the run starts.
         originOverride is preview.json's, { env: "DEPLOY_VERIFY_ORIGIN", origin }, and only when the measured origin
         was not the branch preview's.
         Each of content, tokens, parity, inherited and sanity's verdict is "PASS", "PASS (n/a: <checks>)" (it passed, but
         those checks were n/a: their reasons are in steps.<step>.detail), "FAIL k/n" (k of the n measured failing: gates
         for content, assertions for tokens, rows for the rest), "FAIL stalled decoration: <what>", "ADVISORY <gates>
         (deltas.blocking false)", "not run: <why>" or "ERROR (exit N): <why>"; figma is figma-gate's own
         ledgerFragment (its regime is "preview"), or one of those strings. sanity is never waivable: no delta file
         and no residual accepts its failure, nor chrome's. invocation is the exact argument list, so the line can be run again.
         Run it under run-bg when it may exceed a shell's limit (parity, sanity and the figma-gate child each drive
         a browser):
           node stardust/scripts/replica/run-bg.mjs start --name deployed-<slug> --dir stardust/.work/reskin/bg -- node stardust/scripts/reskin/deployed-gate.mjs all --page <slug>
           node stardust/scripts/replica/run-bg.mjs wait deployed-<slug> --dir stardust/.work/reskin/bg
stamp    Recomputes the code stamp of the project root (the parent of --dir) and compares it with summary.json's
         codeStamp: prints "current" (exit 0) or "stale: summary <a>, now <b>" (exit 1: a block, CSS or script changed
         after the run, so its evidence no longer stands: re-run all). No summary.json is exit 2.
--path         the page's delivered path, without .html (/ns/home)
--reskin <f>   the local reskin page parity holds the preview to, sanity's content-presence compares it with and
               all's figma-gate child measures against (default <dir>/reskin/pages/<slug>.html).
--waiver-budget <pct>  all only: passed to the figma-gate child, so the preview run allows the waiver budget the
               local figma-gate run used (figma-gate validates it).
--dir <d>      the stardust directory (default stardust).
DEPLOY_VERIFY_ORIGIN (environment) replaces the preview origin: a test hook, never a real preview. It is recorded:
               preview.json's originOverride, the "(origin override: …)" ending of the PASS preview line, and summary.json
               and the ledger fragment of all.

Evidence, all under <dir>/.work/reskin/gates/<slug>/deployed/: preview.json (preview); content.json,
content-dom-equality.md, content-slot-coverage.md; tokens.json, tokens-spec.json, tokens-probe.md,
tokens-probe.json; parity.json, parity/, design.json; sanity.json, sanity/; inherited.json, inherited/;
chrome.json; summary.json (all). The figma-gate child writes its own files under <dir>/.work/reskin/gates/<slug>/figma-preview/.
The tracked input is <dir>/reskin/deltas/<slug>.json.

Exit codes: 0 pass, advisory or skipped · 1 a blocking check failed · 2 usage or setup · 3 bot challenge
            · 124 no verdict: the preview never answered; re-run once, the same 124 twice is a
            residual (needs-owner), never a fix iteration. all reports the first present of 2, 3, 124, 1, 0.`;

const SPEC = {
  preview: {
    values: ['--page', '--org', '--repo', '--branch', '--path', '--namespace', '--max-wait', '--dir'],
    bools: ['--sandbox'],
    positional: [],
  },
  content: {
    values: ['--page', '--dir'],
    bools: [],
    positional: [],
  },
  tokens: {
    values: ['--page', '--dir'],
    bools: [],
    positional: [],
  },
  parity: {
    values: ['--page', '--reskin', '--dir'],
    bools: [],
    positional: [],
  },
  sanity: {
    values: ['--page', '--reskin', '--dir'],
    bools: [],
    positional: [],
  },
  inherited: {
    values: ['--page', '--dir'],
    bools: [],
    positional: [],
  },
  chrome: {
    values: ['--page', '--dir'],
    bools: [],
    positional: [],
  },
  all: {
    values: ['--page', '--reskin', '--dir', '--waiver-budget'],
    bools: [],
    positional: [],
  },
  stamp: {
    values: ['--page', '--dir'],
    bools: [],
    positional: [],
  },
};

// The name of an unknown flag, cut at the first character that cannot be part of one (`--flag=<value>`).
const flagName = (a) => a.match(/^--[\w-]+/)?.[0] ?? a;

export function parseArgs(argv, UsageError) {
  const [cmd, ...rest] = argv;
  if (!cmd) throw new UsageError(`no command\n${HELP}`);
  const spec = SPEC[cmd];
  if (!spec) throw new UsageError(`unknown command "${cmd}"\n${HELP}`);
  const opts = {};
  const positional = [];
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (spec.values.includes(a)) {
      const val = rest[i + 1];
      if (val === undefined || val.startsWith('--')) throw new UsageError(`${a} needs a value`);
      opts[a.slice(2)] = val;
      i += 1;
    } else if (spec.bools.includes(a)) opts[a.slice(2)] = true;
    else if (a.startsWith('--')) {
      const name = flagName(a);
      throw new UsageError(name === a ? `unknown flag ${a} for ${cmd}` : `unknown flag ${name} for ${cmd}: a flag and its value are separate arguments (${name} <value>)`);
    } else positional.push(a);
  }
  if (positional.length < spec.positional.length) throw new UsageError(`${cmd} needs ${spec.positional.join(' ')}`);
  if (positional.length > spec.positional.length) {
    throw new UsageError(`unexpected argument "${positional[spec.positional.length]}"`);
  }
  return { cmd, positional, opts };
}

// A partial copy of the scripts is a setup error with the fix, not a module stack trace.
async function helper(name, sub = 'deployed') {
  try { return await import(`./${sub}/${name}.mjs`); } catch (e) {
    if (e?.code !== 'ERR_MODULE_NOT_FOUND' || !String(e.message).includes(`${sub}/${name}.mjs`)) throw e;
    const err = new Error(`the ${sub}/ helpers are missing beside deployed-gate.mjs: copy the reskin scripts recursively (cp -R <plugin>/skills/reskin/scripts/. stardust/scripts/reskin/)`);
    err.code = 2;
    throw err;
  }
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

async function previewStep({ dir, opts, env, log, UsageError }) {
  for (const flag of ['page', 'org', 'repo', 'branch', 'path']) {
    if (!opts[flag]) throw new UsageError(`preview needs --${flag}`);
  }
  if (!NAME.test(opts.page)) throw new UsageError(`--page must be a slug (letters, digits, . _ -), got "${opts.page}"`);
  if (!opts.sandbox && !opts.namespace) throw new UsageError('preview needs --namespace <ns> or --sandbox: say whether the repo is shared');
  if (opts.sandbox && opts.namespace) throw new UsageError('--namespace and --sandbox exclude each other: --sandbox waives the namespace');
  if (opts.namespace && !NAME.test(opts.namespace)) throw new UsageError(`--namespace must be a single path segment, got "${opts.namespace}"`);
  if (!/^\/[^?#\s]*$/.test(opts.path)) throw new UsageError(`--path must start with / and hold no query or fragment, got "${opts.path}"`);
  if (/\.html$/.test(opts.path)) throw new UsageError(`--path is the delivered path without .html, got "${opts.path}"`);
  const maxWaitSec = opts['max-wait'] === undefined ? 120 : Number(opts['max-wait']);
  if (!Number.isInteger(maxWaitSec) || maxWaitSec < 1) throw new UsageError(`--max-wait needs a positive integer (seconds), got "${opts['max-wait']}"`);

  const { runPreview } = await helper('preview');
  try {
    const record = await runPreview({ dir, slug: opts.page, org: opts.org, repo: opts.repo, branch: opts.branch, path: opts.path, namespace: opts.namespace, sandbox: !!opts.sandbox, maxWaitSec, env });
    if (record.skipped) { log(`SKIPPED deployed leg: ${record.reason}`); return 0; }
    if (record.problems) { for (const p of record.problems) log(`FAIL preview: ${p}`); return 1; }
    log(`PASS preview ${record.url}${record.originOverride ? ` (origin override: ${record.originOverride.env}, not the branch preview)` : ''}`);
    return 0;
  } catch (e) {
    if (e?.code === 124) {
      log(`ERROR (exit 124) preview: ${e.message}`);
      log(`  last response: ${e.last}`);
      return 124;
    }
    throw e;
  }
}

// The slug of --page, a setup error when it is missing or not a slug (it becomes a directory name).
function pageSlug(step, opts, UsageError) {
  if (!opts.page) throw new UsageError(`${step} needs --page <slug>`);
  if (!NAME.test(opts.page)) throw new UsageError(`--page must be a slug (letters, digits, . _ -), got "${opts.page}"`);
  return opts.page;
}

// The record of `deployed-gate preview` for --page: the skipped one as it is (its .skipped is true), a ready one, never
// one with problems (a setup error).
async function readRecord(step, { dir, opts, UsageError }) {
  const slug = pageSlug(step, opts, UsageError);
  const { readPreview } = await helper('io');
  const preview = readPreview(dir, slug);
  if (!preview.skipped && preview.problems?.length) throw new UsageError(`preview has problems: run deployed-gate preview again (${preview.problems.length} recorded in preview.json)`);
  return preview;
}

// The record of `deployed-gate preview` for --page, or null once the leg is skipped (`not run: skipped`). Every step after
// preview starts here.
async function pageRecord(step, ctx) {
  const preview = await readRecord(step, ctx);
  if (preview.skipped) { ctx.log('not run: skipped'); return null; }
  return preview;
}

async function contentStep(ctx) {
  const { dir, opts, env, log } = ctx;
  const preview = await pageRecord('content', ctx);
  if (!preview) return 0;
  const { runContent } = await helper('content');
  const result = await runContent({ dir, slug: opts.page, preview, env });
  if (result.verdict === 'PASS') log('PASS content');
  for (const g of result.gates.filter((x) => x.exit === 1 || x.advisory)) {
    log(g.advisory ? `ADVISORY content: ${g.name} — report ${g.report} (deltas.blocking false: reported, not enforced)` : `FAIL content: ${g.name} — report ${g.report}`);
    for (const line of g.lines) log(`  ${line.trim()}`);
  }
  for (const id of result.unusedDeltas) log(`WARNING unused delta ${id}`);
  return result.verdict === 'FAIL' ? 1 : 0;
}

async function tokensStep(ctx) {
  const { dir, opts, env, log } = ctx;
  const preview = await pageRecord('tokens', ctx);
  if (!preview) return 0;
  const { runTokens } = await helper('eds-spec');
  const result = await runTokens({ dir, slug: opts.page, preview, env });
  log(result.verdict === 'PASS' ? `PASS tokens ${result.total}/${result.total}` : `FAIL tokens ${result.failures.length}/${result.total}`);
  for (const f of result.failures) log(`  ${f}`);
  for (const s of result.skipped) log(`SKIP ${s}`);
  return result.exit;
}

async function parityStep(ctx) {
  const { dir, opts, env, log } = ctx;
  const preview = await pageRecord('parity', ctx);
  if (!preview) return 0;
  const { runParity, parityLines } = await helper('parity');
  const result = await runParity({ dir, slug: opts.page, preview, reskinPage: opts.reskin, env });
  for (const line of parityLines(result)) log(line);
  return result.exit;
}

async function sanityStep(ctx) {
  const { dir, opts, env, log } = ctx;
  const preview = await pageRecord('sanity', ctx);
  if (!preview) return 0;
  const { runSanity, sanityLines } = await helper('sanity');
  const result = await runSanity({ dir, slug: opts.page, preview, reskinPage: opts.reskin, env });
  for (const line of sanityLines(result)) log(line);
  return result.exit;
}

async function inheritedStep(ctx) {
  const { dir, opts, env, log } = ctx;
  const preview = await pageRecord('inherited', ctx);
  if (!preview) return 0;
  const { runInherited, inheritedLines } = await helper('inherited');
  const result = await runInherited({ dir, slug: opts.page, preview, env });
  for (const line of inheritedLines(result)) log(line);
  return result.exit;
}

async function chromeStep(ctx) {
  const { dir, opts, log } = ctx;
  const preview = await pageRecord('chrome', ctx);
  if (!preview) return 0;
  const { runChrome, chromeLines } = await helper('chrome');
  const result = await runChrome({ dir, slug: opts.page, preview });
  for (const line of chromeLines(result)) log(line);
  return result.exit;
}

// ---- all: the whole leg in one run ---------------------------------------------------------------------------------------

const ALL_STEPS = ['content', 'tokens', 'parity', 'sanity', 'inherited', 'chrome', 'figma'];
// What a previous run left: the step records and the summary built from them (each step deletes its own evidence).
const STALE_RECORDS = ['content.json', 'tokens.json', 'parity.json', 'sanity.json', 'inherited.json', 'chrome.json', 'summary.json'];
const HEADLINE = /^(PASS|FAIL|ERROR \(exit \d+\)) /;
const ERROR_LINE = /^ERROR \(exit \d+\) /;
const MAX_WHY = 300;
const MAX_WHY_LINES = 10;

// What one step contributes to the run: `line` (its one verdict line), `detail` (the indented lines below it), `ledger` (its
// value in the ledger fragment), and `verdict` and `exit` (null: not run) for summary.json.
const outcome = (verdict, exit, line, ledger, detail = []) => ({ verdict, exit, line, ledger, detail });
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// run-bg's default verdict filter matches a lowercase "advisory", not ADVISORY, so the line carries both.
const advisoryLine = (text) => `ADVISORY ${text} — advisory, exit 0`;

function notRun(step, why, { challenge = false } = {}) {
  const ledger = `not run: ${why}`;
  return challenge ? outcome(ledger, null, `ERROR (exit 3) ${step} ${ledger}`, ledger) : outcome(ledger, null, advisoryLine(`${step} ${ledger}`), ledger);
}

// A step that threw: a bot challenge (code 3) or no verdict (anything else but a setup error).
function thrown(step, code, message) {
  const exit = code === 3 ? 3 : 124;
  const lines = message.split('\n').map((l) => l.trim()).filter(Boolean);
  const why = (lines[0] ?? 'no message').slice(0, MAX_WHY);
  return outcome('ERROR', exit, `ERROR (exit ${exit}) ${step}: ${why}`, `ERROR (exit ${exit}): ${why}`, lines.slice(1, MAX_WHY_LINES).map((l) => `  ${l}`));
}

// A stall is the leading words of a line, after the prefixes a gate puts on it ("[dom-equality] ", figma-gate's "join CRASH: ",
// "donor-probe at 1440px: "), never text that merely holds them.
const STALLED = /^(?:figma-gate: )?(?:\w+ CRASH: )?(?:donor-probe at \d+px: )?(?:\[[\w-]+\] )?stalled decoration: ([^\n]*)/m;

// A gate that exits 2 "stalled decoration: <what>", or figma-gate's exit 124 on that same line, measured nothing because blocks
// of the preview never decorated: that is the step's FAIL (what the deployed page did), not a setup error or no verdict. Null
// for any other message.
function stalled(step, message) {
  const what = STALLED.exec(message)?.[1].trim().slice(0, MAX_WHY);
  return what ? outcome('FAIL', 1, `FAIL ${step}: stalled decoration: ${what}`, `FAIL stalled decoration: ${what}`) : null;
}

function contentOutcome(result) {
  const names = (gates) => gates.map((g) => g.name).join(', ');
  const failed = result.gates.filter((g) => g.exit === 1);
  const soft = result.gates.filter((g) => g.advisory);
  const detail = [
    ...[...failed, ...soft].flatMap((g) => [`  ${g.name} — report ${g.report}`, ...g.lines.map((l) => `    ${l.trim()}`)]),
    ...result.unusedDeltas.map((id) => `  WARNING unused delta ${id}`),
  ];
  if (failed.length) return outcome('FAIL', 1, `FAIL content: ${names(failed)}`, `FAIL ${failed.length}/${result.gates.length}`, detail);
  if (soft.length) return outcome('ADVISORY', 0, advisoryLine(`content: ${names(soft)} failed, deltas.blocking is false`), `ADVISORY ${names(soft)} (deltas.blocking false)`, detail);
  return outcome('PASS', 0, 'PASS content', 'PASS', detail);
}

function tokensOutcome(result) {
  const detail = [...result.failures.map((f) => `  ${f}`), ...result.skipped.map((s) => `  SKIP ${s}`)];
  if (result.verdict === 'FAIL') {
    const fraction = `${result.failures.length}/${result.total}`;
    return outcome('FAIL', 1, `FAIL tokens ${fraction}`, `FAIL ${fraction}`, detail);
  }
  return outcome('PASS', 0, `PASS tokens ${result.total}/${result.total}`, 'PASS', detail);
}

// parity, sanity, inherited and chrome: the step's own lines, less their headline (the verdict line stands for it), indented.
function rowsOutcome(step, result, lines, heading = step) {
  const detail = lines.filter((l) => !HEADLINE.test(l)).map((l) => (l.startsWith(' ') ? l : `  ${l}`));
  const scored = result.rows.filter((r) => r.status === 'PASS' || r.status === 'FAIL');
  const fraction = `${scored.filter((r) => r.status === 'FAIL').length}/${scored.length}`;
  if (result.verdict === 'ERROR') {
    const why = `${plural(result.rows.filter((r) => r.status === 'ERROR').length, 'check')} gave no verdict`;
    return outcome('ERROR', 124, `ERROR (exit 124) ${step}: ${why}`, `ERROR (exit 124): ${why}`, detail);
  }
  if (result.verdict === 'FAIL') return outcome('FAIL', 1, `FAIL ${heading} ${fraction}`, `FAIL ${fraction}`, detail);
  return outcome('PASS', 0, `PASS ${step}`, passLedger(result.rows), detail);
}

// A step that passed with n/a rows says which checks were not measured; the reasons are in its detail.
function passLedger(rows) {
  const unmeasured = [...new Set(rows.filter((r) => r.status === 'n/a').map((r) => r.check))];
  return unmeasured.length ? `PASS (n/a: ${unmeasured.join(', ')})` : 'PASS';
}

// figma-gate all --target preview as a child process, its exit mapped as the other steps' are. Its ledgerFragment (the
// summary.json of the preview regime it wrote) is the step's ledger value; a setup error (its exit 2) stops the run.
async function figmaOutcome({ dir, slug, preview, reskin, env, figmaGate, UsageError, waiverBudget }) {
  const [{ childEnv, coded, firstLine, runChild }, { workDir }, { readJsonIf }] = await Promise.all([helper('child'), helper('io', 'figma-gate'), helper('io', 'figma')]);
  const summaryPath = join(workDir(dir, slug, 'preview'), 'summary.json');
  rmSync(summaryPath, { force: true });
  const args = [figmaGate, 'all', '--page', slug, '--url', preview.url, '--target', 'preview', '--reskin', reskin, '--dir', dir];
  if (waiverBudget !== undefined) args.push('--waiver-budget', waiverBudget);
  let r;
  try { r = await runChild(process.execPath, args, { env: childEnv(env) }); } catch (e) { throw coded(124, `figma-gate did not start: ${e.message}`); }
  const out = r.stdout;
  const err = r.stderr;
  const exit = r.status ?? r.signal;
  // figma-gate all names the step that ended without a verdict on an "ERROR (exit N) <step> …" line of stdout.
  const because = (out.split('\n').find((l) => ERROR_LINE.test(l))?.replace(ERROR_LINE, '') || firstLine(err) || firstLine(out)).trim();
  if (exit === 2) throw new UsageError(err.trim() || out.trim() || 'figma-gate exited 2');
  if (exit === 3) throw coded(3, because || 'figma-gate exited 3: bot challenge');
  if (exit === 124) {
    // figma-gate throws code 124 when the preview never decorates; it is the step's FAIL here, as it is for the other gates.
    const stall = stalled('figma', because);
    if (stall) return stall;
    throw coded(124, because || 'figma-gate exited 124: no verdict');
  }
  if (exit !== 0 && exit !== 1) throw coded(124, `figma-gate exited ${exit}${because ? `: ${because}` : ''}`);
  let summary = null;
  try { summary = readJsonIf(summaryPath); } catch { /* unreadable: no verdict, below */ }
  if (summary?.regime !== 'preview' || !summary.ledgerFragment) throw coded(124, `figma-gate exited ${exit} but wrote no summary.json for the preview run`);
  const fragment = summary.ledgerFragment;
  const detail = [...['join', 'geometry', 'ramp', 'pixel', 'register', 'coverage'].map((k) => `  ${k}: ${fragment[k]}`), `  report: ${join(workDir(dir, slug, 'preview'), 'register.md')}`];
  if (exit === 0) return outcome('PASS', 0, 'PASS figma', fragment, detail);
  const failing = ['join', 'geometry', 'ramp'].filter((k) => /^FAIL/.test(fragment[k])).map((k) => `${k} ${fragment[k]}`);
  return outcome('FAIL', 1, `FAIL figma${failing.length ? `: ${failing.join(', ')}` : ''}`, fragment, detail);
}

const shellWord = (a) => (/^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replaceAll("'", "'\\''")}'`);
// The argument list as it was given.
const invocationOf = (argv) => ['deployed-gate.mjs', ...argv.map(shellWord)].join(' ');

// runners and figmaGate let a test replace a step's run function and the figma-gate script.
async function allStep(ctx) {
  const { dir, opts, env, log, UsageError, argv, runners = {}, figmaGate = FIGMA_GATE } = ctx;
  const slug = pageSlug('all', opts, UsageError);
  const [{ deployedDir }, { provenance, writeJson }] = await Promise.all([helper('io'), helper('io', 'figma')]);
  const deployed = deployedDir(dir, slug);
  for (const f of STALE_RECORDS) rmSync(join(deployed, f), { force: true });

  const preview = await readRecord('all', ctx);
  if (!preview.skipped && (typeof preview.url !== 'string' || !preview.url)) throw new UsageError(`${join(deployed, 'preview.json')} has no url: run deployed-gate preview --page ${slug} again`);
  const reskin = opts.reskin ?? join(dir, 'reskin', 'pages', `${slug}.html`);
  const { codeStamp } = await helper('stamp');
  const stamp = codeStamp(dirname(resolve(dir)));

  let run = {};
  if (!preview.skipped) {
    const [{ runContent }, { runTokens }, { runParity, parityLines }, { runSanity, sanityLines }, { runInherited, inheritedLines }, { runChrome, chromeLines }] = await Promise.all([
      helper('content'), helper('eds-spec'), helper('parity'), helper('sanity'), helper('inherited'), helper('chrome'),
    ]);
    const base = { dir, slug, preview, env };
    const withPage = { ...base, reskinPage: opts.reskin };
    run = {
      content: async () => contentOutcome(await (runners.content ?? runContent)(base)),
      tokens: async () => tokensOutcome(await (runners.tokens ?? runTokens)(base)),
      parity: async () => { const r = await (runners.parity ?? runParity)(withPage); return rowsOutcome('parity', r, parityLines(r)); },
      sanity: async () => { const r = await (runners.sanity ?? runSanity)(withPage); return rowsOutcome('sanity', r, sanityLines(r), 'sanity (hard)'); },
      inherited: async () => { const r = await (runners.inherited ?? runInherited)(base); return rowsOutcome('inherited', r, inheritedLines(r)); },
      chrome: async () => { const r = await (runners.chrome ?? runChrome)(base); return rowsOutcome('chrome', r, chromeLines(r), 'chrome (hard)'); },
      figma: () => figmaOutcome({ ...base, reskin, figmaGate, UsageError, waiverBudget: opts['waiver-budget'] }),
    };
  } else log(`SKIPPED deployed leg: ${preview.reason}`);

  const recorded = {};
  const ledger = {};
  const exits = [];
  let challenged = false;
  for (const step of ALL_STEPS) {
    let result;
    if (preview.skipped) result = notRun(step, 'skipped');
    else if (challenged) result = notRun(step, 'bot challenge', { challenge: true });
    else if (step === 'figma' && !existsSync(join(dir, 'reskin', 'figma-checks', `${slug}.json`))) result = notRun(step, 'no figma checks');
    else {
      try { result = await run[step](); } catch (e) {
        if (e instanceof UsageError || e?.code === 2) {
          result = stalled(step, String(e.message ?? ''));
          if (!result) throw e;
        } else {
          result = thrown(step, e?.code, String(e?.message ?? e));
          challenged = result.exit === 3;
        }
      }
    }
    const { detail } = result;
    recorded[step] = { verdict: result.verdict, exit: result.exit, detail };
    ledger[step] = result.ledger;
    if (result.exit !== null) exits.push(result.exit);
    log(result.line);
    for (const line of detail) log(line);
  }

  const invocation = invocationOf(argv);
  const url = preview.url ?? null;
  const override = preview.originOverride ? { originOverride: preview.originOverride } : {};
  const ledgerFragment = { regime: 'preview', url, ...override, content: ledger.content, tokens: ledger.tokens, parity: ledger.parity, sanity: { verdict: ledger.sanity, hard: true }, inherited: ledger.inherited, chrome: { verdict: ledger.chrome, hard: true }, figma: ledger.figma, codeStamp: stamp, invocation };
  const readArtifacts = ['preview.json', 'content.json', 'tokens.json', 'parity.json', 'sanity.json', 'inherited.json', 'chrome.json'].filter((f) => existsSync(join(deployed, f)));
  const summary = {
    _provenance: provenance({ at: new Date().toISOString(), readArtifacts, note: 'deployed-gate.mjs all', writtenBy: 'stardust:reskin/deployed-gate.mjs' }),
    page: slug, url, regime: 'preview', ...override, steps: recorded, codeStamp: stamp, ledgerFragment, invocation,
  };
  writeJson(join(deployed, 'summary.json'), summary);
  log(`summary written: ${join(deployed, 'summary.json')} (its ledgerFragment is pages.${slug}.gates.deployed in ledger.json)`);
  // A setup error (exit 2) stopped the run above; of the rest the first present wins.
  return [3, 124, 1].find((c) => exits.includes(c)) ?? 0;
}

// stamp: summary.json's codeStamp against the project's code now. No summary is a setup error (exit 2).
async function stampStep({ dir, opts, log, UsageError }) {
  const slug = pageSlug('stamp', opts, UsageError);
  const [{ deployedDir }, { codeStamp }, { readJsonIf }] = await Promise.all([helper('io'), helper('stamp'), helper('io', 'figma')]);
  const path = join(deployedDir(dir, slug), 'summary.json');
  let summary = null;
  try { summary = readJsonIf(path); } catch (e) { throw new UsageError(`${path} is not valid JSON (${e.message}): re-run deployed-gate all --page ${slug}`); }
  if (!summary) throw new UsageError(`missing ${path}: run deployed-gate all --page ${slug} first`);
  const now = codeStamp(dirname(resolve(dir)));
  if (summary.codeStamp === now) { log('current'); return 0; }
  log(`stale: summary ${summary.codeStamp ?? 'none'}, now ${now}`);
  return 1;
}

// steps lets a test replace a step function; runners and figmaGate, `all`'s run functions and figma-gate script.
export async function main(argv, { env = process.env, log = console.log, warn = (m) => process.stderr.write(`${m}\n`), steps = {}, runners = {}, figmaGate = FIGMA_GATE } = {}) {
  if (argv.includes('--help') || argv.includes('-h')) { log(HELP); return 0; }
  const { UsageError } = await helper('errors', 'figma');
  const { cmd, opts } = parseArgs(argv, UsageError);
  const dir = opts.dir || 'stardust';
  const table = { preview: previewStep, content: contentStep, tokens: tokensStep, parity: parityStep, sanity: sanityStep, inherited: inheritedStep, chrome: chromeStep, all: allStep, stamp: stampStep, ...steps };
  return table[cmd]({ dir, opts, env, log, warn, UsageError, steps: table, argv, runners, figmaGate });
}

function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && SELF === safeRealpath(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
    console.error(`deployed-gate: ${String(e?.message ?? e)}`);
    process.exitCode = e?.exitCode ?? (Number.isInteger(e?.code) ? e.code : 124);
  });
}
