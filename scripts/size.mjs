// Measures what consumers actually ship: each entry is bundled from the built package with React
// external, minified and gzipped. Fails when a budget is exceeded.
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { rolldown } from 'rolldown';

const root = resolve(import.meta.dirname, '..');
const tmp = resolve(root, '.size');
await rm(tmp, { recursive: true, force: true });
await mkdir(tmp, { recursive: true });

const cases = [
  { name: 'createApiClient (engine only)', code: `export { createApiClient } from '../dist/index.js';`, budget: 8 },
  { name: 'useApiRequest', code: `export { useApiRequest } from '../dist/index.js';`, budget: 8.5 },
  { name: 'cURL import/export', code: `export { parseCurl, toCurl } from '../dist/index.js';`, budget: 5 },
  { name: 'createWorkspace (headless store)', code: `export { createWorkspace } from '../dist/index.js';`, budget: 22 },
  { name: 'ResponseViewer', code: `export { ResponseViewer } from '../dist/index.js';`, budget: 12 },
  { name: 'RequestBuilder', code: `export { RequestBuilder } from '../dist/index.js';`, budget: 26 },
  { name: '<ApiClient> (complete workspace)', code: `export { ApiClient } from '../dist/index.js';`, budget: 56 },
];

const kb = (n) => (n / 1024).toFixed(2);
const rows = [];
let failed = false;
for (const c of cases) {
  const entry = resolve(tmp, `${rows.length}.js`);
  await writeFile(entry, c.code);
  const bundle = await rolldown({
    input: entry,
    external: [/^react/],
    platform: 'browser',
    // mirror package.json "sideEffects": only CSS has side effects
    treeshake: { moduleSideEffects: (id) => id.endsWith('.css') },
    transform: { define: { 'process.env.NODE_ENV': '"production"' } },
    onLog(level, log, handler) {
      if (log.code !== 'MODULE_LEVEL_DIRECTIVE') handler(level, log);
    },
  });
  const { output } = await bundle.generate({ format: 'esm', minify: true });
  await bundle.close();
  const code = output[0].code;
  const gz = gzipSync(code).length;
  const ok = gz / 1024 <= c.budget;
  failed ||= !ok;
  rows.push(
    `${ok ? '✓' : '✗'} ${c.name.padEnd(36)} ${kb(code.length).padStart(7)} kB min  ${kb(gz).padStart(6)} kB gzip  (budget ${c.budget} kB)`,
  );
}
const css = await readFile(resolve(root, 'dist/styles.css'));
const cssGz = gzipSync(css).length;
const cssOk = cssGz / 1024 <= 10;
failed ||= !cssOk;
rows.push(
  `${cssOk ? '✓' : '✗'} ${'styles.css'.padEnd(36)} ${kb(css.length).padStart(7)} kB min  ${kb(cssGz).padStart(6)} kB gzip  (budget 10 kB)`,
);
await rm(tmp, { recursive: true, force: true });
console.log(rows.join('\n'));
if (failed) {
  console.error('\nSize budget exceeded.');
  process.exit(1);
}
