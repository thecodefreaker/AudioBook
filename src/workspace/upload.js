import { api } from '../services/api.js';
import { state } from '../store.js';
import { $, $$, addClass, removeClass, setText, show, hide } from '../utils/dom.js';
import { showToast } from '../components/toast.js';
import { socketService } from '../services/socket.js';
import { renderChapters } from '../components/chapterList.js';

import { applyWorkspaceMode, switchView } from './layout.js';
import { renderBookOverview, setHeaderBook } from '../main.js';

export const UPLOAD_STEPS = ['upload', 'extract', 'build', 'ready'];
export let isUploading = false;

export function initUpload() {
  const input = $('#file-input');

  input?.addEventListener('change', () => {
    if (input.files[0]) handleUpload(input.files[0]);
    input.value = '';
  });

  const body = document.body;
  body.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types?.includes('Files')) return;
    e.preventDefault();
    addClass(body, 'file-hover');
  });
  body.addEventListener('dragleave', (e) => {
    if (e.relatedTarget === null) removeClass(body, 'file-hover');
  });
  body.addEventListener('drop', (e) => {
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    removeClass(body, 'file-hover');
    const file = e.dataTransfer.files[0];
    if (!file.name.toLowerCase().endsWith('.epub')) {
      showToast('Please drop a valid .epub file', 'error');
      return;
    }
    if (state.currentBookId && !confirm('Open this EPUB instead of the current book?')) return;
    handleUpload(file);
  });
}

export function setUploadStep(step) {
  const at = UPLOAD_STEPS.indexOf(step);
  if (at < 0) return;
  $$('#upload-steps .upload-step').forEach((el) => {
    const i = UPLOAD_STEPS.indexOf(el.dataset.step);
    el.classList.toggle('is-done', i < at);
    el.classList.toggle('is-active', i === at);
  });
}

export async function handleUpload(file) {
  if (isUploading) return;
  isUploading = true;

  switchView('create');
  hide('#welcome-actions');
  show('#upload-progress');
  setText('#upload-file-name', file.name);
  setText('#upload-status', 'Uploading…');
  removeClass('#upload-progress-bar', 'success');
  const bar = $('#upload-progress-bar');
  if (bar) bar.style.width = '0%';
  setUploadStep('upload');

  const fileInput = $('#file-input');
  if (fileInput) fileInput.disabled = true;

  try {
    const result = await api.uploadBook(file, pct => {
      const b = $('#upload-progress-bar');
      if (b) b.style.width = pct + '%';
      if (pct === 100) {
        setText('#upload-status', 'Reading EPUB…');
        setUploadStep('extract');
      }
    });

    state.currentBookId = result.bookId;
    socketService.subscribe(result.bookId);
    setText('#upload-status', 'Extracting chapters…');
    setUploadStep('extract');

    socketService.on('book:parsing', onBookParsing);
    socketService.on('book:parsed', onBookParsed);
    socketService.on('book:error', onBookError);

    showToast('EPUB uploaded successfully!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
    resetUpload();
  } finally {
    isUploading = false;
    if (fileInput) fileInput.disabled = false;
  }
}

export function onBookParsing(data) {
  if (data.bookId !== state.currentBookId) return;
  setText('#upload-status', data.message);
  const bar = $('#upload-progress-bar');
  if (bar) bar.style.width = data.percent + '%';
  setUploadStep(data.phase === 'complete' ? 'build' : 'extract');
}

export function onBookParsed(data) {
  if (data.bookId !== state.currentBookId) return;
  setUploadStep('build');
  setText('#upload-status', `✅ ${data.chapters.length} chapters found!`);
  const bar = $('#upload-progress-bar');
  if (bar) bar.style.width = '100%';
  addClass('#upload-progress-bar', 'success');

  state.chapters = data.chapters;
  state.selectedChapters = new Set();
  state.currentBookMeta = data.metadata || null;

  renderChapters();
  renderBookOverview();
  setHeaderBook(data.metadata?.title, data.chapters.length);
  setText('#player-book-title', data.metadata.title);
  setUploadStep('ready');
  applyWorkspaceMode();
}

export function onBookError(data) {
  if (data.bookId !== state.currentBookId) return;
  showToast(`Parsing failed: ${data.error}`, 'error');
  resetUpload();
}

export function resetUpload() {
  show('#welcome-actions');
  hide('#upload-progress');
  const input = $('#file-input');
  if (input) input.value = '';
}
