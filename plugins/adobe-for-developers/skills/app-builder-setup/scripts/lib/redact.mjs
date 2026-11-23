// Masks credentials and personal data in text before it reaches the chat. Text is redacted line by line, with
// state for sensitive values that span lines. Regex work stays bounded per line; an overlong sensitive
// structure suppresses the rest of the input rather than risking disclosure.
import { existsSync, readFileSync } from 'node:fs';

// A longer single line is cut so regex work stays bounded; the partial word at the cut is dropped, not shown.
const MAX_LINE = 20_000;

// A key name is sensitive when it names a credential (anywhere in the name), or ends in "key" as its own word:
// MY_SERVICE_KEY, secretKey, x-api-key. A bare "key" (as in OpenWhisk annotations) is not.
const SENSITIVE_NAME = /token|secret|passw(or)?d|pwd|^pass$|passphrase|passcode|credential|cookie|authorization|signature|session|private[_-]?key|api[_-]?key|^auth$|^x-auth/i;
export const isSensitiveName = (name) => SENSITIVE_NAME.test(name) || /[_.-]key$/i.test(name) || /[a-z0-9]Key$/.test(name);

const NAME = '[A-Za-z_][\\w.-]*';
// Each pattern matches only the `key<sep>` prefix, so a harmless pair never swallows the pair after it
// (e.g. "stdout: IMS_ACCESS_TOKEN=x"). Sensitive prefixes get a marker; a second pass masks the value after it.
const KEY_VALUE = [
  // Escaped JSON (\"key\":\"v\"): the value ends at the next \" that isn't itself escaped (\\\").
  { prefix: `(?<![\\w.-])(\\\\?["']?)(${NAME})(\\\\?["']?\\s*[:=]\\s*\\\\")`, value: String.raw`(?:\\\\\\"|[^"\\\r\n]|\\(?!"))*` },
  // Quoted values ("key": "a b", key: 'a b'): the value runs to its own unescaped closing quote, so escaped quotes
  // ("a\"b") and the other quote style ("ab'cd") stay inside it.
  { prefix: `(?<![\\w.-])(\\\\?["']?)(${NAME})(\\\\?["']?\\s*[:=]\\s*")`, value: `(?:[^"\\\\\\r\\n]|\\\\.)*` },
  { prefix: `(?<![\\w.-])(\\\\?["']?)(${NAME})(\\\\?["']?\\s*[:=]\\s*')`, value: `(?:[^'\\\\\\r\\n]|\\\\.)*` },
  // Structured or bare JSON values: "secret": ["a"], key: { … }, "pin": 1234, "flag": true. Bare values are filled
  // here; bracketed ones are masked whole by maskStructured.
  { prefix: `(?<![\\w.-])(\\\\?["']?)(${NAME})(\\\\?["']?\\s*:\\s*)(?=[\\[{]|(?<=["']\\s*:\\s*)(?:-?\\d|true\\b|false\\b))`, value: `[^,}\\]\\s\\[{][^,}\\]\\s]*`, structured: true },
  // Unquoted values: key=value, key: value, ?key=value. Once a value has started, quotes are part of it (abc'def).
  { prefix: `(?<![\\w.-])()(${NAME})(\\s*[:=]\\s*)(?=[^"'\\s\\[{])`, value: `[^\\s,;&}\\]]+` },
  // URL-encoded assignments: ...%26access_token%3Dvalue.
  { prefix: `(?:(?<![\\w.-])|(?<=%26|%3[Ff]))()(${NAME})(%3[Dd])`, value: `[^&\\s"'%]*(?:%(?!26)[0-9A-Fa-f]{2}[^&\\s"'%]*)*` },
].map(({ prefix, value, structured = false }, i) => ({
  find: new RegExp(prefix, 'g'),
  mark: `\u0000${i}\u0000`,
  fill: new RegExp(`\u0000${i}\u0000(?:${value})`, 'g'),
  structured,
}));

// Scans a bracketed value from `from`, tracking nesting and quoted strings. Returns the index just after its closing
// bracket, or -1 with the depth still open at the end of the text.
function scanValue(text, from, depth = 0) {
  let quote = null;
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '[' || c === '{') depth++;
    else if ((c === ']' || c === '}') && --depth === 0) return { end: i + 1, depth: 0 };
  }
  return { end: -1, depth };
}

