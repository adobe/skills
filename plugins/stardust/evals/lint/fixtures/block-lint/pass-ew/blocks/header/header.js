/** header — chrome block that moves its nav list and reads text only to classify. */
export default function decorate(block) {
  const nav = document.createElement('nav');
  const list = block.querySelector('ul');
  if (list.textContent.includes('Sign in')) nav.dataset.hasAuth = 'true';
  nav.append(list);
  block.replaceChildren(nav);
}
