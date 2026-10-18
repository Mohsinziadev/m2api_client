// End-to-end check of the *published* artefact: packs the package, installs the tarball into a fresh
// project, type-checks every file in examples/ against it, server-renders the components through both
// the ESM and CommonJS entry points, and sends a request with the engine in plain Node.
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const work = resolve(root, '.smoke');
const run = (cmd, args, cwd) => execFileSync(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'inherit'], encoding: 'utf8' });

await rm(work, { recursive: true, force: true });
await mkdir(work, { recursive: true });

const packed = JSON.parse(run('npm', ['pack', '--json', '--pack-destination', work], root))[0];
console.log(`• packed ${packed.filename} (${(packed.size / 1024).toFixed(1)} kB, ${packed.files.length} files)`);
const paths = packed.files.map((f) => f.path);
const leaked = paths.filter((p) => !/^(dist\/|README\.md|CHANGELOG\.md|LICENSE|package\.json)/.test(p));
if (leaked.length) throw new Error(`Unexpected files in tarball: ${leaked.join(', ')}`);
for (const required of [
  'dist/index.js',
  'dist/index.cjs',
  'dist/index.d.ts',
  'dist/index.d.cts',
  'dist/styles.css',
  'README.md',
  'CHANGELOG.md',
  'LICENSE',
]) {
  if (!paths.includes(required)) throw new Error(`Missing from tarball: ${required}`);
}
console.log('• tarball contains dist (ESM, CJS, types, CSS), README, CHANGELOG and LICENSE only');

const app = resolve(work, 'app');
await mkdir(resolve(app, 'src'), { recursive: true });
await writeFile(resolve(app, 'package.json'), JSON.stringify({ name: 'smoke-app', private: true, type: 'module' }, null, 2));
run(
  'npm',
  [
    'install',
    '--no-audit',
    '--no-fund',
    '--loglevel=error',
    resolve(work, packed.filename),
    'react@19',
    'react-dom@19',
    '@types/react@19',
    '@types/react-dom@19',
    'typescript@5',
  ],
  app,
);
console.log('• installed tarball into a fresh project');

await cp(resolve(root, 'examples'), resolve(app, 'src'), { recursive: true });
// Apps declare CSS modules through their bundler's types (vite/client, next-env.d.ts...).
await writeFile(resolve(app, 'src/env.d.ts'), "declare module '*.css';\n");
await writeFile(
  resolve(app, 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      moduleResolution: 'bundler',
      jsx: 'react-jsx',
      strict: true,
      skipLibCheck: false,
      outDir: 'out',
      rootDir: 'src',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      types: [],
    },
    include: ['src'],
  }),
);
run('npx', ['tsc', '-p', 'tsconfig.json'], app);
console.log('• examples type-check against the published types (skipLibCheck: false)');

// Node cannot import CSS, so strip the stylesheet imports from the compiled examples.
const outFiles = (await readdir(resolve(app, 'out'), { recursive: true })).filter((f) => f.endsWith('.js'));
for (const f of outFiles) {
  const p = resolve(app, 'out', f);
  await writeFile(p, (await readFile(p, 'utf8')).replace(/^import ['"]m2api-client\/styles\.css['"];?$/m, ''));
}

const ssr = `
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const checks = [
  ['./out/quickstart.js', 'default', 'm2a-shell'],
  ['./out/composed-layout.js', 'ComposedLayout', 'm2a-request'],
  ['./out/controlled.js', 'ControlledEditor', 'm2a-response'],
  ['./out/persistence-and-oauth.js', 'PersistentWorkspace', 'm2a-shell'],
  ['./out/user-profile.js', 'UserProfile', 'Load user'],
];
for (const [file, name, marker] of checks) {
  const mod = await import(file);
  const html = renderToString(createElement(mod[name]));
  if (!html.includes(marker)) throw new Error(file + ' did not render ' + marker);
}
console.log('• ESM: ' + checks.length + ' examples server-render');

const { api } = await import('./out/programmatic.js');
if (typeof api.get !== 'function') throw new Error('programmatic example did not create a client');

const cjs = require('m2api-client');
const html = renderToString(createElement(cjs.ApiClient, { initialUrl: 'https://cjs.test/works' }));
if (!html.includes('cjs.test/works')) throw new Error('CJS render failed');
console.log('• CJS: require("m2api-client") renders <ApiClient>');

const client = cjs.createApiClient({ transport: cjs.createMockTransport((req) => ({ body: { echo: req.url } })) });
const res = await client.get('https://node.test/ping', { params: { a: 1 } });
if (res.data.echo !== 'https://node.test/ping?a=1') throw new Error('engine request failed in Node');
console.log('• engine sends requests in plain Node (mock transport)');

const css = require.resolve('m2api-client/styles.css');
if (!css.endsWith('styles.css')) throw new Error('styles.css export missing');
console.log('• styles.css export resolves');
`;
await writeFile(resolve(app, 'ssr.mjs'), ssr);
process.stdout.write(run('node', ['ssr.mjs'], app));

await rm(work, { recursive: true, force: true });
console.log('✓ smoke test passed');
