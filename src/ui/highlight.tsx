import type { ReactNode } from 'react';

export type TokenType = 'key' | 'string' | 'number' | 'literal' | 'punct' | 'variable' | 'text';
export interface Token {
  type: TokenType;
  text: string;
}

// Lexes JSON-ish text (tolerates invalid input and {{variables}}), so the editor can colour partial JSON.
const JSON_TOKEN = /("(?:\\.|[^"\\\n])*"?)(\s*:)?|(\{\{[^{}]*\}\})|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:])/g;

export function tokenizeJson(text: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  for (const m of text.matchAll(JSON_TOKEN)) {
    const index = m.index ?? 0;
    if (index > last) tokens.push({ type: 'text', text: text.slice(last, index) });
    if (m[1] !== undefined) {
      tokens.push({ type: m[2] ? 'key' : 'string', text: m[1] });
      if (m[2]) tokens.push({ type: 'punct', text: m[2] });
    } else if (m[3] !== undefined) tokens.push({ type: 'variable', text: m[3] });
    else if (m[4] !== undefined) tokens.push({ type: 'number', text: m[4] });
    else if (m[5] !== undefined) tokens.push({ type: 'literal', text: m[5] });
    else tokens.push({ type: 'punct', text: m[0] });
    last = index + m[0].length;
  }
  if (last < text.length) tokens.push({ type: 'text', text: text.slice(last) });
  return tokens;
}

/** Finds case-insensitive match ranges of `query` in `text`. */
export function findMatches(text: string, query: string, limit = 5000): Array<[number, number]> {
  if (!query) return [];
  const haystack = text.toLowerCase();
  const needle = query.toLowerCase();
  const out: Array<[number, number]> = [];
  let from = 0;
  while (out.length < limit) {
    const index = haystack.indexOf(needle, from);
    if (index === -1) break;
    out.push([index, index + needle.length]);
    from = index + Math.max(needle.length, 1);
  }
  return out;
}

/**
 * Renders tokens with optional search highlights. Matches are split at token boundaries so syntax
 * colours survive; each match part carries `data-match` for scrolling to the active one.
 */
export function renderTokens(tokens: Token[], matches: Array<[number, number]> = [], activeMatch = -1): ReactNode[] {
  const nodes: ReactNode[] = [];
  let offset = 0;
  let m = 0;
  tokens.forEach((token, ti) => {
    const start = offset;
    const end = offset + token.text.length;
    offset = end;
    const cls = token.type === 'text' ? undefined : `m2a-tok-${token.type}`;
    while (m < matches.length && matches[m][1] <= start) m++;
    if (m >= matches.length || matches[m][0] >= end) {
      nodes.push(
        cls ? (
          <span key={ti} className={cls}>
            {token.text}
          </span>
        ) : (
          token.text
        ),
      );
      return;
    }
    const parts: ReactNode[] = [];
    let cursor = start;
    let k = m;
    while (k < matches.length && matches[k][0] < end) {
      const [ms, me] = matches[k];
      const s = Math.max(ms, start);
      const e = Math.min(me, end);
      if (s > cursor) parts.push(token.text.slice(cursor - start, s - start));
      parts.push(
        <mark key={`${ti}-${k}`} className={k === activeMatch ? 'm2a-mark m2a-mark-active' : 'm2a-mark'} data-match={k}>
          {token.text.slice(s - start, e - start)}
        </mark>,
      );
      cursor = e;
      if (me > end) break;
      k++;
    }
    if (cursor < end) parts.push(token.text.slice(cursor - start));
    nodes.push(
      <span key={ti} className={cls}>
        {parts}
      </span>,
    );
  });
  return nodes;
}

const VARIABLE_TOKEN = /\{\{[^{}]*\}\}/g;

/** Replaces `{{variables}}` outside JSON strings with placeholders so templated JSON can be parsed and formatted. */
function protectVariables(text: string): { text: string; restore: (s: string) => string } {
  const vars: string[] = [];
  let out = '';
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      out += ch;
      if (ch === '\\') out += text[++i] ?? '';
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }
    if (ch === '{' && text[i + 1] === '{') {
      VARIABLE_TOKEN.lastIndex = i;
      const m = VARIABLE_TOKEN.exec(text);
      if (m && m.index === i) {
        out += `"__m2a_var_${vars.length}__"`;
        vars.push(m[0]);
        i += m[0].length - 1;
        continue;
      }
    }
    out += ch;
  }
  return { text: out, restore: (s) => s.replace(/"__m2a_var_(\d+)__"/g, (_, n: string) => vars[Number(n)]) };
}

export interface JsonCheck {
  valid: boolean;
  error?: string;
  line?: number;
  column?: number;
}

/** Validates JSON that may contain `{{variables}}` as values. */
export function checkJson(text: string): JsonCheck {
  if (!text.trim()) return { valid: true };
  const { text: safe } = protectVariables(text);
  try {
    JSON.parse(safe);
    return { valid: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const pos = /position (\d+)/.exec(message);
    const lineCol = /line (\d+) column (\d+)/.exec(message);
    let line: number | undefined;
    let column: number | undefined;
    if (lineCol) {
      line = Number(lineCol[1]);
      column = Number(lineCol[2]);
    } else if (pos) {
      const before = safe.slice(0, Number(pos[1]));
      line = before.split('\n').length;
      column = before.length - before.lastIndexOf('\n');
    }
    const clean = message
      .replace(/^JSON\.parse: /, '')
      .replace(/ in JSON at position \d+( \(line \d+ column \d+\))?/, '')
      .replace(/ at line \d+ column \d+ of the JSON data/, '');
    return { valid: false, error: clean, line, column };
  }
}

/** Pretty-prints JSON, keeping `{{variables}}`. Returns `null` when the text is not valid JSON. */
export function formatJson(text: string, indent = 2): string | null {
  const { text: safe, restore } = protectVariables(text);
  try {
    return restore(JSON.stringify(JSON.parse(safe), null, indent));
  } catch {
    return null;
  }
}
