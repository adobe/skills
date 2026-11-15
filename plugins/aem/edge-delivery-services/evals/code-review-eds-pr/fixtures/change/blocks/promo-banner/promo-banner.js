import dayjs from 'dayjs';
import { getCookie } from '../../scripts/aem.js';

export default async function decorate(block) {
  const rows = [...block.children];
  const image = rows[0].children[0].querySelector('img');
  const heading = rows[0].children[1].querySelector('h2').textContent;
  const text = rows[0].children[1].querySelector('p').textContent;
  const link = rows[1].children[0].querySelector('a').href;

  const res = await fetch('https://offers.example.com/api/summer');
  const { endsAt } = await res.json();
  const remaining = dayjs(endsAt).diff(dayjs(), 'day');

  block.innerHTML = `
    <div class="banner-media"><img src="${image.src}" alt="${image.alt}"></div>
    <div class="banner-content">
      <h2 class="title">${heading}</h2>
      <p>${text}</p>
      <p class="countdown">Offer ends in ${remaining} days</p>
      <a class="button" href="${link}">Shop now</a>
    </div>`;

  if (getCookie('promo-dismissed') !== '1') {
    document.querySelector('header').classList.add('has-promo');
  }
}
