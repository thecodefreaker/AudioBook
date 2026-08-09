/**
 * Small helpers shared across components.
 */

/** Escape text for safe interpolation into an HTML template string. */
export function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}
