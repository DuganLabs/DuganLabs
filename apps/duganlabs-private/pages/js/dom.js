import { effect } from './signals.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function bind(el, sig) {
  effect(() => { el.textContent = sig(); });
}

export function bindAttr(el, attr, sig) {
  effect(() => { el.setAttribute(attr, sig()); });
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, val] of Object.entries(attrs)) {
    if (key === 'on') {
      for (const [event, handler] of Object.entries(val)) {
        node.addEventListener(event, handler);
      }
    } else if (key === 'data') {
      for (const [dk, dv] of Object.entries(val)) {
        node.dataset[dk] = dv;
      }
    } else {
      node.setAttribute(key, val);
    }
  }
  for (const child of children) {
    if (typeof child === 'string') {
      node.appendChild(document.createTextNode(child));
    } else if (child) {
      node.appendChild(child);
    }
  }
  return node;
}
