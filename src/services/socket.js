/**
 * Socket.IO client wrapper for real-time updates.
 */
import { io } from 'socket.io-client';

class SocketService {
  constructor() {
    this.socket = null;
    this.listeners = new Map();
    this.keyed = new Map();
    /**
     * The book room we should be in. Held as STATE, not as a one-shot action.
     *
     * `subscribe()` used to emit only when the socket happened to be connected
     * and then forget the request. Two things made that fatal:
     *
     *   1. `connect()` is asynchronous. `loadBook()` runs on page load and
     *      called `subscribe()` while the handshake was still in flight, so the
     *      emit was skipped and never retried. The client never joined
     *      `book:<id>`.
     *   2. On reconnect, Socket.IO issues a NEW socket id and the server's
     *      rooms are gone, but nothing re-joined them.
     *
     * Either way `chapter:progress` / `chapter:complete` are emitted to a room
     * the client is not in, so conversions sat on "Starting..." forever and
     * Cancel looked broken (the backend cancelled correctly; the row simply
     * never heard about it). Recording the desired room and re-joining on every
     * `connect` makes membership self-healing.
     */
    this.currentBookId = null;
  }

  connect() {
    if (this.socket?.connected) return;

    this.socket = io(window.location.origin, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });

    this.socket.on('connect', () => {
      console.log('🔌 Socket connected:', this.socket.id);
      // Re-assert room membership for both the first connection and every
      // reconnection, since server-side rooms do not survive either.
      if (this.currentBookId) {
        this.socket.emit('subscribe', { bookId: this.currentBookId });
      }
    });

    this.socket.on('disconnect', (reason) => {
      console.log('🔌 Socket disconnected:', reason);
    });

    this.socket.on('connect_error', (error) => {
      console.warn('🔌 Socket connection error:', error.message);
    });

    // Re-register all existing listeners
    for (const [event, callbacks] of this.listeners) {
      for (const cb of callbacks) {
        this.socket.on(event, cb);
      }
    }
  }

  subscribe(bookId) {
    if (!bookId) return;
    this.currentBookId = bookId;
    // If the handshake has not finished, the `connect` handler will replay
    // this. Emitting only when already connected is what silently dropped the
    // subscription on page load.
    if (this.socket?.connected) {
      this.socket.emit('subscribe', { bookId });
    } else if (!this.socket) {
      this.connect();
    }
  }

  unsubscribe(bookId) {
    if (this.currentBookId === bookId) this.currentBookId = null;
    if (this.socket?.connected) {
      this.socket.emit('unsubscribe', { bookId });
    }
  }

  /**
   * Register a listener.
   *
   * Registering the SAME function twice used to stack duplicate handlers,
   * because this pushed blindly into the array. Any caller that re-ran (the
   * per-job progress wiring did, on every conversion) therefore fired its
   * handler N times after N conversions — three success toasts for one job,
   * and every log line repeated. Registration is now idempotent.
   */
  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    const callbacks = this.listeners.get(event);
    if (callbacks.includes(callback)) return; // already registered
    callbacks.push(callback);

    if (this.socket) {
      this.socket.on(event, callback);
    }
  }

  /**
   * Register a listener under a stable key, replacing any previous listener
   * for that key.
   *
   * This is what per-job wiring needs: the handler closes over job-specific
   * data, so it is a *different* function object each time and `on()` cannot
   * dedupe it. Keying by name makes "there is exactly one progress handler"
   * an invariant rather than something each caller has to remember.
   */
  onKeyed(key, event, callback) {
    if (!this.keyed) this.keyed = new Map();
    const mapKey = `${key}:${event}`;
    const previous = this.keyed.get(mapKey);
    if (previous) this.off(event, previous);
    this.keyed.set(mapKey, callback);
    this.on(event, callback);
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      const callbacks = this.listeners.get(event);
      const index = callbacks.indexOf(callback);
      if (index > -1) callbacks.splice(index, 1);
    }

    if (this.socket) {
      this.socket.off(event, callback);
    }
  }

  /**
   * Is the browser currently talking to the server?
   *
   * Callers need this to decide whether to trust pushed updates or fall back to
   * polling — and the header uses it to tell the user, because a dropped socket
   * previously looked identical to a hung backend.
   */
  isConnected() {
    return !!this.socket?.connected;
  }

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
  }
}

export const socketService = new SocketService();
