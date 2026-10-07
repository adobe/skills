// Opens the chat panel with a question from anywhere in the app (inline AI suggestions).
const EVT = 'spec-ask';
export const askScope = (question: string) => window.dispatchEvent(new CustomEvent<string>(EVT, { detail: question }));
export const onAsk = (fn: (question: string) => void) => {
  const h = (e: Event) => fn((e as CustomEvent<string>).detail);
  window.addEventListener(EVT, h);
  return () => window.removeEventListener(EVT, h);
};
