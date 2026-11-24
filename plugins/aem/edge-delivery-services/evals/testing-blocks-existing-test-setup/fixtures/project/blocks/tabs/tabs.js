import { fireAnalyticsEvent } from '../../scripts/analytics.js';

export function toTabId(label, taken = new Set()) {
  const base = label
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'tab';
  let id = base;
  let n = 2;
  while (taken.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  taken.add(id);
  return id;
}

export function initialIndex(hash, ids) {
  const index = ids.indexOf(decodeURIComponent((hash || '').replace(/^#/, '')));
  return index < 0 ? 0 : index;
}

export function nextIndex(current, key, count) {
  switch (key) {
    case 'ArrowRight': return (current + 1) % count;
    case 'ArrowLeft': return (current - 1 + count) % count;
    case 'Home': return 0;
    case 'End': return count - 1;
    default: return current;
  }
}

export default function decorate(block) {
  const taken = new Set();
  const tabs = [...block.children].map((row) => {
    const [labelCell, panelCell] = row.children;
    const label = labelCell?.textContent.trim();
    if (!label) return null;
    return { label, id: toTabId(label, taken), panelCell };
  }).filter(Boolean);

  if (!tabs.length) {
    block.replaceChildren();
    return;
  }

  const tablist = document.createElement('div');
  tablist.className = 'tabs-list';
  tablist.setAttribute('role', 'tablist');

  const panels = tabs.map(({ label, id, panelCell }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'tabs-tab';
    button.id = `tab-${id}`;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', `tabpanel-${id}`);
    button.dataset.analytics = `tabs:${id}`;
    button.textContent = label;
    tablist.append(button);

    const panel = document.createElement('div');
    panel.className = 'tabs-panel';
    panel.id = `tabpanel-${id}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', button.id);
    panel.tabIndex = 0;
    if (panelCell) panel.append(...panelCell.childNodes);
    return panel;
  });

  const buttons = [...tablist.children];

  const select = (index, { focus = false, track = false } = {}) => {
    buttons.forEach((button, i) => {
      const selected = i === index;
      button.setAttribute('aria-selected', selected);
      button.tabIndex = selected ? 0 : -1;
      panels[i].hidden = !selected;
    });
    if (focus) buttons[index].focus();
    if (track) fireAnalyticsEvent('tab-select', { tab: tabs[index].id, position: index + 1 });
  };

  tablist.addEventListener('click', (e) => {
    const button = e.target.closest('[role="tab"]');
    if (button) select(buttons.indexOf(button), { track: true });
  });

  tablist.addEventListener('keydown', (e) => {
    const current = buttons.indexOf(document.activeElement);
    if (current < 0) return;
    const next = nextIndex(current, e.key, buttons.length);
    if (next === current) return;
    e.preventDefault();
    select(next, { focus: true, track: true });
  });

  block.replaceChildren(tablist, ...panels);
  select(initialIndex(window.location.hash, tabs.map((tab) => tab.id)));
}
