/** Minimal cookie helpers (no dependency): read one cookie, build a Set-Cookie value. */

function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) {
      try {
        return decodeURIComponent(part.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

function serializeCookie(name, value, { maxAgeSeconds, sameSite = 'lax', secure = true, path = '/' } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, 'HttpOnly'];
  if (maxAgeSeconds !== undefined) parts.push(`Max-Age=${maxAgeSeconds}`);
  parts.push(`SameSite=${sameSite.charAt(0).toUpperCase()}${sameSite.slice(1)}`);
  // SameSite=None is only honoured together with Secure.
  if (secure || sameSite === 'none') parts.push('Secure');
  return parts.join('; ');
}

module.exports = { readCookie, serializeCookie };
