const DROP = new Set([
  'script',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'base',
  'link',
  'meta',
  'noscript',
  'template',
  'portal',
  'form',
]);
const URL_ATTRS = new Set(['href', 'src', 'action', 'formaction', 'xlink:href', 'srcset', 'poster', 'background', 'ping', 'data']);

/** Blocks scripts, network access and navigation inside the preview frame (defence in depth with `sandbox`). */
export const PREVIEW_CSP =
  "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'";

/**
 * Removes scripts, event handlers, embedded frames and script URLs from an HTML document. Used for the
 * response Preview tab, which additionally renders inside a sandboxed iframe with a strict CSP, so
 * response content can never run code in your page.
 */
/** Browsers ignore control characters and spaces in URL schemes (`java\tscript:`), so compare without them. */
function stripControlAndSpace(value: string): string {
  let out = '';
  for (const ch of value) if (ch.charCodeAt(0) > 0x20) out += ch;
  return out;
}

export function sanitizeHtml(html: string): string {
  if (typeof DOMParser === 'undefined') return '';
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const el of [...doc.querySelectorAll('*')]) {
    const tag = el.tagName.toLowerCase();
    if (DROP.has(tag)) {
      el.remove();
      continue;
    }
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      const value = stripControlAndSpace(attr.value).toLowerCase();
      if (
        name.startsWith('on') ||
        name === 'srcdoc' ||
        (name === 'style' && /expression\(|url\(\s*['"]?\s*javascript:/i.test(attr.value))
      ) {
        el.removeAttribute(attr.name);
      } else if (
        URL_ATTRS.has(name) &&
        (/^(javascript|vbscript):/.test(value) || (value.startsWith('data:') && !value.startsWith('data:image/')))
      ) {
        el.removeAttribute(attr.name);
      }
    }
  }
  const meta = doc.createElement('meta');
  meta.setAttribute('http-equiv', 'Content-Security-Policy');
  meta.setAttribute('content', PREVIEW_CSP);
  doc.head.prepend(meta);
  return `<!doctype html>${doc.documentElement.outerHTML}`;
}
