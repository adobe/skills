/*
 * Personalization block: a placeholder whose rows pick the fragment to render.
 * All logic lives in scripts/personalization/; see its index.js.
 */

import { personalize } from '../../scripts/personalization/index.js';

export default async function decorate(block) {
  await personalize(block);
}
