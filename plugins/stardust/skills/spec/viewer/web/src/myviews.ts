// "My views": generated views this browser created or saved. The views themselves live in D1 and are shareable by link.
export type MyView = { id: string; title: string; created: string };
const KEY = 'spec-viewer-my-views';
const EVT = 'my-views-changed';

export const listViews = (): MyView[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; } };
const save = (v: MyView[]) => { localStorage.setItem(KEY, JSON.stringify(v)); window.dispatchEvent(new Event(EVT)); };
export const addView = (v: MyView) => save([v, ...listViews().filter((x) => x.id !== v.id)]);
export const removeView = (id: string) => save(listViews().filter((x) => x.id !== id));
export const hasView = (id: string) => listViews().some((x) => x.id === id);
export const onViewsChange = (fn: () => void) => {
  window.addEventListener(EVT, fn); window.addEventListener('storage', fn);
  return () => { window.removeEventListener(EVT, fn); window.removeEventListener('storage', fn); };
};
