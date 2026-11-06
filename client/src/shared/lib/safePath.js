/**
 * Accepts only same-app paths ("/dashboard", "/unit/x/practice?step=2").
 * Rejects absolute URLs, protocol-relative URLs ("//evil.com"), backslash
 * tricks ("/\evil.com") and anything with control characters, so a crafted
 * link can never send a learner off-site.
 */
export function safeInternalPath(value, fallback = '/dashboard') {
  if (typeof value !== 'string' || value === '') return fallback;
  if (!value.startsWith('/')) return fallback;
  if (value.startsWith('//') || value.startsWith('/\\')) return fallback;
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f\\]/.test(value)) return fallback;
  return value;
}
