import type { AuthConfig, Environment, HttpMethod, KeyValueEntry, MultipartField, RequestBodyDefinition, Variable } from '../core/types';
import {
  createCollection,
  createFolder,
  toCollectionRequest,
  type Collection,
  type CollectionFolder,
  type CollectionNode,
} from '../collections/collections';
import { createKeyValue, createRequest } from '../core/request';
import { createId } from '../utils/id';

export interface OpenApiImportResult {
  collection: Collection;
  /** An environment holding `baseUrl` (from `servers[0]`) and empty secret variables for each auth scheme. */
  environment: Environment;
  warnings: string[];
}

export class OpenApiImportError extends Error {
  override readonly name = 'OpenApiImportError';
}

type Json = Record<string, unknown>;
const METHODS: Array<[string, HttpMethod]> = [
  ['get', 'GET'],
  ['post', 'POST'],
  ['put', 'PUT'],
  ['patch', 'PATCH'],
  ['delete', 'DELETE'],
  ['head', 'HEAD'],
  ['options', 'OPTIONS'],
];

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Converts an OpenAPI 3.x (or Swagger 2.0) document in JSON form into a collection. Operations are
 * grouped into folders by their first tag; path parameters become `{{variables}}`; request bodies get
 * an example generated from the schema. YAML is not parsed: convert it to JSON first.
 */
