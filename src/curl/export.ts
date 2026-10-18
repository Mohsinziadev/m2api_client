import type { PreparedRequest } from '../core/types';
import { redactPreparedRequest } from '../core/redact';

export interface CurlExportOptions {
  /** Break the command over several lines with `\` continuations. Default `true`. */
  multiline?: boolean;
  /** Mask credentials and secret variable values. Default `false`. */
  redact?: boolean;
}

/** Quotes a value for POSIX shells using single quotes. */
export function shellQuote(value: string): string {
  if (/^[\w@%+=:,./-]+$/.test(value)) return value;
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Renders a prepared request as a cURL command. */
export function toCurl(request: PreparedRequest, options: CurlExportOptions = {}): string {
  const req = options.redact ? redactPreparedRequest(request) : request;
  const head = ['curl'];
  if (req.method === 'HEAD') head.push('--head');
  else if (req.method !== 'GET') head.push(`-X ${req.method}`);
  head.push(shellQuote(req.url));
  const parts: string[] = [head.join(' ')];

  for (const [name, value] of Object.entries(req.headers)) parts.push(`-H ${shellQuote(`${name}: ${value}`)}`);

  const source = req.bodySource;
  if (source?.type === 'text' && source.text !== '') {
    parts.push(`--data-raw ${shellQuote(source.text)}`);
  } else if (source?.type === 'multipart') {
    for (const part of source.parts) {
      parts.push('value' in part ? `-F ${shellQuote(`${part.name}=${part.value}`)}` : `-F ${shellQuote(`${part.name}=@${part.fileName}`)}`);
    }
  } else if (source?.type === 'binary') {
    parts.push(`--data-binary @body.bin`);
  }

  return options.multiline === false ? parts.join(' ') : parts.join(' \\\n  ');
}
