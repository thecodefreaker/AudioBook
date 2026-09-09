/**
 * Cancellation identity — the single place that decides "was this a user
 * cancellation, or a real failure?"
 *
 * WHY THIS EXISTS
 * ---------------
 * Cancellation crosses four module boundaries and each one invented its own
 * vocabulary:
 *
 *   pipeline.js      throws `CancelledError`            (name)
 *   translator.js    throws Error + `code:'CANCELLED'`  (code)
 *   groq-sdk         throws `APIUserAbortError`         (constructor)
 *   node execFile    throws `AbortError` / `ABORT_ERR`  (name/code)
 *
 * Every call site that tested for only ONE of these recorded the others as
 * genuine failures — a cancelled chapter was written to the DB as
 * `status:'error'` and shown to the user as a red "failed" row, which is
 * indistinguishable from a real breakage. Route every cancellation check
 * through here so a new throw site can only ever be wrong in one place.
 */
export function isCancellation(err) {
  if (!err) return false;
  return err.name === 'CancelledError'
    || err.name === 'AbortError'
    || err.code === 'CANCELLED'
    || err.code === 'ABORT_ERR'
    || err.constructor?.name === 'APIUserAbortError';
}
