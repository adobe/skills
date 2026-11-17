// Plugins and skills that are brought in from another repository, where their owners write
// them. What is here is a copy: a change made here is overwritten by the next import.
//
// The rules of this repository still apply to them, but they are kept where the copy comes
// from, and this repository doesn't hold the copy to them:
// - A check of the whole tree leaves them out, so a copy that breaks a rule doesn't fail
//   every other pull request. scripts/check-imported.mjs instead fails the pull request
//   that brings a new copy, with the list of what it would have to change. A maintainer
//   merges it anyway, with that check red.
// - CI doesn't rewrite them: no generated manifest, no version, no changelog, no publish to
//   the Tessl registry that their own files don't ask for.
// - A pull request that changes them, by anyone but their code owners, is closed, and so is
//   an issue about them (scripts/pr-policy.mjs): the change belongs where they come from.
//
// `path` ends with a slash. `from` names where they come from, when that is public.
// `plugins` are the whole plugins among them, by name, with their directories.
// run-workflow's plugin is ours, with its version from the releases here; its skill is
// brought in.
export const IMPORTED = [
  {
    path: 'plugins/commerce/',
    name: 'the Commerce plugins',
    from: 'adobe/aio-commerce-sdk',
    plugins: {
      'commerce-app-management': 'plugins/commerce/app-management',
      'commerce-app-migration': 'plugins/commerce/app-migration',
      'commerce-app-review': 'plugins/commerce/app-review',
    },
  },
  {
    path: 'plugins/creative-cloud/adobe-for-creativity/',
    name: 'adobe-for-creativity',
    from: null,
    plugins: { 'adobe-for-creativity': 'plugins/creative-cloud/adobe-for-creativity' },
  },
  { path: 'plugins/creative-cloud/run-workflow/skills/', name: 'the skill of run-workflow', from: null, plugins: {} },
];

// The import a path lies in (a file, or a directory without the trailing slash), or null.
export const importOf = (path) => IMPORTED.find(({ path: prefix }) => `${path}/`.startsWith(prefix) || path.startsWith(prefix)) ?? null;
export const isImported = (path) => importOf(path) !== null;

// Where an import comes from, for a sentence: "adobe/aio-commerce-sdk", or "another repository".
export const origin = (entry) => (entry.from ? `\`${entry.from}\`` : 'another repository');