export function importOpenApi(input: string | object): OpenApiImportResult {
  let doc: unknown = input;
  if (typeof input === 'string') {
    try {
      doc = JSON.parse(input);
    } catch {
      throw new OpenApiImportError('The document is not valid JSON. YAML specs must be converted to JSON first.');
    }
  }
  if (!isObject(doc) || (typeof doc.openapi !== 'string' && typeof doc.swagger !== 'string')) {
    throw new OpenApiImportError('Not an OpenAPI document: missing the "openapi" (or "swagger") field.');
  }
  const swagger2 = typeof doc.swagger === 'string';
  const warnings: string[] = [];
  const warn = (m: string) => {
    if (!warnings.includes(m)) warnings.push(m);
  };

  const resolve = (value: unknown, seen: string[] = []): unknown => {
    if (!isObject(value) || typeof value.$ref !== 'string') return value;
    const ref = value.$ref;
    if (!ref.startsWith('#/')) {
      warn(`External reference "${ref}" was not resolved.`);
      return {};
    }
    if (seen.includes(ref)) return {};
    let target: unknown = doc;
    for (const part of ref.slice(2).split('/')) {
      target = isObject(target) ? target[part.replace(/~1/g, '/').replace(/~0/g, '~')] : undefined;
    }
    return resolve(target, [...seen, ref]);
  };

  const sample = (schemaRaw: unknown, depth = 0, seen: string[] = []): unknown => {
    const ref = isObject(schemaRaw) && typeof schemaRaw.$ref === 'string' ? schemaRaw.$ref : null;
    if (ref && seen.includes(ref)) return {};
    const schema = resolve(schemaRaw);
    if (!isObject(schema) || depth > 6) return null;
    const nextSeen = ref ? [...seen, ref] : seen;
    if (schema.example !== undefined) return schema.example;
    if (schema.default !== undefined) return schema.default;
    if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];
    if (Array.isArray(schema.allOf)) return Object.assign({}, ...schema.allOf.map((s) => sample(s, depth + 1, nextSeen)).filter(isObject));
    for (const key of ['oneOf', 'anyOf'] as const)
      if (Array.isArray(schema[key]) && schema[key].length) return sample(schema[key][0], depth + 1, nextSeen);
    const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== 'null') : schema.type;
    if (type === 'object' || isObject(schema.properties)) {
      const out: Json = {};
      for (const [name, prop] of Object.entries(isObject(schema.properties) ? schema.properties : {}))
        out[name] = sample(prop, depth + 1, nextSeen);
      return out;
    }
    if (type === 'array') return [sample(schema.items, depth + 1, nextSeen)];
    if (type === 'integer' || type === 'number') return 0;
    if (type === 'boolean') return true;
    if (type === 'string') {
      switch (schema.format) {
        case 'date-time':
          return '2026-01-01T00:00:00Z';
        case 'date':
          return '2026-01-01';
        case 'email':
          return 'user@example.com';
        case 'uuid':
          return '00000000-0000-4000-8000-000000000000';
        case 'uri':
          return 'https://example.com';
        default:
          return 'string';
      }
    }
    return null;
  };

  const exampleOf = (media: Json): unknown => {
    if (media.example !== undefined) return media.example;
    if (isObject(media.examples)) {
      const first = resolve(Object.values(media.examples)[0]);
      if (isObject(first) && first.value !== undefined) return first.value;
    }
    return sample(media.schema);
  };

  // Base URL
  let baseUrl = '';
  if (swagger2) {
    const scheme = Array.isArray(doc.schemes) && doc.schemes.length ? String(doc.schemes[0]) : 'https';
    if (typeof doc.host === 'string') baseUrl = `${scheme}://${doc.host}${typeof doc.basePath === 'string' ? doc.basePath : ''}`;
  } else if (Array.isArray(doc.servers) && isObject(doc.servers[0]) && typeof doc.servers[0].url === 'string') {
    const server = doc.servers[0];
    baseUrl = String(server.url).replace(/\{([^}]+)\}/g, (m, name: string) => {
      const def = isObject(server.variables) && isObject(server.variables[name]) ? server.variables[name].default : undefined;
      return typeof def === 'string' ? def : m;
    });
  }
  baseUrl = baseUrl.replace(/\/+$/, '');
  if (!baseUrl) warn('The document defines no server URL; set {{baseUrl}} in the environment.');
  else if (!/^https?:\/\//.test(baseUrl)) warn(`The server URL "${baseUrl}" is relative; adjust {{baseUrl}} in the environment.`);

  // Security schemes → auth configs + environment variables
  const envVars: Variable[] = [{ id: createId('var'), key: 'baseUrl', value: baseUrl }];
  const schemes: Record<string, AuthConfig> = {};
  const schemeDefs = swagger2 ? doc.securityDefinitions : isObject(doc.components) ? doc.components.securitySchemes : undefined;
  const addSecret = (key: string) => {
    if (!envVars.some((v) => v.key === key)) envVars.push({ id: createId('var'), key, value: '', secret: true });
  };
  for (const [name, raw] of Object.entries(isObject(schemeDefs) ? schemeDefs : {})) {
    const s = resolve(raw);
    if (!isObject(s)) continue;
    const scheme = String(s.scheme ?? '').toLowerCase();
    if ((s.type === 'http' && scheme === 'bearer') || s.type === 'oauth2' || s.type === 'openIdConnect') {
      const variable = s.type === 'http' ? 'bearerToken' : 'accessToken';
      schemes[name] = s.type === 'http' ? { type: 'bearer', token: `{{${variable}}}` } : { type: 'oauth2', accessToken: `{{${variable}}}` };
      addSecret(variable);
    } else if ((s.type === 'http' && scheme === 'basic') || s.type === 'basic') {
      schemes[name] = { type: 'basic', username: '{{username}}', password: '{{password}}' };
      if (!envVars.some((v) => v.key === 'username')) envVars.push({ id: createId('var'), key: 'username', value: '' });
      addSecret('password');
    } else if (s.type === 'apiKey' && typeof s.name === 'string') {
      if (s.in === 'cookie') {
        warn(`Cookie API key "${name}" cannot be sent by browsers and was skipped.`);
        continue;
      }
      schemes[name] = { type: 'apiKey', key: s.name, value: '{{apiKey}}', in: s.in === 'query' ? 'query' : 'header' };
      addSecret('apiKey');
    }
  }
  const authFor = (security: unknown): AuthConfig => {
    if (!Array.isArray(security)) return { type: 'none' };
    for (const requirement of security) {
      if (!isObject(requirement)) continue;
      for (const name of Object.keys(requirement)) if (schemes[name]) return schemes[name];
    }
    return { type: 'none' };
  };

  const info = isObject(doc.info) ? doc.info : {};
  const title = typeof info.title === 'string' && info.title.trim() ? info.title.trim() : 'Imported API';
  const collection = createCollection(title, typeof info.description === 'string' ? { description: info.description } : {});
  const folders = new Map<string, CollectionFolder>();
  const rootItems: CollectionNode[] = [];
  const pathVariables = new Map<string, string>();
  let operations = 0;

  for (const [path, rawItem] of Object.entries(isObject(doc.paths) ? doc.paths : {})) {
    const item = resolve(rawItem);
    if (!isObject(item)) continue;
    const shared = Array.isArray(item.parameters) ? item.parameters : [];
    for (const [key, method] of METHODS) {
      const op = item[key];
      if (!isObject(op)) continue;
      operations++;
      const params: KeyValueEntry[] = [];
      const headers: KeyValueEntry[] = [];
      const formParams: Json[] = [];
      let body: RequestBodyDefinition = { type: 'none' };

      const allParams = [...shared, ...(Array.isArray(op.parameters) ? op.parameters : [])].map((p) => resolve(p)).filter(isObject);
      for (const p of allParams) {
        const name = typeof p.name === 'string' ? p.name : '';
        if (!name) continue;
        const schema = resolve(p.schema ?? p);
        const raw = p.example ?? (isObject(schema) ? sample(schema) : undefined);
        const value = raw === undefined || raw === null || typeof raw === 'object' ? '' : String(raw);
        const description = typeof p.description === 'string' ? p.description : undefined;
        if (p.in === 'query') params.push(createKeyValue(name, value, { enabled: Boolean(p.required) || value !== '', description }));
        else if (p.in === 'header') headers.push(createKeyValue(name, value, { enabled: Boolean(p.required), description }));
        else if (p.in === 'path' && !pathVariables.has(name)) pathVariables.set(name, value);
        else if (p.in === 'body' && swagger2) body = { type: 'json', content: JSON.stringify(sample(p.schema), null, 2) };
        else if (p.in === 'formData') formParams.push(p);
      }

      if (!swagger2 && op.requestBody) {
        const requestBody = resolve(op.requestBody);
        const content = isObject(requestBody) && isObject(requestBody.content) ? requestBody.content : {};
        const types = Object.keys(content);
        const jsonType = types.find((t) => /json/i.test(t));
        if (jsonType && isObject(content[jsonType])) {
          body = { type: 'json', content: JSON.stringify(exampleOf(content[jsonType] as Json), null, 2) };
          if (jsonType !== 'application/json') headers.push(createKeyValue('Content-Type', jsonType));
        } else if (types.includes('application/x-www-form-urlencoded') || types.includes('multipart/form-data')) {
          const multipart = types.includes('multipart/form-data');
          const media = content[multipart ? 'multipart/form-data' : 'application/x-www-form-urlencoded'];
          const schema = isObject(media) ? resolve(media.schema) : {};
          const props = isObject(schema) && isObject(schema.properties) ? schema.properties : {};
          const fields = Object.entries(props).map(([name, propRaw]) => {
            const prop = resolve(propRaw);
            const isFile = isObject(prop) && (prop.format === 'binary' || prop.format === 'base64');
            const v = sample(prop);
            return { name, isFile, value: v === null || typeof v === 'object' ? '' : String(v) };
          });
          body = multipart
            ? {
                type: 'multipart',
                fields: fields.map((f): MultipartField => ({
                  ...createKeyValue(f.name, f.isFile ? '' : f.value),
                  kind: f.isFile ? 'file' : 'text',
                })),
              }
            : { type: 'urlencoded', fields: fields.map((f) => createKeyValue(f.name, f.value)) };
        } else if (types.length) {
          const type = types[0];
          const media = content[type];
          const example = isObject(media) ? exampleOf(media) : '';
          body = { type: 'text', content: typeof example === 'string' ? example : '', contentType: type };
        }
      } else if (formParams.length) {
        const multipart = formParams.some((p) => p.type === 'file');
        body = multipart
          ? {
              type: 'multipart',
              fields: formParams.map((p): MultipartField => ({
                ...createKeyValue(String(p.name)),
                kind: p.type === 'file' ? 'file' : 'text',
              })),
            }
          : { type: 'urlencoded', fields: formParams.map((p) => createKeyValue(String(p.name))) };
      }

      const name =
        (typeof op.summary === 'string' && op.summary.trim()) ||
        (typeof op.operationId === 'string' && op.operationId) ||
        `${method} ${path}`;
      const request = createRequest({
        name,
        method,
        url: `{{baseUrl}}${path.replace(/\{([^}]+)\}/g, '{{$1}}')}`,
        params,
        headers,
        body,
        auth: authFor(op.security ?? doc.security),
        description: typeof op.description === 'string' ? op.description : undefined,
      });
      if (op.deprecated === true) request.name = `${request.name} (deprecated)`;
      const node = toCollectionRequest(request);

      const tag = Array.isArray(op.tags) && typeof op.tags[0] === 'string' ? op.tags[0] : null;
      if (!tag) rootItems.push(node);
      else {
        let folder = folders.get(tag);
        if (!folder) {
          folder = createFolder(tag);
          folders.set(tag, folder);
        }
        folder.items.push(node);
      }
    }
  }

  if (operations === 0) warn('The document contains no operations.');
  collection.items = [...folders.values(), ...rootItems];
  collection.variables = [...pathVariables].map(([key, value]) => ({ id: createId('var'), key, value }));
  return { collection, environment: { id: createId('env'), name: `${title} environment`, variables: envVars }, warnings };
}
