/**
 * REST API client.
 *
 * Two things this fixes versus the old client:
 *
 * 1. ERRORS CARRY THEIR PAYLOAD. Previously every failure collapsed into
 *    `new Error(err.error)`, so the UI could show "Missing dependencies" but
 *    had no way to render the list of what was actually missing, or the fix
 *    instructions. `ApiError` keeps the status and the whole body.
 *
 * 2. It matches the real backend surface: convert/estimate/scripts/glossary/
 *    logs/settings/queue instead of the removed `generate` + `translation`.
 */

const BASE_URL = '/api';

export class ApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body || {};
  }

  /** True when the server told us the machine is missing edge-tts/ffmpeg. */
  get isDependencyError() {
    return this.status === 503 && !!this.body.preflight;
  }

  get isDuplicate() {
    return this.status === 409 && this.body.error === 'duplicate';
  }
}

async function request(url, options = {}) {
  let response;
  try {
    response = await fetch(`${BASE_URL}${url}`, {
      headers: {
        ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        ...options.headers,
      },
      ...options,
    });
  } catch {
    throw new ApiError('Cannot reach the server. Is the backend running?', { status: 0 });
  }

  if (response.status === 204) return null;

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new ApiError(
      body.message || body.error || `Request failed (HTTP ${response.status})`,
      { status: response.status, body }
    );
  }
  return body;
}

const json = (method) => (url, payload) =>
  request(url, { method, body: payload === undefined ? undefined : JSON.stringify(payload) });

const post = json('POST');
const put = json('PUT');
const patch = json('PATCH');
const del = (url) => request(url, { method: 'DELETE' });

