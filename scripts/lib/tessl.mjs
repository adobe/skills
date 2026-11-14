// What the Tessl CLI says when the organization has no credits left:
//   ✘ Your organization has run out of credits. Upgrade your plan or buy more credits to continue.
// Nothing ran then, so it says nothing about a skill. The workflows report it as skipped,
// not as failed.
export const outOfCredits = (output) => /\bout of credits\b/i.test(output ?? '');
