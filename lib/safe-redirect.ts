/** Same-origin path for a user-supplied `next`, or the fallback. Resolves first so backslash/`//` tricks can't escape. */
export function safeRedirectPath(next: string | null, base: string, fallback: string): string {
  if (!next) return fallback;
  try {
    const url = new URL(next, base);
    if (url.origin !== new URL(base).origin) return fallback;
    return url.pathname + url.search + url.hash;
  } catch {
    return fallback;
  }
}