export const api = {
  // ---------------------------------------------------------------- library
  uploadBook(file, optionsOrOnProgress = {}) {
    // Accept both the new `{ onProgress, force }` object and the older
    // bare-callback form still used by main.js.
    const options = typeof optionsOrOnProgress === 'function'
      ? { onProgress: optionsOrOnProgress }
      : optionsOrOnProgress;
    const { onProgress, force = false } = options;

    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append('epub', file);
      if (force) form.append('force', 'true');

      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${BASE_URL}/books/upload`);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
      };

      xhr.onload = () => {
        let body = {};
        try { body = JSON.parse(xhr.responseText); } catch { /* non-JSON */ }

        if (xhr.status >= 200 && xhr.status < 300) resolve(body);
        else reject(new ApiError(body.message || body.error || 'Upload failed', { status: xhr.status, body }));
      };

      xhr.onerror = () => reject(new ApiError('Network error during upload', { status: 0 }));
      xhr.onabort = () => reject(new ApiError('Upload cancelled', { status: 0 }));
      xhr.send(form);
    });
  },

  getBooks: () => request('/books'),
  getBook: (bookId) => request(`/books/${bookId}`),
  deleteBook: (bookId) => del(`/books/${bookId}`),
  getChapters: (bookId) => request(`/books/${bookId}/chapters`),
  getChapterContent: (bookId, idx) => request(`/books/${bookId}/chapters/${idx}/content`),

  // ---------------------------------------------------------------- scripts
  getChapterScripts: (bookId, idx) => request(`/books/${bookId}/chapters/${idx}/scripts`),
  getScript: (bookId, scriptId) => request(`/books/${bookId}/scripts/${scriptId}`),
  saveCustomScript: (bookId, idx, content, language = 'hi', newVersion = false) =>
    put(`/books/${bookId}/chapters/${idx}/script`, { content, language, newVersion }),
  deleteScript: (bookId, scriptId) => del(`/books/${bookId}/scripts/${scriptId}`),
  /** Live "this is exactly what will be spoken" check for the editor. */
  checkScript: (bookId, content, language = 'hi') =>
    post(`/books/${bookId}/check-script`, { content, language }),

  // --------------------------------------------------------------- glossary
  getGlossary: (bookId) => request(`/books/${bookId}/glossary`),
  addGlossaryTerm: (bookId, term, keepAs, note) =>
    post(`/books/${bookId}/glossary`, { term, keepAs, note }),
  deleteGlossaryTerm: (bookId, termId) => del(`/books/${bookId}/glossary/${termId}`),

  // ---------------------------------------------------------------- convert
  estimate: (bookId, options) => post(`/books/${bookId}/estimate`, options),
  convert: (bookId, options) => post(`/books/${bookId}/convert`, options),

  /**
   * Translate only — produces a script, never audio.
   * Lets the retelling be judged (or compared against a custom script) before
   * any TTS time is spent on it.
   */
  translateOnly: (bookId, options) =>
    post(`/books/${bookId}/convert`, { ...options, action: 'script' }),

  /**
   * Speak one script that already exists, named by id. No AI runs, and the
   * resulting audio row points at exactly this script.
   */
  speakScript: (bookId, chapterIdx, scriptId, options = {}) =>
    post(`/books/${bookId}/convert`, {
      ...options, action: 'audio', scriptId, selectedChapters: [chapterIdx],
    }),

  // ------------------------------------------------------------------- jobs
  getJobs: (bookId) => request(`/books/${bookId}/jobs`),
  cancelJob: (bookId, jobId, reason) => post(`/books/${bookId}/jobs/${jobId}/cancel`, { reason }),
  cancelChapter: (bookId, jobId, idx) => post(`/books/${bookId}/jobs/${jobId}/chapters/${idx}/cancel`),
  cancelBook: (bookId, reason) => post(`/books/${bookId}/cancel`, { reason }),
  retryJob: (bookId, jobId, chapters) => post(`/books/${bookId}/jobs/${jobId}/retry`, { chapters }),

  // ------------------------------------------------------------------- logs
  getLogs: (bookId, params = {}) => {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')
    ).toString();
    return request(`/books/${bookId}/logs${qs ? `?${qs}` : ''}`);
  },
  clearLogs: (bookId) => del(`/books/${bookId}/logs`),

  // ------------------------------------------------------------------ audio
  getBookAudio: (bookId) => request(`/books/${bookId}/audio`),
  /** Status of the single-file audiobook, and whether one can be built. */
  getAudiobook: (bookId, language) =>
    request(`/books/${bookId}/audiobook${language ? `?language=${language}` : ''}`),
  /** Build or rebuild the single-file audiobook on demand. */
  buildAudiobook: (bookId, options = {}) => post(`/books/${bookId}/audiobook`, options),
  getAudio: (audioId) => request(`/audio/${audioId}`),
  getAlignment: (audioId) => request(`/audio/${audioId}/alignment`),
  getChapterVersions: (chapterId) => request(`/audio/chapter/${chapterId}/versions`),
  updateAudio: (audioId, updates) => patch(`/audio/${audioId}`, updates),
  deleteAudio: (audioId) => del(`/audio/${audioId}`),

  streamUrl: (audioId) => `${BASE_URL}/audio/${audioId}/stream`,
  downloadUrl: (audioId) => `${BASE_URL}/audio/${audioId}/download`,
  vttUrl: (audioId) => `${BASE_URL}/audio/${audioId}/vtt`,

  // ----------------------------------------------------------------- system
  getSettings: () => request('/system/settings'),
  updateSettings: (patchBody) => put('/system/settings', patchBody),
  clearApiKey: () => del('/system/settings/api-key'),
  getLanguages: () => request('/system/languages'),
  getPrompt: () => request('/system/prompt'),
  getPreflight: (force = false) => request(`/system/preflight${force ? '?force=true' : ''}`),
  getModels: (force = false) => request(`/system/models${force ? '?force=true' : ''}`),
  testApiKey: (apiKey) => post('/system/test-key', { apiKey }),
  getQuota: () => request('/system/quota'),
  getQueue: () => request('/system/queue'),
  pauseQueue: () => post('/system/queue/pause'),
  resumeQueue: () => post('/system/queue/resume'),
  cancelAll: (reason) => post('/system/queue/cancel-all', { reason }),
  getStorage: () => request('/system/storage'),
  exportDbUrl: () => `${BASE_URL}/system/export-db`,
  health: () => request('/health'),
};

/* ---------------------------------------------------------------------------
 * Compatibility shims.
 *
 * The backend refactor renamed several endpoints. `src/main.js` has not been
 * split into components yet and still calls the old names, so these adapters
 * keep the existing UI working instead of throwing "is not a function".
 *
 * They are deliberately thin, and each one is marked so it is obvious what to
 * delete once the frontend rewrite lands.
 * ------------------------------------------------------------------------- */

/** @deprecated use api.convert() */
api.generateAudio = (bookId, options = {}) => {
  const { groqApiKey, groqModel, translationStyle, ...rest } = options;
  return api.convert(bookId, {
    ...rest,
    groqApiKey: groqApiKey || undefined,
    groqModel: groqModel !== undefined ? groqModel : undefined,
    // The old UI still offers the removed "litrpg" style; map it to its
    // closest surviving equivalent rather than silently falling back.
    translationStyle: translationStyle === 'litrpg' ? 'novel' : translationStyle,
  });
};

/** @deprecated use api.cancelBook() */
api.cancelJobs = (bookId) => api.cancelBook(bookId);

/** @deprecated use api.getBookAudio() */
api.getAudioFiles = (bookId) => api.getBookAudio(bookId);

/** @deprecated use api.deleteAudio() */
api.deleteAudioFile = (audioId) => api.deleteAudio(audioId);

/** @deprecated use api.saveCustomScript() */
api.updateChapterTranslation = (bookId, idx, content) =>
  api.saveCustomScript(bookId, idx, content);

/** @deprecated use api.streamUrl() / api.downloadUrl() / api.vttUrl() */
api.getStreamUrl = (audioId) => api.streamUrl(audioId);
api.getDownloadUrl = (audioId) => api.downloadUrl(audioId);
api.getVttUrl = (audioId) => api.vttUrl(audioId);
