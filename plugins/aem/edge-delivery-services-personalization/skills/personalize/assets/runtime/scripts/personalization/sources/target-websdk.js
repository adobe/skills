/*
 * `target` source over the Adobe Web SDK (contract section 7,
 * config.target.transport 'websdk'), for pages that already load alloy
 * (directly or through Tags). Uses the existing instance
 * (config.target.alloyInstance, default `alloy`).
 *
 * One sendEvent fetches the page's target locations (each section's
 * `Personalization Location` row, else its id) as decision scopes, with
 * type decisioning.propositionFetch, renderDecisions false and
 * defaultPersonalizationEnabled false: it renders nothing and isn't counted
 * as a page view. A JSON content item { "fragment": ... } or
 * { "control": true } is the answer. Display and click are proposition
 * display / interact events. The Web SDK owns the visitor id and its own
 * consent; this runtime still calls it only with personalization consent.
 *
 * Status: built against the Web SDK documentation and tested with a stub.
 * Check it on a live datastream (Adobe Experience Platform Debugger) before
 * calling it supported.
 */

import { locationOf, readOffer } from './target.js';

export const JSON_ITEM = 'https://ns.adobe.com/personalization/json-content-item';

const isObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * @param {object} target config.target
 * @returns {Function|null} the alloy instance
 */
export function alloyOf(target = {}) {
  const instance = window[target.alloyInstance || 'alloy'];
  return typeof instance === 'function' ? instance : null;
}

/**
 * The sendEvent options that fetch the given locations.
 * @param {string[]} locations
 * @returns {object}
 */
export function fetchOptions(locations) {
  return {
    type: 'decisioning.propositionFetch',
    renderDecisions: false,
    personalization: { decisionScopes: locations, defaultPersonalizationEnabled: false },
  };
}

function trackingOf(scopeDetails) {
  if (!isObject(scopeDetails)) return undefined;
  const tracking = {
    'activity.id': scopeDetails.activity?.id,
    'experience.id': scopeDetails.experience?.id,
  };
  const kept = Object.entries(tracking).filter(([, value]) => typeof value === 'string' || typeof value === 'number');
  return kept.length ? Object.fromEntries(kept) : undefined;
}

/**
 * Normalized answers from a sendEvent result's propositions.
 * @param {object[]} propositions
 * @param {string[]} locations
 * @returns {object} location -> answer, or undefined when nothing was returned
 */
export function toAnswers(propositions, locations) {
  return Object.fromEntries(locations.map((location) => {
    const proposition = (propositions || []).find((candidate) => candidate.scope === location);
    const items = proposition?.items || [];
    if (!proposition || !items.length) return [location, undefined];
    const item = items.find((candidate) => candidate.schema === JSON_ITEM);
    const offer = item ? readOffer(item.data?.content) : { invalid: 'proposition has no JSON content item' };
    const { id, scope, scopeDetails } = proposition;
    const ref = { id, scope, scopeDetails };
    return [location, JSON.parse(JSON.stringify({
      ...offer,
      tracking: trackingOf(proposition.scopeDetails),
      tokens: { display: [ref], click: [ref] },
    }))];
  }));
}

/**
 * The XDM event reporting a display or click of a proposition.
 * @param {'display'|'click'} type
 * @param {object[]} propositions { id, scope, scopeDetails }
 * @returns {object}
 */
export function propositionEvent(type, propositions) {
  return {
    xdm: {
      eventType: type === 'click' ? 'decisioning.propositionInteract' : 'decisioning.propositionDisplay',
      _experience: {
        decisioning: {
          propositions,
          propositionEventType: type === 'click' ? { interact: 1 } : { display: 1 },
        },
      },
    },
  };
}

/**
 * @param {object[]} specs target section specs
 * @param {object} context visitor context (the Web SDK sends its own)
 * @param {object} options { config }
 * @returns {Promise<{answers?: object, error?: string, kind?: string}>}
 */
export async function decide(specs, context, { config }) {
  const target = config.target || {};
  const alloy = alloyOf(target);
  if (!alloy) return { error: `window.${target.alloyInstance || 'alloy'} is not loaded`, kind: 'config' };
  const locations = [...new Set(specs.map(locationOf))];
  try {
    const result = await alloy('sendEvent', fetchOptions(locations));
    const byLocation = toAnswers(result?.propositions, locations);
    const answers = Object.fromEntries(specs
      .map((spec) => [spec.id, byLocation[locationOf(spec)]]));
    return { answers };
  } catch (error) {
    return { error: error.message || 'sendEvent failed', kind: 'http' };
  }
}

/**
 * @param {{type: 'display'|'click', decision: object}} event
 * @param {object} options { config }
 * @returns {Promise<{ok: boolean}|null>}
 */
export async function notify({ type, decision }, { config }) {
  const propositions = decision.tokens?.[type];
  if (!propositions?.length) return null;
  const alloy = alloyOf(config.target);
  if (!alloy) return { ok: false };
  try {
    await alloy('sendEvent', propositionEvent(type, propositions));
    return { ok: true };
  } catch (e) {
    return { ok: false };
  }
}
