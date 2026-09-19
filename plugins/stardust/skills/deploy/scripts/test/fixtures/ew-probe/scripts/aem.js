// Mini aem.js for the probe fixture: the shapes block JS imports, plus the
// import-time side effect the real one has (init() → RUM sampling off-origin).
export function getMetadata(name) {
  const m = document.head.querySelector(`meta[name="${name}"]`);
  return m ? m.content : '';
}
export function createOptimizedPicture(src, alt = '') {
  const pic = document.createElement('picture');
  const img = document.createElement('img');
  img.src = src; img.alt = alt; img.loading = 'lazy';
  pic.append(img);
  return pic;
}
export function decorateIcons() {}
fetch('https://rum.hlx.page/.rum/1').catch(() => {});
