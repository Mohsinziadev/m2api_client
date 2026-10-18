/** UTF-8 safe base64 (btoa only handles Latin-1). */
export function base64Encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function base64Decode(value: string): string {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/**
 * Percent-encodes a query component without double-encoding existing `%XX` escapes, so both
 * `a b` and `a%20b` end up as `a%20b`.
 */
export function encodeQueryComponent(value: string): string {
  return value.replace(/%(?![0-9A-Fa-f]{2})|[^%]+/g, (part) => (part === '%' ? '%25' : encodeURIComponent(part)));
}

export function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value.replace(/\+/g, ' '));
  } catch {
    return value;
  }
}
