/*
 * Offer popup for `target` sections with `Personalization Display | popup`
 * (or a Trigger row): a native modal <dialog> labelled by the offer's
 * heading. Escape, the close button and a click on the backdrop close it.
 * sections.js opens it at most once per decision. Styles:
 * styles/target-popup.css (site-owned).
 */

let opened = 0;

/**
 * Calls back once when the trigger fires.
 * @param {{type: string, ratio?: number}} trigger load | view | scroll
 * @param {Element} section the section the offer belongs to (view)
 * @param {Function} callback
 * @returns {Function} cancels the trigger
 */
export function onTrigger(trigger, section, callback) {
  if (trigger.type === 'load') {
    callback();
    return () => {};
  }
  if (trigger.type === 'view') {
    const observer = new IntersectionObserver((records) => {
      if (!records.some((record) => record.isIntersecting)) return;
      observer.disconnect();
      callback();
    }, { threshold: 0.25 });
    observer.observe(section);
    return () => observer.disconnect();
  }
  // scroll: the share of the page seen so far, measured on scroll only, so a
  // short page does not open the popup without the visitor doing anything.
  let frame;
  const check = () => {
    frame = null;
    const seen = (window.scrollY + window.innerHeight) / document.documentElement.scrollHeight;
    if (seen < trigger.ratio) return;
    // eslint-disable-next-line no-use-before-define
    cancel();
    callback();
  };
  const onScroll = () => { frame = frame || window.requestAnimationFrame(check); };
  const cancel = () => {
    window.removeEventListener('scroll', onScroll);
    if (frame) window.cancelAnimationFrame(frame);
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  return cancel;
}

/**
 * Opens the offer in a modal dialog.
 * @param {Node[]} nodes the offer's content
 * @param {object} options
 * @param {string} options.label accessible name when the offer has no heading
 * @param {Function} [options.onClose]
 * @returns {HTMLDialogElement}
 */
export function openPopup(nodes, { label, onClose }) {
  opened += 1;
  const dialog = document.createElement('dialog');
  dialog.className = 'target-popup';
  const content = document.createElement('div');
  content.className = 'target-popup-content';
  content.append(...nodes);
  const heading = content.querySelector('h1, h2, h3, h4');
  if (heading) {
    heading.id = heading.id || `target-popup-heading-${opened}`;
    dialog.setAttribute('aria-labelledby', heading.id);
  } else {
    dialog.setAttribute('aria-label', label);
  }
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'target-popup-close';
  close.setAttribute('aria-label', 'Close');
  close.addEventListener('click', () => dialog.close());
  // A click on the backdrop lands on the dialog element itself.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (onClose) onClose();
  });
  dialog.append(close, content);
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}
