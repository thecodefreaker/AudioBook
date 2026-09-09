/**
 * Serializers — the single place where snake_case DB rows become camelCase API
 * payloads. The old code hand-mapped fields in every route, which is why the
 * frontend ended up reading `ch.hasTranslation` in one place and
 * `ch.translated_content` in another. One function per entity, used everywhere.
 */

export function book(row, extra = {}) {
  if (!row) return null;
  let coverImage = row.cover_image;
  if (coverImage && coverImage.includes('/data/covers/')) {
    coverImage = '/data/covers/' + coverImage.split('/data/covers/').pop();
  }

  return {
    id: row.id,
    title: row.title,
    author: row.author,
    coverImage: coverImage,
    totalChapters: row.total_chapters,
    status: row.status,
    fileSizeBytes: row.file_size_bytes,
    contentHash: row.content_hash,
    lastOpenedAt: row.last_opened_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...extra,
  };
}

export function chapter(row, rollup = {}) {
  if (!row) return null;
  return {
    id: row.id,
    chapterIndex: row.chapter_index,
    title: row.title,
    wordCount: row.word_count,
    charCount: row.char_count,
    status: row.status,
    errorMessage: row.error_message,
    isSkipped: !!row.is_skipped,
    skipReason: row.skip_reason,
    audioCount: rollup.audioCount || 0,
    scriptCount: rollup.scriptCount || 0,
    hasCustomScript: !!rollup.hasCustomScript,
    hasAiScript: !!rollup.hasAiScript,
    latestAiScriptId: rollup.latestAiScriptId || null,
    totalDuration: rollup.totalDuration || 0,
    latestAudioAt: rollup.latestAudioAt || null,
  };
}

export function script(row) {
  if (!row) return null;
  return {
    id: row.id,
    chapterId: row.chapter_id,
    source: row.source,
    language: row.language,
    scriptKind: row.script_kind,
    style: row.style,
    provider: row.provider,
    model: row.model,
    promptVersion: row.prompt_version,
    customPrompt: row.custom_prompt,
    content: row.content,
    spokenContent: row.spoken_content,
    tokenCount: row.token_count,
    charCount: row.char_count,
    createdAt: row.created_at,
  };
}

/** Lightweight variant for lists — omits the (potentially huge) body. */
export function scriptMeta(row) {
  if (!row) return null;
  const { content, spokenContent, ...rest } = script(row);
  return { ...rest, preview: (content || '').slice(0, 240) };
}

export function audio(row) {
  if (!row) return null;
  return {
    id: row.id,
    bookId: row.book_id,
    chapterId: row.chapter_id,
    chapterIndex: row.chapter_index,
    language: row.language,
    voiceId: row.voice_id,
    ttsProvider: row.tts_provider,
    durationSeconds: row.duration_seconds,
    fileSizeBytes: row.file_size_bytes,
    isMerged: !!row.is_merged,
    isFavourite: !!row.is_favourite,
    translationStyle: row.translation_style,
    model: row.groq_model,
    scriptId: row.script_id,
    // How this audio was actually produced. Joined from the script row so the
    // UI can badge it truthfully rather than inferring it from the style.
    scriptSource: row.script_source || null,
    scriptKind: row.script_kind || null,
    label: row.label,
    speakingRate: row.speaking_rate,
    providerStatus: row.provider_status,
    hasAlignment: !!row.alignment_json,
    createdAt: row.created_at,
    streamUrl: `/api/audio/${row.id}/stream`,
    downloadUrl: `/api/audio/${row.id}/download`,
  };
}

export function job(row, queueStatus = null) {
  if (!row) return null;
  return {
    id: row.id,
    bookId: row.book_id,
    bookTitle: row.book_title,
    status: row.status,
    progressPercent: row.progress_percent,
    selectedChapters: row.selected_chapters,
    completedChapters: row.completed_chapters,
    failedChapters: row.failed_chapters,
    totalChapters: row.total_chapters,
    language: row.language,
    voiceId: row.voice_id,
    translationStyle: row.translation_style,
    scriptSource: row.script_source,
    // 'both' | 'script' | 'audio' — the UI shows a text-only run differently,
    // since it produces no audio and must not be reported as a failed one.
    action: row.action || 'both',
    scriptId: row.script_id || null,
    model: row.groq_model,
    errorLog: row.error_log,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    createdAt: row.created_at,
    queue: queueStatus,
  };
}

export function logLine(row) {
  if (!row) return null;
  return {
    id: row.id,
    bookId: row.book_id,
    jobId: row.job_id,
    chapterIndex: row.chapter_index,
    level: row.level,
    stage: row.stage,
    message: row.message,
    detail: row.detail,
    timestamp: row.created_at,
  };
}

export function glossaryTerm(row) {
  if (!row) return null;
  return {
    id: row.id,
    term: row.term,
    keepAs: row.keep_as,
    note: row.note,
    auto: !!row.auto,
    createdAt: row.created_at,
  };
}
