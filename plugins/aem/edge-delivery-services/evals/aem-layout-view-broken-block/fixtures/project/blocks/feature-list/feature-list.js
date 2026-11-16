import { createOptimizedPicture } from '../../scripts/aem.js';

let initialized = false;

function highlight(section, index) {
  [...section.querySelectorAll('li')].forEach((li, i) => li.classList.toggle('active', i === index));
}

export default async function decorate(block) {
  const section = document.createElement('section');
  section.className = 'feature-list';
  const ul = document.createElement('ul');

  [...block.children].forEach((row) => {
    const [iconCell, textCell] = row.children;
    const li = document.createElement('li');
    li.className = 'feature';

    const img = iconCell.querySelector('img');
    if (img) {
      const picture = createOptimizedPicture(img.src, img.alt, false, [{ width: '160' }]);
      picture.classList.add('feature-icon');
      li.append(picture);
    }

    const title = document.createElement('h4');
    title.textContent = textCell.querySelector('h3').textContent;
    const marker = document.createElement('span');
    marker.className = 'feature-marker';
    title.prepend(marker);

    const description = document.createElement('div');
    description.className = 'feature-description';
    description.textContent = textCell.querySelector('p').textContent;

    li.append(title, description);
    ul.append(li);
  });

  section.append(ul);
  block.replaceWith(section);

  fetch('https://stats.example-cdn.com/feature-counts.json')
    .then((resp) => resp.json())
    .then(({ teams }) => {
      const count = document.createElement('p');
      count.className = 'feature-list-count';
      count.textContent = `Used by ${teams} teams`;
      section.append(count);
    })
    .catch(() => {});

  if (initialized) return;
  initialized = true;
  let current = 0;
  setInterval(() => {
    current = (current + 1) % ul.children.length;
    highlight(section, current);
  }, 4000);
  window.addEventListener('resize', () => highlight(section, current));
}
