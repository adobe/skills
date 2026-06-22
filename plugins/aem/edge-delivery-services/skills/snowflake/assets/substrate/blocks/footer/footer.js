/**
 * Loads the template-specific footer fragment from the code bus.
 * Each overlay-controlled page sets main.dataset.overlay = <template>
 * during loadEager; we read it here to pick the right fragment.
 * Fragments live at /fragments/<template>/footer.html.
 */
export default async function decorate(block) {
  const template = document.querySelector('main')?.dataset?.overlay;
  if (!template) return;
  const path = `/fragments/${template}/footer.html`;
  const resp = await fetch(`${window.hlx.codeBasePath}${path}`);
  if (!resp.ok) {
    // eslint-disable-next-line no-console
    console.warn(`[footer] fragment not found at ${path}`);
    return;
  }
  block.innerHTML = await resp.text();
}
