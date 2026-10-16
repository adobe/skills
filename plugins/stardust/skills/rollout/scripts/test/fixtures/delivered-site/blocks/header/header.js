/**
 * Header block: loads the nav document into the page header.
 */
export default async function decorate(block) {
  const resp = await fetch('/nav.plain.html');
  if (resp.ok) block.innerHTML = await resp.text();
}
