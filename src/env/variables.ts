import type { Variable, VariablesInput } from '../core/types';

/**
 * Variable scopes, from highest to lowest precedence. When the same key exists in several scopes the
 * first one wins: a request-level value overrides the active environment, which overrides collection
 * variables, which override globals.
 */
export const VARIABLE_SCOPES = ['request', 'environment', 'collection', 'global'] as const;
export type VariableScope = (typeof VARIABLE_SCOPES)[number];
export type VariableScopes = Partial<Record<VariableScope, VariablesInput | undefined>>;

export interface ResolvedVariable {
  key: string;
  value: string;
  secret: boolean;
  scope: VariableScope | 'dynamic';
}

/** Matches `{{name}}` and `{{ name }}`. Names may contain anything except braces. */
const PATTERN = /\{\{\s*([^{}]+?)\s*\}\}/g;
const MAX_DEPTH = 8;

/** Built-in values computed at send time. */
export const DYNAMIC_VARIABLES: Record<string, { description: string; get: () => string }> = {
  $timestamp: { description: 'Unix time in seconds', get: () => String(Math.floor(Date.now() / 1000)) },
  $isoTimestamp: { description: 'Current time as ISO 8601', get: () => new Date().toISOString() },
  $uuid: { description: 'Random UUID v4', get: () => uuid() },
  $randomInt: { description: 'Random integer 0–1000', get: () => String(Math.floor(Math.random() * 1001)) },
};

export function normalizeVariables(input: VariablesInput | undefined): Variable[] {
  if (!input) return [];
  if (Array.isArray(input)) return (input as readonly Variable[]).filter((v) => v.enabled !== false && v.key.trim() !== '');
  return Object.entries(input as Record<string, string>).map(([key, value]) => ({ key, value: String(value) }));
}

/** Resolves variable lookups across scopes. Create one per send so dynamic values stay consistent. */
export class VariableResolver {
  private readonly vars = new Map<string, ResolvedVariable>();
  private readonly dynamicCache = new Map<string, string>();

  constructor(scopes: VariableScopes = {}) {
    // Iterate lowest → highest precedence so later scopes overwrite earlier ones.
    for (const scope of [...VARIABLE_SCOPES].reverse()) {
      for (const v of normalizeVariables(scopes[scope])) {
        this.vars.set(v.key.trim(), { key: v.key.trim(), value: v.value, secret: Boolean(v.secret), scope });
      }
    }
  }

  get(name: string): ResolvedVariable | undefined {
    const found = this.vars.get(name);
    if (found) return found;
    const dynamic = DYNAMIC_VARIABLES[name];
    if (!dynamic) return undefined;
    let value = this.dynamicCache.get(name);
    if (value === undefined) this.dynamicCache.set(name, (value = dynamic.get()));
    return { key: name, value, secret: false, scope: 'dynamic' };
  }

  has(name: string): boolean {
    return this.vars.has(name) || name in DYNAMIC_VARIABLES;
  }

  entries(): ResolvedVariable[] {
    return [...this.vars.values()];
  }

  /** Fully interpolated values of every secret variable, for redaction. */
  secretValues(): string[] {
    return this.entries()
      .filter((v) => v.secret)
      .map((v) => this.interpolate(v.value).value)
      .filter((v) => v.length > 0);
  }

  /** Replaces `{{name}}` references. Unknown names are left as-is and reported in `unresolved`. */
  interpolate(template: string): InterpolationResult {
    const unresolved = new Set<string>();
    const secrets = new Set<string>();
    const value = this.replace(template, unresolved, secrets, 0, []);
    return { value, unresolved: [...unresolved], secretsUsed: [...secrets] };
  }

  private replace(template: string, unresolved: Set<string>, secrets: Set<string>, depth: number, stack: string[]): string {
    if (!template.includes('{{')) return template;
    return template.replace(PATTERN, (match, rawName: string) => {
      const name = rawName.trim();
      const variable = this.get(name);
      if (!variable || stack.includes(name) || depth >= MAX_DEPTH) {
        unresolved.add(name);
        return match;
      }
      const resolved = this.replace(variable.value, unresolved, secrets, depth + 1, [...stack, name]);
      if (variable.secret && resolved) secrets.add(resolved);
      return resolved;
    });
  }
}

export interface InterpolationResult {
  value: string;
  unresolved: string[];
  /** Resolved values of secret variables used in this template. */
  secretsUsed: string[];
}

/** One-off interpolation helper. */
export function interpolate(template: string, variables: VariablesInput | VariableScopes | VariableResolver = {}): InterpolationResult {
  return toResolver(variables).interpolate(template);
}

export function toResolver(variables: VariablesInput | VariableScopes | VariableResolver | undefined): VariableResolver {
  if (variables instanceof VariableResolver) return variables;
  if (!variables) return new VariableResolver();
  if (!Array.isArray(variables) && isScopes(variables)) return new VariableResolver(variables as VariableScopes);
  return new VariableResolver({ request: variables as VariablesInput });
}

function isScopes(value: object): boolean {
  const keys = Object.keys(value);
  return (
    keys.length > 0 &&
    keys.every((k) => (VARIABLE_SCOPES as readonly string[]).includes(k)) &&
    Object.values(value).every((v) => v === undefined || typeof v === 'object')
  );
}

/** Lists the variable names referenced in a template, in order of first appearance. */
export function findVariableReferences(template: string): string[] {
  const names: string[] = [];
  for (const match of template.matchAll(PATTERN)) {
    const name = match[1].trim();
    if (!names.includes(name)) names.push(name);
  }
  return names;
}

/** Splits a template into literal text and variable segments, for highlighting. */
export function tokenizeTemplate(template: string): Array<{ type: 'text' | 'variable'; text: string; name?: string }> {
  const out: Array<{ type: 'text' | 'variable'; text: string; name?: string }> = [];
  let last = 0;
  for (const match of template.matchAll(PATTERN)) {
    const index = match.index ?? 0;
    if (index > last) out.push({ type: 'text', text: template.slice(last, index) });
    out.push({ type: 'variable', text: match[0], name: match[1].trim() });
    last = index + match[0].length;
  }
  if (last < template.length) out.push({ type: 'text', text: template.slice(last) });
  return out;
}

/** True when the whole string is a single variable reference such as `{{apiToken}}`. */
export function isPureVariableReference(value: string): boolean {
  return /^\s*\{\{\s*[^{}]+?\s*\}\}\s*$/.test(value);
}

/** Flattens scopes into one list (highest precedence wins), keeping `secret` flags. */
export function mergeVariableScopes(scopes: VariableScopes): Variable[] {
  return new VariableResolver(scopes).entries().map(({ key, value, secret }) => ({ key, value, secret }));
}

function uuid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes);
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
