// Shared between client and server so both sides agree on the same cutoffs.

/** How long past an event's endsAt a guest can still finish uploading
 * photos they already captured before the cutoff. Doesn't extend how long
 * they can keep taking NEW photos — just gives already-staged ones a
 * window to finish going up instead of being silently stranded. */
export const UPLOAD_GRACE_PERIOD_MS = 60_000;

/** How many photos upload at once. 2 is a reasonable balance — meaningfully
 * cuts total wait for a guest with several shots queued, without hammering
 * a possibly-weak mobile connection with too much at once. */
export const UPLOAD_CONCURRENCY = 2;

/** Per-attempt timeout for the direct-to-Cloudinary upload. Without this, a
 * stalled request on a bad connection can hang far longer than it's worth
 * waiting before just retrying. */
export const CLOUDINARY_UPLOAD_TIMEOUT_MS = 25_000;