// Masks each whole bracketed value after `mark`. A value that doesn't close on this line masks the rest of it, and its
// open depth is returned so the following lines can be masked until it closes.
function maskStructured(text, mark) {
  let out = text;
  let openDepth = 0;
  for (let at = out.indexOf(mark); at !== -1; at = out.indexOf(mark, at)) {
    const { end, depth } = scanValue(out, at + mark.length);
    if (end === -1) openDepth = depth;
    out = `${out.slice(0, at)}[REDACTED]${end === -1 ? '' : out.slice(end)}`;
  }
  return { out, openDepth };
}

// Runtime log lines start with "<timestamp>  stdout: "; that prefix is kept and the rest of the line is redacted.
const LINE_PREFIX = /^\s*(?:\d{4}-\d\d-\d\dT[\d:.]+Z?\s+)?(?:(?:stdout|stderr):\s?)?/;
// A sensitive key at the end of a line (`"password":`) whose value starts on the next line.
const DANGLING_KEY = new RegExp(`(?<![\\w.-])\\\\?["']?(${NAME})\\\\?["']?\\s*[:=]\\s*$`);
const LEADING_SCALAR = /^(?:\\?"(?:[^"\\]|\\.)*"?|'(?:[^'\\]|\\.)*'?|[^\s,}\]]+)/;
// After this many continuation lines, stop scanning and suppress the rest of the input.
const MAX_OPEN_LINES = 200;

