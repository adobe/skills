'use strict';

/**
 * Legacy UI (dialog) RUNTIME invariant — the "Render" half of RV for UI.
 * Deploy the migrated Coral 3 dialog and confirm it actually renders as Coral 3
 * Touch UI on the live instance (real coral-* web components, not Coral 2).
 *
 * Oracle (render → observe markup):
 *   render  → GET the dialog's .html on the SDK
 *   observe → the response is Coral 3 (coral-textfield / coral-Form)
 *
 * ctx: { probe, target }   target: { renderPath }  e.g. /apps/.../cq%3Adialog.html
 */
module.exports = {
  pattern: 'lui',

  async check({ probe, target }) {
    const checks = {};
    const resp = await probe.callGet(target.renderPath);
    const html = resp.body || '';

    checks.dialog_renders = resp.status === 200;
    checks.renders_coral3 = /is="coral-textfield"|coral-Form|components\/coral\/foundation/.test(html);

    if (!checks.dialog_renders) return fail('runtime.dialog_not_rendered', checks, `status ${resp.status}`);
    if (!checks.renders_coral3) return fail('runtime.not_coral3', checks, 'rendered markup is not Coral 3');
    return { result: 'pass', failure_class: null, checks };
  },
};

function fail(failure_class, checks, evidence = '') {
  return { result: 'fail', failure_class, checks, evidence };
}
