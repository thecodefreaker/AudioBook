// ==UserScript==
// @name         Mozbot ChatGPT Audiobook Reteller Bridge
// @namespace    https://github.com/antigravity/audiobook-generator
// @version      2.8.0
// @description  Automates chapter retelling in ChatGPT Web and saves Hinglish scripts back to Audiobook Generator
// @author       Mozbot AI
// @match        https://chatgpt.com/*
// @match        https://chat.openai.com/*
// @match        *://chatgpt.com/*
// @match        *://chat.openai.com/*
// @include      https://chatgpt.com/*
// @include      https://chat.openai.com/*
// @include      *://chatgpt.com/*
// @include      *://*.chatgpt.com/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @connect      localhost
// @connect      127.0.0.1
// @connect      trycloudflare.com
// @connect      *
// @run-at       document-idle
// @noframes
// ==/UserScript==

(function () {
  'use strict';

  // Prevent script from running inside any embedded iframes
  if (typeof window !== 'undefined' && window.top !== window.self) {
    return;
  }

  const DEFAULT_SERVER_URL = 'http://localhost:3000';

  // Safe storage polyfills (supports Tampermonkey, Violentmonkey, Console, Bookmarklet)
  const _getValue = (key, def) => {
    try {
      if (typeof GM_getValue !== 'undefined') return GM_getValue(key, def);
      const val = localStorage.getItem(key);
      return val !== null ? JSON.parse(val) : def;
    } catch {
      return def;
    }
  };

  const _setValue = (key, val) => {
    try {
      if (typeof GM_setValue !== 'undefined') {
        GM_setValue(key, val);
        return;
      }
      localStorage.setItem(key, JSON.stringify(val));
    } catch {}
  };

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Background Worker: Prevents browser timer throttling when ChatGPT tab is inactive/minimized
  let bgWorker = null;
  function startBackgroundWorker() {
    if (bgWorker || typeof Worker === 'undefined') return;
    try {
      const workerCode = `
        self.onmessage = function(e) {
          if (e.data === 'start') {
            setInterval(function() {
              self.postMessage('tick');
            }, 1000);
          }
        };
      `;
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      bgWorker = new Worker(URL.createObjectURL(blob));
      bgWorker.onmessage = () => {
        window.dispatchEvent(new CustomEvent('mozbot_bg_tick'));
      };
      bgWorker.postMessage('start');
    } catch (e) {
      console.warn('[Mozbot] Background worker initialization skipped:', e.message);
    }
  }

  const State = {
    serverUrl: _getValue('mozbot_server_url', DEFAULT_SERVER_URL),
    serverConnected: false,
    autoAudio: _getValue('mozbot_auto_audio', true),
    existingAudioAction: _getValue('mozbot_existing_audio_action', 'ask'), // 'ask', 'regenerate', 'skip'
    delaySeconds: _getValue('mozbot_delay_seconds', 5),
    newChatStrategy: _getValue('mozbot_new_chat_strategy', 'every_5'), // 'every_5', 'every_chapter', 'every_n', 'off'
    newChatEveryN: parseInt(_getValue('mozbot_new_chat_every_n', 5), 10) || 5,
    chaptersInCurrentChat: parseInt(_getValue('mozbot_chapters_in_chat', 0), 10) || 0,
    cooldownEveryChapters: parseInt(_getValue('mozbot_cooldown_chapters', 20), 10) || 20,
    cooldownDurationMinutes: parseInt(_getValue('mozbot_cooldown_minutes', 30), 10) || 30,
    consecutiveConvertedCount: parseInt(_getValue('mozbot_consecutive_converted', 0), 10) || 0,
    inCooldown: false,
    cooldownEndsAt: parseInt(_getValue('mozbot_cooldown_ends_at', 0), 10) || 0,
    selectedBookId: _getValue('mozbot_book_id', ''),
    customPrompt: _getValue('mozbot_custom_prompt', ''),
    mode: _getValue('mozbot_mode', 'range'), // 'range' or 'single'
    fromChapter: _getValue('mozbot_from_chapter', ''),
    toChapter: _getValue('mozbot_to_chapter', ''),
    singleChapterIndex: _getValue('mozbot_single_ch', ''),
    running: Boolean(_getValue('mozbot_running', false)),
    paused: false,
    currentChapter: null,
    nextChapterInfo: null,
    currentOutputChars: 0,
    currentStage: 'idle', // 'idle', 'fetching', 'ready', 'newchat', 'pasting', 'generating', 'saving', 'cooldown', 'waiting'
    forceComplete: false,
    lastExtractedText: '',
    books: [],
    chapterList: [],
    chapterSearchQuery: '',
    processedChapters: new Set(_getValue('mozbot_processed_chapters', [])),
    activeTab: _getValue('mozbot_active_tab', 'studio'),
    statusText: 'Connecting to app...',
    logMessages: [],
  };

  function log(msg) {
    console.log('[Mozbot Bridge]', msg);
    State.logMessages.unshift(`[${new Date().toLocaleTimeString()}] ${msg}`);
    if (State.logMessages.length > 20) State.logMessages.pop();
    updateUi();
  }

  // -------------------------------------------------------------------------
  // Network calls to local / tunnel backend (bypasses CORS via GM or uses fetch)
  // -------------------------------------------------------------------------

  function apiRequest(method, endpoint, data = null) {
    return new Promise((resolve, reject) => {
      const baseUrl = State.serverUrl.replace(/\/+$/, '');
      const url = `${baseUrl}/api/bridge${endpoint}`;

      // 1. If inside Tampermonkey, GM_xmlhttpRequest bypasses all CORS and Mixed Content restrictions
      if (typeof GM_xmlhttpRequest !== 'undefined') {
        GM_xmlhttpRequest({
          method,
          url,
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json',
          },
          data: data ? JSON.stringify(data) : null,
          timeout: 20000,
          onload: (res) => {
            if (res.status >= 200 && res.status < 300) {
              try {
                resolve(JSON.parse(res.responseText));
              } catch (e) {
                resolve(res.responseText);
              }
            } else {
              reject(new Error(`Server returned ${res.status}: ${res.responseText || res.statusText}`));
            }
          },
          onerror: () => reject(new Error('Cannot reach Audiobook Generator. Is the server running?')),
          ontimeout: () => reject(new Error('Request timed out reaching Audiobook Generator')),
        });
        return;
      }

      // 2. Fallback: window.fetch() if run directly in DevTools console or bookmarklet
      fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: data ? JSON.stringify(data) : undefined,
      })
        .then(async (res) => {
          if (!res.ok) {
            const txt = await res.text().catch(() => '');
            throw new Error(`Server returned ${res.status}: ${txt || res.statusText}`);
          }
          return res.json();
        })
        .then(resolve)
        .catch((err) => reject(new Error(err.message || 'Cannot reach Audiobook Generator via fetch')));
    });
  }

  async function refreshServerStatus() {
    try {
      const data = await apiRequest('GET', '/status');
      if (data && data.books) {
        State.serverConnected = true;
        State.books = data.books;
        if (!State.selectedBookId && data.books.length > 0) {
          State.selectedBookId = data.books[0].id;
          _setValue('mozbot_book_id', State.selectedBookId);
        }
        if (!State.running && !State.inCooldown) {
          State.statusText = `Connected · ${data.books.length} book(s) in library`;
        }

        // Fetch detailed chapter list for active book
        if (State.selectedBookId) {
          const chData = await apiRequest('GET', `/book/${State.selectedBookId}/chapters`).catch(() => null);
          if (chData && chData.chapters) {
            State.chapterList = chData.chapters;
          }
        }
      }
    } catch (err) {
      State.serverConnected = false;
      if (!State.running && !State.inCooldown) {
        State.statusText = `⚠️ Offline (${err.message})`;
      }
    }
    updateUi();
  }

  function promptAudioConflict(chapterIndex, chapterTitle) {
    return new Promise((resolve) => {
      const existing = document.getElementById('mozbot-conflict-dialog');
      if (existing) existing.remove();

      const dialog = document.createElement('div');
      dialog.id = 'mozbot-conflict-dialog';
      dialog.style.cssText = `
        position: fixed;
        top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0, 0, 0, 0.78);
        backdrop-filter: blur(8px);
        z-index: 2147483648;
        display: flex; align-items: center; justify-content: center;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      `;

      dialog.innerHTML = `
        <div style="background: #161b22; border: 1px solid #30363d; border-radius: 14px; padding: 22px 24px; width: 350px; box-shadow: 0 16px 48px rgba(0,0,0,0.8); color: #c9d1d9;">
          <h3 style="margin: 0 0 12px; font-size: 15px; color: #f0883e; display:flex; align-items:center; gap:8px;">
            <span>🔊</span>
            <span>Audio Already Exists</span>
          </h3>
          <p style="font-size: 12.5px; margin: 0 0 18px; color: #8b949e; line-height: 1.45;">
            Chapter <strong>${chapterIndex}</strong> (${chapterTitle || 'Untitled'}) already has generated audio in your library.
          </p>
          <div style="display: flex; flex-direction: column; gap: 9px;">
            <button id="mozbot-act-regen" style="background: #238636; color: #fff; border: none; padding: 10px 16px; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 12.5px; transition: background 0.2s;">🔄 Regenerate Script & Audio</button>
            <button id="mozbot-act-skip" style="background: #21262d; color: #c9d1d9; border: 1px solid #30363d; padding: 10px 16px; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 12.5px; transition: background 0.2s;">⏭️ Skip This Chapter</button>
          </div>
        </div>
      `;

      document.body.appendChild(dialog);

      document.getElementById('mozbot-act-regen')?.addEventListener('click', () => {
        dialog.remove();
        resolve('regenerate');
      });

      document.getElementById('mozbot-act-skip')?.addEventListener('click', () => {
        dialog.remove();
        resolve('skip');
      });
    });
  }

  // -------------------------------------------------------------------------
  // ChatGPT DOM Helpers (Robust against frontend updates)
  // -------------------------------------------------------------------------

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getChatInput() {
    return (
      document.querySelector('#prompt-textarea') ||
      document.querySelector('#mobile-composer-prompt') ||
      document.querySelector('textarea.wm-composer-textarea') ||
      document.querySelector('div[contenteditable="true"][data-placeholder]') ||
      document.querySelector('div[contenteditable="true"]') ||
      document.querySelector('textarea[data-id="root"]') ||
      document.querySelector('textarea[placeholder*="ChatGPT"]') ||
      document.querySelector('textarea')
    );
  }

  async function waitForChatInput(timeoutMs = 25000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const inputEl = getChatInput();
      if (inputEl && isElementVisible(inputEl)) {
        return inputEl;
      }
      await sleep(300);
    }
    return getChatInput();
  }

  function isElementVisible(el) {
    if (!el) return false;
    try {
      if (el.closest && el.closest('[hidden]')) return false;
      if (el.style && (el.style.display === 'none' || el.style.visibility === 'hidden')) return false;
      return el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0;
    } catch {
      return false;
    }
  }

  function isStopButton(btn) {
    if (!btn) return false;
    const testid = (btn.getAttribute('data-testid') || '').toLowerCase();
    const label = (btn.getAttribute('aria-label') || '').toLowerCase();
    const title = (btn.getAttribute('title') || '').toLowerCase();
    return (
      testid.includes('stop') ||
      label.includes('stop streaming') ||
      label.includes('stop generating') ||
      label === 'stop' ||
      title.includes('stop')
    );
  }

  function getSendButton() {
    return (
      document.querySelector('button[data-testid="send-button"]') ||
      document.querySelector('button.wm-composer-submitButton') ||
      document.querySelector('button[aria-label="Send message"]') ||
      document.querySelector('button[aria-label="Send prompt"]') ||
      document.querySelector('button[data-testid="fruitjuice-send-button"]') ||
      document.querySelector('form button[type="submit"]') ||
      document.querySelector('button[aria-label*="Send" i]')
    );
  }

  function isExplicitStopButtonActive() {
    // Look specifically inside or directly adjacent to the composer form
    const composer = (
      document.querySelector('form[data-testid*="composer"]') ||
      document.querySelector('form') ||
      document.querySelector('.wm-composer') ||
      document.querySelector('#prompt-textarea')?.closest('form') ||
      document
    );

    const stopSelectors = [
      'button[data-testid="stop-button"]',
      'button[data-testid="composer-stop-button"]',
      'button.wm-composer-stopButton',
      'button[aria-label="Stop streaming" i]',
      'button[aria-label="Stop generating" i]',
      'button[aria-label="Stop" i]'
    ];

    for (const sel of stopSelectors) {
      const btn = composer.querySelector(sel);
      if (btn && isElementVisible(btn)) {
        return true;
      }
    }

    return false;
  }

  function isStreamingElementActive() {
    // Only elements with EXPLICIT ="true" or active result-streaming class
    const activeStream = (
      document.querySelector('.result-streaming') ||
      document.querySelector('[data-is-streaming="true"]') ||
      document.querySelector('[data-message-streaming="true"]')
    );
    return Boolean(activeStream && isElementVisible(activeStream));
  }

  function isGeneratingActive() {
    // If the composer clearly shows an active Send button and NO stop button, generation is NOT active
    const sendBtn = getSendButton();
    const hasVisibleSendBtn = sendBtn && isElementVisible(sendBtn) && !isStopButton(sendBtn);

    const hasStop = isExplicitStopButtonActive();
    const hasStreamingEl = isStreamingElementActive();

    if (hasStop) return true;
    if (hasStreamingEl && !hasVisibleSendBtn) return true;

    return false;
  }

  function getContinueButton() {
    return (
      document.querySelector('button[data-testid="continue-generating-button"]') ||
      Array.from(document.querySelectorAll('button')).find((btn) => {
        if (!isElementVisible(btn)) return false;
        const text = (btn.innerText || btn.textContent || '').toLowerCase();
        const label = (btn.getAttribute('aria-label') || '').toLowerCase();
        return text.includes('continue generating') || label.includes('continue generating');
      })
    );
  }

  function getAllAssistantMessages() {
    const isVisible = (el) => {
      if (!el) return false;
      if (el.closest && el.closest('[hidden]')) return false;
      return el.offsetParent !== null || (el.innerText || el.textContent || '').trim().length > 0;
    };

    // Priority 1: data-message-role="assistant" (current web/mobile architecture)
    let els = Array.from(document.querySelectorAll('[data-message-role="assistant"]')).filter(isVisible);
    if (els.length > 0) return els;

    // Priority 2: data-message-author-role="assistant" (classic desktop)
    els = Array.from(document.querySelectorAll('[data-message-author-role="assistant"]')).filter(isVisible);
    if (els.length > 0) return els;

    // Priority 3: Conversation turns that are assistant (not user)
    els = Array.from(document.querySelectorAll('article[data-testid^="conversation-turn-"], li[data-message-role]')).filter((turn) => {
      if (!isVisible(turn)) return false;
      const isUser = Boolean(turn.querySelector('[data-message-role="user"], [data-message-author-role="user"]'));
      const hasContent = Boolean(turn.querySelector('.markdown, .prose, [data-assistant-markdown], [data-testid="writing-block-container"]'));
      return !isUser && hasContent;
    });
    if (els.length > 0) return els;

    // Priority 4: Canvas / Writing Block or Markdown containers
    return Array.from(document.querySelectorAll('[data-testid="writing-block-container"], [data-assistant-markdown], .markdown.prose, .markdown')).filter(isVisible);
  }

  function extractAssistantMessageText(msgEl) {
    if (!msgEl) return '';

    // DUAL-MODE Extraction Strategy:
    // Mode A: Interactive Canvas / Writing Block Artifact Mode
    let container = (
      msgEl.querySelector('.writing-block-editor') ||
      msgEl.querySelector('[data-testid="writing-block-container"] .ProseMirror') ||
      msgEl.querySelector('[data-testid="writing-block-container"]')
    );

    // Mode B: Standard Response Mode (Normal Text Mode)
    if (!container) {
      container = (
        msgEl.querySelector('[data-assistant-markdown]') ||
        msgEl.querySelector('.markdown') ||
        msgEl.querySelector('.prose')
      );
    }

    if (!container) {
      container = msgEl;
    }

    try {
      const clone = container.cloneNode(true);

      // Strip UI controls, headers, buttons, icons, action bars, and follow-up suggestion blocks
      const unwanted = clone.querySelectorAll(`
        button,
        svg,
        .writing-block-header,
        [aria-label*="actions"],
        [aria-label*="Edit"],
        [aria-label*="Copy"],
        [data-testid*="action"],
        [data-testid*="follow-up"],
        .suggestions-container,
        [role="button"],
        details,
        [class*="thought"],
        ._wdUoQG_srOnly,
        .sr-only
      `);
      unwanted.forEach((el) => el.remove());

      let extracted = (clone.innerText || clone.textContent || '').trim();

      // Clean leftover header labels
      extracted = extracted.replace(/^(?:Edit|Copy|Share)\s+/i, '');
      extracted = extracted.replace(/(?:Edit|Copy|Share|Read aloud)\s*$/gi, '').trim();

      // Strip trailing follow-up conversational questions
      const followUpRegex = /\n\n(?:Would you like|Shall I|Do you want|Let me know if|आगे क्या|क्या आप|क्या मैं)[^\n]*\??$/gi;
      extracted = extracted.replace(followUpRegex, '').trim();

      return extracted;
    } catch {
      let txt = (container.innerText || container.textContent || '').trim();
      txt = txt.replace(/^(?:Edit|Copy|Share)\s+/i, '');
      txt = txt.replace(/(?:Edit|Copy|Share|Read aloud)\s*$/gi, '').trim();
      return txt;
    }
  }

  function hasTurnActionButtons(msgEl) {
    if (!msgEl) return false;
    const turn = msgEl.closest('article, [data-testid^="conversation-turn-"]') || msgEl.parentElement || msgEl;

    const actionSelectors = [
      'button[data-testid*="copy"]',
      'button[aria-label*="Copy" i]',
      'button[data-testid="copy-turn-action-button"]',
      'button[aria-label*="Read aloud" i]',
      'button[aria-label*="Good response" i]',
      'button[aria-label*="Bad response" i]',
      '[data-testid*="turn-action"]',
      '[data-testid*="message-actions"] button',
      '.message-actions button'
    ];

    for (const sel of actionSelectors) {
      const btn = turn.querySelector(sel);
      if (btn && isElementVisible(btn)) return true;
    }

    return false;
  }

  function setInputValue(inputEl, text) {
    if (!inputEl) return;
    inputEl.focus();

    if (inputEl.tagName.toLowerCase() === 'textarea') {
      inputEl.value = text;
      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    } else if (inputEl.isContentEditable || inputEl.getAttribute('contenteditable') === 'true') {
      // Modern ProseMirror / contenteditable ChatGPT input
      try {
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
      } catch {}

      let success = false;
      try {
        success = document.execCommand('insertText', false, text);
      } catch {}

      if (!success) {
        inputEl.innerHTML = '';
        const p = document.createElement('p');
        p.textContent = text;
        inputEl.appendChild(p);
      }

      inputEl.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
      inputEl.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function getLastAssistantMessage() {
    const assistantMessages = getAllAssistantMessages();
    if (assistantMessages.length > 0) {
      const lastMsg = assistantMessages[assistantMessages.length - 1];
      const extracted = extractAssistantMessageText(lastMsg);
      if (extracted && extracted.length >= 50) return extracted;
    }
    if (State.lastExtractedText && State.lastExtractedText.length >= 50) {
      return State.lastExtractedText;
    }
    return null;
  }

  // -------------------------------------------------------------------------
  // Automation Engine (Multi-Signal Detection + Watchdog Safety Valve)
  // -------------------------------------------------------------------------

  async function waitForGenerationComplete(initialAssistantCount = 0, timeoutMs = 240000) {
    log('Waiting for ChatGPT response to begin...');
    const start = Date.now();
    State.forceComplete = false;

    // 1. Wait for response to start streaming (up to 20 seconds)
    let responseStarted = false;
    while (Date.now() - start < 20000) {
      if (!State.running) throw new Error('Stopped by user');
      if (State.forceComplete) {
        State.forceComplete = false;
        log('⚡ Manual override: Force proceeding to save.');
        return true;
      }

      const msgs = getAllAssistantMessages();
      const generating = isGeneratingActive();
      if (msgs.length > initialAssistantCount || generating) {
        responseStarted = true;
        break;
      }
      await sleep(400);
    }

    if (responseStarted) {
      log('Generation in progress...');
    } else {
      log('Generation start indicator pending; monitoring response stability...');
    }

    // 2. Wait until generation finishes using a resilient multi-signal approach
    let lastLength = 0;
    let stableCount = 0;
    const STABLE_REQUIRED = 3; // 3 consecutive checks (~3s) with unchanged text

    while (Date.now() - start < timeoutMs) {
      if (!State.running) throw new Error('Stopped by user');
      if (State.forceComplete) {
        State.forceComplete = false;
        log('⚡ Manual override: Force-marked generation as complete!');
        return true;
      }

      // Check for rate limit or errors
      const errorNotice = document.querySelector('.text-red-500, [data-testid="error-message"], [class*="errorMessage"]');
      if (errorNotice && isElementVisible(errorNotice) && (errorNotice.innerText.includes('limit') || errorNotice.innerText.includes('error') || errorNotice.innerText.includes('capacity'))) {
        throw new Error(`ChatGPT Error: ${errorNotice.innerText}`);
      }

      // Check if ChatGPT stopped early with a "Continue generating" button
      const continueBtn = getContinueButton();
      if (continueBtn && !continueBtn.disabled) {
        log('Detected "Continue generating" button. Clicking to resume...');
        continueBtn.click();
        await sleep(1500);
        continue;
      }

      const generating = isGeneratingActive();
      const msgs = getAllAssistantMessages();
      const currentMsg = msgs.length > 0 ? msgs[msgs.length - 1] : null;
      const currentText = currentMsg ? extractAssistantMessageText(currentMsg) : '';
      const currentLength = currentText.length;

      if (currentText && currentLength > 50) {
        State.lastExtractedText = currentText;
      }

      // Live progress indicator in the HUD
      if (currentLength > 0 && currentLength !== lastLength) {
        State.currentOutputChars = currentLength;
        State.currentStage = 'generating';
        State.statusText = `Generating: ${currentLength.toLocaleString()} chars...`;
        updateUi();
      }

      const actionButtonsPresent = currentMsg ? hasTurnActionButtons(currentMsg) : false;
      const sendBtn = getSendButton();
      const sendReady = sendBtn && isElementVisible(sendBtn) && !isStopButton(sendBtn);
      const inputEl = getChatInput();
      const inputReady = inputEl && !inputEl.hasAttribute('disabled');

      // Stability tracker
      if (currentLength > 50 && currentLength === lastLength) {
        stableCount++;
      } else {
        stableCount = 0;
      }
      lastLength = currentLength;

      // Completion Condition 1: Turn action buttons (Copy/Read aloud) appeared
      // (Definitive signal: ChatGPT only renders action buttons after stream is closed)
      if (actionButtonsPresent && currentLength > 50) {
        if (!generating || stableCount >= 1) {
          log(`✅ Generation completed! (Turn action buttons detected, ${currentLength.toLocaleString()} chars)`);
          State.currentOutputChars = currentLength;
          State.currentStage = 'saving';
          State.statusText = `Completed (${currentLength.toLocaleString()} chars) · Saving...`;
          updateUi();
          return true;
        }
      }

      // Completion Condition 2: Send button restored in composer & text is stable for 2s
      if (sendReady && stableCount >= 2 && currentLength > 50) {
        log(`✅ Generation completed! (Send button restored in composer, ${currentLength.toLocaleString()} chars)`);
        State.currentOutputChars = currentLength;
        State.currentStage = 'saving';
        State.statusText = `Completed (${currentLength.toLocaleString()} chars) · Saving...`;
        updateUi();
        return true;
      }

      // Completion Condition 3: Text has stabilized for 3s & no active stop button
      if (stableCount >= STABLE_REQUIRED && !generating && currentLength > 50) {
        log(`✅ Generation completed! (Text stabilized at ${currentLength.toLocaleString()} chars)`);
        State.currentOutputChars = currentLength;
        State.currentStage = 'saving';
        State.statusText = `Completed (${currentLength.toLocaleString()} chars) · Saving...`;
        updateUi();
        return true;
      }

      // Completion Condition 4: Stop button gone, input is editable, text is substantial and stable
      if (!generating && inputReady && stableCount >= 2 && currentLength > 100) {
        log(`✅ Generation completed! (Composer ready, ${currentLength.toLocaleString()} chars)`);
        State.currentOutputChars = currentLength;
        State.currentStage = 'saving';
        State.statusText = `Completed (${currentLength.toLocaleString()} chars) · Saving...`;
        updateUi();
        return true;
      }

      // Completion Condition 5 (FAILSAFE WATCHDOG): Zero text growth for 4 consecutive seconds on substantial text
      // Prevents halting if any third-party script or DOM element causes false-positive generating flag
      if (stableCount >= 4 && currentLength > 150 && !isExplicitStopButtonActive()) {
        log(`✅ Generation completed! (Watchdog: Text stable for 4s with ${currentLength.toLocaleString()} chars)`);
        State.currentOutputChars = currentLength;
        State.currentStage = 'saving';
        State.statusText = `Completed (${currentLength.toLocaleString()} chars) · Saving...`;
        updateUi();
        return true;
      }

      // Completion Condition 6 (ULTIMATE CATCH-ALL): 6 seconds of static text with substantial output
      if (stableCount >= 6 && currentLength > 200) {
        log(`✅ Generation completed! (Watchdog catch-all: 6s of silence, ${currentLength.toLocaleString()} chars)`);
        State.currentOutputChars = currentLength;
        State.currentStage = 'saving';
        State.statusText = `Completed (${currentLength.toLocaleString()} chars) · Saving...`;
        updateUi();
        return true;
      }

      await sleep(1000);
    }

    throw new Error('Timeout waiting for ChatGPT response (4 minutes)');
  }

  async function openNewChat() {
    log('✨ Opening new ChatGPT chat session...');
    State.statusText = '✨ Opening new chat...';
    updateUi();

    State.chaptersInCurrentChat = 0;
    _setValue('mozbot_chapters_in_chat', 0);

    // 1. If already on root path without assistant messages, session is fresh
    if (window.location.pathname === '/' || window.location.pathname === '') {
      const msgs = getAllAssistantMessages();
      if (msgs.length === 0) {
        log('Already in clean chat session.');
        return 'clean';
      }
    }

    // 2. Attempt Keyboard Shortcut (ChatGPT native hotkey Ctrl+Shift+O / Cmd+Shift+O)
    try {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const opts = {
        key: 'O',
        code: 'KeyO',
        keyCode: 79,
        which: 79,
        ctrlKey: !isMac,
        metaKey: isMac,
        shiftKey: true,
        bubbles: true,
        cancelable: true
      };
      window.dispatchEvent(new KeyboardEvent('keydown', opts));
      document.dispatchEvent(new KeyboardEvent('keydown', opts));
      await sleep(1000);
      const msgsAfterHotkey = getAllAssistantMessages();
      if (msgsAfterHotkey.length === 0 && (window.location.pathname === '/' || window.location.pathname === '')) {
        log('✅ Successfully started fresh chat via keyboard shortcut.');
        return 'clean';
      }
    } catch (e) {
      // Continue to DOM click strategy
    }

    // 3. Click New Chat button in DOM using multi-selector list
    const selectors = [
      'a[href="/"]',
      'a[href="https://chatgpt.com/"]',
      'a[href="https://chatgpt.com"]',
      'button[aria-label*="New chat" i]',
      'a[aria-label*="New chat" i]',
      'button[aria-label*="Naya chat" i]',
      '[data-testid="create-new-chat-button"]',
      '[data-testid="navigation-new-chat-button"]',
      '[data-testid="new-chat-button"]',
      '[data-testid="sidebar-new-chat-button"]',
      'nav a[href="/"]',
      'nav button[aria-label*="New" i]',
      'a[data-discover="true"]'
    ];

    let clicked = false;
    for (const sel of selectors) {
      const btn = document.querySelector(sel);
      if (btn && (btn.offsetParent !== null || btn.offsetWidth > 0 || btn.getClientRects().length > 0)) {
        btn.click();
        clicked = true;
        break;
      }
    }

    if (!clicked) {
      const allBtns = Array.from(document.querySelectorAll('a, button, [role="button"]'));
      const textMatch = allBtns.find((el) => {
        const txt = (el.innerText || el.textContent || '').trim().toLowerCase();
        return txt === 'new chat' || txt === '+ new chat' || txt.includes('new chat');
      });
      if (textMatch) {
        textMatch.click();
        clicked = true;
      }
    }

    if (clicked) {
      await sleep(1500);
      const msgs = getAllAssistantMessages();
      const inputEl = getChatInput();
      if (msgs.length === 0 && inputEl) {
        log('✅ Successfully started fresh ChatGPT conversation via DOM click.');
        return 'clean';
      }
    }

    // 4. Fallback: Navigate to root https://chatgpt.com/ (100% foolproof, auto-resumes state on load)
    if (window.location.pathname !== '/' && window.location.pathname !== '') {
      log('Navigating to root https://chatgpt.com/ for fresh chat...');
      _setValue('mozbot_running', State.running);
      _setValue('mozbot_processed_chapters', Array.from(State.processedChapters));
      _setValue('mozbot_chapters_in_chat', 0);
      window.location.href = 'https://chatgpt.com/';
      return 'navigating';
    }
    return 'clean';
  }

  async function runCooldown(totalSeconds) {
    State.inCooldown = true;
    State.currentStage = 'cooldown';
    State.cooldownEndsAt = Date.now() + totalSeconds * 1000;
    _setValue('mozbot_cooldown_ends_at', State.cooldownEndsAt);
    log(`☕ Entering a ${Math.round(totalSeconds / 60)}-minute anti-spam pause to protect ChatGPT rate limits...`);
    window.dispatchEvent(new CustomEvent('mozbot_state_change'));
    updateUi();

    while (State.running && State.inCooldown && Date.now() < State.cooldownEndsAt) {
      const remainingSec = Math.max(0, Math.round((State.cooldownEndsAt - Date.now()) / 1000));
      const m = Math.floor(remainingSec / 60);
      const s = remainingSec % 60;
      const timeStr = `${m}m ${s < 10 ? '0' : ''}${s}s`;
      State.statusText = `☕ Anti-spam break (${timeStr} left)`;
      updateUi();
      await sleep(1000);
    }

    const wasCancelled = !State.inCooldown;
    State.inCooldown = false;
    State.cooldownEndsAt = 0;
    _setValue('mozbot_cooldown_ends_at', 0);

    if (State.running) {
      if (wasCancelled) {
        log('⚡ Anti-spam break skipped by user. Resuming conversion loop...');
      } else {
        log('☕ Anti-spam break finished! Starting fresh chat and resuming conversion loop...');
      }
      await openNewChat();
      updateUi();
    }
  }

  async function runStepOnce() {
    if (!State.running) return 'stopped';

    let targetLabel = 'next chapter';
    let targetNum = null;
    if (State.mode === 'single' && State.singleChapterIndex !== '') {
      targetNum = parseInt(State.singleChapterIndex, 10);
      targetLabel = `Chapter ${targetNum}`;
    } else if (State.nextChapterInfo && State.nextChapterInfo.index) {
      targetNum = State.nextChapterInfo.index;
      targetLabel = `Chapter ${targetNum}`;
    } else if (State.fromChapter !== '') {
      targetNum = parseInt(State.fromChapter, 10);
      targetLabel = `Chapter ${targetNum}`;
    }

    State.currentStage = 'fetching';
    State.currentOutputChars = 0;
    State.requestingChapterNum = targetNum;
    State.statusText = `📡 Fetching ${targetLabel} from app...`;
    updateUi();
    log(`📡 Requesting ${targetLabel} from server...`);

    const promptQuery = State.customPrompt ? `&customPrompt=${encodeURIComponent(State.customPrompt)}` : '';
    const skipQuery = State.processedChapters.size > 0 ? `&skipIndices=${Array.from(State.processedChapters).join(',')}` : '';

    let endpointUrl = '';
    if (State.mode === 'single' && State.singleChapterIndex !== '') {
      endpointUrl = `/next-chapter?bookId=${encodeURIComponent(State.selectedBookId)}&chapterIndex=${encodeURIComponent(State.singleChapterIndex)}${promptQuery}`;
    } else {
      const fromQuery = State.fromChapter !== '' ? `&fromChapter=${encodeURIComponent(State.fromChapter)}` : '';
      const toQuery = State.toChapter !== '' ? `&toChapter=${encodeURIComponent(State.toChapter)}` : '';
      endpointUrl = `/next-chapter?bookId=${encodeURIComponent(State.selectedBookId)}${promptQuery}${fromQuery}${toQuery}${skipQuery}`;
    }

    const data = await apiRequest('GET', endpointUrl);
    State.requestingChapterNum = null;

    if (!data.ok) {
      throw new Error(data.error || 'Failed to fetch chapter from app');
    }

    if (data.done) {
      log('🎉 ' + (data.message || 'Scope completed! All target chapters processed.'));
      State.running = false;
      _setValue('mozbot_running', false);
      State.currentChapter = null;
      State.nextChapterInfo = null;
      State.currentStage = 'idle';
      State.statusText = '🎉 Scope Completed!';
      window.dispatchEvent(new CustomEvent('mozbot_state_change'));
      updateUi();
      return 'done';
    }

    State.currentChapter = data;
    State.nextChapterInfo = { index: data.nextChapterIndex, title: data.nextChapterTitle };
    State.currentStage = 'ready';
    State.statusText = `Converting Ch ${data.chapterIndex}: ${data.chapterTitle || 'Untitled'}`;
    log(`✅ Loaded Chapter ${data.chapterIndex} ("${data.chapterTitle || 'Untitled'}") · ${data.wordCount || 0} words`);
    updateUi();

    // Check existing audio conflict
    if (data.hasAudio && !State.processedChapters.has(data.chapterIndex)) {
      if (State.existingAudioAction === 'skip') {
        log(`⏭️ Chapter ${data.chapterIndex} already has audio. Skipping per settings...`);
        State.processedChapters.add(data.chapterIndex);
        _setValue('mozbot_processed_chapters', Array.from(State.processedChapters));
        updateUi();
        return 'continue';
      } else if (State.existingAudioAction === 'ask') {
        log(`⚠️ Chapter ${data.chapterIndex} has existing audio. Asking user choice...`);
        const choice = await promptAudioConflict(data.chapterIndex, data.chapterTitle);
        if (choice === 'skip') {
          log(`⏭️ Skipped Chapter ${data.chapterIndex} (User requested skip).`);
          State.processedChapters.add(data.chapterIndex);
          _setValue('mozbot_processed_chapters', Array.from(State.processedChapters));
          updateUi();
          return 'continue';
        } else {
          log(`🔄 Regenerating Chapter ${data.chapterIndex} per user choice...`);
        }
      }
    }

    log(`Starting Chapter ${data.chapterIndex} (${data.chapterTitle || 'Untitled'}) · ${data.wordCount || 0} words`);

    // 2. Check if a new chat should be opened (e.g. after every 5 chapters in Range mode)
    let shouldNewChat = false;
    if (State.newChatStrategy === 'every_chapter') {
      if (State.chaptersInCurrentChat > 0) shouldNewChat = true;
    } else if (State.newChatStrategy === 'every_5') {
      if (State.chaptersInCurrentChat >= 5) shouldNewChat = true;
    } else if (State.newChatStrategy === 'every_n') {
      if (State.chaptersInCurrentChat >= (State.newChatEveryN || 5)) shouldNewChat = true;
    }

    if (shouldNewChat) {
      State.currentStage = 'newchat';
      State.statusText = '✨ Starting fresh chat session...';
      updateUi();
      log(`🔄 Processed ${State.chaptersInCurrentChat} chapter(s) in active chat. Starting NEW CHAT...`);
      const navRes = await openNewChat();
      if (navRes === 'navigating') {
        return 'navigating'; // Page is reloading to root, init() will auto-resume in fresh session
      }
      await sleep(1000);
    }

    // Capture assistant message count before sending prompt
    const initialAssistantCount = getAllAssistantMessages().length;

    // 3. Paste into chat input (wait up to 15 seconds for composer to be active)
    const inputEl = await waitForChatInput(15000);
    if (!inputEl) {
      throw new Error('Could not find ChatGPT input box. Is the chat page fully loaded?');
    }

    State.currentStage = 'pasting';
    State.statusText = `Pasting prompt for Ch ${data.chapterIndex}...`;
    updateUi();
    log(`Pasting prompt for Chapter ${data.chapterIndex}...`);
    setInputValue(inputEl, data.prompt);
    await sleep(600);

    // 4. Wait up to 10s for Send button to be enabled and click Send
    let sendBtn = null;
    const sendWaitStart = Date.now();
    while (Date.now() - sendWaitStart < 10000) {
      sendBtn = getSendButton();
      if (sendBtn && !sendBtn.disabled && sendBtn.getAttribute('aria-disabled') !== 'true') {
        break;
      }
      await sleep(250);
    }

    if (sendBtn && !sendBtn.disabled && sendBtn.getAttribute('aria-disabled') !== 'true') {
      sendBtn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      sendBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
      sendBtn.click();
      sendBtn.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
      sendBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    } else {
      // Fallback: Dispatch Enter key
      inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      inputEl.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      inputEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true }));
      if (sendBtn) {
        sendBtn.removeAttribute('disabled');
        sendBtn.setAttribute('aria-disabled', 'false');
        sendBtn.click();
      }
    }

    await sleep(1000);

    // 5. Wait for ChatGPT to finish generating
    State.currentStage = 'generating';
    State.statusText = `Waiting for response on Ch ${data.chapterIndex}...`;
    updateUi();
    await waitForGenerationComplete(initialAssistantCount);

    // 6. Extract the retold text
    const retoldText = getLastAssistantMessage();
    if (!retoldText || retoldText.length < 50) {
      throw new Error('Retold response from ChatGPT was empty or too short');
    }

    State.currentStage = 'saving';
    State.statusText = `Saving Ch ${data.chapterIndex} (${retoldText.length} chars)...`;
    updateUi();
    log(`Received retold text (${retoldText.length} characters). Saving to app...`);

    // 7. Submit back to Audiobook Generator
    const submitRes = await apiRequest('POST', '/submit-chapter', {
      bookId: data.bookId,
      chapterIndex: data.chapterIndex,
      content: retoldText,
      autoAudio: State.autoAudio,
    });

    if (!submitRes.ok) {
      throw new Error(submitRes.error || 'Failed to save chapter to app');
    }

    log(`✅ Chapter ${data.chapterIndex} saved! ${State.autoAudio ? '(Audio generation started)' : ''}`);
    State.processedChapters.add(data.chapterIndex);
    _setValue('mozbot_processed_chapters', Array.from(State.processedChapters));

    State.chaptersInCurrentChat++;
    _setValue('mozbot_chapters_in_chat', State.chaptersInCurrentChat);
    log(`📊 Progress in active chat: ${State.chaptersInCurrentChat} chapter(s) converted.`);

    State.consecutiveConvertedCount++;
    _setValue('mozbot_consecutive_converted', State.consecutiveConvertedCount);
    log(`🔢 Total consecutive chapters in current run: ${State.consecutiveConvertedCount}`);
    refreshServerStatus();

    if (State.mode === 'single') {
      log(`🎉 Single Chapter ${data.chapterIndex} conversion complete!`);
      State.running = false;
      _setValue('mozbot_running', false);
      State.currentChapter = null;
      State.nextChapterInfo = null;
      State.currentStage = 'idle';
      State.statusText = `✅ Chapter ${data.chapterIndex} Done!`;
      window.dispatchEvent(new CustomEvent('mozbot_state_change'));
      updateUi();
      return 'done';
    }

    // Check Anti-Spam Batch Cooldown (e.g. pause for 30 minutes after every 20 chapters)
    if (State.cooldownEveryChapters > 0 && State.consecutiveConvertedCount >= State.cooldownEveryChapters) {
      log(`☕ Reached ${State.consecutiveConvertedCount} consecutive chapters! Initiating ${State.cooldownDurationMinutes || 30}-minute cooldown break...`);
      State.consecutiveConvertedCount = 0;
      _setValue('mozbot_consecutive_converted', 0);
      await runCooldown((State.cooldownDurationMinutes || 30) * 60);
      if (!State.running) return 'stopped';
    }

    // 8. Delay before next chapter
    if (State.running) {
      State.currentStage = 'waiting';
      for (let s = State.delaySeconds; s > 0; s--) {
        if (!State.running) break;
        State.statusText = `Next chapter in ${s}s...`;
        updateUi();
        await sleep(1000);
      }
    }
    return 'continue';
  }

  async function runAutomationLoop() {
    let consecutiveErrors = 0;
    const MAX_RETRIES = 3;

    while (State.running) {
      try {
        const res = await runStepOnce();
        consecutiveErrors = 0;
        if (res === 'done' || res === 'stopped' || !State.running) {
          break;
        }
        if (res === 'navigating') {
          return; // page is reloading to root, init() will auto-resume in fresh session
        }
      } catch (err) {
        if (!State.running) break;
        consecutiveErrors++;
        log(`⚠️ Step error (attempt ${consecutiveErrors}/${MAX_RETRIES}): ${err.message}`);

        if (consecutiveErrors >= MAX_RETRIES) {
          log(`❌ Automation stopped after ${MAX_RETRIES} consecutive errors: ${err.message}`);
          State.running = false;
          _setValue('mozbot_running', false);
          State.currentStage = 'idle';
          State.statusText = `Stopped: ${err.message}`;
          window.dispatchEvent(new CustomEvent('mozbot_state_change'));
          updateUi();
          break;
        }

        const retryDelaySec = consecutiveErrors * 5;
        for (let s = retryDelaySec; s > 0; s--) {
          if (!State.running) break;
          State.statusText = `⚠️ Error: Retrying in ${s}s... (${consecutiveErrors}/${MAX_RETRIES})`;
          updateUi();
          await sleep(1000);
        }
      }
    }
  }

  async function startAutomation() {
    if (!State.selectedBookId) {
      alert('Please select a book first in the Mozbot widget!');
      return;
    }
    State.processedChapters.clear();
    _setValue('mozbot_processed_chapters', []);
    State.chaptersInCurrentChat = 0;
    _setValue('mozbot_chapters_in_chat', 0);
    State.consecutiveConvertedCount = 0;
    _setValue('mozbot_consecutive_converted', 0);
    State.running = true;
    _setValue('mozbot_running', true);
    State.currentStage = 'fetching';
    State.statusText = 'Starting automation loop...';
    window.dispatchEvent(new CustomEvent('mozbot_state_change'));
    updateUi();

    startBackgroundWorker();

    if (State.newChatStrategy !== 'off' && (window.location.pathname !== '/' || getAllAssistantMessages().length > 0)) {
      log('Starting batch range in fresh chat session...');
      const navRes = await openNewChat();
      if (navRes === 'navigating') {
        return;
      }
      await sleep(1000);
    }

    await runAutomationLoop();
  }

  function stopAutomation() {
    State.running = false;
    State.inCooldown = false;
    State.cooldownEndsAt = 0;
    _setValue('mozbot_running', false);
    _setValue('mozbot_cooldown_ends_at', 0);
    State.currentStage = 'idle';
    State.statusText = 'Paused';
    log('Automation stopped by user.');
    window.dispatchEvent(new CustomEvent('mozbot_state_change'));
    updateUi();
  }

  // -------------------------------------------------------------------------
  // Floating HUD UI (Ultra-Modern Glassmorphism Multi-Tab Interface)
  // -------------------------------------------------------------------------

  let hudContainer = null;
  let isMinimized = Boolean(_getValue('mozbot_minimized', false));
  let isDragging = false;
  let dragOffset = { x: 0, y: 0 };
  let currentRenderedTab = null;

  function injectStyles() {
    let styleEl = document.getElementById('mozbot-hud-styles');
    if (!styleEl) {
      styleEl = document.createElement('style');
      styleEl.id = 'mozbot-hud-styles';
      document.head.appendChild(styleEl);
    }
    styleEl.textContent = `
      #mozbot-bridge-hud,
      #mozbot-bridge-hud * {
        box-sizing: border-box !important;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif !important;
      }
      #mozbot-bridge-hud :where(h1, h2, h3, h4, h5, h6, p, ul, ol, li, figure) {
        margin: 0;
        padding: 0;
      }
      #mozbot-bridge-hud {
        position: fixed !important;
        z-index: 2147483647 !important;
        color: #f0f6fc !important;
        font-size: 12px !important;
        line-height: 1.5 !important;
        transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease !important;
        text-rendering: optimizeLegibility !important;
        -webkit-font-smoothing: antialiased !important;
      }
      #mozbot-bridge-hud .mozbot-panel {
        width: 396px !important;
        background: rgba(13, 17, 23, 0.94) !important;
        backdrop-filter: blur(28px) saturate(190%) !important;
        -webkit-backdrop-filter: blur(28px) saturate(190%) !important;
        border: 1px solid rgba(255, 255, 255, 0.12) !important;
        border-radius: 16px !important;
        box-shadow: 0 24px 64px -8px rgba(0, 0, 0, 0.82), 0 0 0 1px rgba(255, 255, 255, 0.06), inset 0 1px 0 rgba(255, 255, 255, 0.14) !important;
        overflow: hidden !important;
        display: flex !important;
        flex-direction: column !important;
        user-select: none !important;
        transition: border-color 0.25s ease, box-shadow 0.25s ease !important;
      }
      #mozbot-bridge-hud .mozbot-panel.running {
        border-color: rgba(34, 197, 94, 0.45) !important;
        box-shadow: 0 24px 64px -8px rgba(0, 0, 0, 0.85), 0 0 24px rgba(34, 197, 94, 0.22), 0 0 0 1px rgba(34, 197, 94, 0.35) !important;
      }
      #mozbot-bridge-hud .mozbot-panel.cooldown {
        border-color: rgba(234, 179, 8, 0.5) !important;
        box-shadow: 0 24px 64px -8px rgba(0, 0, 0, 0.85), 0 0 24px rgba(234, 179, 8, 0.25), 0 0 0 1px rgba(234, 179, 8, 0.4) !important;
      }
      /* Header */
      #mozbot-bridge-hud .mozbot-header {
        display: flex !important;
        align-items: center !important;
        justify-content: space-between !important;
        padding: 14px 20px !important;
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.05) 0%, rgba(255, 255, 255, 0.01) 100%) !important;
        border-bottom: 1px solid rgba(255, 255, 255, 0.08) !important;
        cursor: grab !important;
      }
      #mozbot-bridge-hud .mozbot-header:active {
        cursor: grabbing !important;
      }
      #mozbot-bridge-hud .mozbot-header-left {
        display: flex !important;
        align-items: center !important;
        gap: 10px !important;
      }
      #mozbot-bridge-hud .mozbot-drag-handle {
        color: #8b949e !important;
        font-size: 13px !important;
        letter-spacing: -2px !important;
        opacity: 0.55 !important;
      }
      #mozbot-bridge-hud .mozbot-header-title {
        font-weight: 700 !important;
        font-size: 13px !important;
        color: #ffffff !important;
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        letter-spacing: -0.2px !important;
      }
      #mozbot-bridge-hud .mozbot-version-tag {
        font-size: 10px !important;
        font-weight: 700 !important;
        padding: 3px 9px !important;
        border-radius: 9999px !important;
        background: rgba(59, 130, 246, 0.15) !important;
        color: #60a5fa !important;
        border: 1px solid rgba(59, 130, 246, 0.35) !important;
        letter-spacing: 0.3px !important;
        line-height: 1.2 !important;
      }
      #mozbot-bridge-hud .mozbot-header-actions {
        display: flex !important;
        align-items: center !important;
        gap: 6px !important;
      }
      #mozbot-bridge-hud .mozbot-icon-btn {
        background: transparent !important;
        border: none !important;
        color: #94a3b8 !important;
        cursor: pointer !important;
        border-radius: 7px !important;
        width: 28px !important;
        height: 28px !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        font-size: 13px !important;
        transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1) !important;
      }
      #mozbot-bridge-hud .mozbot-icon-btn:hover {
        background: rgba(255, 255, 255, 0.09) !important;
        color: #ffffff !important;
        transform: scale(1.05) !important;
      }
      /* Modern Capsule Tabs Bar - Segmented Control */
      #mozbot-bridge-hud .mozbot-tabs-bar {
        display: flex !important;
        background: rgba(0, 0, 0, 0.42) !important;
        margin: 14px 20px 2px !important;
        padding: 5px !important;
        border-radius: 11px !important;
        border: 1px solid rgba(255, 255, 255, 0.08) !important;
        gap: 4px !important;
      }
      #mozbot-bridge-hud .mozbot-tab-btn {
        flex: 1 !important;
        text-align: center !important;
        padding: 8px 10px !important;
        font-size: 11.5px !important;
        font-weight: 600 !important;
        line-height: 1.25 !important;
        color: #8b949e !important;
        background: transparent !important;
        border: none !important;
        border-radius: 8px !important;
        cursor: pointer !important;
        transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1) !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 6px !important;
        min-height: 34px !important;
        white-space: nowrap !important;
      }
      #mozbot-bridge-hud .mozbot-tab-btn:hover {
        color: #f0f6fc !important;
        background: rgba(255, 255, 255, 0.06) !important;
      }
      #mozbot-bridge-hud .mozbot-tab-btn.active {
        color: #ffffff !important;
        background: rgba(255, 255, 255, 0.13) !important;
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.16) !important;
      }
      /* Body Content */
      #mozbot-bridge-hud .mozbot-body {
        padding: 16px 20px 20px !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 14px !important;
        max-height: 560px !important;
        overflow-y: auto !important;
        user-select: text !important;
      }
      #mozbot-bridge-hud .mozbot-body::-webkit-scrollbar,
      #mozbot-bridge-hud .mozbot-scroll::-webkit-scrollbar {
        width: 5px !important;
      }
      #mozbot-bridge-hud .mozbot-body::-webkit-scrollbar-track,
      #mozbot-bridge-hud .mozbot-scroll::-webkit-scrollbar-track {
        background: transparent !important;
      }
      #mozbot-bridge-hud .mozbot-body::-webkit-scrollbar-thumb,
      #mozbot-bridge-hud .mozbot-scroll::-webkit-scrollbar-thumb {
        background: rgba(255, 255, 255, 0.14) !important;
        border-radius: 4px !important;
      }
      #mozbot-bridge-hud .mozbot-body::-webkit-scrollbar-thumb:hover,
      #mozbot-bridge-hud .mozbot-scroll::-webkit-scrollbar-thumb:hover {
        background: rgba(255, 255, 255, 0.25) !important;
      }
      /* Pulse Animations */
      @keyframes mozbot-pulse-green {
        0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.7); }
        70% { transform: scale(1.05); box-shadow: 0 0 0 6px rgba(34, 197, 94, 0); }
        100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
      }
      @keyframes mozbot-pulse-amber {
        0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(234, 179, 8, 0.8); }
        70% { transform: scale(1.05); box-shadow: 0 0 0 6px rgba(234, 179, 8, 0); }
        100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(234, 179, 8, 0); }
      }
      @keyframes mozbot-pulse-blue {
        0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(59, 130, 246, 0.75); }
        70% { transform: scale(1.05); box-shadow: 0 0 0 6px rgba(59, 130, 246, 0); }
        100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(59, 130, 246, 0); }
      }
      #mozbot-bridge-hud .mozbot-dot-green {
        width: 7.5px !important;
        height: 7.5px !important;
        border-radius: 50% !important;
        background: #22c55e !important;
        animation: mozbot-pulse-green 1.8s infinite !important;
      }
      #mozbot-bridge-hud .mozbot-dot-amber {
        width: 7.5px !important;
        height: 7.5px !important;
        border-radius: 50% !important;
        background: #eab308 !important;
        animation: mozbot-pulse-amber 1.8s infinite !important;
      }
      #mozbot-bridge-hud .mozbot-dot-blue {
        width: 7.5px !important;
        height: 7.5px !important;
        border-radius: 50% !important;
        background: #3b82f6 !important;
        animation: mozbot-pulse-blue 1.8s infinite !important;
      }
      #mozbot-bridge-hud .mozbot-dot-idle {
        width: 7.5px !important;
        height: 7.5px !important;
        border-radius: 50% !important;
        background: #64748b !important;
      }
      /* Hero Live Monitor Card */
      #mozbot-bridge-hud .mozbot-hero-card {
        background: linear-gradient(165deg, rgba(30, 38, 52, 0.8) 0%, rgba(15, 20, 29, 0.95) 100%) !important;
        border: 1px solid rgba(255, 255, 255, 0.1) !important;
        border-radius: 14px !important;
        padding: 16px 18px !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 12px !important;
        box-shadow: 0 4px 18px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.09) !important;
      }
      #mozbot-bridge-hud .mozbot-hero-top {
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
      }
      #mozbot-bridge-hud .mozbot-hero-badge {
        display: inline-flex !important;
        align-items: center !important;
        gap: 7px !important;
        padding: 4.5px 11px !important;
        border-radius: 9999px !important;
        font-size: 10px !important;
        font-weight: 700 !important;
        letter-spacing: 0.5px !important;
        line-height: 1.2 !important;
        text-transform: uppercase !important;
      }
      #mozbot-bridge-hud .mozbot-hero-badge.running {
        background: rgba(34, 197, 94, 0.15) !important;
        color: #4ade80 !important;
        border: 1px solid rgba(34, 197, 94, 0.35) !important;
      }
      #mozbot-bridge-hud .mozbot-hero-badge.generating {
        background: rgba(168, 85, 247, 0.18) !important;
        color: #c084fc !important;
        border: 1px solid rgba(168, 85, 247, 0.38) !important;
      }
      #mozbot-bridge-hud .mozbot-hero-badge.cooldown {
        background: rgba(234, 179, 8, 0.16) !important;
        color: #facc15 !important;
        border: 1px solid rgba(234, 179, 8, 0.38) !important;
      }
      #mozbot-bridge-hud .mozbot-hero-badge.idle {
        background: rgba(100, 116, 139, 0.15) !important;
        color: #94a3b8 !important;
        border: 1px solid rgba(100, 116, 139, 0.3) !important;
      }
      #mozbot-bridge-hud .mozbot-hero-title {
        font-size: 13px !important;
        font-weight: 700 !important;
        color: #ffffff !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        margin: 2px 0 !important;
        line-height: 1.35 !important;
      }
      #mozbot-bridge-hud .mozbot-hero-grid {
        display: grid !important;
        grid-template-columns: 1fr 1fr !important;
        gap: 9px !important;
        margin-top: 2px !important;
      }
      /* Stat Box Component System */
      #mozbot-bridge-hud .mozbot-metric-box {
        background: rgba(0, 0, 0, 0.38) !important;
        border: 1px solid rgba(255, 255, 255, 0.07) !important;
        border-radius: 10px !important;
        padding: 10px 14px !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 4px !important;
      }
      #mozbot-bridge-hud .mozbot-metric-label {
        font-size: 9px !important;
        color: #94a3b8 !important;
        text-transform: uppercase !important;
        letter-spacing: 0.6px !important;
        font-weight: 650 !important;
        line-height: 1.2 !important;
      }
      #mozbot-bridge-hud .mozbot-metric-val {
        font-size: 12.5px !important;
        font-weight: 650 !important;
        color: #e2e8f0 !important;
        overflow: hidden !important;
        text-overflow: ellipsis !important;
        white-space: nowrap !important;
        font-family: ui-monospace, SFMono-Regular, monospace !important;
        line-height: 1.35 !important;
        padding: 1px 0 !important;
      }
      #mozbot-bridge-hud .mozbot-force-btn {
        background: linear-gradient(135deg, rgba(59,130,246,0.2), rgba(37,99,235,0.3)) !important;
        border: 1px solid rgba(59,130,246,0.5) !important;
        color: #93c5fd !important;
        border-radius: 7px !important;
        padding: 5px 12px !important;
        font-size: 10.5px !important;
        font-weight: 700 !important;
        cursor: pointer !important;
        display: inline-flex !important;
        align-items: center !important;
        gap: 5px !important;
        line-height: 1.25 !important;
        box-shadow: 0 2px 6px rgba(0,0,0,0.3) !important;
        transition: all 0.15s ease !important;
      }
      #mozbot-bridge-hud .mozbot-force-btn:hover {
        background: linear-gradient(135deg, rgba(59,130,246,0.35), rgba(37,99,235,0.45)) !important;
        border-color: #60a5fa !important;
        color: #ffffff !important;
        transform: translateY(-1px) !important;
      }
      /* Live Status Bar */
      #mozbot-bridge-hud .mozbot-status-bar {
        display: flex !important;
        align-items: center !important;
        gap: 8px !important;
        background: rgba(0, 0, 0, 0.45) !important;
        border: 1px solid rgba(59, 130, 246, 0.28) !important;
        border-radius: 9px !important;
        padding: 8px 12px !important;
        font-size: 11.5px !important;
        color: #93c5fd !important;
        font-weight: 550 !important;
        line-height: 1.35 !important;
        box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04) !important;
        overflow: hidden !important;
      }
      #mozbot-bridge-hud .mozbot-status-bar.running {
        border-color: rgba(34, 197, 94, 0.35) !important;
        color: #86efac !important;
        background: rgba(34, 197, 94, 0.08) !important;
      }
      #mozbot-bridge-hud .mozbot-status-bar.warning {
        border-color: rgba(234, 179, 8, 0.4) !important;
        color: #fde047 !important;
        background: rgba(234, 179, 8, 0.08) !important;
      }
      /* Pill / Minimized Mode */
      #mozbot-bridge-hud .mozbot-pill {
        display: flex !important;
        align-items: center !important;
        gap: 10px !important;
        padding: 9px 16px !important;
        background: rgba(13, 17, 23, 0.94) !important;
        backdrop-filter: blur(20px) !important;
        -webkit-backdrop-filter: blur(20px) !important;
        border: 1px solid rgba(255, 255, 255, 0.16) !important;
        border-radius: 9999px !important;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.65), 0 0 0 1px rgba(255, 255, 255, 0.05) !important;
        cursor: pointer !important;
        transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1) !important;
        user-select: none !important;
      }
      #mozbot-bridge-hud .mozbot-pill:hover {
        border-color: rgba(59, 130, 246, 0.55) !important;
        transform: translateY(-2px) !important;
        box-shadow: 0 12px 34px rgba(0, 0, 0, 0.75) !important;
      }
      #mozbot-bridge-hud .mozbot-pill-text {
        font-size: 12px !important;
        font-weight: 600 !important;
        color: #ffffff !important;
        white-space: nowrap !important;
      }
      /* Form Controls & Input System */
      #mozbot-bridge-hud .mozbot-select,
      #mozbot-bridge-hud .mozbot-input,
      #mozbot-bridge-hud .mozbot-textarea {
        width: 100% !important;
        background: rgba(0, 0, 0, 0.45) !important;
        color: #f0f6fc !important;
        border: 1px solid rgba(255, 255, 255, 0.12) !important;
        border-radius: 9px !important;
        padding: 9px 13px !important;
        font-size: 12px !important;
        line-height: 1.4 !important;
        min-height: 38px !important;
        box-sizing: border-box !important;
        transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease !important;
      }
      #mozbot-bridge-hud .mozbot-select {
        padding-right: 28px !important;
        cursor: pointer !important;
      }
      #mozbot-bridge-hud .mozbot-textarea {
        padding: 11px 13px !important;
        line-height: 1.5 !important;
        min-height: 85px !important;
      }
      #mozbot-bridge-hud .mozbot-select:focus,
      #mozbot-bridge-hud .mozbot-input:focus,
      #mozbot-bridge-hud .mozbot-textarea:focus {
        outline: none !important;
        border-color: #3b82f6 !important;
        box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25) !important;
        background: rgba(0, 0, 0, 0.65) !important;
      }
      #mozbot-bridge-hud .mozbot-input[type=number]::-webkit-inner-spin-button,
      #mozbot-bridge-hud .mozbot-input[type=number]::-webkit-outer-spin-button {
        -webkit-appearance: none !important;
        margin: 0 !important;
      }
      #mozbot-bridge-hud .mozbot-input[type=number] {
        -moz-appearance: textfield !important;
        appearance: textfield !important;
      }
      #mozbot-bridge-hud .mozbot-input-compact {
        min-width: 66px !important;
        width: 70px !important;
        padding: 7px 10px !important;
        min-height: 34px !important;
        text-align: center !important;
        font-weight: 600 !important;
        font-family: ui-monospace, monospace !important;
      }
      #mozbot-bridge-hud .mozbot-label {
        display: block !important;
        font-size: 10.5px !important;
        font-weight: 600 !important;
        color: #94a3b8 !important;
        margin-bottom: 6px !important;
        text-transform: uppercase !important;
        letter-spacing: 0.5px !important;
        line-height: 1.3 !important;
      }
      /* Segmented Mode Controller */
      #mozbot-bridge-hud .mozbot-segmented {
        display: flex !important;
        background: rgba(0, 0, 0, 0.42) !important;
        padding: 5px !important;
        border-radius: 11px !important;
        gap: 5px !important;
        border: 1px solid rgba(255, 255, 255, 0.08) !important;
      }
      #mozbot-bridge-hud .mozbot-seg-btn {
        flex: 1 !important;
        padding: 8px 14px !important;
        background: transparent !important;
        color: #8b949e !important;
        border: none !important;
        border-radius: 8px !important;
        font-size: 12px !important;
        font-weight: 600 !important;
        line-height: 1.25 !important;
        cursor: pointer !important;
        transition: all 0.15s cubic-bezier(0.16, 1, 0.3, 1) !important;
        text-align: center !important;
        min-height: 34px !important;
        display: inline-flex !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 6px !important;
        white-space: nowrap !important;
      }
      #mozbot-bridge-hud .mozbot-seg-btn:hover {
        color: #ffffff !important;
      }
      #mozbot-bridge-hud .mozbot-seg-btn.active {
        background: #2563eb !important;
        color: #ffffff !important;
        box-shadow: 0 2px 8px rgba(37, 99, 235, 0.4) !important;
      }
      /* Primary CTA Buttons */
      #mozbot-bridge-hud .mozbot-cta-start {
        width: 100% !important;
        background: linear-gradient(180deg, #22c55e 0%, #16a34a 100%) !important;
        color: #ffffff !important;
        border: 1px solid rgba(255, 255, 255, 0.18) !important;
        border-radius: 11px !important;
        padding: 12px 18px !important;
        font-size: 13px !important;
        font-weight: 700 !important;
        line-height: 1.3 !important;
        min-height: 44px !important;
        cursor: pointer !important;
        box-shadow: 0 4px 14px rgba(22, 163, 74, 0.38), inset 0 1px 0 rgba(255, 255, 255, 0.2) !important;
        transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1) !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 7px !important;
      }
      #mozbot-bridge-hud .mozbot-cta-start:hover {
        background: linear-gradient(180deg, #2ade74 0%, #18b753 100%) !important;
        transform: translateY(-1px) !important;
        box-shadow: 0 6px 18px rgba(22, 163, 74, 0.48) !important;
      }
      #mozbot-bridge-hud .mozbot-cta-start:active {
        transform: translateY(0) !important;
      }
      #mozbot-bridge-hud .mozbot-cta-stop {
        width: 100% !important;
        background: linear-gradient(180deg, #ef4444 0%, #dc2626 100%) !important;
        color: #ffffff !important;
        border: 1px solid rgba(255, 255, 255, 0.18) !important;
        border-radius: 10px !important;
        padding: 12px 18px !important;
        font-size: 13px !important;
        font-weight: 700 !important;
        line-height: 1.3 !important;
        min-height: 44px !important;
        cursor: pointer !important;
        box-shadow: 0 4px 14px rgba(220, 38, 38, 0.38), inset 0 1px 0 rgba(255, 255, 255, 0.2) !important;
        transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1) !important;
        display: flex !important;
        align-items: center !important;
        justify-content: center !important;
        gap: 7px !important;
      }
      #mozbot-bridge-hud .mozbot-cta-stop:hover {
        background: linear-gradient(180deg, #f87171 0%, #e11d48 100%) !important;
        transform: translateY(-1px) !important;
        box-shadow: 0 6px 18px rgba(220, 38, 38, 0.48) !important;
      }
      #mozbot-bridge-hud .mozbot-cta-stop:active {
        transform: translateY(0) !important;
      }
      /* Card Section Container (Settings, etc) */
      #mozbot-bridge-hud .mozbot-card-section {
        background: rgba(255, 255, 255, 0.025) !important;
        border: 1px solid rgba(255, 255, 255, 0.07) !important;
        border-radius: 13px !important;
        padding: 14px 18px !important;
        display: flex !important;
        flex-direction: column !important;
        gap: 10px !important;
      }
      #mozbot-bridge-hud .mozbot-card-section summary {
        font-weight: 600 !important;
        font-size: 12px !important;
        color: #e2e8f0 !important;
        outline: none !important;
        padding: 6px 2px !important;
        line-height: 1.4 !important;
        cursor: pointer !important;
        user-select: none !important;
      }
      #mozbot-bridge-hud .mozbot-btn-secondary {
        background: rgba(255, 255, 255, 0.06) !important;
        border: 1px solid rgba(255, 255, 255, 0.1) !important;
        color: #cbd5e1 !important;
        border-radius: 7px !important;
        padding: 5px 12px !important;
        font-size: 11px !important;
        font-weight: 600 !important;
        line-height: 1.3 !important;
        cursor: pointer !important;
        transition: all 0.15s ease !important;
        display: inline-flex !important;
        align-items: center !important;
        gap: 5px !important;
      }
      #mozbot-bridge-hud .mozbot-btn-secondary:hover {
        background: rgba(255, 255, 255, 0.12) !important;
        color: #ffffff !important;
      }
      #mozbot-bridge-hud .mozbot-ch-chip {
        display: inline-flex !important;
        align-items: center !important;
        background: rgba(59, 130, 246, 0.22) !important;
        color: #60a5fa !important;
        border: 1px solid rgba(59, 130, 246, 0.4) !important;
        padding: 3px 8px !important;
        border-radius: 6px !important;
        font-size: 10.5px !important;
        font-weight: 700 !important;
        font-family: ui-monospace, monospace !important;
        line-height: 1.2 !important;
        white-space: nowrap !important;
      }
      #mozbot-bridge-hud .mozbot-ch-row {
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        padding: 10px 14px !important;
        background: rgba(0, 0, 0, 0.36) !important;
        border: 1px solid rgba(255, 255, 255, 0.06) !important;
        border-radius: 10px !important;
        cursor: pointer !important;
        transition: all 0.15s ease !important;
        margin-bottom: 3px !important;
        gap: 10px !important;
      }
      #mozbot-bridge-hud .mozbot-ch-row:hover {
        background: rgba(255, 255, 255, 0.06) !important;
        border-color: rgba(255, 255, 255, 0.15) !important;
        transform: translateX(1px) !important;
      }
    `;
  }

  function makeDraggable(element, handle) {
    if (!element || !handle) return;

    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('button') || e.target.closest('input') || e.target.closest('select')) return;
      isDragging = true;
      const rect = element.getBoundingClientRect();
      dragOffset.x = e.clientX - rect.left;
      dragOffset.y = e.clientY - rect.top;

      element.style.bottom = 'auto';
      element.style.right = 'auto';
      element.style.left = `${rect.left}px`;
      element.style.top = `${rect.top}px`;

      document.body.style.userSelect = 'none';

      const onMouseMove = (moveEvt) => {
        if (!isDragging) return;
        const newLeft = Math.max(10, Math.min(window.innerWidth - element.offsetWidth - 10, moveEvt.clientX - dragOffset.x));
        const newTop = Math.max(10, Math.min(window.innerHeight - 50, moveEvt.clientY - dragOffset.y));
        element.style.left = `${newLeft}px`;
        element.style.top = `${newTop}px`;
      };

      const onMouseUp = () => {
        if (!isDragging) return;
        isDragging = false;
        document.body.style.userSelect = '';
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);

        const finalRect = element.getBoundingClientRect();
        _setValue('mozbot_hud_pos', { left: Math.round(finalRect.left), top: Math.round(finalRect.top) });
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    });

    handle.addEventListener('dblclick', (e) => {
      if (e.target.closest('button')) return;
      resetHudPosition();
    });
  }

  function resetHudPosition() {
    if (!hudContainer) return;
    _setValue('mozbot_hud_pos', null);
    hudContainer.style.left = 'auto';
    hudContainer.style.top = 'auto';
    hudContainer.style.right = '20px';
    hudContainer.style.bottom = '20px';
    log('Reset HUD position to bottom-right corner.');
  }

  function createUi() {
    try {
      if (document.getElementById('mozbot-bridge-hud')) return;

      const target = document.body || document.documentElement;
      if (!target) return;

      injectStyles();

      hudContainer = document.createElement('div');
      hudContainer.id = 'mozbot-bridge-hud';

      const savedPos = _getValue('mozbot_hud_pos', null);
      if (savedPos && typeof savedPos.left === 'number' && typeof savedPos.top === 'number') {
        const maxLeft = Math.max(10, window.innerWidth - 380);
        const maxTop = Math.max(10, window.innerHeight - 80);
        hudContainer.style.left = `${Math.min(Math.max(10, savedPos.left), maxLeft)}px`;
        hudContainer.style.top = `${Math.min(Math.max(10, savedPos.top), maxTop)}px`;
        hudContainer.style.right = 'auto';
        hudContainer.style.bottom = 'auto';
      } else {
        hudContainer.style.bottom = '20px';
        hudContainer.style.right = '20px';
        hudContainer.style.left = 'auto';
        hudContainer.style.top = 'auto';
      }

      target.appendChild(hudContainer);
      updateUi();
    } catch (err) {
      console.error('[Mozbot UI Error in createUi]', err);
    }
  }

  function getStageBadgeInfo() {
    if (State.inCooldown) {
      return { text: '☕ ANTI-SPAM BREAK', cls: 'cooldown', dot: 'mozbot-dot-amber' };
    }
    if (!State.running) {
      return { text: '⏸️ READY (IDLE)', cls: 'idle', dot: 'mozbot-dot-idle' };
    }
    switch (State.currentStage) {
      case 'generating':
        return { text: '⚡ GENERATING', cls: 'generating', dot: 'mozbot-dot-blue' };
      case 'pasting':
        return { text: '✉️ SENDING PROMPT', cls: 'running', dot: 'mozbot-dot-green' };
      case 'newchat':
        return { text: '✨ OPENING CHAT', cls: 'running', dot: 'mozbot-dot-green' };
      case 'fetching':
        return { text: '📡 FETCHING', cls: 'running', dot: 'mozbot-dot-green' };
      case 'saving':
        return { text: '💾 SAVING', cls: 'running', dot: 'mozbot-dot-green' };
      case 'waiting':
        return { text: '⏱️ NEXT IN SECONDS', cls: 'running', dot: 'mozbot-dot-green' };
      default:
        return { text: '🟢 RUNNING', cls: 'running', dot: 'mozbot-dot-green' };
    }
  }

  function renderChapterRow(ch, isCurrent) {
    let badgeText = isCurrent ? '🟢 Active' : ch.hasAudio ? '🔊 Audio' : ch.hasCustomScript || ch.hasAiScript ? '📝 Script' : '⏳ Pending';
    let badgeColor = isCurrent ? '#4ade80' : ch.hasAudio ? '#c084fc' : ch.hasCustomScript || ch.hasAiScript ? '#60a5fa' : '#94a3b8';
    let badgeBg = isCurrent ? 'rgba(34,197,94,0.18)' : ch.hasAudio ? 'rgba(168,85,247,0.18)' : ch.hasCustomScript || ch.hasAiScript ? 'rgba(59,130,246,0.18)' : 'rgba(255,255,255,0.06)';
    let badgeBorder = isCurrent ? 'rgba(34,197,94,0.38)' : ch.hasAudio ? 'rgba(168,85,247,0.38)' : ch.hasCustomScript || ch.hasAiScript ? 'rgba(59,130,246,0.38)' : 'rgba(255,255,255,0.08)';

    return `
      <div class="mozbot-ch-row" data-index="${ch.chapterIndex}" style="${isCurrent ? 'border-color:rgba(34,197,94,0.5); background:rgba(34,197,94,0.12);' : ''}">
        <div style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1; font-size:12px; line-height:1.35;">
          <span style="font-weight:700; color:#f0f6fc; font-family:ui-monospace, monospace; margin-right:6px;">Ch ${ch.chapterIndex}:</span>
          <span style="color:#94a3b8;">${ch.title || 'Untitled'}</span>
        </div>
        <span style="font-size:10.5px; font-weight:700; color:${badgeColor}; background:${badgeBg}; border:1px solid ${badgeBorder}; padding:4px 10px; border-radius:6px; white-space:nowrap; line-height:1.2; flex-shrink:0;">
          ${badgeText}
        </span>
      </div>
    `;
  }

  function renderStudioTab(currentBook, scripted, total, percent) {
    const badge = getStageBadgeInfo();
    const chIndexBadge = State.currentChapter && State.currentChapter.chapterIndex
      ? `<span class="mozbot-ch-chip">CH ${State.currentChapter.chapterIndex}</span>`
      : '';
    const chTitleText = State.currentChapter ? (State.currentChapter.chapterTitle || 'Untitled') : State.requestingChapterNum ? `Fetching Chapter ${State.requestingChapterNum}...` : 'Ready to start';
    const words = State.currentChapter && State.currentChapter.wordCount ? `${State.currentChapter.wordCount.toLocaleString()} w` : '—';
    const streamChars = State.currentOutputChars > 0 ? `${State.currentOutputChars.toLocaleString()} chars` : '0 chars';
    const scopeLabel = State.mode === 'single' ? `Single Ch ${State.singleChapterIndex || '?'}` : `[${State.fromChapter || 1} - ${State.toChapter || total || 'End'}]`;
    const sessionLabel = `Ch ${State.chaptersInCurrentChat} of ${State.newChatStrategy === 'every_n' ? State.newChatEveryN : 5}`;
    const nextPreview = State.nextChapterInfo && State.nextChapterInfo.index ? `Next ➔ Ch ${State.nextChapterInfo.index}: ${State.nextChapterInfo.title || 'Untitled'}` : State.running ? 'End of scope' : 'Auto-detected';

    return `
      <!-- Book Selector Bar -->
      <div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <label class="mozbot-label" style="margin-bottom:0;">Target Book Library</label>
          <span id="mozbot-connection-badge" style="font-size:11px; color:${State.serverConnected ? '#4ade80' : '#facc15'}; font-weight:600; display:flex; align-items:center; gap:6px;">
            <span id="mozbot-connection-dot">${State.serverConnected ? '🟢' : '⚠️'}</span>
            <span id="mozbot-connection-status">${State.serverConnected ? 'Connected' : 'Offline'}</span>
          </span>
        </div>
        <select id="mozbot-book-select" class="mozbot-select">
          ${
            State.books.length === 0
              ? '<option value="">No books detected</option>'
              : State.books.map((b) => `<option value="${b.id}" ${b.id === State.selectedBookId ? 'selected' : ''}>${b.title} (${b.scriptedChapters}/${b.totalChapters})</option>`).join('')
          }
        </select>
      </div>

      <!-- Book Progress Bar -->
      ${
        total > 0
          ? `
        <div>
          <div style="display:flex; justify-content:space-between; font-size:11px; color:#94a3b8; margin-bottom:6px;">
            <span>Book Progress</span>
            <span id="mozbot-live-progress-label"><strong>${scripted}</strong> / ${total} chapters (${percent}%)</span>
          </div>
          <div style="height:8px; background:rgba(255,255,255,0.06); border-radius:4px; overflow:hidden; position:relative; box-shadow:inset 0 1px 2px rgba(0,0,0,0.5);">
            <div id="mozbot-live-progress-fill" style="width:${percent}%; height:100%; background:linear-gradient(90deg, #3b82f6, #10b981); border-radius:4px; box-shadow:0 0 10px rgba(16,185,129,0.35); transition:width 0.3s ease;"></div>
          </div>
        </div>
      `
          : ''
      }

      <!-- Anti-Spam Break Banner (Active when inCooldown) -->
      ${
        State.inCooldown
          ? `
        <div id="mozbot-live-cooldown-banner" style="background:linear-gradient(135deg, rgba(234,179,8,0.15), rgba(202,138,4,0.08)); border:1px solid rgba(234,179,8,0.45); border-radius:13px; padding:16px 18px; text-align:center; box-shadow:0 4px 12px rgba(0,0,0,0.25);">
          <div style="font-weight:700; color:#facc15; font-size:12.5px; margin-bottom:5px; display:flex; align-items:center; justify-content:center; gap:6px;">
            <span>☕ Anti-Spam Rest Active</span>
          </div>
          <div style="font-size:11px; color:#cbd5e1; margin-bottom:10px; line-height:1.4;">Pausing after ${State.cooldownEveryChapters} chapters to shield ChatGPT rate limits.</div>
          <div id="mozbot-live-cooldown-timer" style="font-size:16px; font-weight:700; color:#60a5fa; font-family:ui-monospace, monospace; margin-bottom:12px; letter-spacing:0.5px;">${State.statusText.replace('☕ Anti-spam break ', '')}</div>
          <button id="mozbot-skip-cooldown-btn" style="background:linear-gradient(180deg, #22c55e 0%, #16a34a 100%); color:#fff; border:1px solid rgba(255,255,255,0.2); border-radius:8px; padding:8px 18px; font-size:11.5px; font-weight:700; cursor:pointer; box-shadow:0 2px 8px rgba(22,163,74,0.3); transition:all 0.15s ease;">⚡ Skip Break & Resume Now</button>
        </div>
      `
          : ''
      }

      <!-- Hero Live Monitor Card -->
      <div class="mozbot-hero-card">
        <div class="mozbot-hero-top">
          <div id="mozbot-hero-stage" class="mozbot-hero-badge ${badge.cls}">
            <div id="mozbot-hero-dot" class="${badge.dot}"></div>
            <span id="mozbot-hero-badge-text">${badge.text}</span>
          </div>
          <div id="mozbot-hero-top-right" style="display:flex; align-items:center; gap:6px;">
            ${
              State.running && (State.currentStage === 'generating' || State.currentOutputChars > 50)
                ? `<button id="mozbot-force-done-btn" class="mozbot-force-btn" title="If ChatGPT response has finished, click to proceed immediately to save">⚡ Save Now</button>`
                : '<span style="font-size:9.5px; color:#8b949e; font-weight:700; letter-spacing:0.5px;">COCKPIT</span>'
            }
          </div>
        </div>

        <div id="mozbot-hero-title" class="mozbot-hero-title" title="${State.currentChapter ? `Ch ${State.currentChapter.chapterIndex}: ${State.currentChapter.chapterTitle || 'Untitled'}` : chTitleText}">
          ${chIndexBadge} <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${chTitleText}</span>
        </div>

        <!-- Live Activity Status Bar inside cockpit -->
        <div id="mozbot-live-status-bar" class="mozbot-status-bar ${State.running ? 'running' : State.inCooldown ? 'warning' : ''}" style="margin: 4px 0;">
          <span class="mozbot-status-dot ${State.inCooldown ? 'mozbot-dot-amber' : State.running ? 'mozbot-dot-green' : 'mozbot-dot-idle'}" style="width:7px; height:7px; border-radius:50%; flex-shrink:0;"></span>
          <span id="mozbot-live-status-text" style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap; flex:1;">${escapeHtml(State.statusText)}</span>
        </div>

        <div class="mozbot-hero-grid">
          <div class="mozbot-metric-box">
            <div class="mozbot-metric-label">Scope Target</div>
            <div id="mozbot-hero-scope" class="mozbot-metric-val">${scopeLabel}</div>
          </div>
          <div class="mozbot-metric-box">
            <div class="mozbot-metric-label">Live Output</div>
            <div id="mozbot-hero-chars" class="mozbot-metric-val" style="color:#60a5fa;">${streamChars}</div>
          </div>
          <div class="mozbot-metric-box">
            <div class="mozbot-metric-label">Chat Session</div>
            <div id="mozbot-hero-session" class="mozbot-metric-val">${sessionLabel}</div>
          </div>
          <div class="mozbot-metric-box">
            <div class="mozbot-metric-label">Word Count</div>
            <div id="mozbot-hero-words" class="mozbot-metric-val">${words}</div>
          </div>
        </div>

        <div id="mozbot-hero-next" style="font-size:11px; color:#94a3b8; margin-top:4px; border-top:1px dashed rgba(255,255,255,0.08); padding-top:8px; padding-bottom:2px; line-height:1.4; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
          ${nextPreview}
        </div>
      </div>

      <!-- Scope Selector -->
      <div style="display:flex; flex-direction:column; gap:9px;">
        <div class="mozbot-segmented">
          <button id="mozbot-mode-range-btn" class="mozbot-seg-btn ${State.mode === 'range' ? 'active' : ''}">📖 Range Mode</button>
          <button id="mozbot-mode-single-btn" class="mozbot-seg-btn ${State.mode === 'single' ? 'active' : ''}">🎯 Single Ch Mode</button>
        </div>

        ${
          State.mode === 'range'
            ? `
          <div style="display:flex; gap:12px; align-items:center;">
            <div style="flex:1;">
              <label class="mozbot-label">From Ch #</label>
              <input id="mozbot-from-ch" type="number" min="1" placeholder="1" value="${State.fromChapter || ''}" class="mozbot-input" />
            </div>
            <div style="flex:1;">
              <label class="mozbot-label">Up to Ch #</label>
              <input id="mozbot-to-ch" type="number" min="1" placeholder="${total || 'End'}" value="${State.toChapter || ''}" class="mozbot-input" />
            </div>
          </div>
        `
            : `
          <div>
            <label class="mozbot-label">Convert Single Chapter Index #</label>
            <input id="mozbot-single-ch" type="number" min="1" placeholder="e.g. 50" value="${State.singleChapterIndex || ''}" class="mozbot-input" />
          </div>
        `
        }
      </div>

      <!-- Action Primary CTA Button -->
      <div style="margin-top:6px;">
        ${
          !State.running
            ? `<button id="mozbot-start-btn" class="mozbot-cta-start">▶ Start Auto-Retell</button>`
            : `<button id="mozbot-stop-btn" class="mozbot-cta-stop">⏸ Pause Automation</button>`
        }
      </div>
    `;
  }

  function renderChaptersTab() {
    const query = (State.chapterSearchQuery || '').toLowerCase().trim();
    const filtered = State.chapterList.filter((ch) => {
      if (!query) return true;
      return (
        String(ch.chapterIndex).includes(query) ||
        (ch.title || '').toLowerCase().includes(query)
      );
    });

    const scriptedCount = State.chapterList.filter((c) => c.hasCustomScript || c.hasAiScript).length;
    const audioCount = State.chapterList.filter((c) => c.hasAudio).length;

    return `
      <div>
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <label class="mozbot-label" style="margin-bottom:0;">Search Chapters</label>
          <span style="font-size:11px; color:#94a3b8; font-weight:600;">${scriptedCount} scripted · ${audioCount} audio</span>
        </div>
        <input id="mozbot-ch-search" type="text" placeholder="Search by title or chapter #..." value="${State.chapterSearchQuery || ''}" class="mozbot-input" />
      </div>

      <div id="mozbot-chapter-list-container" class="mozbot-scroll" style="max-height:350px; overflow-y:auto; display:flex; flex-direction:column; gap:6px; padding-right:4px;">
        ${
          filtered.length === 0
            ? '<div style="font-size:11.5px; color:#8b949e; text-align:center; padding:28px;">No chapters found matching search.</div>'
            : filtered
                .map((ch) => {
                  const isCurrent = State.currentChapter && State.currentChapter.chapterIndex === ch.chapterIndex && State.running;
                  return renderChapterRow(ch, isCurrent);
                })
                .join('')
        }
      </div>
    `;
  }

  function renderSettingsTab() {
    return `
      <!-- Anti-Spam Cooldown Settings -->
      <div class="mozbot-card-section">
        <label class="mozbot-label">☕ Anti-Spam Auto-Pause (Rate Limit Shield)</label>
        <div style="display:flex; align-items:center; gap:9px; margin-bottom:6px; flex-wrap:wrap;">
          <span style="font-size:11.5px; color:#94a3b8;">Pause every</span>
          <input id="mozbot-cooldown-ch-input" type="number" min="0" max="200" value="${State.cooldownEveryChapters}" class="mozbot-input mozbot-input-compact" />
          <span style="font-size:11.5px; color:#94a3b8;">chs for</span>
          <input id="mozbot-cooldown-min-input" type="number" min="1" max="180" value="${State.cooldownDurationMinutes}" class="mozbot-input mozbot-input-compact" />
          <span style="font-size:11.5px; color:#94a3b8;">mins</span>
        </div>
        <div style="font-size:10.5px; color:#64748b; line-height:1.45;">Protects your ChatGPT account from rate limits during unattended runs (0 disables).</div>
      </div>

      <!-- New Chat Strategy -->
      <div class="mozbot-card-section">
        <label class="mozbot-label">🔄 New Chat Session Rotation</label>
        <select id="mozbot-newchat-strategy" class="mozbot-select" style="margin-bottom:6px;">
          <option value="every_5" ${State.newChatStrategy === 'every_5' ? 'selected' : ''}>New chat after every 5 chapters (Default)</option>
          <option value="every_chapter" ${State.newChatStrategy === 'every_chapter' ? 'selected' : ''}>New chat after every chapter</option>
          <option value="every_n" ${State.newChatStrategy === 'every_n' ? 'selected' : ''}>New chat after every N chapters</option>
          <option value="off" ${State.newChatStrategy === 'off' ? 'selected' : ''}>Keep single chat session (Off)</option>
        </select>
        ${
          State.newChatStrategy === 'every_n'
            ? `
          <div style="display:flex; align-items:center; gap:9px; margin-top:6px;">
            <span style="font-size:11.5px; color:#94a3b8;">Rotate every:</span>
            <input id="mozbot-newchat-n-input" type="number" min="1" max="100" value="${State.newChatEveryN || 5}" class="mozbot-input mozbot-input-compact" />
            <span style="font-size:11.5px; color:#94a3b8;">chapters</span>
          </div>
        `
            : ''
        }
      </div>

      <!-- Pacing and Audio Options -->
      <div class="mozbot-card-section">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
          <label class="mozbot-label" style="margin-bottom:0;">Delay Between Chapters</label>
          <div style="display:flex; align-items:center; gap:8px;">
            <input id="mozbot-delay-input" type="number" min="1" max="60" value="${State.delaySeconds}" class="mozbot-input mozbot-input-compact" />
            <span style="font-size:11px; color:#94a3b8; font-weight:600;">sec</span>
          </div>
        </div>

        <div style="margin-top:6px;">
          <label class="mozbot-label">If Audio Already Exists</label>
          <select id="mozbot-audio-exist-act" class="mozbot-select">
            <option value="ask" ${State.existingAudioAction === 'ask' ? 'selected' : ''}>Prompt / Ask me each time</option>
            <option value="regenerate" ${State.existingAudioAction === 'regenerate' ? 'selected' : ''}>Regenerate Audio & Script</option>
            <option value="skip" ${State.existingAudioAction === 'skip' ? 'selected' : ''}>Skip Chapter</option>
          </select>
        </div>

        <label style="display:flex; align-items:center; gap:10px; cursor:pointer; margin-top:6px; user-select:none;">
          <input type="checkbox" id="mozbot-opt-audio" ${State.autoAudio ? 'checked' : ''} style="cursor:pointer; accent-color:#3b82f6; width:16px; height:16px; flex-shrink:0;" />
          <span style="font-size:12px; color:#e2e8f0; line-height:1.35;">Generate audio immediately upon script save</span>
        </label>
      </div>

      <!-- Custom Prompt -->
      <details class="mozbot-card-section" style="cursor:pointer;">
        <summary style="font-weight:600; font-size:12px; color:#e2e8f0; outline:none; padding:6px 2px; line-height:1.4;">⚙️ Custom Storytelling Prompt</summary>
        <div style="margin-top:10px;">
          <textarea id="mozbot-prompt-input" class="mozbot-textarea" style="min-height:85px; font-family:ui-monospace, monospace; resize:vertical; font-size:11.5px; line-height:1.5; padding:11px 13px;" placeholder="Leave empty for default novel storytelling prompt...">${State.customPrompt || ''}</textarea>
          <div style="display:flex; justify-content:flex-end; margin-top:8px;">
            <button id="mozbot-reset-prompt-btn" style="background:none; border:none; color:#60a5fa; font-size:11px; cursor:pointer; font-weight:600; padding:4px 8px;">Reset to default</button>
          </div>
        </div>
      </details>

      <!-- App Connection URL -->
      <div class="mozbot-card-section">
        <label class="mozbot-label">🔗 Server Connection URL</label>
        <div style="display:flex; gap:10px;">
          <input id="mozbot-server-url" type="text" value="${State.serverUrl}" class="mozbot-input" style="flex:1;" />
          <button id="mozbot-save-url-btn" style="background:linear-gradient(180deg, #22c55e 0%, #16a34a 100%); border:1px solid rgba(255,255,255,0.2); color:#fff; padding:8px 16px; border-radius:8px; font-size:11.5px; font-weight:700; cursor:pointer; white-space:nowrap; box-shadow:0 2px 6px rgba(22,163,74,0.3);">Test & Save</button>
        </div>
      </div>
    `;
  }

  function renderLogsTab() {
    return `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
        <label class="mozbot-label" style="margin-bottom:0;">Live Event Logs</label>
        <div style="display:flex; gap:8px;">
          <button id="mozbot-copy-logs-btn" class="mozbot-btn-secondary" title="Copy all logs">📋 Copy</button>
          <button id="mozbot-clear-logs-btn" class="mozbot-btn-secondary" title="Clear logs">🗑️ Clear</button>
        </div>
      </div>

      <div id="mozbot-live-log-content" class="mozbot-scroll" style="font-family:ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size:11px; color:#94a3b8; background:rgba(0, 0, 0, 0.45); border:1px solid rgba(255, 255, 255, 0.08); border-radius:10px; padding:14px 16px; max-height:360px; overflow-y:auto; line-height:1.55; user-select:text;">
        ${
          State.logMessages.length === 0
            ? '<span style="color:#64748b;">No log events recorded yet.</span>'
            : State.logMessages.map((m) => `<div style="padding:2px 0; margin-bottom:4px; word-break:break-word;">${m}</div>`).join('')
        }
      </div>
    `;
  }

  function updateUi() {
    try {
      if (!hudContainer) return;

      // 1. Minimized Mode (Pill FAB)
      if (isMinimized) {
        currentRenderedTab = 'minimized';
        const badge = getStageBadgeInfo();
        const shortText = State.inCooldown
          ? `☕ Break (${Math.max(1, Math.round((State.cooldownEndsAt - Date.now()) / 60000))}m)`
          : State.running
          ? `🟢 Ch ${State.currentChapter ? State.currentChapter.chapterIndex : '...'}`
          : '⚡ Mozbot Bridge';

        hudContainer.innerHTML = `
          <div class="mozbot-pill" id="mozbot-restore-btn" title="Click to open Mozbot Studio">
            <div class="${badge.dot}"></div>
            <span class="mozbot-pill-text">${shortText}</span>
            <span style="font-size:10px; color:#8b949e; margin-left:2px;">⤢</span>
          </div>
        `;

        document.getElementById('mozbot-restore-btn')?.addEventListener('click', () => {
          isMinimized = false;
          _setValue('mozbot_minimized', false);
          updateUi();
        });
        return;
      }

      // 2. In-Place Smart Update (If panel is already mounted and on same tab, update dynamic values directly)
      const currentBook = State.books.find((b) => b.id === State.selectedBookId);
      const scripted = currentBook ? currentBook.scriptedChapters : 0;
      const total = currentBook ? currentBook.totalChapters : 0;
      const percent = total > 0 ? Math.round((scripted / total) * 100) : 0;

      const panel = document.getElementById('mozbot-hud-panel');
      if (panel && currentRenderedTab === State.activeTab) {
        // Update Panel classes
        panel.className = `mozbot-panel ${State.inCooldown ? 'cooldown' : State.running ? 'running' : ''}`;

        // Studio In-Place updates
        if (State.activeTab === 'studio') {
          const badge = getStageBadgeInfo();
          const badgeEl = document.getElementById('mozbot-hero-stage');
          const dotEl = document.getElementById('mozbot-hero-dot');
          const badgeTextEl = document.getElementById('mozbot-hero-badge-text');
          if (badgeEl && dotEl && badgeTextEl) {
            badgeEl.className = `mozbot-hero-badge ${badge.cls}`;
            dotEl.className = badge.dot;
            badgeTextEl.innerText = badge.text;
          }

          const titleEl = document.getElementById('mozbot-hero-title');
          if (titleEl) {
            const chIndexBadge = State.currentChapter && State.currentChapter.chapterIndex
              ? `<span class="mozbot-ch-chip">CH ${State.currentChapter.chapterIndex}</span>`
              : '';
            const chTitleText = State.currentChapter ? (State.currentChapter.chapterTitle || 'Untitled') : State.requestingChapterNum ? `Fetching Chapter ${State.requestingChapterNum}...` : 'Ready to start';
            titleEl.innerHTML = `${chIndexBadge} <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${chTitleText}</span>`;
            titleEl.title = State.currentChapter ? `Ch ${State.currentChapter.chapterIndex}: ${State.currentChapter.chapterTitle || 'Untitled'}` : chTitleText;
          }

          const charsEl = document.getElementById('mozbot-hero-chars');
          if (charsEl) {
            charsEl.innerText = State.currentOutputChars > 0 ? `${State.currentOutputChars.toLocaleString()} chars` : '0 chars';
          }

          const sessionEl = document.getElementById('mozbot-hero-session');
          if (sessionEl) {
            sessionEl.innerText = `Ch ${State.chaptersInCurrentChat} of ${State.newChatStrategy === 'every_n' ? State.newChatEveryN : 5}`;
          }

          const nextEl = document.getElementById('mozbot-hero-next');
          if (nextEl) {
            nextEl.innerText = State.nextChapterInfo && State.nextChapterInfo.index ? `Next ➔ Ch ${State.nextChapterInfo.index}: ${State.nextChapterInfo.title || 'Untitled'}` : State.running ? 'End of scope' : 'Auto-detected';
          }

          const progFill = document.getElementById('mozbot-live-progress-fill');
          const progLabel = document.getElementById('mozbot-live-progress-label');
          if (progFill && progLabel) {
            progFill.style.width = `${percent}%`;
            progLabel.innerHTML = `<strong>${scripted}</strong> / ${total} chapters (${percent}%)`;
          }

          // Live Activity Status Bar update
          const statusBar = document.getElementById('mozbot-live-status-bar');
          const statusTextEl = document.getElementById('mozbot-live-status-text');
          if (statusBar && statusTextEl) {
            statusBar.className = `mozbot-status-bar ${State.running ? 'running' : State.inCooldown ? 'warning' : ''}`;
            statusTextEl.innerText = State.statusText;
          }

          // Live Connection indicator update
          const connBadge = document.getElementById('mozbot-connection-badge');
          const connDot = document.getElementById('mozbot-connection-dot');
          const connStatus = document.getElementById('mozbot-connection-status');
          if (connBadge && connDot && connStatus) {
            connBadge.style.color = State.serverConnected ? '#4ade80' : '#facc15';
            connDot.innerText = State.serverConnected ? '🟢' : '⚠️';
            connStatus.innerText = State.serverConnected ? 'Connected' : 'Offline';
          }

          const cooldownTimer = document.getElementById('mozbot-live-cooldown-timer');
          if (cooldownTimer && State.inCooldown) {
            cooldownTimer.innerText = State.statusText.replace('☕ Anti-spam break ', '');
          }

          const heroRightEl = document.getElementById('mozbot-hero-top-right');
          if (heroRightEl) {
            if (State.running && (State.currentStage === 'generating' || State.currentOutputChars > 50)) {
              if (!document.getElementById('mozbot-force-done-btn')) {
                heroRightEl.innerHTML = `<button id="mozbot-force-done-btn" class="mozbot-force-btn" title="If ChatGPT response has finished, click to proceed immediately to save">⚡ Save Now</button>`;
                document.getElementById('mozbot-force-done-btn')?.addEventListener('click', () => {
                  log('⚡ Force save triggered by user.');
                  State.forceComplete = true;
                });
              }
            } else if (heroRightEl.innerHTML.includes('mozbot-force-done-btn')) {
              heroRightEl.innerHTML = '<span style="font-size:9.5px; color:#8b949e; font-weight:700; letter-spacing:0.5px;">COCKPIT</span>';
            }
          }
        } else if (State.activeTab === 'chapters') {
          const container = document.getElementById('mozbot-chapter-list-container');
          if (container) {
            const query = (State.chapterSearchQuery || '').toLowerCase().trim();
            const filtered = State.chapterList.filter((ch) => {
              if (!query) return true;
              return (
                String(ch.chapterIndex).includes(query) ||
                (ch.title || '').toLowerCase().includes(query)
              );
            });
            if (filtered.length === 0) {
              container.innerHTML = '<div style="font-size:11.5px; color:#8b949e; text-align:center; padding:28px;">No chapters found matching search.</div>';
            } else {
              container.innerHTML = filtered
                .map((ch) => {
                  const isCurrent = State.currentChapter && State.currentChapter.chapterIndex === ch.chapterIndex && State.running;
                  return renderChapterRow(ch, isCurrent);
                })
                .join('');
              container.querySelectorAll('.mozbot-ch-row').forEach((row) => {
                row.addEventListener('click', () => {
                  const idx = row.getAttribute('data-index');
                  State.mode = 'single';
                  State.singleChapterIndex = idx;
                  _setValue('mozbot_mode', 'single');
                  _setValue('mozbot_single_ch', idx);
                  State.activeTab = 'studio';
                  _setValue('mozbot_active_tab', 'studio');
                  log(`🎯 Targeted Chapter ${idx} from Chapter Queue.`);
                  updateUi();
                });
              });
            }
          }
        } else if (State.activeTab === 'logs') {
          const logEl = document.getElementById('mozbot-live-log-content');
          if (logEl) {
            logEl.innerHTML = State.logMessages.length === 0
              ? '<span style="color:#64748b;">No log events recorded yet.</span>'
              : State.logMessages.map((m) => `<div style="padding:2px 0; margin-bottom:4px; word-break:break-word;">${m}</div>`).join('');
          }
        }
        return;
      }

      // 3. Full Structural Render (Initial mount or tab switch)
      currentRenderedTab = State.activeTab;

      let bodyHtml = '';
      if (State.activeTab === 'studio') {
        bodyHtml = renderStudioTab(currentBook, scripted, total, percent);
      } else if (State.activeTab === 'chapters') {
        bodyHtml = renderChaptersTab();
      } else if (State.activeTab === 'settings') {
        bodyHtml = renderSettingsTab();
      } else if (State.activeTab === 'logs') {
        bodyHtml = renderLogsTab();
      }

      hudContainer.innerHTML = `
        <div id="mozbot-hud-panel" class="mozbot-panel ${State.inCooldown ? 'cooldown' : State.running ? 'running' : ''}">
          <!-- Drag Header -->
          <div id="mozbot-hud-header" class="mozbot-header" style="padding: 14px 20px;" title="Click and drag to move · Double-click to reset">
            <div class="mozbot-header-left">
              <span class="mozbot-drag-handle">⋮⋮</span>
              <span class="mozbot-header-title">⚡ Mozbot Studio</span>
              <span class="mozbot-version-tag">v2.8.0</span>
            </div>
            <div class="mozbot-header-actions">
              <button id="mozbot-header-refresh" class="mozbot-icon-btn" title="Refresh server data">↻</button>
              <button id="mozbot-header-reset-pos" class="mozbot-icon-btn" title="Reset position to bottom-right corner">⤢</button>
              <button id="mozbot-header-min" class="mozbot-icon-btn" title="Minimize to pill">─</button>
            </div>
          </div>

          <!-- Tabs Bar -->
          <div class="mozbot-tabs-bar" style="margin: 14px 20px 2px; padding: 5px;">
            <button id="mozbot-tab-studio" class="mozbot-tab-btn ${State.activeTab === 'studio' ? 'active' : ''}">⚡ Studio</button>
            <button id="mozbot-tab-chapters" class="mozbot-tab-btn ${State.activeTab === 'chapters' ? 'active' : ''}">📊 Chapters</button>
            <button id="mozbot-tab-settings" class="mozbot-tab-btn ${State.activeTab === 'settings' ? 'active' : ''}">⚙️ Settings</button>
            <button id="mozbot-tab-logs" class="mozbot-tab-btn ${State.activeTab === 'logs' ? 'active' : ''}">📜 Logs</button>
          </div>

          <!-- Body Content -->
          <div id="mozbot-tab-content" class="mozbot-body" style="padding: 16px 20px 20px;">
            ${bodyHtml}
          </div>
        </div>
      `;

      // Wire Header and Dragging
      const headerEl = document.getElementById('mozbot-hud-header');
      makeDraggable(hudContainer, headerEl);

      document.getElementById('mozbot-header-min')?.addEventListener('click', () => {
        isMinimized = true;
        _setValue('mozbot_minimized', true);
        updateUi();
      });

      document.getElementById('mozbot-header-reset-pos')?.addEventListener('click', resetHudPosition);
      document.getElementById('mozbot-header-refresh')?.addEventListener('click', refreshServerStatus);

      // Wire Tab Switches
      document.getElementById('mozbot-tab-studio')?.addEventListener('click', () => {
        State.activeTab = 'studio';
        _setValue('mozbot_active_tab', 'studio');
        updateUi();
      });
      document.getElementById('mozbot-tab-chapters')?.addEventListener('click', () => {
        State.activeTab = 'chapters';
        _setValue('mozbot_active_tab', 'chapters');
        updateUi();
      });
      document.getElementById('mozbot-tab-settings')?.addEventListener('click', () => {
        State.activeTab = 'settings';
        _setValue('mozbot_active_tab', 'settings');
        updateUi();
      });
      document.getElementById('mozbot-tab-logs')?.addEventListener('click', () => {
        State.activeTab = 'logs';
        _setValue('mozbot_active_tab', 'logs');
        updateUi();
      });

      // Wire Studio Tab Controls
      if (State.activeTab === 'studio') {
        document.getElementById('mozbot-book-select')?.addEventListener('change', (e) => {
          State.selectedBookId = e.target.value;
          _setValue('mozbot_book_id', State.selectedBookId);
          refreshServerStatus();
        });

        document.getElementById('mozbot-mode-range-btn')?.addEventListener('click', () => {
          State.mode = 'range';
          _setValue('mozbot_mode', 'range');
          updateUi();
        });

        document.getElementById('mozbot-mode-single-btn')?.addEventListener('click', () => {
          State.mode = 'single';
          _setValue('mozbot_mode', 'single');
          updateUi();
        });

        document.getElementById('mozbot-from-ch')?.addEventListener('input', (e) => {
          State.fromChapter = e.target.value.trim();
          _setValue('mozbot_from_chapter', State.fromChapter);
        });

        document.getElementById('mozbot-to-ch')?.addEventListener('input', (e) => {
          State.toChapter = e.target.value.trim();
          _setValue('mozbot_to_chapter', State.toChapter);
        });

        document.getElementById('mozbot-single-ch')?.addEventListener('input', (e) => {
          State.singleChapterIndex = e.target.value.trim();
          _setValue('mozbot_single_ch', State.singleChapterIndex);
        });

        document.getElementById('mozbot-skip-cooldown-btn')?.addEventListener('click', () => {
          log('⚡ User skipped cooldown break. Resuming immediately...');
          State.inCooldown = false;
          State.cooldownEndsAt = 0;
          _setValue('mozbot_cooldown_ends_at', 0);
          updateUi();
        });

        document.getElementById('mozbot-force-done-btn')?.addEventListener('click', () => {
          log('⚡ Force save triggered by user.');
          State.forceComplete = true;
        });

        document.getElementById('mozbot-start-btn')?.addEventListener('click', startAutomation);
        document.getElementById('mozbot-stop-btn')?.addEventListener('click', stopAutomation);
      }

      // Wire Chapters Tab Controls
      if (State.activeTab === 'chapters') {
        const searchInput = document.getElementById('mozbot-ch-search');
        searchInput?.addEventListener('input', (e) => {
          State.chapterSearchQuery = e.target.value;
          const container = document.getElementById('mozbot-chapter-list-container');
          if (container) {
            const query = (State.chapterSearchQuery || '').toLowerCase().trim();
            const filtered = State.chapterList.filter((ch) => {
              if (!query) return true;
              return String(ch.chapterIndex).includes(query) || (ch.title || '').toLowerCase().includes(query);
            });
            container.innerHTML = filtered.length === 0
              ? '<div style="font-size:11.5px; color:#8b949e; text-align:center; padding:28px;">No chapters found matching search.</div>'
              : filtered.map((ch) => {
                  const isCurrent = State.currentChapter && State.currentChapter.chapterIndex === ch.chapterIndex && State.running;
                  return renderChapterRow(ch, isCurrent);
                }).join('');

            container.querySelectorAll('.mozbot-ch-row').forEach((row) => {
              row.addEventListener('click', () => {
                const idx = row.getAttribute('data-index');
                State.mode = 'single';
                State.singleChapterIndex = idx;
                _setValue('mozbot_mode', 'single');
                _setValue('mozbot_single_ch', idx);
                State.activeTab = 'studio';
                _setValue('mozbot_active_tab', 'studio');
                log(`🎯 Targeted Chapter ${idx} from Chapter Queue.`);
                updateUi();
              });
            });
          }
        });

        document.querySelectorAll('.mozbot-ch-row').forEach((row) => {
          row.addEventListener('click', () => {
            const idx = row.getAttribute('data-index');
            State.mode = 'single';
            State.singleChapterIndex = idx;
            _setValue('mozbot_mode', 'single');
            _setValue('mozbot_single_ch', idx);
            State.activeTab = 'studio';
            _setValue('mozbot_active_tab', 'studio');
            log(`🎯 Targeted Chapter ${idx} from Chapter Queue.`);
            updateUi();
          });
        });
      }

      // Wire Settings Tab Controls
      if (State.activeTab === 'settings') {
        document.getElementById('mozbot-cooldown-ch-input')?.addEventListener('input', (e) => {
          const val = parseInt(e.target.value.trim(), 10);
          State.cooldownEveryChapters = isNaN(val) ? 20 : val;
          _setValue('mozbot_cooldown_chapters', State.cooldownEveryChapters);
        });

        document.getElementById('mozbot-cooldown-min-input')?.addEventListener('input', (e) => {
          const val = parseInt(e.target.value.trim(), 10);
          State.cooldownDurationMinutes = isNaN(val) ? 30 : val;
          _setValue('mozbot_cooldown_minutes', State.cooldownDurationMinutes);
        });

        document.getElementById('mozbot-newchat-strategy')?.addEventListener('change', (e) => {
          State.newChatStrategy = e.target.value;
          _setValue('mozbot_new_chat_strategy', State.newChatStrategy);
          updateUi();
        });

        document.getElementById('mozbot-newchat-n-input')?.addEventListener('input', (e) => {
          const val = parseInt(e.target.value.trim(), 10) || 5;
          State.newChatEveryN = val;
          _setValue('mozbot_new_chat_every_n', val);
        });

        document.getElementById('mozbot-delay-input')?.addEventListener('input', (e) => {
          const val = parseInt(e.target.value.trim(), 10) || 5;
          State.delaySeconds = val;
          _setValue('mozbot_delay_seconds', val);
        });

        document.getElementById('mozbot-audio-exist-act')?.addEventListener('change', (e) => {
          State.existingAudioAction = e.target.value;
          _setValue('mozbot_existing_audio_action', State.existingAudioAction);
        });

        document.getElementById('mozbot-opt-audio')?.addEventListener('change', (e) => {
          State.autoAudio = e.target.checked;
          _setValue('mozbot_auto_audio', State.autoAudio);
        });

        document.getElementById('mozbot-prompt-input')?.addEventListener('input', (e) => {
          State.customPrompt = e.target.value;
          _setValue('mozbot_custom_prompt', State.customPrompt);
        });

        document.getElementById('mozbot-reset-prompt-btn')?.addEventListener('click', () => {
          State.customPrompt = '';
          _setValue('mozbot_custom_prompt', '');
          const promptInput = document.getElementById('mozbot-prompt-input');
          if (promptInput) promptInput.value = '';
          log('Custom prompt reset to default.');
        });

        document.getElementById('mozbot-save-url-btn')?.addEventListener('click', () => {
          const input = document.getElementById('mozbot-server-url');
          if (input && input.value.trim()) {
            State.serverUrl = input.value.trim().replace(/\/+$/, '');
            _setValue('mozbot_server_url', State.serverUrl);
            refreshServerStatus();
          }
        });
      }

      // Wire Logs Tab Controls
      if (State.activeTab === 'logs') {
        document.getElementById('mozbot-clear-logs-btn')?.addEventListener('click', () => {
          State.logMessages = [];
          updateUi();
        });

        document.getElementById('mozbot-copy-logs-btn')?.addEventListener('click', () => {
          const text = State.logMessages.join('\n');
          navigator.clipboard.writeText(text).then(() => {
            log('📋 Logs copied to clipboard!');
          }).catch(() => {
            log('⚠️ Failed to copy logs.');
          });
        });
      }
    } catch (err) {
      console.error('[Mozbot UI Error in updateUi]', err);
    }
  }

  // -------------------------------------------------------------------------
  // Resilient Initialization & Mount
  // -------------------------------------------------------------------------

  function init() {
    if (!document.body) {
      setTimeout(init, 200);
      return;
    }

    startBackgroundWorker();
    createUi();
    refreshServerStatus();

    // Heartbeat: Ensure widget remains mounted if ChatGPT re-renders document.body
    setInterval(() => {
      if (!document.getElementById('mozbot-bridge-hud')) {
        createUi();
      }
    }, 1000);

    // Adaptive Polling: 4s when running, 15s when idle
    let pollInterval = setInterval(refreshServerStatus, State.running ? 4000 : 15000);
    window.addEventListener('mozbot_state_change', () => {
      clearInterval(pollInterval);
      pollInterval = setInterval(refreshServerStatus, State.running ? 4000 : 15000);
    });

    // Auto-resume cooldown or batch conversion
    const wasRunning = Boolean(_getValue('mozbot_running', false));
    const savedCooldownEnds = parseInt(_getValue('mozbot_cooldown_ends_at', 0), 10);

    if (wasRunning && savedCooldownEnds > Date.now()) {
      const remainingSec = Math.round((savedCooldownEnds - Date.now()) / 1000);
      log(`☕ Resuming remaining ${Math.round(remainingSec / 60)}-minute anti-spam cooldown...`);
      State.running = true;
      (async () => {
        await runCooldown(remainingSec);
        if (State.running) {
          await runAutomationLoop();
        }
      })().catch((err) => {
        log(`❌ Error during cooldown resume: ${err.message}`);
      });
      return;
    }

    if (wasRunning && !State.running) {
      log('⚡ Resuming batch conversion in fresh chat session...');
      State.running = true;
      (async () => {
        State.statusText = 'Waiting for ChatGPT interface to hydrate...';
        updateUi();
        await waitForChatInput(30000);
        await sleep(1500);
        await runAutomationLoop();
      })().catch((err) => {
        log(`❌ Error after resume: ${err.message}`);
        State.running = false;
        _setValue('mozbot_running', false);
        State.statusText = `Stopped: ${err.message}`;
        window.dispatchEvent(new CustomEvent('mozbot_state_change'));
        updateUi();
      });
    }

    console.log('%c⚡ Mozbot Audiobook Bridge v2.8.0 loaded successfully! Controller mounted at bottom-right.', 'background: #238636; color: white; padding: 4px 8px; border-radius: 4px; font-weight: bold;');
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(init, 200);
  } else {
    window.addEventListener('DOMContentLoaded', () => setTimeout(init, 200));
    window.addEventListener('load', () => setTimeout(init, 200));
  }
})();

