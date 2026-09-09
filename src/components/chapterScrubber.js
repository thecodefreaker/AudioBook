/**
 * chapterScrubber.js
 * 
 * Interactive vertical fast-scrubber for navigating 2,000+ chapters.
 * Allows instant touch-drag scrubbing with a floating chapter badge,
 * volume notches, and smooth virtual viewport positioning.
 */

import { escapeHtml } from '../utils/html.js';

export function createChapterScrubber(options) {
  const {
    container,
    listEl,
    getChapterAt,
    totalChapters,
    onScrub,
    onSelect
  } = options;

  if (!container || !listEl) return null;

  // Remove existing scrubber if any
  container.querySelector('.chapter-scrubber-track')?.remove();
  container.querySelector('.chapter-scrubber-bubble')?.remove();

  const track = document.createElement('div');
  track.className = 'chapter-scrubber-track';
  track.setAttribute('role', 'slider');
  track.setAttribute('aria-label', 'Chapter fast seek scrubber');
  track.setAttribute('aria-valuemin', '1');
  track.setAttribute('aria-valuemax', String(totalChapters || 1));

  const thumb = document.createElement('div');
  thumb.className = 'chapter-scrubber-thumb';

  const bubble = document.createElement('div');
  bubble.className = 'chapter-scrubber-bubble';
  bubble.setAttribute('aria-hidden', 'true');
  bubble.style.display = 'none';

  track.appendChild(thumb);
  container.appendChild(track);
  container.appendChild(bubble);

  let isDragging = false;
  let currentFraction = 0;

  function updateScrubberPosition(fraction, showBubble = true) {
    fraction = Math.max(0, Math.min(1, fraction));
    currentFraction = fraction;

    const trackHeight = track.clientHeight;
    const thumbTop = fraction * Math.max(0, trackHeight - 24);
    thumb.style.transform = `translateY(${thumbTop}px)`;

    const total = totalChapters || 1;
    const targetIdx = Math.min(total - 1, Math.floor(fraction * total));
    track.setAttribute('aria-valuenow', String(targetIdx + 1));

    if (showBubble && getChapterAt) {
      const info = getChapterAt(targetIdx) || {
        chapterIndex: targetIdx,
        title: `Chapter ${targetIdx + 1}`
      };
      const title = info.title || `Chapter ${targetIdx + 1}`;
      const percent = Math.round(fraction * 100);
      const volNum = Math.floor(targetIdx / 100) + 1;

      bubble.innerHTML = `
        <span class="scrubber-bubble-num">Ch. ${targetIdx + 1}</span>
        <span class="scrubber-bubble-title">${escapeHtml(title)}</span>
        <span class="scrubber-bubble-meta">Vol. ${volNum} · ${percent}%</span>
      `;

      bubble.style.display = 'block';
      const bubbleTop = Math.max(10, Math.min(trackHeight - 40, thumbTop));
      bubble.style.top = `${bubbleTop}px`;
    }
  }

  function handlePointer(e, isFinal = false) {
    const rect = track.getBoundingClientRect();
    if (!rect.height) return;
    const clientY = e.clientY != null ? e.clientY : (e.touches ? e.touches[0].clientY : 0);
    const relativeY = clientY - rect.top;
    const fraction = relativeY / rect.height;

    updateScrubberPosition(fraction, true);

    const total = totalChapters || 1;
    const targetIdx = Math.min(total - 1, Math.max(0, Math.floor(fraction * total)));

    if (onScrub) onScrub(targetIdx, fraction);
    if (isFinal && onSelect) onSelect(targetIdx);
  }

  track.addEventListener('pointerdown', (e) => {
    isDragging = true;
    track.setPointerCapture(e.pointerId);
    track.classList.add('active');
    handlePointer(e, false);
  });

  track.addEventListener('pointermove', (e) => {
    if (!isDragging) return;
    handlePointer(e, false);
  });

  const endDrag = (e) => {
    if (!isDragging) return;
    isDragging = false;
    track.classList.remove('active');
    handlePointer(e, true);
    setTimeout(() => {
      if (!isDragging) bubble.style.display = 'none';
    }, 1500);
  };

  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);

  // Sync with container scrolling
  listEl.addEventListener('scroll', () => {
    if (isDragging) return;
    const scrollMax = listEl.scrollHeight - listEl.clientHeight;
    if (scrollMax > 0) {
      const fraction = listEl.scrollTop / scrollMax;
      updateScrubberPosition(fraction, false);
    }
  }, { passive: true });

  return {
    update(newTotal) {
      track.setAttribute('aria-valuemax', String(newTotal || 1));
      updateScrubberPosition(currentFraction, false);
    },
    destroy() {
      track.remove();
      bubble.remove();
    }
  };
}
