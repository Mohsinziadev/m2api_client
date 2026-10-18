import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// By default the demo consumes the library from source for instant HMR. `npm run build:demo:dist`
// (M2API_DEMO_DIST=1) builds it against the compiled package in ../dist instead, exactly as an app
// installing it from npm would.
const fromDist = process.env.M2API_DEMO_DIST === '1';

export default defineConfig({
  root: r('.'),
  base: './',
  plugins: [react()],
  resolve: {
    alias: [
      { find: 'm2api-client/styles.css', replacement: fromDist ? r('../dist/styles.css') : r('../src/styles/index.css') },
      { find: /^m2api-client$/, replacement: fromDist ? r('../dist/index.js') : r('../src/index.ts') },
    ],
  },
  server: { fs: { allow: [r('..')] } },
  build: { outDir: r('dist'), emptyOutDir: true },
});
