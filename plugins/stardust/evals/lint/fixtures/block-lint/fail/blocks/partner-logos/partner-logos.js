/**
 * partner-logos — one authored row per partner: [logo | name].
 * Fixture: every block-lint 🔴 in one file (BL-CSS, BL-MEDIA, IMG-HARDCODED ×3).
 */
import { buildCards } from '../cards/cards.js';
import { createOptimizedPicture } from '../../scripts/aem.js';

const LOGOS = ['/img/partners/alpha.png', '/img/partners/beta.png', '/img/partners/gamma.png'];
const slug = (s) => s.toLowerCase().replace(/\W+/g, '-');

export default function decorate(block) {
  const media = block.querySelectorAll('picture, img');
  [...block.children].forEach((row, i) => {
    const title = row.querySelector('h3')?.textContent || '';
    const fallback = LOGOS[i];
    const icon = `/icons/${slug(title)}.svg`;
    row.dataset.icon = icon;
    row.dataset.fallback = fallback;
    row.append(createOptimizedPicture('/img/partners/placeholder.png', 'partner'));
  });
  block.append(buildCards(block, media));
}
