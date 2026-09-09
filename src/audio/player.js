import { api } from '../services/api.js';
import { state } from '../store.js';
import { $, $$, addClass, removeClass, setText, hide, show } from '../utils/dom.js';
import { formatTime } from '../utils/formatters.js';
import { showToast } from '../components/toast.js';
import { versionLabel } from '../components/catalog.js';
import {
  SPEED_PRESETS, clampSpeed, speedForBook, rememberSpeed, makeSpeedDefault,
  clampPitch, pitchForBook, rememberPitch, makePitchDefault,
  setLastRead
} from '../services/settings.js';
import { parseVtt, startSubtitleSync } from './subtitles.js';
import { renderListenPane } from '../main.js';
import { previewChapter, attachReaderSync } from '../reader/readerUi.js';
import { escapeHtml } from '../utils/html.js';

export function playbackOrder() {
  return (state.chapters || [])
    .slice()
    .sort((a, b) => a.chapterIndex - b.chapterIndex)
    .map((ch) => (state.audioFiles || []).find((a) => a.chapterId === ch.id && !a.isMerged))
    .filter(Boolean)
    .map((a) => state.audioFiles.indexOf(a));
}

export function playAdjacent(step) {
  const order = playbackOrder();
  if (!order.length) return;
  const currentAudio = state.audioFiles?.[state.currentAudioIndex];
  const here = currentAudio ? order.findIndex(idx => state.audioFiles[idx]?.chapterId === currentAudio.chapterId) : -1;
  const nextPos = here === -1 ? (step > 0 ? 0 : order.length - 1) : here + step;
  if (nextPos < 0 || nextPos >= order.length) return;
  playAudioAtIndex(order[nextPos]);
}

export function stopPlayback() {
  const audio = $('#audio-element');
  if (audio) {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
  }
  state.currentAudioIndex = -1;
  state.isPlaying = false;
  state.vttCues = [];
  state.currentAlignment = null;
  addClass('#sticky-player', 'hidden');
  removeClass('#app', 'has-player');
  updatePlayButton();
}

