// Fixture: every project decorator run from decorateMain() carries an idempotency guard.
function decorateEyebrows(main) {
  if (main.dataset.decorated) return;
  main.dataset.decorated = 'true';
  main.querySelectorAll('h3').forEach((h) => h.classList.add('eyebrow'));
}

export function decorateMain(main) {
  decorateButtons(main);
  decorateIcons(main);
  buildAutoBlocks(main);
  decorateEyebrows(main);
  decorateSections(main);
  decorateBlocks(main);
}
