// Builds the library: ESM + CJS (one file per source module, so bundlers can tree-shake unused
// layouts), bundled type declarations for both module systems, and the stylesheet.
import { copyFile, readdir, readFile, rm } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { rolldown } from 'rolldown';
import { dts } from 'rolldown-plugin-dts';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const external = [/^react($|\/)/, /^react-dom($|\/)/];

await rm(dist, { recursive: true, force: true });

// Rolldown keeps module-level 'use client' directives when preserving modules, so every component
// file stays a client boundary while pure utilities (date parsing, sorting...) remain server-safe.
const bundle = await rolldown({
  input: resolve(root, 'src/index.ts'),
  external,
  platform: 'neutral',
  treeshake: true,
  transform: { target: 'es2020', jsx: 'react-jsx' },
  onLog(level, log, handler) {
    if (log.code === 'MODULE_LEVEL_DIRECTIVE') return; // verified below
    handler(level, log);
  },
});

const shared = { dir: dist, preserveModules: true, preserveModulesRoot: 'src', sourcemap: false, exports: 'named' };
await bundle.write({ ...shared, format: 'esm', entryFileNames: '[name].js' });
await bundle.write({ ...shared, format: 'cjs', entryFileNames: '[name].cjs' });
await bundle.close();

// Declarations: a single self-contained file, duplicated as .d.cts for `require` consumers.
const types = await rolldown({
  input: resolve(root, 'src/index.ts'),
  external,
  plugins: [dts({ emitDtsOnly: true, tsconfig: resolve(root, 'tsconfig.build.json') })],
});
await types.write({ dir: dist, format: 'esm', entryFileNames: '[name].js' });
await types.close();
await copyFile(resolve(dist, 'index.d.ts'), resolve(dist, 'index.d.cts'));

// Guard: every source module marked 'use client' must keep the directive in both formats.
const sources = (await readdir(resolve(root, 'src'), { recursive: true })).filter((f) => /\.tsx?$/.test(f));
let checked = 0;
for (const file of sources) {
  const code = await readFile(resolve(root, 'src', file), 'utf8');
  if (!/^\s*['"]use client['"]/.test(code)) continue;
  for (const ext of ['.js', '.cjs']) {
    const out = resolve(dist, file.replace(/\.tsx?$/, ext));
    const built = await readFile(out, 'utf8');
    if (!/^\s*['"]use client['"]/.test(built)) throw new Error(`'use client' missing in ${relative(root, out)}`);
    checked++;
  }
}

console.log(`✓ built dist (esm, cjs, d.ts, d.cts) — ${checked} client boundaries verified`);
