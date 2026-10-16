/**
 * Footer block: loads the footer document into the page footer.
 */
export default async function decorate(block) {
  const resp = await fetch('/footer.plain.html');
  if (resp.ok) block.innerHTML = await resp.text();
}
