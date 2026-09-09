/**
 * DOM utility helpers.
 */

export function $(selector) {
  return document.querySelector(selector);
}

export function $$(selector) {
  return document.querySelectorAll(selector);
}

export function show(el) {
  if (typeof el === 'string') el = $(el);
  if (el) el.classList.remove('hidden');
}

export function hide(el) {
  if (typeof el === 'string') el = $(el);
  if (el) el.classList.add('hidden');
}

export function toggle(el, condition) {
  if (typeof el === 'string') el = $(el);
  if (el) el.classList.toggle('hidden', !condition);
}

export function addClass(el, cls) {
  if (typeof el === 'string') el = $(el);
  if (el) el.classList.add(cls);
}

export function removeClass(el, cls) {
  if (typeof el === 'string') el = $(el);
  if (el) el.classList.remove(cls);
}

export function setText(el, text) {
  if (typeof el === 'string') el = $(el);
  if (el) el.textContent = text;
}

export function setHTML(el, html) {
  if (typeof el === 'string') el = $(el);
  if (el) el.innerHTML = html;
}
