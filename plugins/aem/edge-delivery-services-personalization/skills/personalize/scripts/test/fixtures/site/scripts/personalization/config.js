// Test fixture: a site config as setup records it (contract site-config.schema.json).
export default {
  consent: { mode: 'cmp', tool: 'onetrust' },
  hasConsent: () => window.OnetrustActiveGroups?.includes(',C0004,'),
  fragmentPrefixes: ['/fragments/'],
  budgets: { eager: 800, lazy: 2000 },
  api: { endpoint: '/pzn/decide', engine: 'generic', timeout: 1500 },
  target: { transport: 'delivery-api', clientCode: '' },
  audiences: {},
  mock: false,
};
