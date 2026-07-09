/**
 * Lightweight protection for public endpoints.
 *
 * Rate limiting is in-memory (per serverless instance). On Vercel this is
 * burst protection, not a bulletproof global limit — a determined abuser can
 * still spread requests across instances. It stops the common cases (someone
 * spamming the button, a naive script loop) at zero infrastructure cost.
 * If usage grows, swap `checkRateLimit` for an Upstash Redis-backed limiter —
 * the call sites won't need to change.
 *
 * The access code gate is optional: set RA_ACCESS_CODE in Vercel env vars to
 * require it; leave unset to keep the app fully open.
 */

type Bucket = number[]; // request timestamps (ms)

const buckets = new Map<string, Bucket>();
const MAX_TRACKED_IPS = 5000;

export function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return fwd.split(",")[0].trim();
  return req.headers.get("x-real-ip") || "unknown";
}

export function checkRateLimit(
  req: Request,
  opts: { key: string; limit: number; windowMs: number }
): { ok: true } | { ok: false; retryAfterSeconds: number } {
  const ip = getClientIp(req);
  const bucketKey = `${opts.key}:${ip}`;
  const now = Date.now();

  // Basic memory hygiene
  if (buckets.size > MAX_TRACKED_IPS) buckets.clear();

  const bucket = (buckets.get(bucketKey) || []).filter(
    (t) => now - t < opts.windowMs
  );

  if (bucket.length >= opts.limit) {
    const oldest = bucket[0];
    const retryAfterSeconds = Math.ceil((oldest + opts.windowMs - now) / 1000);
    buckets.set(bucketKey, bucket);
    return { ok: false, retryAfterSeconds: Math.max(1, retryAfterSeconds) };
  }

  bucket.push(now);
  buckets.set(bucketKey, bucket);
  return { ok: true };
}

/**
 * Returns null when access is allowed, or an error message when blocked.
 * Access code check is skipped entirely unless RA_ACCESS_CODE is set.
 */
export function checkAccessCode(req: Request): string | null {
  const required = process.env.RA_ACCESS_CODE;
  if (!required) return null;

  const provided = req.headers.get("x-ra-access-code") || "";
  if (provided === required) return null;

  return "Access code required. Enter the code from the poster / your tutor.";
}