const KEY_BEGIN = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;
const KEY_END = /-----END [A-Z ]*PRIVATE KEY-----/;
const VALUE_PATTERNS = [
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----/g, '[REDACTED_PRIVATE_KEY]'],
  // Header lines: the whole value, whatever the scheme (Bearer, Basic, Digest, AWS4-HMAC-SHA256…) or cookie count.
  [/\b((?:proxy-)?authorization\s*:\s*)(?!["'\s])[^\r\n]+/gi, '$1[REDACTED]'],
  [/\b((?:set-)?cookie\s*:\s*)(?!["'\s])[^\r\n]+/gi, '$1[REDACTED]'],
  // Only token-like values (with a digit, dot or =), so prose such as "basic authentication" is kept.
  [/\b(bearer|basic)(\s+)(?=[\w.~+/=-]*[\d.=])[\w.~+/=-]{8,}/gi, '$1$2[REDACTED]'],
  [/eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, '[REDACTED_JWT]'],
  [/p8e-[\w-]{10,}/g, '[REDACTED_SECRET]'],
  [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_\w{20,})\b/g, '[REDACTED_TOKEN]'],
  [/\bxox[abprs]-[\w-]{10,}/g, '[REDACTED_TOKEN]'],
  [/\bAIza[\w-]{30,}/g, '[REDACTED_KEY]'],
  [/\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, '[REDACTED_KEY]'],
  [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:\w{32,}/gi, '[REDACTED_RUNTIME_AUTH]'],
];
const EMAIL = /(?<![\w.+-])[\w.+-]+@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}\b/g;

// .env values are secrets, except public Runtime routing values and generated IMS organisation IDs. Generated .env files
// use mixed case (e.g. AIO_runtime_namespace), so names are compared case-insensitively.
const PUBLIC_ENV = new Set(['AIO_RUNTIME_NAMESPACE', 'AIO_RUNTIME_APIHOST']);
function envValue(raw) {
  const quoted = raw.match(/^(["'])(.*)\1/);
  return quoted ? quoted[2] : raw.replace(/\s+#.*$/, '').trim();
}
const envValues = existsSync('.env')
  ? readFileSync('.env', 'utf8').split(/\r?\n/)
    .map((line) => line.match(/^\s*(?:export\s+)?([\w.]+)\s*=\s*(.*)$/))
    .filter((m) => m && !PUBLIC_ENV.has(m[1].toUpperCase()) && !/^AIO_IMS_CONTEXTS_.+_IMS__ORG__ID$/i.test(m[1]))
    .map((m) => envValue(m[2]))
    .filter((value) => value.length >= 6)
    .sort((a, b) => b.length - a.length)
  : [];

export const envMasking = existsSync('.env');

function redactLine(text) {
  // NUL is reserved for the masking markers below. Terminal colors are removed first, so a colored key name
  // (\x1b[33mpassword\x1b[0m=…) is still recognized.
  // eslint-disable-next-line no-control-regex
  let out = text.replace(/\u0000/g, '').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
  if (out.length > MAX_LINE) out = `${out.slice(0, MAX_LINE).replace(/\S*$/, '')} …[cut ${out.length - MAX_LINE} chars]`;
  for (const value of envValues) out = out.split(value).join('[REDACTED_ENV]');
  for (const [pattern, replacement] of VALUE_PATTERNS) out = out.replace(pattern, replacement);
  let openDepth = 0;
  for (const { find, mark, fill, structured } of KEY_VALUE) {
    out = out.replace(find, (match, quote, name, sep) => (isSensitiveName(name) ? `${quote}${name}${sep}${mark}` : match));
    out = out.replace(fill, '[REDACTED]');
    if (structured) ({ out, openDepth } = maskStructured(out, mark));
  }
  // A marker left without a value (nothing matched after the key) is dropped, never shown.
  out = out.replace(/\u0000\d+\u0000/g, '');
  return { text: out.includes('@') ? out.replace(EMAIL, '[REDACTED_EMAIL]') : out, openDepth };
}

// Returns a function that redacts one line at a time. Across lines it remembers a private-key block (those lines come
// back as null; callers drop them), a sensitive key that ended the previous line (this line's leading value is
// masked), and a sensitive object or array still open (lines are masked until it closes). Its `isSuppressed()` reports
// whether an overlong sensitive structure has suppressed the rest of the input.
export function createLineRedactor() {
  let inPrivateKey = false;
  let valueFollows = false;
  let open = null;
  let suppressRemaining = false;
  const redactNext = (line) => {
    const prefix = line.match(LINE_PREFIX)[0];
    let body = line.slice(prefix.length);
    let head = '';
    const leading = body.match(/^\s*/)[0];
    const value = body.slice(leading.length);
    if (open || (valueFollows && /^[[{]/.test(value))) {
      const { end, depth } = open ? scanValue(body, 0, open.depth) : scanValue(value, 0);
      if (end === -1) {
        const lines = open ? open.lines + 1 : 0;
        if (lines >= MAX_OPEN_LINES) {
          suppressRemaining = true;
          return `[REDACTED: sensitive value exceeded ${MAX_OPEN_LINES} lines; remaining log suppressed]`;
        }
        open = { depth, lines };
        valueFollows = false;
        return `${prefix}${leading}[REDACTED]`;
      }
      head = `${leading}[REDACTED]`;
      body = open ? body.slice(end) : value.slice(end);
      open = null;
    } else if (valueFollows) {
      const scalar = value.match(LEADING_SCALAR);
      if (scalar) {
        head = `${leading}[REDACTED]`;
        body = value.slice(scalar[0].length);
      }
    }
    const { text, openDepth } = redactLine(body);
    if (openDepth) open = { depth: openDepth, lines: 0 };
    const dangling = text.match(DANGLING_KEY);
    valueFollows = !open && Boolean(dangling && isSensitiveName(dangling[1]));
    return `${prefix}${head}${text}`;
  };
  const redactOne = (line) => {
    if (suppressRemaining) return null;
    if (inPrivateKey) {
      const end = line.match(KEY_END);
      if (!end) return null;
      inPrivateKey = false;
      const rest = line.slice(end.index + end[0].length);
      return rest.trim() ? redactNext(rest) : null;
    }
    const begin = line.match(KEY_BEGIN);
    if (begin && !KEY_END.test(line.slice(begin.index))) {
      inPrivateKey = true;
      valueFollows = false;
      open = null;
      return `${redactLine(line.slice(0, begin.index)).text}[REDACTED_PRIVATE_KEY]`;
    }
    return redactNext(line);
  };
  redactOne.isSuppressed = () => suppressRemaining;
  return redactOne;
}

// Like redactLines, but also reports whether the rest of the input was suppressed, so callers can say why output stops.
export function redactLinesWithStatus(lines) {
  const redactOne = createLineRedactor();
  const out = lines.map((line) => redactOne(String(line ?? ''))).filter((line) => line !== null);
  return { lines: out, suppressed: redactOne.isSuppressed() };
}

export const redactLines = (lines) => redactLinesWithStatus(lines).lines;

export const redact = (text) => redactLines(String(text ?? '').split(/\r?\n/)).join('\n');
