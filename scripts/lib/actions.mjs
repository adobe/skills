// What a script tells GitHub Actions: step outputs, the step summary, log groups and
// annotations. Outside Actions the files are not set and nothing is written to them.
import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// A step output. A value with line breaks is written with a delimiter of its own.
export function setOutput(name, value) {
  const file = process.env.GITHUB_OUTPUT;
  if (!file) return;
  const text = String(value);
  if (text.includes('\n')) {
    const delimiter = `EOF_${randomUUID()}`;
    appendFileSync(file, `${name}<<${delimiter}\n${text}\n${delimiter}\n`);
  } else {
    appendFileSync(file, `${name}=${text}\n`);
  }
}

export function summary(lines) {
  const file = process.env.GITHUB_STEP_SUMMARY;
  if (file) appendFileSync(file, `${[lines].flat().join('\n')}\n`);
}

// A Markdown table for the step summary.
export function table(header, rows) {
  return [
    `| ${header.join(' | ')} |`,
    `|${header.map(() => '---').join('|')}|`,
    ...rows.map((row) => `| ${row.join(' | ')} |`),
  ];
}

// Characters that would end or forge a workflow command are escaped.
const escape = (text) => String(text).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A');

export const error = (message) => console.log(`::error::${escape(message)}`);
export const warning = (message) => console.log(`::warning::${escape(message)}`);

export function group(title, body) {
  console.log(`::group::${escape(title)}`);
  try {
    return body();
  } finally {
    console.log('::endgroup::');
  }
}
