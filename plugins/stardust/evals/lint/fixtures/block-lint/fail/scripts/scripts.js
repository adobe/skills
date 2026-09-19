// Fixture: decorateMain() calls one guarded and one unguarded project decorator.
function decorateGuarded(main) {
  if (main.dataset.decorated) return;
  main.dataset.decorated = 'true';
  main.querySelectorAll('h2').forEach((h) => h.classList.add('display'));
}

function decorateUnguarded(main) {
  main.querySelectorAll('h3').forEach((h) => h.classList.add('eyebrow'));
}

export function decorateMain(main) {
  decorateButtons(main);
  decorateIcons(main);
  buildAutoBlocks(main);
  decorateGuarded(main);
  decorateUnguarded(main);
  decorateSections(main);
  decorateBlocks(main);
}
