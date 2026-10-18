#!/usr/bin/env node
/**
 * skills/replica/scripts/presence.mjs
 *
 * Writes the site-wide hide list, `stardust/replica/presence.json` — the file every gate instrument merges
 * under a gate dir's own presence.json (live-session's mergePresence: the gate dir wins per key and field).
 * In-flow per-visitor regions (a geo-IP location bar above the header, a member strip) cannot be dismissed;
 * they reach the captures and the probes only through a `hide` list. A recorded hands-off run named such a
 * region and its selector in prose, nothing wrote the selector into the file, and the gate never hid it —
 * this script is that link.
 *
 *   add      the preserve-direction step records a region it identified: the selector(s) are appended to
 *            `"*".hide` (every page) or, with --slug, to `<slug>.hide` (that page only). With --verify <url>
 *            the selectors are checked on the live page first: a selector that matches nothing there is refused
 *            (exit 2, nothing written) — a recorded hands-off run carried a bar selector that matched nothing on
 *            the live page while the real element was the first body-level in-flow block above the header.
 *            The same call records the page's other CAPTURE SETTINGS, so a roster re-gate takes the captures the
 *            run took (a recorded hands-off run pinned a rotating hero with a --dismiss flag and accepted two clip
 *            findings in prose — an independent re-gate could not reproduce either): --dismiss <sel,…> (extra
 *            overlay closers, the key's `dismiss`), --pin <sel> --state <label> (a rotator control clicked after the
 *            freeze — the state it pins, `pin: [{ sel, state }]`) and --allow <kind>=<selector> (`allow: [{ kind,
 *            selector, reason }]`, kinds ALLOW_KINDS: `clip` — counted clip findings under the selector do not count;
 *            `per-visitor-dialog` — a dialog left open whose container the page hides is no INCONCLUSIVE row; refused
 *            unless the container is in the page's hide list, this call's --hide included). --verify polls every
 *            selector of the call; --allow needs --reason. gate-all, gate.sh and stitch-shot (--slug) read them
 *            (captureSettings, clipAllowed — exported, pure). A refused --verify also lists, read on the same loaded
 *            page (no second navigation), the top three candidates of each missed selector's kind, each with the
 *            exact add command (Output) — a recorded hands-off run, refused on a guessed accept-button selector on a
 *            site with a consent manager, walked the DOM by hand for 14 minutes to find the real one.
 *   seed     Setup writes the runner's overlay selectors into `"*".hide`: run.json `siteOverlays` (an array of
 *            selectors) and the env STARDUST_SITE_OVERLAYS (a comma list), in that order. No browser.
 *   suggest  lists the candidates read off the live page's DOM — the in-flow blocks above the header
 *            (live-session's inFlowRegionsAboveHeader), where a per-visitor location bar sits — and checks the
 *            presence file's `"*".hide` on the same page: a selector there that matches nothing is warned on
 *            (never a refusal, exit 0). Writes nothing. --kind dismiss / pin lists the overlay / rotator CONTROL
 *            candidates instead, the top three as a refused add --verify prints them (--kind hide, the default: the
 *            output above, unchanged).
 *
 * Usage:
 *   node stardust/scripts/replica/presence.mjs add [--hide <sel[,sel…]>] [--dismiss <sel[,sel…]>] [--pin <sel> --state <label>]
 *        [--allow <kind>=<selector>] [--slug <s>] [--reason <R-nn>] [--file <f>] [--verify <url> [--wait-ms 5000] [--width 1440] [--headed]]
 *   node stardust/scripts/replica/presence.mjs seed [--run stardust/.labs/run.json] [--file <f>]
 *   node stardust/scripts/replica/presence.mjs suggest <url> [--width 1440] [--wait-ms 5000] [--headed] [--file <f>] [--kind hide|dismiss|pin]
 *
 *   --hide <sel,…>   selectors to append (repeatable; each value a comma list)
 *   --dismiss <sel,…> extra overlay closers for the key's `dismiss` (repeatable; comma lists), clicked by both stitches
 *   --pin <sel>      one rotator control per call, clicked after the freeze on both sides; --state <label> names the
 *                    state it pins (required; the same selector's state is replaced)
 *   --allow <k>=<s>  an allowance { kind, selector, reason } (repeatable; split at the first '='; kinds clip,
 *                    per-visitor-dialog; needs --reason; the same kind + selector gets the new reason)
 *   --slug <s>       write the `<s>` entry instead of `"*"`
 *   --reason <R-nn>  the residual id (`R-<digits>`) recorded as `reasons[<sel>]` for every hide / dismiss / pin
 *                    selector of the call (a different earlier reason is replaced) and as each allowance's reason
 *   --verify <url>   add: before writing, load the http(s) page and poll each selector of the call for up to
 *                    --wait-ms after the settle; every one must match at least once
 *   --wait-ms <n>    add --verify, suggest: the poll window in ms (default 5000; 0 = one look after the settle)
 *   --width <px>     add --verify, suggest: the viewport width (default 1440; height 900)
 *   --headed         add --verify, suggest: the stealth real-Chrome tier (live-session launchStealthHeaded,
 *                    with the challenge-solve window) — for a bot-managed site that challenged the default tier
 *   --run <f>        the runner's run file (default stardust/.labs/run.json); a missing file seeds nothing
 *   --file <f>       the presence file (default stardust/replica/presence.json, relative to the cwd = the
 *                    project root); created with its directory when missing (suggest only reads it)
 *   --kind <k>       suggest: whose candidates — hide (default), dismiss or pin (SUGGEST_KINDS)
 *
 * The live page is opened the way the gate's live instruments open it (live-session.mjs): newLiveContext
 * (real-Chrome UA + document-only headers), gotoLive (the default waitUntil, settle 2500 ms on a live site,
 * 1200 ms on a local one; a bot challenge or an HTTP error is never measured), dismissOverlays (the late-modal
 * window on a live site), then one scroll through the page and back to the top. add --verify then polls
 * every 250 ms until each selector of the call matched at least once or --wait-ms passed (a block a geo lookup
 * renders late is found when it arrives); a selector the query refuses counts 0. suggest polls the presence
 * file's `"*".hide` the same way (none listed, or the file missing: no poll), then reads the candidates (a 0-px
 * wrapper is listed: a block that grows later is still hidden by the persistent display:none !important rule).
 *
 * File shape (a gate dir's presence.json shape): `{ "*": { "hide": [<sel>, …], "dismiss": [<sel>, …], "pin": [{ "sel",
 * "state" }], "allow": [{ "kind", "selector", "reason" }], "reasons": { "<sel>": "<R-nn | seeded: …>" } }, "<slug>":
 * { "hide": […], "main": …, "variable": […] } }`. Readers ignore `reasons`. The key's list is extended in order and de-duplicated with live-session's parseHideList (each
 * stored entry may be a comma list; trimmed; empty dropped); when it changes it is stored as one selector per
 * array item (a stored comma-list string is split — same selectors, same order). seed records
 * `seeded: run.json siteOverlays` or `seeded: STARDUST_SITE_OVERLAYS` (run.json first when both name a
 * selector) for the selectors it appends; a selector already in the list keeps its reason, or none. Other
 * top-level keys and the entry's other fields are left as they are; a new key or field is appended. No
 * change → the file is not rewritten. Writes are atomic (`<file>.<pid>.tmp` + rename), JSON indent 2 plus a
 * trailing newline, no timestamps — the same inputs give the same bytes. Reads nothing but the presence file,
 * the run file, STARDUST_SITE_OVERLAYS and — suggest, add --verify — the page at the URL.
 *
 * Output (stdout): add --verify first prints `verified on <url> @ <w>px: <sel> ×<n>, …` (the highest match
 * count seen). add / seed: `<key>.hide: <sel>, <sel>` — the key's resulting list (`*.hide: …` for "*"); add also
 * `<key>.dismiss: …`, `<key>.pin: <sel> → <state>, …`, `<key>.allow: <kind> <selector> (<reason>), …` for the fields
 * the call names — then `wrote <file>: +<n> selector(s), <m> reason(s)` (`+<n> setting(s)` when the call names more
 * than --hide) or `unchanged: <file>`, both printed only after the write
 * succeeded (a failed write prints nothing on stdout); seed with no selector from either
 * source prints `nothing to seed (<run>: <not found | no siteOverlays>; STARDUST_SITE_OVERLAYS: <unset | empty>)`
 * and touches no file. add without --verify also prints one warning line on stderr (it still writes):
 * `presence: not verified against a live page — add --verify <url> (presence.mjs suggest <url> lists candidates)`.
 * A refused add --verify prints on stderr `presence: hide matched nothing on live — candidates: <…> (<sel>, …)`
 * (live-session's hideMissLine: the in-flow blocks above the header, then the selectors that matched nothing)
 * (a dismiss / pin / allow selector: `presence: dismiss / pin / allow matched nothing on <url> @ <w>px (<sel>, …)`),
 * then per missed selector in call order `presence: suggest on <url> @ <w>px — top candidates for --<kind> <sel>:` and
 * up to three pairs `presence:   <selector>  "<text>"  <role>` / `presence:     presence.mjs add --<kind> <selector>
 * [--state <s>] [--slug <s>] [--reason <R>] [--file <f>] --verify <url> [--width <w>] [--wait-ms <n>] [--headed]` (the
 * call's flags carried: --state for a pin, --file / --width off their defaults, --wait-ms / --headed when given;
 * shell-quoted) — none: `presence: suggest on <url> @ <w>px — no <kind> candidate found for --<kind> <sel>`; an
 * allowance: `… — no allow candidate for --allow <k>=<sel>: an allowance names a recorded finding's selector, so there
 * is nothing to suggest` — and last `presence: refused — nothing written to <file>`. The candidates: hide — the in-flow
 * blocks above the header (as hideMissLine), with their text and role; dismiss — the displayed controls inside an
 * overlay (a dialog, aria-modal, a cookie / consent / gdpr / privacy / banner / modal / popup / overlay id or class, a
 * fixed layer; weaker: sticky or z-index ≥ 100), a consent label (live-session's CONSENT_LABEL_SWEEP) first, then a
 * close-like one, then the rest; pin — the displayed tabs and rotator controls (next / prev / pause / play / slide / dot
 * / pagination … in the text, label, title, class or aria-controls) — controlCandidatesInPage has the rules. Every
 * selector is light-DOM and matched exactly one element when read — by document.querySelectorAll, the counter --verify
 * uses (a candidate without such a selector is skipped). suggest prints one line per candidate in document
 * order, `<selector>  <tag>  <h>px` (`(no unique selector)` when the page has none for it), then
 * `presence.mjs add --hide <first candidate> --verify <url>` (+ `--width <w>` off the default; shell-quoted
 * where needed); no candidate → `none found above the header`; a `"*".hide` selector that matched nothing →
 * one more line on stderr, `presence: WARNING hide matched nothing on live — candidates: <…> (<sel>, …)`. suggest
 * --kind dismiss / pin prints instead, on stdout, the refused add's block without the `presence: ` prefix and with no
 * missed selector — `suggest on <url> @ <w>px — top candidates for --<kind>:` and up to three candidate / add-command
 * pairs (--file, --width, --wait-ms, --headed carried as on a miss; a pin's --state is the control's text, else `pinned`
 * — rename it to the state its click pins), or `suggest on <url> @ <w>px — no <kind> candidate found`.
 *
 * Exit codes: 0 written, unchanged, nothing to seed, or suggest listed; 1 a malformed input file — the presence
 * file not JSON, not an object, the touched entry not an object, its `hide` / `dismiss` not a selector string or list,
 * its `pin` / `allow` not a list of valid entries, its `reasons` not an object of strings; the run file not JSON, not an object, `siteOverlays` not an array of
 * strings — named on stderr with nothing written (add --verify and suggest check the presence file before
 * opening the page; also: a file that cannot be read or written, live-session.mjs not found, playwright not importable, the
 * page not loadable — an HTTP error, a navigation failure); 2 usage (no or unknown command, unknown flag, a flag
 * without a value, add without a setting, --reason not `R-<digits>`, a URL that is not http(s), --wait-ms /
 * --width not a whole number, --wait-ms / --width / --headed on add without --verify, --pin without --state or twice,
 * --allow not <kind>=<selector>, of another kind or without --reason, a per-visitor-dialog container the page does
 * not hide, a suggest --kind other than hide / dismiss / pin) — or add --verify refused:
 * a selector matched nothing on the live page, nothing written; 3 a bot challenge on the page (suggest,
 * add --verify; nothing written — retry with --headed).
 *
 * Requires the diff skill's live-session.mjs (parseHideList; for suggest / --verify the live helpers) in one of
 * two layouts — the plugin tree (../../diff/scripts/) or the project copy (stardust/scripts/diff/ beside
 * stardust/scripts/replica/; replica SKILL.md § Setup copies both). It is imported after --help, so --help needs
 * neither it nor any file. playwright is imported only by suggest and add --verify: --help, seed and add without
 * --verify never load it.
 */