export function initPlayer() {
  const audio = $('#audio-element');
  const seekBar = $('#player-seek');

  $('#btn-play-pause')?.addEventListener('click', togglePlay);
  $('#btn-prev-chapter')?.addEventListener('click', () => playAdjacent(-1));
  $('#btn-next-chapter')?.addEventListener('click', () => playAdjacent(1));
  $('#btn-seek-back')?.addEventListener('click', () => { if (audio.duration) audio.currentTime = Math.max(0, audio.currentTime - 10); });
  $('#btn-seek-forward')?.addEventListener('click', () => { if (audio.duration) audio.currentTime = Math.min(audio.duration, audio.currentTime + 10); });
  
  $('#sticky-player')?.addEventListener('click', (e) => {
    if (window.innerWidth <= 640 && !e.target.closest('button, input, select, a')) {
      $('#sticky-player').classList.add('expanded');
    }
  });

  $('#btn-close-expanded')?.addEventListener('click', (e) => {
    e.stopPropagation();
    $('#sticky-player').classList.remove('expanded');
  });
  
  const handleOpenReader = () => {
    const currentAudio = state.audioFiles?.[state.currentAudioIndex];
    if (currentAudio) {
      const ch = state.chapters.find(c => c.id === currentAudio.chapterId);
      const targetIdx = ch ? ch.chapterIndex : currentAudio.chapterIndex;
      if (targetIdx !== undefined && targetIdx !== null) {
        previewChapter(targetIdx, null, currentAudio.scriptId);
      }
    }
  };
  $('#btn-player-view-script')?.addEventListener('click', handleOpenReader);
  $('#player-chapter-title')?.addEventListener('click', handleOpenReader);

  // Spotify Live Synced Script / Lyrics Card Toggle
  $('#btn-toggle-lyrics-view')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const card = $('#player-lyrics-card');
    if (!card) return;
    const isHidden = card.classList.contains('hidden');
    card.classList.toggle('hidden', !isHidden);
    if (isHidden) {
      renderLiveLyricsStream();
    }
  });

  $('#btn-close-lyrics-card')?.addEventListener('click', (e) => {
    e.stopPropagation();
    $('#player-lyrics-card')?.classList.add('hidden');
  });

  const btnSubtitles = $('#btn-toggle-subtitles');
  if (btnSubtitles) {
    const updateCaptionBtnState = () => {
      const enabled = state.captionsEnabled !== false;
      btnSubtitles.classList.toggle('btn-active', enabled);
      btnSubtitles.setAttribute('aria-pressed', String(enabled));
      const container = $('#subtitle-container');
      if (container) {
        if (enabled) {
          container.removeAttribute('hidden');
        } else {
          container.setAttribute('hidden', '');
        }
      }
    };

    updateCaptionBtnState();

    btnSubtitles.addEventListener('click', (e) => {
      e.stopPropagation();
      state.captionsEnabled = !state.captionsEnabled;
      setSetting('captionsEnabled', state.captionsEnabled);
      updateCaptionBtnState();
      showToast(state.captionsEnabled ? 'Captions enabled' : 'Captions disabled', 'info');
    });
  }

  $('#player-chapter-select')?.addEventListener('change', (e) => {
    playAudioAtIndex(parseInt(e.target.value, 10));
  });

  initSpeedControl();
  initPitchControl();

  seekBar?.addEventListener('input', () => {
    if (audio.duration) audio.currentTime = (seekBar.value / 100) * audio.duration;
  });

  audio?.addEventListener('timeupdate', () => {
    if (audio.duration) {
      const percent = (audio.currentTime / audio.duration) * 100;
      if (seekBar) seekBar.value = percent;
      const mobProgress = $('#mobile-player-progress-bar');
      if (mobProgress) mobProgress.style.width = `${percent}%`;
      setText('#player-current-time', formatTime(audio.currentTime));
    }
  });

  audio?.addEventListener('loadedmetadata', () => {
    setText('#player-duration', formatTime(audio.duration));
    applySpeedForCurrentBook();
  });

  audio?.addEventListener('ended', () => {
    const order = playbackOrder();
    const currentAudio = state.audioFiles?.[state.currentAudioIndex];
    const here = currentAudio ? order.findIndex(idx => state.audioFiles[idx]?.chapterId === currentAudio.chapterId) : -1;
    if (here !== -1 && here < order.length - 1) {
      playAudioAtIndex(order[here + 1]);
    } else {
      state.isPlaying = false;
      updatePlayButton();
    }
  });

  audio?.addEventListener('play', () => { state.isPlaying = true; updatePlayButton(); });
  audio?.addEventListener('pause', () => { state.isPlaying = false; updatePlayButton(); });

  window.addEventListener('reader:chapter:changed', (e) => {
    if (e.detail && e.detail.audioIdx !== undefined) {
      playAudioAtIndex(e.detail.audioIdx, e.detail.autoPlay !== false);
    }
  });
}

export function initSpeedControl() {
  const audio = $('#audio-element');
  const trigger = $('#player-speed-trigger');
  const menu = $('#speed-menu');
  const presets = $('#speed-presets');
  const custom = $('#speed-custom-input');
  if (!trigger || !menu) return;

  presets.innerHTML = SPEED_PRESETS.map(
    (r) => `<button class="speed-preset" role="menuitemradio" data-rate="${r}">${r}×</button>`
  ).join('');

  const closeMenu = () => {
    addClass(menu, 'hidden');
    trigger.setAttribute('aria-expanded', 'false');
  };

  const apply = (rate, persist = true) => {
    const value = clampSpeed(rate);
    if (audio) {
      audio.playbackRate = value;
      audio.preservesPitch = true;
      audio.mozPreservesPitch = true;
      audio.webkitPreservesPitch = true;
    }

    setText('#player-speed-label', `${value}×`);
    trigger.title = `Playback speed — ${value}×`;
    if (custom) custom.value = value;
    $$('.speed-preset').forEach((b) => {
      const on = parseFloat(b.dataset.rate) === value;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-checked', String(on));
    });

    if (persist) rememberSpeed(state.currentBookId, value);
  };

  trigger.addEventListener('click', () => {
    const open = menu.classList.contains('hidden');
    menu.classList.toggle('hidden', !open);
    trigger.setAttribute('aria-expanded', String(open));
  });

  presets.addEventListener('click', (e) => {
    const btn = e.target.closest('.speed-preset');
    if (!btn) return;
    apply(parseFloat(btn.dataset.rate));
    closeMenu();
  });

  custom?.addEventListener('input', () => apply(custom.value));

  document.addEventListener('click', (e) => {
    if (!menu.classList.contains('hidden') && !e.target.closest('.speed-control')) closeMenu();
  });
  menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeMenu(); trigger.focus(); } });

  apply(speedForBook(state.currentBookId), false);
  applySpeedForCurrentBook = () => apply(speedForBook(state.currentBookId), false);

  $('#speed-make-default')?.addEventListener('click', () => {
    if (!audio) return;
    const rate = clampSpeed(audio.playbackRate);
    makeSpeedDefault(state.currentBookId, rate);
    makePitchDefault(state.currentBookId, currentPitch());
    showToast(`Default set: ${rate}× — new books will start here.`, 'success');
    updateSpeedDefaultNote();
  });

  updateSpeedDefaultNote();
}

