import { JSDOM } from 'jsdom';

export default function setupDom(html = '<!DOCTYPE html>') {
  const { window } = new JSDOM(html, { url: 'http://localhost:3000/' });
  global.window = window;
  global.document = window.document;
  return window;
}
