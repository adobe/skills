import { fail, graded, ok, readJson } from '../../lib/outputs.mjs';

const BASE = 'http://localhost:8765';
const paths = (r) => (readJson(r, 'urls.json')?.urls ?? []).map((u) => u.url.replace(BASE, '')).sort();
const langs = (r) => new Set((readJson(r, 'urls.json')?.urls ?? []).map((u) => u.lang).filter(Boolean));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const ALL = [
  '/en/',
  '/en/archive/2019',
  '/en/blog?page=2&sort=new',
  '/en/products/summit',
  '/en/products/trailhead',
  '/fr-fr/',
  '/fr-fr/produits/trailhead',
];

const CHECKS = {
  'inventory-fixture': (r) => ({
    'all seven URLs, once each': same(paths(r), ALL),
    'languages en and fr-FR': langs(r).has('en') && langs(r).has('fr-FR'),
    'the missing German sitemap is reported': (readJson(r, 'urls.json')?.errors ?? []).some((e) => /sitemap-de/.test(e.url)),
  }),
  'exclude-fixture': (r) => ({
    'archive left out, the other six kept': same(paths(r), ALL.filter((p) => !p.includes('/archive/'))),
  }),
  'limit-fixture': (r) => ({
    'exactly three URLs': paths(r).length === 3,
    'all of them from the sitemaps': paths(r).every((p) => ALL.includes(p)),
  }),
  'links-fixture': (r) => ({
    'home, pricing and prix, no fragment': same(paths(r), ['/site/en/pricing.html', '/site/fr-fr/prix.html', '/site/home.html']),
  }),
  'sitemap-valid': (r) => ({
    'more than ten URLs on the origin': (readJson(r, 'urls.json')?.urls ?? []).length > 10,
    'all on www.aem.live': (readJson(r, 'urls.json')?.urls ?? []).every((u) => u.url.startsWith('https://www.aem.live/')),
  }),
};

export const scanMatches = graded((_output, { vars, providerResponse }) => {
  const check = CHECKS[vars.check];
  if (!check) return fail(`unknown check ${vars.check}`);
  const failed = Object.entries(check(providerResponse)).filter(([, passed]) => !passed).map(([name]) => name);
  return failed.length ? fail(`failed checks: ${failed.join(', ')}`) : ok(`${vars.check} checks passed`);
});
