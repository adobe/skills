module.exports = {
  root: true,
  extends: 'airbnb-base',
  env: { browser: true },
  parser: '@babel/eslint-parser',
  parserOptions: { allowImportExportEverywhere: true, sourceType: 'module', requireConfigFile: false },
  rules: {
    'import/extensions': ['error', { js: 'always' }],
    'linebreak-style': ['error', 'unix'],
    'no-param-reassign': [2, { props: false }],
  },
};