export function updateSpeedDefaultNote() {
  const note = $('#speed-default-note');
  if (!note) return;
  const global = clampSpeed(1); // Usually getSetting('playbackRate') is used, but clamping 1 is fine since speedForBook does the heavy lifting.
  const here = speedForBook(state.currentBookId);
  note.textContent = here === global ? `Default is ${global}×` : `Default is ${global}× · this book ${here}×`;
}

export function initPitchControl() {
  const audio = $('#audio-element');
  const slider = $('#player-pitch-slider');
  if (!slider || !audio) return;

  let audioCtx, source, filter;

  const ensureGraph = () => {
    if (audioCtx) {
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      return true;
    }
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return false;
      audioCtx = new AudioContext();
      source = audioCtx.createMediaElementSource(audio);
      filter = audioCtx.createBiquadFilter();
      filter.type = 'peaking';
      filter.frequency.value = 500;
      filter.Q.value = 1.5;
      source.connect(filter);
      filter.connect(audioCtx.destination);
      if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
      return true;
    } catch {
      audioCtx = null;
      return false;
    }
  };

  audio.addEventListener('play', () => {
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => {});
    }
  });

  const apply = (value, persist = true) => {
    const pitch = clampPitch(value);
    slider.value = pitch;
    slider.title = `Tone — ${pitch === 1 ? 'neutral' : pitch < 1 ? 'deeper' : 'lighter'} (double-click to reset)`;
    if (pitch !== 1) {
      if (ensureGraph()) filter.gain.value = (pitch - 1) * 20;
    } else if (filter) {
      filter.gain.value = 0;
    }
    if (persist) rememberPitch(state.currentBookId, pitch);
  };

  slider.addEventListener('input', () => apply(slider.value));
  slider.addEventListener('dblclick', () => {
    apply(1);
    showToast('Tone reset to neutral.', 'info');
  });

  apply(pitchForBook(state.currentBookId), false);
  applyPitchForCurrentBook = () => apply(pitchForBook(state.currentBookId), false);
  currentPitch = () => clampPitch(slider.value);
}

export let applyPitchForCurrentBook = () => {};
export let currentPitch = () => 1;
export let applySpeedForCurrentBook = () => {};