/* eslint-disable import/extensions, no-restricted-syntax, no-await-in-loop, brace-style, object-curly-newline, max-len */
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_FILE = 'stardust/replica/presence.json';
export const DEFAULT_RUN = 'stardust/.labs/run.json';
export const ENV_OVERLAYS = 'STARDUST_SITE_OVERLAYS';
export const SEED_REASON = Object.freeze({ run: 'seeded: run.json siteOverlays', env: 'seeded: STARDUST_SITE_OVERLAYS' });
export const REASON_RE = /^R-\d+$/;
export const DEFAULT_WIDTH = 1440;
export const DEFAULT_WAIT_MS = 5000;
export const UNVERIFIED = 'not verified against a live page — add --verify <url> (presence.mjs suggest <url> lists candidates)';
/** The allowance kinds: `clip` (counted clip findings under the selector — the clipper or whole path segments — do not
 * count) and `per-visitor-dialog` (a dialog left open whose container is hidden for the page is no INCONCLUSIVE row). */
export const ALLOW_KINDS = Object.freeze(['clip', 'per-visitor-dialog']);

const HELP = `presence.mjs — write the site-wide hide list (${DEFAULT_FILE}) every gate instrument merges under a gate dir's presence.json

Usage:
  node stardust/scripts/replica/presence.mjs add [--hide <sel[,sel…]>] [--dismiss <sel[,sel…]>] [--pin <sel> --state <label>]
       [--allow <kind>=<selector>] [--slug <s>] [--reason <R-nn>] [--file <f>] [--verify <url> [--wait-ms ${DEFAULT_WAIT_MS}] [--width ${DEFAULT_WIDTH}] [--headed]]
  node stardust/scripts/replica/presence.mjs seed [--run ${DEFAULT_RUN}] [--file <f>]
  node stardust/scripts/replica/presence.mjs suggest <url> [--width ${DEFAULT_WIDTH}] [--wait-ms ${DEFAULT_WAIT_MS}] [--headed] [--file <f>] [--kind hide|dismiss|pin]

  add      append in-flow per-visitor region selectors (a location bar above the header) to "*".hide, or to
           <slug>.hide with --slug — the preserve-direction step records a region it identified — and the page's
           capture settings every gate reads (gate-all, gate.sh, stitch-shot --slug): dismiss, pin, allow
  seed     append the runner's overlay selectors to "*".hide: run.json siteOverlays (array of selectors), then
           the env ${ENV_OVERLAYS} (comma list) — run at Setup; no browser
  suggest  list the hide candidates read off the live page's DOM — the in-flow blocks above the header (where a
           per-visitor location bar sits) — and warn on a "*".hide selector of the file that matches nothing
           there; writes nothing. --kind dismiss / pin: the overlay / rotator controls instead
  --hide <sel,…>   selectors to append (repeatable; comma lists)
  --dismiss <sel,…> extra overlay closers both stitches click ("dismiss"; repeatable; comma lists)
  --pin <sel>      one rotator control per call, clicked after the freeze on both sides; --state <label> (required)
                   names the state it pins ("pin": [{ sel, state }]; the same selector's state is replaced)
  --allow <kind>=<selector>   an allowance ("allow": [{ kind, selector, reason }]; needs --reason; repeatable):
                   ${ALLOW_KINDS[0]} — counted clip findings whose clipper is the selector or whose path holds it do not count;
                   ${ALLOW_KINDS[1]} — a dialog left open whose container is hidden for the page is no INCONCLUSIVE
                   row (refused unless the selector is in the page's hide list — this call's --hide included)
  --slug <s>       write the <s> entry instead of "*"
  --reason <R-nn>  residual id (R-<digits>) recorded as reasons[<sel>] for every hide / dismiss / pin selector of the
                   call, and as each --allow's reason
  --verify <url>   add: before writing, load the http(s) page and poll each selector of the call (hide, dismiss, pin,
                   allow) for up to --wait-ms after the settle — one that never matches is refused (exit 2, nothing
                   written; the candidates of its kind on that page are listed with their add commands)
  --wait-ms <n>    add --verify, suggest: the poll window in ms (default ${DEFAULT_WAIT_MS}; 0 = one look after the settle)
  --width <px>     add --verify, suggest: viewport width (default ${DEFAULT_WIDTH}; height 900)
  --headed         add --verify, suggest: stealth real-Chrome tier (a bot-managed site that challenged the default)
  --run <f>        the run file (default ${DEFAULT_RUN}); missing = nothing from it
  --file <f>       the presence file (default ${DEFAULT_FILE}, relative to the project root = cwd; suggest reads it)
  --kind <k>       suggest: hide (default — the output below, unchanged), dismiss or pin (the overlay / rotator controls,
                   the top three as a refused add --verify lists them)
  --help           this text (reads and writes nothing)

The page (suggest, add --verify) opens the way the gate's live instruments open it (live-session: newLiveContext,
gotoLive, dismissOverlays), then one scroll through it and back to the top; playwright is loaded only for these two —
--help, seed and add without --verify never import it.

Writes: the key's hide list extended in order, de-duplicated (live-session parseHideList), stored one selector per
item; reasons in the entry's "reasons" map (seed: "${SEED_REASON.run}" / "${SEED_REASON.env}" for the
selectors it appends); other keys and fields untouched; atomic (tmp + rename), indent 2 + newline, deterministic.
No change → the file is not rewritten.

Output: add --verify first "verified on <url> @ <w>px: <sel> ×<n>, …"; then "<key>.hide: <sel>, <sel>" (the key's
resulting list; "*.hide: …"), "<key>.dismiss: …", "<key>.pin: <sel> → <state>, …", "<key>.allow: <kind> <selector>
(<reason>), …" for the fields the call names, and "wrote <file>: +<n> selector(s), <m> reason(s)" ("+<n> setting(s)"
beyond --hide) or "unchanged: <file>", printed after the write succeeded; seed with nothing from either source: "nothing to seed (…)", no file touched.
add without --verify still writes and warns on stderr:
  presence: ${UNVERIFIED}
add --verify refused (stderr, nothing written):
  presence: hide matched nothing on live — candidates: <selector> (<tag>, <h>px); … (<sel>, …)
  presence: dismiss / pin / allow matched nothing on <url> @ <w>px (<sel>, …)
  presence: suggest on <url> @ <w>px — top candidates for --<kind> <sel>:
  presence:   <selector>  "<text>"  <role>
  presence:     presence.mjs add --<kind> <selector> [--state <s>] [--slug <s>] [--reason <R>] [--file <f>] --verify <url> [--width <w>] [--wait-ms <n>] [--headed]
  presence: refused — nothing written to <file>
the suggest block: per missed selector in call order, read on the same loaded page (no second load), ≤ 3 candidates
of its kind, each with the add command carrying the call's flags (--state for a pin; --file / --width off the
default; --wait-ms / --headed when given; shell-quoted). hide: the in-flow blocks above the header; dismiss: the
displayed controls inside an overlay (dialog, aria-modal, a cookie|consent|gdpr|privacy|banner|modal|popup|overlay id
or class, fixed; weaker: sticky or z-index ≥ 100) — a consent label first, then close-like, then the rest; pin: the
displayed tabs and rotator controls (next/prev/pause/play/slide/dot/pagination… in text, label, title, class). Each
selector is light-DOM and matched exactly one element when read (what --verify counts; none such → skipped). None:
"presence: suggest on <url> @ <w>px — no <kind> candidate found for --<kind> <sel>"; an --allow: "… — no allow
candidate for --allow <k>=<sel>: an allowance names a recorded finding's selector, so there is nothing to suggest".
suggest: one line per candidate in document order, "<selector>  <tag>  <h>px", then
"presence.mjs add --hide <first candidate> --verify <url>"; no candidate: "none found above the header"; a "*".hide
selector of the file that matched nothing (polled like --verify) adds on stderr, exit still 0:
  presence: WARNING hide matched nothing on live — candidates: <selector> (<tag>, <h>px); … (<sel>, …)
suggest --kind dismiss / pin: on stdout the refused add's suggest block without "presence: " and without a missed
selector — "suggest on <url> @ <w>px — top candidates for --<kind>:", ≤ 3 "  <selector>  "<text>"  <role>" /
"    presence.mjs add --<kind> <selector> … --verify <url> …" pairs (a pin's --state is the control's text, else
"pinned" — rename it to the state its click pins); none: "suggest on <url> @ <w>px — no <kind> candidate found".

Exit codes: 0 written / unchanged / nothing to seed / suggest listed; 1 malformed input file (presence file or run
file — named, nothing written), a file that cannot be read or written, live-session.mjs not found, playwright not
importable, or the page not loadable (HTTP error, navigation failure); 2 usage error, or add --verify refused (a
selector matched nothing on the live page); 3 bot challenge on the page (suggest, add --verify — retry --headed).`;

