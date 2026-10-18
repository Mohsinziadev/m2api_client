import { describe, expect, it } from 'vitest';
import { CurlParseError, createRequest, parseCurl, prepareDefinition, prepareRequest, toCurl, tokenizeShell } from '../src';

describe('cURL export', () => {
  it('renders method, URL, headers and body with shell quoting', () => {
    const prepared = prepareRequest({
      url: 'https://api.test/users',
      method: 'POST',
      headers: { 'X-Note': "it's" },
      json: { name: 'Ada' },
    });
    expect(toCurl(prepared)).toBe(
      [
        'curl -X POST https://api.test/users',
        `-H 'X-Note: it'\\''s'`,
        "-H 'Content-Type: application/json'",
        `--data-raw '{"name":"Ada"}'`,
      ].join(' \\\n  '),
    );
    expect(toCurl(prepareRequest({ url: 'https://api.test' }), { multiline: false })).toBe('curl https://api.test');
    expect(toCurl(prepareRequest({ url: 'https://api.test', method: 'HEAD' }))).toBe('curl --head https://api.test');
  });

  it('renders multipart parts and redacts secrets on request', () => {
    const form = new FormData();
    form.append('name', 'x');
    form.append('file', new Blob(['a']), 'a.txt');
    const prepared = prepareRequest({ url: 'https://api.test', method: 'POST', body: form, auth: { type: 'bearer', token: 'tok-12345' } });
    const curl = toCurl(prepared, { multiline: false });
    expect(curl).toContain('-F name=x');
    expect(curl).toContain('-F file=@a.txt');
    expect(curl).toContain('tok-12345');
    expect(toCurl(prepared, { redact: true })).not.toContain('tok-12345');
  });
});

describe('cURL import', () => {
  it('tokenizes quotes, escapes and line continuations', () => {
    expect(tokenizeShell(`curl 'a b' "c \\"d\\"" e\\ f $'g\\nh' \\\n -X`)).toEqual(['curl', 'a b', 'c "d"', 'e f', 'g\nh', '-X']);
    expect(() => tokenizeShell(`curl 'oops`)).toThrow(CurlParseError);
  });

  it('parses a typical JSON POST', () => {
    const { request, warnings } = parseCurl(`curl -X POST 'https://api.test/users?team=core' \\
      -H 'Content-Type: application/json' -H "Authorization: Bearer abc" \\
      --data-raw '{"name":"Ada"}' --compressed -sSL`);
    expect(warnings).toEqual([]);
    expect(request.method).toBe('POST');
    expect(request.url).toBe('https://api.test/users?team=core');
    expect(request.params).toMatchObject([{ key: 'team', value: 'core', enabled: true }]);
    expect(request.headers.map((h) => [h.key, h.value])).toEqual([
      ['Content-Type', 'application/json'],
      ['Authorization', 'Bearer abc'],
    ]);
    expect(request.body).toEqual({ type: 'json', content: '{\n  "name": "Ada"\n}' });
  });

  it('infers POST from data and urlencoded bodies', () => {
    const { request } = parseCurl(`curl https://api.test/login -d 'user=ada&pass=x%20y' --data-urlencode 'note=a b'`);
    expect(request.method).toBe('POST');
    expect(request.body.type).toBe('urlencoded');
    if (request.body.type === 'urlencoded') {
      expect(request.body.fields.map((f) => [f.key, f.value])).toEqual([
        ['user', 'ada'],
        ['pass', 'x y'],
        ['note', 'a b'],
      ]);
    }
  });

  it('parses basic auth, forms, -G, --json, -XPATCH and timeouts', () => {
    expect(parseCurl('curl -u ada:secret https://api.test').request.auth).toEqual({ type: 'basic', username: 'ada', password: 'secret' });
    const form = parseCurl(`curl -F 'name=Ada' -F 'avatar=@me.png' https://api.test/upload`);
    expect(form.request.body).toMatchObject({
      type: 'multipart',
      fields: [
        { key: 'name', value: 'Ada', kind: 'text' },
        { key: 'avatar', kind: 'file', fileName: 'me.png' },
      ],
    });
    expect(form.warnings.join()).toMatch(/without their files/);
    const get = parseCurl(`curl -G https://api.test/search -d q=ada -d page=2`).request;
    expect(get.method).toBe('GET');
    expect(get.url).toBe('https://api.test/search?q=ada&page=2');
    const json = parseCurl(`curl --json '{"a":1}' https://api.test`).request;
    expect(json.method).toBe('POST');
    expect(json.headers.map((h) => h.key)).toEqual(['Content-Type', 'Accept']);
    expect(parseCurl('curl -XPATCH https://api.test').request.method).toBe('PATCH');
    expect(parseCurl('curl -m 2.5 https://api.test').request.settings.timeout).toBe(2500);
    expect(parseCurl('curl -I api.test').request).toMatchObject({ method: 'HEAD', url: 'https://api.test' });
  });

  it('warns about unsupported and browser-restricted options', () => {
    const { warnings } = parseCurl(`curl --proxy http://p:8080 -b 'a=1' --frobnicate https://api.test`);
    expect(warnings.join('\n')).toMatch(/proxy/);
    expect(warnings.join('\n')).toMatch(/Cookie/);
    expect(warnings.join('\n')).toMatch(/--frobnicate/);
  });

  it('rejects input that is not a curl command or has no URL', () => {
    expect(() => parseCurl('wget https://x')).toThrow(/must start with "curl"/);
    expect(() => parseCurl('curl -X POST')).toThrow(/No URL/);
  });

  it('round-trips through export and import', () => {
    const original = createRequest({
      method: 'PUT',
      url: 'https://api.test/items/1',
      headers: { 'X-Mode': 'fast' },
      body: { type: 'json', content: '{"done":true}' },
    });
    const { request } = parseCurl(toCurl(prepareDefinition(original)));
    expect(request.method).toBe('PUT');
    expect(request.url).toBe('https://api.test/items/1');
    expect(request.headers.find((h) => h.key === 'X-Mode')?.value).toBe('fast');
    expect(request.body.type === 'json' && JSON.parse(request.body.content)).toEqual({ done: true });
  });
});
