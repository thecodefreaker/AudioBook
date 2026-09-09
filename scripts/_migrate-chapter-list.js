/**
 * One-off: replace the legacy chapter-list block in main.js (initChapterControls,
 * applyChapterFilters, renderChapters) with delegation-based wiring that calls
 * into components/chapterList.js.
 */
import fs from 'fs';

const file = 'src/main.js';
const lines = fs.readFileSync(file, 'utf8').split('\n');

const start = lines.findIndex((l) => l.startsWith('function initChapterControls()'));
const end = lines.findIndex((l) => l.startsWith('function openVersionsModal('));
if (start < 0 || end < 0 || end <= start) {
  console.error('markers not found', { start, end });
  process.exit(1);
}

const replacement = `/**
 * Rendering, filtering, sorting and selection now live in
 * \`components/chapterList.js\`. main.js only supplies the app-level actions a
 * row can trigger, which keeps that module free of API and player knowledge —
 * and is what let the per-row listeners (re-attached on every render, so a
 * click fired N times after N conversions) become one delegated handler.
 */
function initChapterControls() {
  initChapterList({
    onPlay: (audioIndex) => { if (!isNaN(audioIndex)) playAudioAtIndex(audioIndex); },
    onConvert: (chapterIdx) => openQuickConvertModal(chapterIdx),
    onPreview: (chapterIdx) => previewChapter(chapterIdx),
    onVersions: (chapterIdx) => openVersionsModal(chapterIdx),
    onCancel: () => cancelAllJobs(),
    onDeleteAudio: (chapterIdx, audioIndex) => deleteAudioVersion(audioIndex),
    // The audiobook panel is a function of which chapters have audio, so it is
    // refreshed with the list rather than from every call site that changes it.
    onRendered: () => refreshAudiobookPanel(),
  });
}

/**
 * Delete one audio version. \`audioIndex\` is whichever version the row's picker
 * is showing, so what gets deleted is always what the user is looking at —
 * previously the row deleted the newest version regardless of the choice.
 */
async function deleteAudioVersion(audioIndex) {
  const audio = state.audioFiles[audioIndex];
  if (!audio) return;
  if (!confirm('Delete this audio version permanently?')) return;

  try {
    await api.deleteAudioFile(audio.id);
    showToast('Audio version deleted', 'info');
    await loadAudioFilesForBook();
    renderChapters();
  } catch (err) {
    showToast('Failed to delete audio: ' + err.message, 'error');
  }
}

async function cancelAllJobs() {
  if (!state.currentBookId) return;
  if (!confirm('Cancel all running conversions? Chapters already completed will be kept.')) return;
  try {
    const result = await api.cancelJobs(state.currentBookId);
    showToast(result.message, 'info');
  } catch (err) {
    showToast('Cancel failed: ' + err.message, 'error');
  }
}

`;

lines.splice(start, end - start, replacement);
fs.writeFileSync(file, lines.join('\n'));
console.log(`Replaced lines ${start + 1}–${end} of ${file}`);
