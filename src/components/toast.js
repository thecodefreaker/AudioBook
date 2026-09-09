/**
 * Toast notifications.
 *
 * Extracted so any component can report to the user without importing the
 * whole of main.js. Toasts are for transient acknowledgement only — anything
 * worth keeping goes to the log console, which persists.
 */
import { $, addClass } from '../utils/dom.js';

/**
 * @param {string} message
 * @param {'info'|'success'|'warning'|'error'} type
 * @param {{ persist?: boolean, actionLabel?: string, onClick?: () => void }} [options]
 *
 * `persist` exists for offers the user must be able to accept in their own
 * time — a resume prompt that disappears after five seconds is an offer that
 * was never really made. Such a toast is dismissed only by acting on it or
 * closing it.
 */
export function showToast(message, type = 'info', options = {}) {
  const container = $('#toast-container');
  if (!container) return;

  const { persist = false, actionLabel = null, onClick = null } = options;

  const toast = document.createElement('div');
  toast.className = `toast ${type}${onClick ? ' clickable' : ''}`;
  toast.innerHTML = `<span class="toast-message"></span>${
    onClick && actionLabel ? '<button class="toast-action"></button>' : ''
  }<button class="toast-close">✕</button>`;
  // textContent, so a message containing markup can never inject HTML.
  toast.querySelector('.toast-message').textContent = message;
  if (onClick && actionLabel) toast.querySelector('.toast-action').textContent = actionLabel;

  container.appendChild(toast);
  toast.querySelector('.toast-close').addEventListener('click', (e) => {
    e.stopPropagation();
    removeToast(toast);
  });

  if (onClick) {
    const fire = () => { removeToast(toast); onClick(); };
    (toast.querySelector('.toast-action') || toast).addEventListener('click', fire);
  }

  if (!persist) setTimeout(() => removeToast(toast), 5000);
  return toast;
}

export function removeToast(toast) {
  if (!toast?.parentNode) return;
  addClass(toast, 'removing');
  setTimeout(() => toast.remove(), 300);
}
