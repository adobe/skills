/**
 * brand-mark — the fixed brand mark above a partner grid; rows: [picture | caption].
 * @fixed-asset /img/brand/mark.svg — the brand mark is identical on every instance
 */
import { buildCards } from '../cards/cards.js';
import { createOptimizedPicture, loadCSS } from '../../scripts/aem.js';

const MARK = '/img/brand/mark.svg';

export default async function decorate(block) {
  await loadCSS(`${window.hlx.codeBasePath}/blocks/cards/cards.css`);
  const pictures = block.querySelectorAll('picture');
  const media = pictures.length ? [...pictures] : [...block.querySelectorAll('img')];
  block.prepend(createOptimizedPicture('/img/brand/mark.svg', 'brand mark'));
  block.append(buildCards(block, media, MARK));
}