export class UsageError extends Error { constructor(msg) { super(msg); this.code = 2; } }
export class InputError extends Error { constructor(msg) { super(msg); this.code = 1; } }
/** The live page could not be read: code 3 a bot challenge, 1 any other load failure. */
export class LiveError extends Error { constructor(msg, code) { super(msg); this.code = code; } }

// live-session.mjs lives in the diff skill's scripts dir: the plugin tree (../../diff/scripts/) or the project copy
// (stardust/scripts/diff/ beside stardust/scripts/replica/).
async function loadLiveSession() {
  const found = ['../../diff/scripts/live-session.mjs', '../diff/live-session.mjs'].map((p) => resolvePath(HERE, p)).find((p) => existsSync(p));
  if (!found) throw new InputError('presence: live-session.mjs not found (looked in ../../diff/scripts/ and ../diff/). Copy the diff skill\'s scripts dir alongside this one (replica SKILL.md § Setup).');
  return import(pathToFileURL(found).href);
}

const FLAGS = {
  add: ['--hide', '--dismiss', '--pin', '--state', '--allow', '--slug', '--reason', '--file', '--verify', '--wait-ms', '--width', '--headed'],
  seed: ['--run', '--file'],
  suggest: ['--width', '--headed', '--wait-ms', '--file', '--kind'],
};
/** suggest --kind: whose candidates it lists (hide, the default, as before; dismiss / pin as a refused add --verify does). */
export const SUGGEST_KINDS = Object.freeze(['hide', 'dismiss', 'pin']);
const COMMANDS = 'add, seed or suggest';
const isHttpUrl = (v) => { try { return ['http:', 'https:'].includes(new URL(v).protocol); } catch { return false; } };
const wholeNumber = (flag, v, min) => {
  if (!/^\d+$/.test(v) || Number(v) < min) throw new UsageError(`presence: ${flag} must be a whole number ≥ ${min} (got "${v}")`);
  return Number(v);
};

/** argv after the script path → { cmd, hide: [values], dismiss: [values], pin: { sel, state } | null, allow: [{ kind,
 * selector }], slug, reason, file, run, url, verify, waitMs, waitGiven (--wait-ms was on the line), width, headed, kind
 * (suggest) }; throws UsageError. --help is answered before this. */
