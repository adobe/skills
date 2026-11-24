import { describe, it, expect } from 'vitest';
import { JSDOM } from 'jsdom';

const { window } = new JSDOM('<!DOCTYPE html><header></header><main></main>');
global.window = window;
global.document = window.document;
global.fetch = async () => ({ json: async () => ({ endsAt: '2099-08-31' }) });

const { default: decorate } = await import('../../../blocks/promo-banner/promo-banner.js');

async function render() {
  const block = document.createElement('div');
  block.className = 'promo-banner';
  block.innerHTML = `
    <div><div><picture><img src="/media_1.jpg" alt="Beach"></picture></div><div><h2>Summer sale</h2><p>Up to 50% off</p></div></div>
    <div><div><a href="/summer">Shop</a></div></div>`;
  document.querySelector('main').append(block);
  await decorate(block);
  return block;
}

describe('promo-banner', () => {
  it('renders the title', async () => {
    const block = await render();
    expect(block.querySelector('.banner-content .title').textContent).toBe('Summer sale');
  });

  it('renders the text', async () => {
    const block = await render();
    expect(block.querySelector('.banner-content p').textContent).toBe('Up to 50% off');
  });

  it('renders the button', async () => {
    const block = await render();
    expect(block.querySelector('.button').textContent).toBe('Shop now');
  });

  it('uses the dark background', async () => {
    const block = await render();
    expect(window.getComputedStyle(block).backgroundColor).toBe('rgb(19, 19, 19)');
  });

  it('matches the snapshot', async () => {
    const block = await render();
    expect(block.innerHTML).toMatchSnapshot();
  });
});
