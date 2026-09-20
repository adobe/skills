// importer / renderer for the fixture blocks — references value-props but never the icon leaf
export function renderValueProps(rows) { return `<ul class="value-props">${rows.map((r) => `<li class="value-props__item"><h3>${r.title}</h3><p>${r.copy}</p></li>`).join('')}</ul>`; }
export function renderCards(rows) { return `<div class="cards">${rows.map((r) => `<div class="card">…</div>`).join('')}</div>`; }
export const blocks = ['tabs', 'cards', 'value-props', 'link-list'];