export function parseArgs(argv) {
  const [cmd, ...rest] = argv;
  if (!cmd) throw new UsageError(`presence: a command is required — ${COMMANDS} (see --help)`);
  if (!Object.hasOwn(FLAGS, cmd)) throw new UsageError(`presence: unknown command "${cmd}" — ${COMMANDS} (see --help)`);
  const o = { cmd, hide: [], dismiss: [], pin: null, state: null, allow: [], slug: null, reason: null, file: DEFAULT_FILE, run: DEFAULT_RUN, url: null, verify: null, waitMs: null, width: null, headed: false, kind: 'hide' };
  for (let i = 0; i < rest.length; i += 1) {
    const a = rest[i];
    if (cmd === 'suggest' && !a.startsWith('-')) {
      if (o.url !== null) throw new UsageError(`presence: suggest takes one page URL (got "${o.url}" and "${a}")`);
      o.url = a;
      continue;
    }
    if (!FLAGS[cmd].includes(a)) throw new UsageError(`presence: unknown argument ${a} for ${cmd} (see --help)`);
    if (a === '--headed') { o.headed = true; continue; }
    const v = rest[i + 1];
    if (v === undefined || v.startsWith('--')) throw new UsageError(`presence: ${a} needs a value (see --help)`);
    i += 1;
    if (a === '--hide') o.hide.push(v);
    else if (a === '--dismiss') o.dismiss.push(v);
    else if (a === '--pin') {
      if (o.pin !== null) throw new UsageError('presence: one --pin per call (each pin has its own --state)');
      o.pin = v.trim();
    } else if (a === '--state') o.state = v.trim();
    else if (a === '--allow') {
      // <kind>=<selector>, split at the FIRST '=': a kind has none, a selector may ([data-x="y"])
      const i = v.indexOf('=');
      const kind = i < 0 ? '' : v.slice(0, i).trim(); const selector = i < 0 ? '' : v.slice(i + 1).trim();
      if (!kind || !selector) throw new UsageError(`presence: --allow takes <kind>=<selector> (got "${v}")`);
      if (!ALLOW_KINDS.includes(kind)) throw new UsageError(`presence: --allow kind must be one of ${ALLOW_KINDS.join(', ')} (got "${kind}")`);
      o.allow.push({ kind, selector });
    } else if (a === '--slug') o.slug = v.trim();
    else if (a === '--reason') o.reason = v.trim();
    else if (a === '--file') o.file = v;
    else if (a === '--run') o.run = v;
    else if (a === '--verify') o.verify = v.trim();
    else if (a === '--kind') o.kind = v.trim();
    else if (a === '--wait-ms') o.waitMs = wholeNumber(a, v, 0);
    else if (a === '--width') o.width = wholeNumber(a, v, 1);
  }
  if (cmd === 'add' && !o.hide.length && !o.dismiss.length && o.pin === null && !o.allow.length) throw new UsageError('presence: add needs --hide, --dismiss, --pin or --allow <…> (see --help)');
  if (o.pin !== null && !o.pin) throw new UsageError('presence: --pin needs a selector (see --help)');
  if (o.pin !== null && !o.state) throw new UsageError('presence: --pin needs --state <label> (the state its click pins, e.g. "slide 1")');
  if (o.pin === null && o.state !== null) throw new UsageError('presence: --state needs --pin <sel> (see --help)');
  if (o.allow.length && o.reason === null) throw new UsageError('presence: --allow needs --reason R-<nn> (an allowance names its register entry)');
  if (cmd === 'suggest' && o.url === null) throw new UsageError('presence: suggest needs a page URL (see --help)');
  if (cmd === 'suggest' && !isHttpUrl(o.url)) throw new UsageError(`presence: suggest needs an http(s) page URL (got "${o.url}")`);
  if (!SUGGEST_KINDS.includes(o.kind)) throw new UsageError(`presence: --kind must be one of ${SUGGEST_KINDS.join(', ')} (got "${o.kind}")`);
  if (o.verify !== null && !isHttpUrl(o.verify)) throw new UsageError(`presence: --verify needs an http(s) page URL (got "${o.verify}")`);
  if (cmd === 'add' && o.verify === null && (o.waitMs !== null || o.width !== null || o.headed)) throw new UsageError('presence: --wait-ms, --width and --headed need --verify <url> (see --help)');
  if (o.slug === '') throw new UsageError('presence: --slug needs a page slug (see --help)');
  if (o.reason !== null && !REASON_RE.test(o.reason)) throw new UsageError(`presence: --reason must be a residual id R-<digits> (got "${o.reason}")`);
  if (!o.file.trim()) throw new UsageError('presence: --file needs a path (see --help)');
  if (!o.run.trim()) throw new UsageError('presence: --run needs a path (see --help)');
  o.width ??= DEFAULT_WIDTH;
  o.waitGiven = o.waitMs !== null;
  o.waitMs ??= DEFAULT_WAIT_MS;
  return o;
}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const own = (obj, key) => (Object.hasOwn(obj, key) ? obj[key] : undefined);
const malformed = (file, why) => new InputError(`presence: ${file} is malformed (${why}) — nothing written`);

/** A JSON file → { found, json }; a missing file → found: false. Unreadable / not JSON / not an object → InputError naming it. */
function readJsonObject(file) {
  if (!existsSync(file)) return { found: false, json: {} };
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (e) { throw new InputError(`presence: ${file} cannot be read (${e.code || e.message}) — nothing written`); }
  let json;
  try { json = JSON.parse(text); } catch (e) { throw malformed(file, String(e.message).split('\n')[0]); }
  if (!isPlainObject(json)) throw malformed(file, 'the top level must be a JSON object');
  return { found: true, json };
}

const isSelectorList = (v) => typeof v === 'string' || (Array.isArray(v) && v.every((s) => typeof s === 'string'));
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';
const validPin = (x) => isPlainObject(x) && nonEmpty(x.sel) && nonEmpty(x.state);
const validAllow = (x) => isPlainObject(x) && ALLOW_KINDS.includes(x.kind) && nonEmpty(x.selector) && typeof x.reason === 'string';

/** Checks the entry this run touches: an object whose `hide` and `dismiss` are a selector string or a list of them,
 * `pin` a list of { sel, state }, `allow` a list of { kind (ALLOW_KINDS), selector, reason } and `reasons` an object of
 * strings (each may be absent; `hide: null` / `dismiss: null` read as absent). Throws InputError. */
export function checkEntry(json, key, file) {
  const entry = own(json, key);
  if (entry === undefined) return;
  if (!isPlainObject(entry)) throw malformed(file, `"${key}" must be an object`);
  const { hide, dismiss, pin, allow, reasons } = entry;
  for (const [field, v] of [['hide', hide], ['dismiss', dismiss]]) if (v != null && !isSelectorList(v)) throw malformed(file, `"${key}".${field} must be a selector string or a list of selector strings`);
  if (pin !== undefined && !(Array.isArray(pin) && pin.every(validPin))) throw malformed(file, `"${key}".pin must be a list of { sel, state }`);
  if (allow !== undefined && !(Array.isArray(allow) && allow.every(validAllow))) throw malformed(file, `"${key}".allow must be a list of { kind: ${ALLOW_KINDS.join(' | ')}, selector, reason }`);
  if (reasons !== undefined && !(isPlainObject(reasons) && Object.values(reasons).every((r) => typeof r === 'string'))) throw malformed(file, `"${key}".reasons must be an object of strings`);
}

/**
 * Pure: append `selectors` to `json[key].hide` → { json, list, added, reasonChanges, changed }. `parse` is
 * live-session's parseHideList. `reasonOf(sel)` → the reason to record (or null) for each selector of the call,
 * replacing a different recorded one; `onlyAdded` restricts it to the selectors this call appends (seed), so a
 * selector already in the list keeps its reason. With no
 * change the input object is returned as is; otherwise a new object (the input is not mutated) whose key and field
 * order follow the input, a new key or field appended.
 */
export function applyHide(json, key, selectors, opts) { return applyList(json, key, 'hide', selectors, opts); }

/** applyHide for any selector-list field of the entry (`hide`, `dismiss`): the same rules, the same result shape. */
export function applyList(json, key, field, selectors, { parse, reasonOf = null, onlyAdded = false }) {
  const entry = own(json, key) || {};
  const before = parse(entry[field]);
  const list = parse(entry[field], selectors);
  const added = list.filter((sel) => !before.includes(sel));
  const reasons = { ...(isPlainObject(entry.reasons) ? entry.reasons : {}) };
  let reasonChanges = 0;
  if (reasonOf) {
    for (const sel of parse(selectors)) {
      const r = reasonOf(sel);
      if (!r || (onlyAdded && !added.includes(sel))) continue;
      if (own(reasons, sel) !== r) { reasons[sel] = r; reasonChanges += 1; }
    }
  }
  if (!added.length && !reasonChanges) return { json, list, added, reasonChanges, changed: false };
  const next = { ...entry, [field]: list };
  if (Object.keys(reasons).length) next.reasons = reasons;
  return { json: { ...json, [key]: next }, list, added, reasonChanges, changed: true };
}

/** Pure: the seed selectors → { selectors, reasonOf } — run.json `siteOverlays` first, then the env comma list,
 * de-duplicated; a selector named by both carries the run.json reason. */
export function seedSelectors(siteOverlays, envValue, parse) {
  const fromRun = parse(siteOverlays);
  const selectors = parse(fromRun, envValue);
  return { selectors, reasonOf: (sel) => (fromRun.includes(sel) ? SEED_REASON.run : SEED_REASON.env) };
}

/**
 * Pure: a pin into `json[key].pin` ({ sel, state }; the same selector's state replaced in place, else appended) and its
 * `reason` into `reasons[sel]` → { json, list, changes, reasonChanges, changed } — the input is never mutated; no change
 * returns it as is.
 */
