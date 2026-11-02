import { readFileSync } from 'node:fs';
import { fail, findFile, findJson, graded, ok } from '../../lib/outputs.mjs';

/** A collector's result from <name>.json anywhere under out/, or from collection.json when `all` was run. */
const collector = (response, name) =>
  findJson(response, `${name}.json`) ?? findJson(response, 'collection.json')?.collectors?.[name] ?? null;

const problems = (checks) => Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
const verdict = (list, what) => (list.length ? fail(`${what}: ${list.join(', ')}`) : ok(what));

const platformsOf = (r) => (collector(r, 'socials')?.socials ?? []).map((s) => s.platform);

const FIXTURE_CHECKS = {
  'meta-backlinko': (r) => {
    const meta = collector(r, 'metadata');
    return {
      'title names the brand': /Backlinko/.test(meta?.title ?? ''),
      'og:site_name': meta?.tags?.['og:site_name'] === 'Backlinko',
      'canonical': meta?.canonical?.replace(/\/$/, '') === 'https://backlinko.com',
    };
  },
  'socials-wpbeginner': (r) => ({
    'facebook, youtube, twitter': ['facebook', 'youtube', 'twitter'].every((p) => platformsOf(r).includes(p)),
    'at least five platforms': new Set(platformsOf(r)).size >= 5,
  }),
  'socials-stripe': (r) => ({
    'github and youtube': ['github', 'youtube'].every((p) => platformsOf(r).includes(p)),
  }),
  'all-fixture': (r) => {
    const meta = collector(r, 'metadata');
    const forms = collector(r, 'forms')?.forms ?? [];
    const videos = collector(r, 'videos')?.videos ?? [];
    const socials = (collector(r, 'socials')?.socials ?? []).map((s) => s.platform);
    const icons = collector(r, 'icons')?.icons ?? [];
    return {
      'title': meta?.title === 'Mountain Lodge | Rooms and trails',
      'og:title': meta?.tags?.['og:title'] === 'Mountain Lodge',
      'two forms': forms.length === 2,
      'two videos': videos.length === 2,
      'four social platforms': ['twitter', 'linkedin', 'github', 'instagram'].every((p) => socials.includes(p)),
      'logo and two icons': icons.filter((i) => i.class === 'logo').length === 1 && icons.filter((i) => i.class === 'icon').length === 2,
    };
  },
  'icons-fixture': (r) => {
    const icons = collector(r, 'icons')?.icons ?? [];
    const named = (n) => icons.some((i) => i.name === n);
    const searchPath = findFile(r, 'search.svg');
    const search = searchPath ? readFileSync(searchPath, 'utf-8') : '';
    return {
      'search and menu icons listed': named('search') && named('menu'),
      'logo listed': icons.some((i) => i.class === 'logo'),
      'svg files written': ['search', 'menu'].every((n) => findFile(r, `${n}.svg`)),
      'icon recolored to currentColor': search?.includes('currentColor'),
    };
  },
  'sprites-fixture': (r) => {
    const icons = collector(r, 'icons')?.icons ?? [];
    const names = icons.map((i) => i.name);
    const favorites = findFile(r, 'favorites.svg');
    return {
      'favorites, rate and download listed': ['favorites', 'rate', 'download'].every((n) => names.includes(n)),
      'svg files written': ['favorites', 'rate', 'download'].every((n) => findFile(r, `${n}.svg`)),
      'icons recolored to currentColor': favorites ? readFileSync(favorites, 'utf-8').includes('currentColor') : false,
    };
  },
  'jsonld-fixture': (r) => {
    const data = collector(r, 'metadata')?.structuredData ?? [];
    return {
      'organization found': data.some((d) => d['@type'] === 'Organization' && d.name === 'Sprite Co'),
    };
  },
  'forms-fixture': (r) => {
    const forms = collector(r, 'forms')?.forms ?? [];
    const byAction = Object.fromEntries(forms.map((f) => [f.action, f]));
    return {
      'two forms': forms.length === 2,
      'booking form': byAction['/book']?.method === 'post' && byAction['/book']?.fields?.some((f) => f.name === 'email'),
      'newsletter form': byAction['/newsletter']?.method === 'get',
    };
  },
  'collection-valid': (r) => {
    const names = ['icons', 'metadata', 'text', 'forms', 'videos', 'socials'];
    return {
      'all six collectors present': names.every((n) => collector(r, n)),
      'page title captured': Boolean(collector(r, 'metadata')?.title),
    };
  },
};

export const collectMatches = graded((_output, { vars, providerResponse }) => {
  const check = FIXTURE_CHECKS[vars.check];
  if (!check) return fail(`unknown check ${vars.check}`);
  const list = problems(check(providerResponse));
  return verdict(list, list.length ? 'failed checks' : `${vars.check} checks passed`);
});
