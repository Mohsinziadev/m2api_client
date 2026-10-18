import type { AuthConfig, HttpMethod, KeyValueEntry, MultipartField, RequestBodyDefinition, RequestDefinition } from '../core/types';
import { createKeyValue, createRequest, isHttpMethod } from '../core/request';
import { syncParamsFromUrl, splitUrl } from '../core/url';
import { createId } from '../utils/id';
import { safeDecode } from '../utils/encoding';

export interface CurlImportResult {
  request: RequestDefinition;
  /** Flags that were ignored or only partially supported. */
  warnings: string[];
}

export class CurlParseError extends Error {
  override readonly name = 'CurlParseError';
}

/** Splits a shell command into words, handling quotes, escapes and line continuations. */
export function tokenizeShell(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inToken = false;
  let i = 0;
  const src = input.replace(/\\\r?\n/g, ' ').replace(/\^\r?\n/g, ' ');
  while (i < src.length) {
    const ch = src[i];
    if (ch === "'") {
      const end = src.indexOf("'", i + 1);
      if (end === -1) throw new CurlParseError('Unterminated single quote.');
      current += src.slice(i + 1, end);
      inToken = true;
      i = end + 1;
    } else if (ch === '$' && src[i + 1] === "'") {
      i += 2;
      while (i < src.length && src[i] !== "'") {
        if (src[i] === '\\' && i + 1 < src.length) {
          const next = src[i + 1];
          current += ({ n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"' } as Record<string, string>)[next] ?? next;
          i += 2;
        } else current += src[i++];
      }
      if (src[i] !== "'") throw new CurlParseError("Unterminated $'...' string.");
      inToken = true;
      i++;
    } else if (ch === '"') {
      i++;
      while (i < src.length && src[i] !== '"') {
        if (src[i] === '\\' && i + 1 < src.length && '"\\$`\n'.includes(src[i + 1])) {
          current += src[i + 1];
          i += 2;
        } else current += src[i++];
      }
      if (src[i] !== '"') throw new CurlParseError('Unterminated double quote.');
      inToken = true;
      i++;
    } else if (ch === '\\' && i + 1 < src.length) {
      current += src[i + 1];
      inToken = true;
      i += 2;
    } else if (/\s/.test(ch)) {
      if (inToken) tokens.push(current);
      current = '';
      inToken = false;
      i++;
    } else {
      current += ch;
      inToken = true;
      i++;
    }
  }
  if (inToken) tokens.push(current);
  return tokens;
}

// prettier-ignore
const NO_ARG_IGNORED = new Set([
  '-L', '--location', '-k', '--insecure', '-s', '--silent', '-S', '--show-error', '-v', '--verbose', '-i', '--include',
  '--compressed', '-f', '--fail', '-g', '--globoff', '--http1.0', '--http1.1', '--http2', '--http3', '-N', '--no-buffer',
  '-#', '--progress-bar', '-0', '-4', '-6', '--fail-with-body', '--no-progress-meter', '-O', '--remote-name', '-j', '--junk-session-cookies',
]);
// prettier-ignore
const ARG_IGNORED = new Set([
  '-o', '--output', '--connect-timeout', '-w', '--write-out', '--retry', '--retry-delay', '--cacert', '--capath', '-E', '--cert',
  '--key', '-c', '--cookie-jar', '-r', '--range', '--resolve', '--limit-rate', '-K', '--config', '--max-redirs', '-T', '--upload-file', '-x', '--proxy',
  '-U', '--proxy-user', '--interface', '--dns-servers',
]);
const SHORT_NO_ARG = new Set(['L', 'k', 's', 'S', 'v', 'i', 'f', 'g', 'N', '#', '0', '4', '6', 'G', 'I', 'O', 'j']);
const SHORT_WITH_ARG = new Set(['X', 'H', 'd', 'F', 'u', 'A', 'e', 'b', 'o', 'm', 'w', 'x', 'E', 'c', 'r', 'K', 'T', 'U']);

/**
 * Parses a cURL command into a {@link RequestDefinition}. Supports the common flags (method, headers,
 * data variants, forms, basic auth, `--json`, `-G`, `--max-time`); unsupported flags become warnings.
 */
export function parseCurl(command: string): CurlImportResult {
  const tokens = tokenizeShell(command.trim());
  const warnings: string[] = [];
  const warn = (message: string) => {
    if (!warnings.includes(message)) warnings.push(message);
  };
  if (tokens[0] !== 'curl') {
    if (tokens[0]?.endsWith('curl') || tokens[0]?.endsWith('curl.exe')) tokens[0] = 'curl';
    else throw new CurlParseError('The command must start with "curl".');
  }

  // Expand bundled short flags (-sSL, -XPOST, -HAccept:x).
  const args: string[] = [];
  for (const token of tokens.slice(1)) {
    if (/^-[A-Za-z0-9#]{2,}$/.test(token) && !token.startsWith('--')) {
      const letters = token.slice(1);
      if (SHORT_WITH_ARG.has(letters[0])) {
        args.push(`-${letters[0]}`, letters.slice(1));
        continue;
      }
      if ([...letters].every((l) => SHORT_NO_ARG.has(l))) {
        for (const l of letters) args.push(`-${l}`);
        continue;
      }
    }
    if (/^-[A-Za-z]./.test(token) && SHORT_WITH_ARG.has(token[1]) && !token.startsWith('--')) {
      args.push(token.slice(0, 2), token.slice(2));
      continue;
    }
    args.push(token);
  }

  let url = '';
  let method: HttpMethod | undefined;
  let get = false;
  let head = false;
  const headers: KeyValueEntry[] = [];
  const data: string[] = [];
  const urlencoded: KeyValueEntry[] = [];
  const form: MultipartField[] = [];
  let json = false;
  let auth: AuthConfig = { type: 'none' };
  let timeout: number | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const value = () => {
      const next = args[++i];
      if (next === undefined) throw new CurlParseError(`Missing value for ${arg}.`);
      return next;
    };
    switch (arg) {
      case '-X':
      case '--request': {
        const m = value().toUpperCase();
        if (isHttpMethod(m)) method = m;
        else warn(`Unsupported method "${m}"; using GET.`);
        break;
      }
      case '-H':
      case '--header': {
        const raw = value();
        const colon = raw.indexOf(':');
        if (colon <= 0) {
          warn(`Ignored malformed header "${raw}".`);
          break;
        }
        const name = raw.slice(0, colon).trim();
        const headerValue = raw.slice(colon + 1).trim();
        if (/^cookie$/i.test(name)) warn('Browsers do not let scripts send a Cookie header; it was imported but will be dropped.');
        headers.push(createKeyValue(name, headerValue));
        break;
      }
      case '-d':
      case '--data':
      case '--data-ascii':
      case '--data-raw':
      case '--data-binary': {
        const raw = value();
        if (raw.startsWith('@') && arg !== '--data-raw')
          warn('Reading request data from a file (@file) is not supported; paste the content instead.');
        else data.push(arg === '--data-binary' || arg === '--data-raw' ? raw : raw.replace(/\r?\n/g, ''));
        break;
      }
      case '--data-urlencode': {
        const raw = value();
        const eq = raw.indexOf('=');
        if (eq === -1) urlencoded.push(createKeyValue(raw, ''));
        else urlencoded.push(createKeyValue(raw.slice(0, eq), raw.slice(eq + 1)));
        break;
      }
      case '--json': {
        data.push(value());
        json = true;
        break;
      }
      case '-F':
      case '--form':
      case '--form-string': {
        const raw = value();
        const eq = raw.indexOf('=');
        const name = eq === -1 ? raw : raw.slice(0, eq);
        const fieldValue = eq === -1 ? '' : raw.slice(eq + 1);
        if (arg !== '--form-string' && fieldValue.startsWith('@')) {
          form.push({
            id: createId('kv'),
            key: name,
            value: '',
            enabled: true,
            kind: 'file',
            file: null,
            fileName: fieldValue.slice(1).split(';')[0],
          });
          warn('File fields were imported without their files; select the files again.');
        } else {
          form.push({ id: createId('kv'), key: name, value: fieldValue.replace(/^"(.*)"$/, '$1'), enabled: true, kind: 'text' });
        }
        break;
      }
      case '-u':
      case '--user': {
        const raw = value();
        const colon = raw.indexOf(':');
        auth =
          colon === -1
            ? { type: 'basic', username: raw, password: '' }
            : { type: 'basic', username: raw.slice(0, colon), password: raw.slice(colon + 1) };
        break;
      }
      case '--oauth2-bearer':
        auth = { type: 'bearer', token: value() };
        break;
      case '-A':
      case '--user-agent':
        headers.push(createKeyValue('User-Agent', value()));
        break;
      case '-e':
      case '--referer':
        headers.push(createKeyValue('Referer', value()));
        warn('Browsers control the Referer header; it was imported but will be dropped.');
        break;
      case '-b':
      case '--cookie':
        headers.push(createKeyValue('Cookie', value()));
        warn('Browsers do not let scripts send a Cookie header; it was imported but will be dropped.');
        break;
      case '-G':
      case '--get':
        get = true;
        break;
      case '-I':
      case '--head':
        head = true;
        break;
      case '-m':
      case '--max-time': {
        const seconds = Number(value());
        if (Number.isFinite(seconds) && seconds > 0) timeout = Math.round(seconds * 1000);
        break;
      }
      case '--url':
        url = value();
        break;
      default:
        if (NO_ARG_IGNORED.has(arg)) break;
        if (ARG_IGNORED.has(arg)) {
          const ignored = value();
          if (arg === '-x' || arg === '--proxy') warn(`The proxy "${ignored}" is not applied; browsers cannot choose a proxy.`);
          break;
        }
        if (arg.startsWith('-') && arg.length > 1) {
          warn(`Ignored unsupported option ${arg}.`);
          break;
        }
        if (!url) url = arg;
        else warn(`Ignored extra argument "${arg}".`);
    }
  }

  if (!url) throw new CurlParseError('No URL found in the cURL command.');

  // Content-Type decides how -d data is interpreted.
  const contentTypeHeader = headers.find((h) => h.key.toLowerCase() === 'content-type');
  const contentType = contentTypeHeader?.value.toLowerCase() ?? '';
  let body: RequestBodyDefinition = { type: 'none' };
  const dataText = data.join('&');

  if (get && (data.length || urlencoded.length)) {
    const extra = [
      ...data.flatMap((d) => d.split('&').filter(Boolean)),
      ...urlencoded.map((f) => `${encodeURIComponent(f.key)}=${encodeURIComponent(f.value)}`),
    ];
    url = `${url}${url.includes('?') ? '&' : '?'}${extra.join('&')}`;
  } else if (form.length) {
    body = { type: 'multipart', fields: form };
  } else if (json) {
    body = { type: 'json', content: prettyJson(dataText) };
    if (!contentTypeHeader) headers.push(createKeyValue('Content-Type', 'application/json'));
    if (!headers.some((h) => h.key.toLowerCase() === 'accept')) headers.push(createKeyValue('Accept', 'application/json'));
  } else if (
    urlencoded.length ||
    (data.length && (contentType.includes('x-www-form-urlencoded') || (!contentType && !looksLikeJson(dataText))))
  ) {
    const fields = [
      ...dataText
        .split('&')
        .filter(Boolean)
        .map((pair) => {
          const eq = pair.indexOf('=');
          return eq === -1
            ? createKeyValue(safeDecode(pair), '')
            : createKeyValue(safeDecode(pair.slice(0, eq)), safeDecode(pair.slice(eq + 1)));
        }),
      ...urlencoded,
    ];
    body = { type: 'urlencoded', fields };
    if (contentTypeHeader) headers.splice(headers.indexOf(contentTypeHeader), 1);
  } else if (data.length) {
    if (contentType.includes('json') || (!contentType && looksLikeJson(dataText))) {
      body = { type: 'json', content: prettyJson(dataText) };
    } else {
      body = { type: 'text', content: dataText, contentType: contentTypeHeader?.value };
      if (contentTypeHeader) headers.splice(headers.indexOf(contentTypeHeader), 1);
    }
  }

  const hasBody = body.type !== 'none';
  const finalMethod: HttpMethod = head ? 'HEAD' : (method ?? (get ? 'GET' : hasBody ? 'POST' : 'GET'));
  if (!/^[a-z][a-z\d+\-.]*:\/\//i.test(url)) url = `${/^(localhost|127\.)/.test(url) ? 'http' : 'https'}://${url}`;

  const request = createRequest({
    method: finalMethod,
    url,
    headers,
    body,
    auth,
    settings: timeout ? { timeout } : {},
    name: '',
  });
  request.params = syncParamsFromUrl(url, []);
  if (splitUrl(url).hash) warn('The URL fragment (#...) is never sent to the server.');
  return { request, warnings };
}

function looksLikeJson(text: string): boolean {
  const t = text.trim();
  if (!/^[[{]/.test(t)) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    return false;
  }
}

function prettyJson(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