export function applyPin(json, key, pin, reason = null) {
  const entry = own(json, key) || {};
  const list = (Array.isArray(entry.pin) ? entry.pin : []).map((x) => ({ ...x }));
  const at = list.findIndex((x) => x.sel === pin.sel);
  let changes = 0;
  if (at < 0) { list.push({ sel: pin.sel, state: pin.state }); changes = 1; } else if (list[at].state !== pin.state) { list[at].state = pin.state; changes = 1; }
  const reasons = { ...(isPlainObject(entry.reasons) ? entry.reasons : {}) };
  let reasonChanges = 0;
  if (reason && own(reasons, pin.sel) !== reason) { reasons[pin.sel] = reason; reasonChanges = 1; }
  if (!changes && !reasonChanges) return { json, list, changes, reasonChanges, changed: false };
  return { json: { ...json, [key]: { ...entry, pin: list, ...(Object.keys(reasons).length ? { reasons } : {}) } }, list, changes, reasonChanges, changed: true };
}

/** Pure: allowances into `json[key].allow` ({ kind, selector, reason }; the same kind + selector gets the new reason in
 * place, else appended) → { json, list, changes, changed }; the input is never mutated. */
export function applyAllow(json, key, allows, reason) {
  const entry = own(json, key) || {};
  const list = (Array.isArray(entry.allow) ? entry.allow : []).map((x) => ({ ...x }));
  let changes = 0;
  for (const { kind, selector } of allows) {
    const at = list.findIndex((x) => x.kind === kind && x.selector === selector);
    if (at < 0) { list.push({ kind, selector, reason }); changes += 1; } else if (list[at].reason !== reason) { list[at].reason = reason; changes += 1; }
  }
  if (!changes) return { json, list, changes, changed: false };
  return { json: { ...json, [key]: { ...entry, allow: list } }, list, changes, changed: true };
}

// live-session's parseHideList, restated so the pure readers below need no import (gate-all, stitch-shot and gate.sh read
// presence.json through them; keep them in step): comma lists or arrays of them, trimmed, empty dropped, de-duplicated.
const splitList = (...values) => {
  const out = [];
  const add = (v) => {
    if (Array.isArray(v)) { v.forEach(add); return; }
    if (typeof v !== 'string') return;
    for (const part of v.split(',')) { const sel = part.trim(); if (sel && !out.includes(sel)) out.push(sel); }
  };
  values.forEach(add);
  return out;
};

/**
 * Pure: a (merged) presence.json → one page's capture settings, `"*"`'s then `<slug>`'s (a null slug: `"*"` only):
 * { hide, dismiss } — selector lists de-duplicated in order; pin — [{ sel, state }], one per selector (the slug's state
 * wins, the first position kept); allow — [{ kind, selector, reason }], one per kind + selector (the slug's reason wins);
 * allowDialog — the per-visitor-dialog selectors that are in `hide` (an allowance for a container not hidden allows
 * nothing). Lenient: a malformed field or entry is skipped (presence.mjs add refuses to write one).
 */
export function captureSettings(json, slug = null) {
  const entries = ['*', ...(slug != null && slug !== '*' ? [slug] : [])].map((k) => (isPlainObject(json) && isPlainObject(json[k]) ? json[k] : {}));
  const pin = []; const allow = [];
  for (const e of entries) {
    for (const x of Array.isArray(e.pin) ? e.pin.filter(validPin) : []) {
      const at = pin.findIndex((y) => y.sel === x.sel.trim());
      if (at < 0) pin.push({ sel: x.sel.trim(), state: x.state.trim() }); else pin[at] = { sel: pin[at].sel, state: x.state.trim() };
    }
    for (const x of Array.isArray(e.allow) ? e.allow.filter(validAllow) : []) {
      const y = { kind: x.kind, selector: x.selector.trim(), reason: x.reason };
      const at = allow.findIndex((z) => z.kind === y.kind && z.selector === y.selector);
      if (at < 0) allow.push(y); else allow[at] = y;
    }
  }
  const hide = splitList(...entries.map((e) => e.hide));
  const allowDialog = allow.filter((x) => x.kind === 'per-visitor-dialog' && hide.includes(x.selector)).map((x) => x.selector);
  return { hide, dismiss: splitList(...entries.map((e) => e.dismiss)), pin, allow, allowDialog: [...new Set(allowDialog)] };
}

/**
 * Pure: the counted clip findings (clip-probe / content-presence `findings`, or `groups` with their `n`) the page's `clip`
 * allowances cover → { n, by: [{ selector, reason, n }] } (allowance order, only those that covered one). A finding is
 * covered when an allowance's selector is its `clipper`, or occurs in its `path` (`a > b > c`) as whole segments; the
 * first covering allowance takes it. `byClipper` (groups: a group's `path` is its first finding's only) matches the
 * clipper alone. Advisory findings are never counted, so never allowed either.
 */
export function clipAllowed(findings, allow, { byClipper = false } = {}) {
  const clips = (Array.isArray(allow) ? allow : []).filter((x) => x && x.kind === 'clip' && nonEmpty(x.selector));
  const by = clips.map((x) => ({ selector: x.selector.trim(), reason: x.reason, n: 0 }));
  for (const f of Array.isArray(findings) ? findings : []) {
    if (!f || f.advisory) continue;
    const path = ` > ${String(f.path || '')} > `;
    const hit = by.find((x) => x.selector === f.clipper || (!byClipper && path.includes(` > ${x.selector} > `)));
    if (hit) hit.n += Number.isInteger(f.n) && f.n > 0 ? f.n : 1;
  }
  const used = by.filter((x) => x.n > 0);
  return { n: used.reduce((a, x) => a + x.n, 0), by: used };
}

/** The run file's `siteOverlays` → { found, overlays }; a missing file or key → []. Malformed → InputError naming it. */
function readRun(file) {
  const { found, json } = readJsonObject(file);
  const so = own(json, 'siteOverlays');
  if (so == null) return { found, overlays: [] };
  if (!Array.isArray(so) || !so.every((s) => typeof s === 'string')) throw malformed(file, 'siteOverlays must be an array of selector strings');
  return { found, overlays: so };
}

/** `json` → `file` atomically (`<file>.<pid>.tmp` + rename, the directory created); a failure removes the tmp file
 * and throws InputError naming the file. */
export function writeAtomic(file, json) {
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    mkdirSync(dirname(resolvePath(file)), { recursive: true });
    writeFileSync(tmp, `${JSON.stringify(json, null, 2)}\n`);
    renameSync(tmp, file);
  } catch (e) {
    try { rmSync(tmp, { force: true }); } catch { /* no tmp to remove (its directory is not one) */ }
    throw new InputError(`presence: cannot write ${file} (${e.code || e.message})`);
  }
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

// ---- the live page: suggest and add --verify ------------------------------------------------------------------

// playwright is imported here only: --help, seed and add without --verify never load it.
async function loadChromium() {
  let m;
  try { m = await import('playwright'); } catch (e) { throw new InputError(`presence: playwright is not importable from ${HERE} (${e.code || e.message}) — replica SKILL.md § Setup: copy the scripts dir into the project and run the copy`); }
  return (m.chromium ? m : m.default).chromium;
}

/* eslint-disable no-undef */
// In the page: each selector's current match count; a selector the query refuses counts 0 (live-session's recount rule).
function countInPage(sels) {
  return sels.map((sel) => { try { return document.querySelectorAll(sel).length; } catch { return 0; } });
}
// In the page: one scroll through the document and back to the top — lazy content rendered, the header at rest.
async function scrollThroughInPage() {
  const h = document.documentElement.scrollHeight;
  for (let y = 0; y < h; y += 700) { window.scrollTo(0, y); await new Promise((r) => { setTimeout(r, 80); }); }
  window.scrollTo(0, 0);
  await new Promise((r) => { setTimeout(r, 400); });
}

