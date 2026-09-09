import { $ } from '../utils/dom.js';
import { state } from '../store.js';

export function parseVtt(vttText) {
  const cues = [];
  const blocks = vttText.split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    for (let i = 0; i < lines.length; i++) {
      const match = lines[i].match(/(\d{2}):(\d{2}):(\d{2})\.(\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})\.(\d{3})/);
      if (match) {
        const start = parseInt(match[1])*3600 + parseInt(match[2])*60 + parseInt(match[3]) + parseInt(match[4])/1000;
        const end = parseInt(match[5])*3600 + parseInt(match[6])*60 + parseInt(match[7]) + parseInt(match[8])/1000;
        const text = lines.slice(i + 1).join(' ').trim();
        if (text) cues.push({ start, end, text });
        break;
      }
    }
  }
  return cues;
}

let subtitleAnimFrame = null;

export function stopSubtitleSync() {
  if (subtitleAnimFrame) {
    cancelAnimationFrame(subtitleAnimFrame);
    subtitleAnimFrame = null;
  }
  const subtitleContainer = $('#subtitle-container');
  if (subtitleContainer) {
    const pill = $('#subtitle-pill', subtitleContainer);
    if (pill) {
      pill.classList.remove('is-active');
      pill.classList.add('fade-out');
    }
  }
}

export function startSubtitleSync() {
  if (subtitleAnimFrame) cancelAnimationFrame(subtitleAnimFrame);
  
  const audio = $('#audio-element');
  const subtitleContainer = $('#subtitle-container');
  if (!subtitleContainer) return;
  
  // Ensure internal glassmorphic pill structure is present
  let pill = $('#subtitle-pill', subtitleContainer);
  let textSpan = $('#subtitle-text', subtitleContainer);
  
  if (!pill || !textSpan) {
    subtitleContainer.innerHTML = `
      <div class="subtitle-pill" id="subtitle-pill">
        <span class="subtitle-text" id="subtitle-text"></span>
      </div>
    `;
    pill = $('#subtitle-pill', subtitleContainer);
    textSpan = $('#subtitle-text', subtitleContainer);
  }

  let currentCueIndex = -1;
  let lastCueText = '';
  // Max gap tolerance in seconds to hold cue text during word-to-word micro pauses
  const MICRO_GAP_TOLERANCE = 0.45;

  function tick() {
    if (!audio || !audio.src || !state.vttCues.length || state.captionsEnabled === false) {
      if (subtitleContainer && !subtitleContainer.hasAttribute('hidden') && state.captionsEnabled === false) {
        subtitleContainer.setAttribute('hidden', '');
      }
      subtitleAnimFrame = requestAnimationFrame(tick);
      return;
    }

    if (subtitleContainer.hasAttribute('hidden')) {
      subtitleContainer.removeAttribute('hidden');
    }

    const t = audio.currentTime;
    let activeCue = null;
    let activeCueIndex = -1;

    for (let i = 0; i < state.vttCues.length; i++) {
      const cue = state.vttCues[i];
      if (t >= cue.start && t <= cue.end) {
        activeCue = cue;
        activeCueIndex = i;
        break;
      }
    }

    // Cue Hysteresis: prevent rapid text disappearance during micro gaps between words (e.g. 50-300ms)
    if (!activeCue && currentCueIndex !== -1 && currentCueIndex < state.vttCues.length) {
      const prevCue = state.vttCues[currentCueIndex];
      const nextCue = state.vttCues[currentCueIndex + 1];

      // If we are between prevCue and nextCue and the gap is within tolerance, hold prevCue
      if (t > prevCue.end && (!nextCue || (nextCue.start - prevCue.end <= MICRO_GAP_TOLERANCE && t < nextCue.start))) {
        activeCue = prevCue;
        activeCueIndex = currentCueIndex;
      }
    }

    if (activeCue) {
      currentCueIndex = activeCueIndex;
      if (activeCue.text !== lastCueText) {
        lastCueText = activeCue.text;
        if (textSpan) textSpan.textContent = activeCue.text;
        if (pill) {
          pill.classList.remove('fade-out');
          pill.classList.add('is-active');
        }
      }

      // Sync with Spotify-style Live Script / Lyrics Card if open
      const lyricsCard = $('#player-lyrics-card');
      if (lyricsCard && !lyricsCard.classList.contains('hidden')) {
        const activeLine = $(`#lyrics-stream .lyric-line[data-idx="${activeCueIndex}"]`);
        if (activeLine && !activeLine.classList.contains('is-active')) {
          const stream = $('#lyrics-stream');
          stream?.querySelectorAll('.lyric-line.is-active').forEach(l => l.classList.remove('is-active'));
          activeLine.classList.add('is-active');
          activeLine.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    } else if (lastCueText) {
      // Extended silence gap (> 0.45s) or track finished -> fade out cleanly
      lastCueText = '';
      currentCueIndex = -1;
      if (pill) {
        pill.classList.remove('is-active');
        pill.classList.add('fade-out');
      }
    }

    subtitleAnimFrame = requestAnimationFrame(tick);
  }

  subtitleAnimFrame = requestAnimationFrame(tick);
}
