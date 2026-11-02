// Small, dependency free guards used wherever data crosses a trust boundary:
// URLs from query strings or storage, JSON embedded in HTML, emails in links.

/** Only same-site paths: "/cuenta" yes; "//evil.com", "/\\evil.com", "https://…", "javascript:" no. */
export function safeRedirect(path: string | null | undefined, fallback = '/') {
  if (!path || !path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return fallback;
  try {
    const url = new URL(path, location.origin);
    return url.origin === location.origin ? url.pathname + url.search + url.hash : fallback;
  } catch {
    return fallback;
  }
}

/** Links an admin or the data can set: internal paths or https only. */
export function safeHref(href: string | null | undefined) {
  if (!href) return '';
  const h = href.trim();
  if (h.startsWith('/') && !h.startsWith('//') && !h.startsWith('/\\')) return h;
  try {
    return new URL(h).protocol === 'https:' ? h : '';
  } catch {
    return '';
  }
}

const EMAIL = /^[^\s@<>()[\]\\,;:"?&=#]+@[^\s@<>()[\]\\,;:"?&=#]+\.[^\s@<>()[\]\\,;:"?&=#]{2,}$/;
export const isEmail = (v: string) => EMAIL.test(v.trim());

/** mailto: link that can't smuggle extra headers (cc, bcc, body) through the address. */
export const mailto = (email: string, subject = '') => (isEmail(email) ? `mailto:${email.trim()}${subject ? `?subject=${encodeURIComponent(subject)}` : ''}` : '');

/**
 * JSON safe to drop inside <script type="application/json">: a "</script>" or
 * "<!--" inside the data (say, from a compromised remote catalog) can't close
 * the tag and start running code.
 */
export const jsonForScript = (value: unknown) =>
  JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

/** Only same-site image paths from our own build (cart thumbnails live in storage). */
export const safeImg = (src: string | null | undefined) => (src && src.startsWith('/') && !src.startsWith('//') ? src : '');

/** Client side throttle: allow `max` actions per `windowMs`, remembered across reloads. */
export function rateLimit(key: string, max: number, windowMs: number) {
  const k = `primor.rl.${key}`;
  const now = Date.now();
  let hits: number[] = [];
  try {
    hits = (JSON.parse(localStorage.getItem(k) ?? '[]') as number[]).filter((t) => now - t < windowMs);
  } catch {
    hits = [];
  }
  const allowed = hits.length < max;
  const retryIn = allowed ? 0 : Math.ceil((windowMs - (now - hits[0])) / 1000);
  return {
    allowed,
    retryIn,
    hit() {
      try {
        localStorage.setItem(k, JSON.stringify([...hits, now]));
      } catch {
        /* storage blocked: no throttle memory */
      }
    },
    reset() {
      try {
        localStorage.removeItem(k);
      } catch {
        /* ignore */
      }
    },
  };
}
