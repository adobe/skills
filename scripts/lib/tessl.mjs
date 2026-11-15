// What the Tessl CLI says when the organization has no credits left:
//   ✘ Your organization has run out of credits. Upgrade your plan or buy more credits to continue.
// Nothing ran then, so it says nothing about a skill. The workflows report it as skipped,
// not as failed.
export const outOfCredits = (output) => /\bout of credits\b/i.test(output ?? '');

// What `tessl plugin publish` did, from its exit status and what it printed (CLI 0.119.0):
//   published   exit 0. The upload was accepted; Tessl may still run publication checks.
//   exists      "<name>@<version> already exists. Bump the version in …". The version is on
//               the registry: from an earlier run of the job, or from an attempt that timed
//               out after its upload went through.
//   timeout     "Publish timed out after 20 seconds". The CLI gave up waiting; the upload
//               may or may not have gone through. Worth another attempt.
//   blocked     exit 0 with "publication is blocked" or "publication checks could not
//               complete": the upload was accepted and the version is not usable.
//   failed      anything else.
export function publishOutcome(status, output) {
  const text = output ?? '';
  if (/Upload accepted, but publication (is blocked|checks could not complete)/.test(text)) return 'blocked';
  if (status === 0) return 'published';
  if (/@\S+ already exists\. Bump the version/.test(text)) return 'exists';
  if (/Publish timed out/i.test(text)) return 'timeout';
  return 'failed';
}