export function playAudioAtIndex(index, autoPlay = true) {
  if (index < 0 || index >= state.audioFiles.length) return;
  state.currentAudioIndex = index;
  const audioFile = state.audioFiles[index];
  const audio = $('#audio-element');

  const currentAudioId = audioFile.id;
  state.currentAudioId = currentAudioId;

  audio.innerHTML = '';
  state.vttCues = [];
  state.currentAlignment = null;

  audio.src = api.getStreamUrl(audioFile.id);
  if (autoPlay) {
    audio.play().catch(() => {});
  }

  api.getAlignment(audioFile.id)
    .then(({ alignment }) => {
      if (state.currentAudioId !== currentAudioId) return;
      state.currentAlignment = alignment;
      if (state.readerChapterIdx !== null) attachReaderSync();
    })
    .catch(() => {});

  fetch(api.getVttUrl(audioFile.id))
    .then(r => r.ok ? r.text() : null)
    .then(vttText => {
      if (state.currentAudioId !== currentAudioId) return;
      if (vttText) {
        state.vttCues = parseVtt(vttText);
        startSubtitleSync();
        renderLiveLyricsStream();
      }
    })
    .catch(() => {});

  const subtitleContainer = $('#subtitle-container');
  if (subtitleContainer) {
    subtitleContainer.style.display = '';
    if (state.captionsEnabled !== false) {
      subtitleContainer.removeAttribute('hidden');
    } else {
      subtitleContainer.setAttribute('hidden', '');
    }
  }

  const ch = state.chapters.find(c => c.id === audioFile.chapterId);
  setText('#player-chapter-title', ch?.title || `Chapter ${index + 1}`);
  setText('#player-book-title', versionLabel(audioFile));
  
  if (ch && state.currentBookId) {
    setLastRead(state.currentBookId, ch.chapterIndex);
    if (state.readerChapterIdx !== null && state.readerChapterIdx !== ch.chapterIndex) {
      previewChapter(ch.chapterIndex);
    }
  }

  removeClass('#sticky-player', 'hidden');
  addClass('#app', 'has-player');

  $$('.ch-row.playing').forEach((row) => removeClass(row, 'playing'));
  const row = $(`.ch-row[data-ch="${ch?.chapterIndex}"]`);
  if (row) addClass(row, 'playing');

  renderPlayerChapterList();
  updateTransportButtons();
}

export function renderPlayerChapterList() {
  const sel = $('#player-chapter-select');
  if (!sel) return;

  const order = playbackOrder();
  sel.hidden = order.length < 2;
  if (sel.hidden) { sel.innerHTML = ''; return; }

  sel.innerHTML = order.map((audioIdx) => {
    const a = state.audioFiles[audioIdx];
    const ch = state.chapters.find((c) => c.id === a.chapterId);
    const label = ch ? `${ch.chapterIndex + 1}. ${ch.title || 'Chapter'}` : 'Chapter';
    return `<option value="${audioIdx}" ${audioIdx === state.currentAudioIndex ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  }).join('');
}

export function updateTransportButtons() {
  const order = playbackOrder();
  const currentAudio = state.audioFiles?.[state.currentAudioIndex];
  const here = currentAudio ? order.findIndex(idx => state.audioFiles[idx]?.chapterId === currentAudio.chapterId) : -1;
  const prev = $('#btn-prev-chapter');
  const next = $('#btn-next-chapter');
  if (prev) prev.disabled = here <= 0;
  if (next) next.disabled = here === -1 || here >= order.length - 1;
}

export function togglePlay() {
  const audio = $('#audio-element');
  if (audio) {
    audio.muted = false;
    if (audio.volume === 0) audio.volume = 1.0;
  }
  if (audio && audio.src) {
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  } else if (state.audioFiles.length > 0) {
    playAudioAtIndex(0);
  }
}

export function updatePlayButton() {
  const playIcon = $('#btn-play-pause .icon-play');
  const pauseIcon = $('#btn-play-pause .icon-pause');
  if (state.isPlaying) { hide(playIcon); show(pauseIcon); }
  else { show(playIcon); hide(pauseIcon); }
  if (state.readerChapterIdx != null) renderListenPane();

  $$('.ch-actions [data-act="play"]').forEach(btn => {
    const idx = parseInt(btn.dataset.audioIndex, 10);
    const isCurrent = idx === state.currentAudioIndex;
    if (isCurrent && state.isPlaying) {
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg> Pause`;
    } else {
      btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12"><polygon points="5 3 19 12 5 21 5 3"/></svg> Play`;
    }
  });
}

export function renderLiveLyricsStream() {
  const container = $('#lyrics-stream');
  if (!container) return;
  if (!state.vttCues || !state.vttCues.length) {
    container.innerHTML = `<div class="lyrics-empty">No synchronized script lines available for this audio yet.</div>`;
    return;
  }
  container.innerHTML = state.vttCues.map((cue, idx) => `
    <div class="lyric-line" data-idx="${idx}" data-start="${cue.start}">
      ${escapeHtml(cue.text)}
    </div>
  `).join('');

  $$('.lyric-line', container).forEach(line => {
    line.addEventListener('click', (e) => {
      e.stopPropagation();
      const start = parseFloat(line.dataset.start);
      const audio = $('#audio-element');
      if (audio && !isNaN(start)) {
        audio.currentTime = start;
        audio.play().catch(() => {});
      }
    });
  });
}