/**
 * In the page (self-contained for page.evaluate): the CONTROL candidates for a missed --dismiss (kind 'dismiss') or --pin
 * (kind 'pin') → [{ selector, text, role }], best first, at most `limit`. Light DOM only — the --verify counter
 * (countInPage) is document.querySelectorAll, which never enters a shadow root. Controls: `button, [role="button"],
 * a[href], input[type="button"], input[type="submit"], [role="tab"], summary`, displayed (display, visibility, opacity, a
 * 2×2 box).
 *   dismiss — only a control inside an overlay container (itself or an ancestor below body): role=dialog, aria-modal=true,
 *     an id/class matching cookie|consent|gdpr|privacy|banner|modal|popup|overlay or position fixed ("strong"); sticky, or
 *     positioned with z-index ≥ 100 ("weak"). Ranked: its text IS one of `labels` (the consent label sweep's, earlier
 *     first) > close-like (text / aria-label / title matching close|dismiss|×|✕|schließen|fermer|cerrar|chiudi) > another
 *     control in a strong container > one in a weak container.
 *   pin — a control whose role is tab, or whose text / aria-label / title / class / aria-controls matches
 *     next|prev|previous|pause|play|stop|slide|carousel|slider|rotat|dot|bullet|pagination.
 * Within a rank a control that leaves the page (a form submit, a link off this document) comes after the others (a click
 * on it would navigate the capture away), then document order. selector: the first of `#id` (a clean id: a letter, then
 * [A-Za-z0-9_-], no run of 4 digits), `tag[data-testid|aria-label|name|title="…"]` (a value ≤ 80 chars on one line),
 * `#anchor tag`, `#anchor tag.class` (the nearest ancestor with a clean unique id), `tag.class` (clean classes, no state
 * class — is- / has-, active, selected, current, … move with the state), then the `body > …:nth-of-type(i)` path, that
 * matches only this element (querySelectorAll length 1); none → the control is skipped. text: whitespace-collapsed (an
 * input's value), else aria-label / title, cut to 40 chars; role: the role attribute, else button (button, summary, input
 * button / submit), link (a[href]), else the tag.
 */
export function controlCandidatesInPage({ kind, labels = [], limit = 3 }) {
  const CONTROLS = 'button, [role="button"], a[href], input[type="button"], input[type="submit"], [role="tab"], summary';
  const OVERLAY = /cookie|consent|gdpr|privacy|banner|modal|popup|overlay/i;
  const CLOSE = /close|dismiss|×|✕|schließen|fermer|cerrar|chiudi/i;
  const ROTATOR = /next|prev|previous|pause|play|stop|slide|carousel|slider|rotat|dot|bullet|pagination/i;
  const { body } = document;
  if (!body) return [];
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const attr = (el, a) => norm(el.getAttribute(a));
  const textOf = (el) => (el.tagName === 'INPUT' ? norm(el.value) : norm(el.textContent)) || attr(el, 'aria-label') || attr(el, 'title');
  const classOf = (el) => (typeof el.className === 'string' ? el.className : el.getAttribute('class') || '');
  const displayed = (el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
    if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width >= 2 && r.height >= 2;
  };
  // the overlay around a node: 2 strong, 1 weak, 0 none — memoised, the control's ancestors are shared
  const memo = new Map();
  const overlay = (n) => {
    if (!n || n === body || n === document.documentElement) return 0;
    if (memo.has(n)) return memo.get(n);
    let own = 0;
    if (n.getAttribute('role') === 'dialog' || n.getAttribute('aria-modal') === 'true' || OVERLAY.test(`${n.id} ${classOf(n)}`)) own = 2;
    else {
      const cs = getComputedStyle(n);
      if (cs.position === 'fixed') own = 2;
      else if (cs.position === 'sticky' || (cs.position !== 'static' && Number(cs.zIndex) >= 100)) own = 1;
    }
    const k = own === 2 ? 2 : Math.max(own, overlay(n.parentElement));
    memo.set(n, k);
    return k;
  };
  const leaves = (el) => {
    if (el.tagName === 'INPUT') return el.type === 'submit';
    if (el.tagName === 'BUTTON') return el.type === 'submit' && Boolean(el.form);
    if (el.tagName === 'A' && el.hasAttribute('href')) { const h = el.getAttribute('href').trim(); return !h.startsWith('#') && !/^javascript:/i.test(h); }
    return false;
  };
  const ranked = [];
  [...document.querySelectorAll(CONTROLS)].forEach((el, order) => {
    if (!body.contains(el) || !displayed(el)) return;
    const text = textOf(el);
    let rank;
    if (kind === 'dismiss') {
      const k = overlay(el);
      if (!k) return;
      const label = labels.indexOf(text.toLowerCase());
      if (label >= 0) rank = [0, label];
      else if (CLOSE.test(`${text} ${attr(el, 'aria-label')} ${attr(el, 'title')}`)) rank = [1, 0];
      else rank = [k === 2 ? 2 : 3, 0];
    } else {
      if (attr(el, 'role') !== 'tab' && !ROTATOR.test([text, attr(el, 'aria-label'), attr(el, 'title'), classOf(el), attr(el, 'aria-controls')].join(' '))) return;
      rank = [0, 0];
    }
    ranked.push({ el, text, rank: [...rank, leaves(el) ? 1 : 0, order] });
  });
  ranked.sort((a, b) => a.rank.reduce((d, x, i) => d || x - b.rank[i], 0));
  const only = (sel, el) => { try { const m = document.querySelectorAll(sel); return m.length === 1 && m[0] === el; } catch { return false; } };
  const clean = (s) => /^[A-Za-z][\w-]*$/.test(s) && !/\d{4}/.test(s);
  // a state class moves with the state (the active dot): a selector built on it would match another control later
  const STATEFUL = /^(is|has)[-_]|active|selected|current|focus|hover|visible|hidden|^(show|open|closed|in)$/i;
  const quoted = (v) => `"${v.replace(/["\\]/g, '\\$&')}"`;
  const selectorOf = (el) => {
    const tag = el.tagName.toLowerCase();
    const tries = el.id && clean(el.id) ? [`#${el.id}`] : [];
    for (const a of ['data-testid', 'aria-label', 'name', 'title']) {
      const v = el.getAttribute(a);
      if (v && v.trim() && v.length <= 80 && !/[\n\r\f]/.test(v)) tries.push(`${tag}[${a}=${quoted(v)}]`);
    }
    const classes = [...el.classList].filter((c) => clean(c) && !STATEFUL.test(c)).slice(0, 8);
    const tails = [tag, ...classes.map((c) => `${tag}.${c}`), ...(classes.length > 1 ? [`${tag}${classes.map((c) => `.${c}`).join('')}`] : [])];
    let anchor = null;
    for (let n = el.parentElement; n && n !== body && !anchor; n = n.parentElement) if (n.id && clean(n.id) && only(`#${n.id}`, n)) anchor = n;
    if (anchor) tries.push(...tails.map((t) => `#${anchor.id} ${t}`));
    tries.push(...tails.slice(1));
    const hit = tries.find((s) => only(s, el));
    if (hit) return hit;
    const parts = [];
    for (let n = el; n !== body; n = n.parentElement) parts.unshift(`${n.tagName.toLowerCase()}:nth-of-type(${[...n.parentElement.children].filter((c) => c.tagName === n.tagName).indexOf(n) + 1})`);
    const path = ['body', ...parts].join(' > ');
    return only(path, el) ? path : null;
  };
  const roleOf = (el) => {
    const tag = el.tagName.toLowerCase();
    if (attr(el, 'role')) return attr(el, 'role');
    if (tag === 'button' || tag === 'summary' || (tag === 'input' && ['button', 'submit'].includes(el.type))) return 'button';
    return tag === 'a' && el.hasAttribute('href') ? 'link' : tag;
  };
  const out = [];
  for (const c of ranked) {
    if (out.length >= limit) break;
    const selector = selectorOf(c.el);
    if (selector) out.push({ selector, text: c.text.slice(0, 40), role: roleOf(c.el) });
  }
  return out;
}

/** In the page: each hide candidate's selector → { text, role } (null unless it matches exactly one element): text the
 * whitespace-collapsed visible text, else aria-label / title, cut to 40 chars; role the role attribute, else the implicit
 * landmark (header banner, nav navigation, aside complementary, footer contentinfo, form form, section region), else the
 * tag. */
export function regionFactsInPage(sels) {
  const LANDMARK = { header: 'banner', nav: 'navigation', aside: 'complementary', footer: 'contentinfo', form: 'form', section: 'region' };
  const norm = (s) => (s || '').replace(/\s+/g, ' ').trim();
  return sels.map((sel) => {
    let m;
    try { m = document.querySelectorAll(sel); } catch { return null; }
    if (m.length !== 1) return null;
    const el = m[0]; const tag = el.tagName.toLowerCase();
    const text = (norm(el.innerText) || norm(el.getAttribute('aria-label')) || norm(el.getAttribute('title'))).slice(0, 40);
    return { text, role: norm(el.getAttribute('role')) || LANDMARK[tag] || tag };
  });
}
/* eslint-enable no-undef */

