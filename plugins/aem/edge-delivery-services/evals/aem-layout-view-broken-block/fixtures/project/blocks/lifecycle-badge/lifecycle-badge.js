export default function decorate(block) {
  block.textContent = '';
  const badge = document.createElement('span');
  badge.className = 'lifecycle-badge-label';
  badge.textContent = 'Beta';
  block.append(badge);
}