/**
 * Opens `url` the way the gate's live instruments do (live-session: newLiveContext, gotoLive with the default
 * waitUntil — a bot challenge or an HTTP error is never read as the page —, dismissOverlays with the late-modal
 * window of a live site, then one scroll through and back to the top), runs `work(page)` and closes the browser.
 * A bot challenge → LiveError code 3; any other load failure → LiveError code 1.
 */
async function withLivePage(session, url, { width, headed }, work) {
  const chromium = await loadChromium();
  const browser = headed ? await session.launchStealthHeaded(chromium) : await chromium.launch();
  try {
    const ctx = await session.newLiveContext(browser, { viewport: { width, height: 900 } });
    const page = await ctx.newPage();
    try {
      await session.gotoLive(page, url, { waitUntil: session.defaultWaitUntil(url), settleMs: session.isLiveHttpUrl(url) ? 2500 : 1200, solveWindow: headed });
    } catch (e) {
      const why = String(e.message).split('\n')[0];
      throw e.name === 'BotChallengeError' ? new LiveError(`presence: ${why}`, 3) : new LiveError(`presence: cannot load ${url} (${why})`, 1);
    }
    await session.dismissOverlays(page, { lateWindowMs: session.lateWindowFor(url) });
    await page.evaluate(scrollThroughInPage);
    await page.waitForTimeout(500);
    return await work(page);
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Polls each selector on `page` every `everyMs` until every one matched at least once or `waitMs` passed (one look
 * when `waitMs` is 0) → { counts: the highest match count seen per selector, misses: the selectors never matched }.
 * A block rendered late (a geo lookup filling its wrapper) is found when it arrives.
 */
export async function pollSelectors(page, sels, { waitMs = DEFAULT_WAIT_MS, everyMs = 250 } = {}) {
  const counts = sels.map(() => 0);
  const deadline = Date.now() + waitMs;
  for (;;) {
    const now = await page.evaluate(countInPage, sels);
    now.forEach((c, i) => { counts[i] = Math.max(counts[i], c); });
    const left = deadline - Date.now();
    if (counts.every((c) => c > 0) || left <= 0) break;
    await page.waitForTimeout(Math.min(everyMs, left));
  }
  return { counts, misses: sels.filter((_, i) => counts[i] === 0) };
}

const SHELL_SAFE = /^[\w.\-/:=@%+,]+$/;
/** A value for a copy-paste command line: as is when the shell reads it literally, else single-quoted. */
export const shellArg = (v) => (SHELL_SAFE.test(v) ? v : `'${v.replace(/'/g, "'\\''")}'`);

/** Pure: inFlowRegionsAboveHeader's candidates → suggest's lines: `<selector>  <tag>  <h>px` each, in document order
 * (`(no unique selector)` when the page has none for a block), then `presence.mjs add --hide <first selector>
 * --verify <url>` (+ `--width <w>` off the default); no candidate → []. */
export function suggestLines(list, { url, width = DEFAULT_WIDTH }) {
  const rows = (list || []).filter(Boolean);
  const lines = rows.map((c) => `${c.selector || '(no unique selector)'}  ${c.tag}  ${c.height}px`);
  const first = rows.find((c) => c.selector);
  if (first) lines.push(`presence.mjs add --hide ${shellArg(first.selector)} --verify ${shellArg(url)}${width === DEFAULT_WIDTH ? '' : ` --width ${width}`}`);
  return lines;
}

// how many candidates a miss (and suggest --kind dismiss / pin) prints
const TOP_CANDIDATES = 3;

/** Pure: the runnable `presence.mjs add --<kind> <selector> [--state <s>] [--slug <s>] [--reason <R>] [--file <f>] --verify
 * <url> [--width <w>] [--wait-ms <n>] [--headed]` line — --state for pin only, --file and --width off their defaults,
 * --wait-ms when `waitMs` is not null, --headed when set; every value shell-quoted where needed (shellArg). */
function addCommand(kind, selector, { url, width = DEFAULT_WIDTH, state = null, slug = null, reason = null, file = DEFAULT_FILE, waitMs = null, headed = false }) {
  const parts = ['presence.mjs add', `--${kind}`, shellArg(selector)];
  if (kind === 'pin') parts.push('--state', shellArg(state));
  if (slug) parts.push('--slug', shellArg(slug));
  if (reason) parts.push('--reason', shellArg(reason));
  if (file && file !== DEFAULT_FILE) parts.push('--file', shellArg(file));
  parts.push('--verify', shellArg(url));
  if (width !== DEFAULT_WIDTH) parts.push('--width', String(width));
  if (waitMs !== null && waitMs !== undefined) parts.push('--wait-ms', String(waitMs));
  if (headed) parts.push('--headed');
  return parts.join(' ');
}

/**
 * Pure: one kind's candidates ([{ selector, text, role }], best first) → the suggest block: `suggest on <url> @ <w>px — top
 * candidates for <missed | --<kind>>:`, then per candidate (≤ TOP_CANDIDATES; one without a selector skipped) `  <selector>
 * "<text>"  <role>` and `    <addCommand>` (`opts` carries the call's flags; a pin without `state` takes the control's text,
 * else `pinned`). None → `suggest on <url> @ <w>px — no <kind> candidate found[ for <missed>]`; kind allow → `… — no allow
 * candidate[ for <missed>]: an allowance names a recorded finding's selector, so there is nothing to suggest`.
 */
export function candidateLines(kind, list, { missed = null, ...opts }) {
  const where = `suggest on ${opts.url} @ ${opts.width ?? DEFAULT_WIDTH}px`;
  const forMissed = missed === null ? '' : ` for ${missed}`;
  if (kind === 'allow') return [`${where} — no allow candidate${forMissed}: an allowance names a recorded finding's selector, so there is nothing to suggest`];
  const rows = (list || []).filter((c) => c && c.selector).slice(0, TOP_CANDIDATES);
  if (!rows.length) return [`${where} — no ${kind} candidate found${forMissed}`];
  return [`${where} — top candidates for ${missed ?? `--${kind}`}:`, ...rows.flatMap((c) => [
    `  ${c.selector}  ${JSON.stringify(c.text || '')}  ${c.role}`,
    `    ${addCommand(kind, c.selector, { ...opts, state: kind === 'pin' ? (opts.state ?? (c.text || 'pinned')) : null })}`,
  ])];
}

/** Pure: add --verify's missed settings ([{ kind: hide | dismiss | pin | allow, selector, allowKind }], call order) and the
 * candidates read per kind ({ hide, dismiss, pin }) → the stderr lines, `presence: ` + candidateLines for each, missed =
 * `--<kind> <selector>` (`--allow <allowKind>=<selector>`). */
export function missSuggestLines(misses, candidates, opts) {
  return (misses || []).flatMap((m) => candidateLines(m.kind, (candidates || {})[m.kind], { ...opts, missed: m.kind === 'allow' ? `--allow ${m.allowKind}=${m.selector}` : `--${m.kind} ${m.selector}` })).map((line) => `presence: ${line}`);
}

/** On the loaded page: the candidates of each kind in `kinds` → { hide?, dismiss?, pin? } ([{ selector, text, role }], ≤
 * TOP_CANDIDATES each). hide: `regions` (inFlowRegionsAboveHeader's, document order) with a selector, enriched in one
 * page.evaluate (regionFactsInPage; one that no longer matches exactly one element is skipped); dismiss / pin:
 * controlCandidatesInPage with the consent label sweep's labels. No navigation — the page the poll ran on. */
async function readCandidates(page, kinds, { regions = [], labels = [] } = {}) {
  const out = {};
  if (kinds.includes('hide')) {
    const rows = (regions || []).filter((c) => c && c.selector);
    const facts = rows.length ? await page.evaluate(regionFactsInPage, rows.map((c) => c.selector)) : [];
    out.hide = rows.flatMap((c, i) => (facts[i] ? [{ selector: c.selector, ...facts[i] }] : [])).slice(0, TOP_CANDIDATES);
  }
  for (const kind of ['dismiss', 'pin']) if (kinds.includes(kind)) out[kind] = await page.evaluate(controlCandidatesInPage, { kind, labels, limit: TOP_CANDIDATES });
  return out;
}
// live-session's consent label table, when the copy has one (an older project copy may not)
const consentLabels = (session) => [...((session.CONSENT_LABEL_SWEEP && session.CONSENT_LABEL_SWEEP.labels) || [])];

/** The CLI: argv after the script path → exit code; result lines go to `log`, warnings and refusals to `warn`. */
export async function main(argv, { env = process.env, log = console.log, warn = console.error } = {}) {
  if (argv.includes('--help') || argv.includes('-h')) { log(HELP); return 0; }
  const o = parseArgs(argv);
  const session = await loadLiveSession();
  const { parseHideList } = session;
  if (o.cmd === 'suggest') {
    // the presence file's "*" list is checked on the same page: a selector that matches nothing there is warned on
    const json = readJsonObject(o.file).json;
    checkEntry(json, '*', o.file);
    const entry = own(json, '*');
    const listed = parseHideList(entry && entry.hide);
    const seen = await withLivePage(session, o.url, o, async (page) => {
      const { misses } = listed.length ? await pollSelectors(page, listed, { waitMs: o.waitMs }) : { misses: [] };
      const list = await session.inFlowRegionsAboveHeader(page);
      return { misses, list, controls: o.kind === 'hide' ? null : (await readCandidates(page, [o.kind], { labels: consentLabels(session) }))[o.kind] };
    });
    const lines = o.kind === 'hide'
      ? suggestLines(seen.list, o)
      : candidateLines(o.kind, seen.controls, { url: o.url, width: o.width, file: o.file, waitMs: o.waitGiven ? o.waitMs : null, headed: o.headed });
    for (const line of lines.length ? lines : [session.formatCandidates([])]) log(line);
    if (seen.misses.length) warn(`presence: WARNING ${session.hideMissLine(seen.misses, seen.list)}`);
    return 0;
  }
  const key = o.cmd === 'add' && o.slug ? o.slug : '*';
  if (o.cmd === 'add') return add(o, key, session, { log, warn });
  const run = readRun(o.run);
  const raw = env[ENV_OVERLAYS];
  const { selectors, reasonOf } = seedSelectors(run.overlays, raw, parseHideList);
  if (!selectors.length) {
    // the presence file is still checked: a malformed one fails here, not at the first gate round
    checkEntry(readJsonObject(o.file).json, key, o.file);
    log(`nothing to seed (${o.run}: ${run.found ? 'no siteOverlays' : 'not found'}; ${ENV_OVERLAYS}: ${raw === undefined ? 'unset' : 'empty'})`);
    return 0;
  }
  const current = readJsonObject(o.file).json;
  checkEntry(current, key, o.file);
  const r = applyHide(current, key, selectors, { parse: parseHideList, reasonOf, onlyAdded: true });
  // the resulting list is printed only once it is true on disk: a failed write prints nothing as written
  if (r.changed) writeAtomic(o.file, r.json);
  log(`${key}.hide: ${r.list.join(', ')}`);
  log(r.changed ? `wrote ${o.file}: +${plural(r.added.length, 'selector')}, ${plural(r.reasonChanges, 'reason')}` : `unchanged: ${o.file}`);
  return 0;
}

/** `add`: the call's hide / dismiss / pin / allow → the key's entry (verified on the live page first with --verify). */
async function add(o, key, session, { log, warn }) {
  const { parseHideList } = session;
  const call = { hide: parseHideList(o.hide), dismiss: parseHideList(o.dismiss) };
  if (o.hide.length && !call.hide.length) throw new UsageError('presence: --hide names no selector (see --help)');
  if (o.dismiss.length && !call.dismiss.length) throw new UsageError('presence: --dismiss names no selector (see --help)');
  const reasonOf = o.reason ? () => o.reason : null;
  // a malformed presence file is refused before the page is opened (it is read again after the wait), and so is a
  // per-visitor-dialog allowance whose container the page does not hide ("*" and the key's hide, this call's included)
  const pending = readJsonObject(o.file).json;
  checkEntry(pending, key, o.file);
  const hideOf = (k) => (isPlainObject(own(pending, k)) ? pending[k].hide : null);
  const hidden = parseHideList(hideOf('*'), key === '*' ? null : hideOf(key), call.hide);
  for (const a of o.allow) {
    if (a.kind === 'per-visitor-dialog' && !hidden.includes(a.selector)) throw new UsageError(`presence: per-visitor-dialog ${a.selector} is not in the hide list of ${key === '*' ? '"*"' : key} — add --hide ${shellArg(a.selector)} in the same call (a dialog left open is allowed only when its container is hidden)`);
  }
  const checks = [...new Set([...call.hide, ...call.dismiss, ...(o.pin ? [o.pin] : []), ...o.allow.map((a) => a.selector)])];
  if (o.verify) {
    const v = await withLivePage(session, o.verify, o, async (page) => {
      const polled = await pollSelectors(page, checks, { waitMs: o.waitMs });
      const miss = (sel) => polled.misses.includes(sel);
      // the missed settings in call order, each with its kind: the candidates are read for that kind on this same page
      const missed = [
        ...call.hide.filter(miss).map((selector) => ({ kind: 'hide', selector })),
        ...call.dismiss.filter(miss).map((selector) => ({ kind: 'dismiss', selector })),
        ...(o.pin && miss(o.pin) ? [{ kind: 'pin', selector: o.pin }] : []),
        ...o.allow.filter((a) => miss(a.selector)).map((a) => ({ kind: 'allow', selector: a.selector, allowKind: a.kind })),
      ];
      const candidates = missed.some((m) => m.kind === 'hide') ? await session.inFlowRegionsAboveHeader(page) : [];
      const suggested = missed.length ? await readCandidates(page, [...new Set(missed.map((m) => m.kind))], { regions: candidates, labels: consentLabels(session) }) : {};
      return { ...polled, candidates, missed, suggested };
    });
    if (v.misses.length) {
      const hideMissed = v.misses.filter((sel) => call.hide.includes(sel)); const otherMissed = v.misses.filter((sel) => !call.hide.includes(sel));
      if (hideMissed.length) warn(`presence: ${session.hideMissLine(hideMissed, v.candidates)}`);
      if (otherMissed.length) warn(`presence: dismiss / pin / allow matched nothing on ${o.verify} @ ${o.width}px (${otherMissed.join(', ')})`);
      const flags = { url: o.verify, width: o.width, state: o.state, slug: o.slug, reason: o.reason, file: o.file, waitMs: o.waitGiven ? o.waitMs : null, headed: o.headed };
      for (const line of missSuggestLines(v.missed, v.suggested, flags)) warn(line);
      warn(`presence: refused — nothing written to ${o.file}`);
      return 2;
    }
    log(`verified on ${o.verify} @ ${o.width}px: ${checks.map((sel, i) => `${sel} ×${v.counts[i]}`).join(', ')}`);
  }
  const current = readJsonObject(o.file).json;
  checkEntry(current, key, o.file);
  let json = current; let added = 0; let reasons = 0; const lines = [];
  for (const field of ['hide', 'dismiss']) {
    if (!call[field].length) continue;
    const r = applyList(json, key, field, call[field], { parse: parseHideList, reasonOf });
    json = r.json; added += r.added.length; reasons += r.reasonChanges;
    lines.push(`${key}.${field}: ${r.list.join(', ')}`);
  }
  if (o.pin) {
    const r = applyPin(json, key, { sel: o.pin, state: o.state }, o.reason);
    json = r.json; added += r.changes; reasons += r.reasonChanges;
    lines.push(`${key}.pin: ${r.list.map((x) => `${x.sel} → ${x.state}`).join(', ')}`);
  }
  if (o.allow.length) {
    const r = applyAllow(json, key, o.allow, o.reason);
    json = r.json; added += r.changes;
    lines.push(`${key}.allow: ${r.list.map((x) => `${x.kind} ${x.selector} (${x.reason})`).join(', ')}`);
  }
  const changed = json !== current;
  // the resulting lists are printed only once they are true on disk: a failed write prints nothing as written
  if (changed) writeAtomic(o.file, json);
  for (const line of lines) log(line);
  const hideOnly = !call.dismiss.length && !o.pin && !o.allow.length;
  log(changed ? `wrote ${o.file}: +${plural(added, hideOnly ? 'selector' : 'setting')}, ${plural(reasons, 'reason')}` : `unchanged: ${o.file}`);
  if (!o.verify) warn(`presence: ${UNVERIFIED}`);
  return 0;
}

// Compare by real path: a symlinked checkout or scratch dir must not turn the CLI into a silent no-op.
function safeRealpath(p) { try { return realpathSync(p); } catch { return p; } }
if (process.argv[1] && fileURLToPath(import.meta.url) === safeRealpath(process.argv[1])) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => {
    const known = e instanceof UsageError || e instanceof InputError || e instanceof LiveError;
    console.error(known ? e.message : `presence: ${e.stack || e.message}`);
    process.exitCode = known ? e.code : 1;
  });
}
