import pkg from '../../package.json';

/** Real package facts, read from package.json at build time. */
export const PKG = {
  name: pkg.name,
  version: pkg.version,
  license: pkg.license,
} as const;

export const NPM_URL = `https://www.npmjs.com/package/${PKG.name}`;

export const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];
export const installCommand = (pm: PackageManager) => (pm === 'npm' ? `npm install ${PKG.name}` : `${pm} add ${PKG.name}`);

/** M2Toolkit hosts this page at /npm-packages/<slug>; links use absolute URLs like the other package pages. */
export const M2TOOLKIT = 'https://www.m2toolkit.com';
export const PACKAGES_URL = `${M2TOOLKIT}/npm-packages`;

/** Other packages in the M2Toolkit registry (titles and taglines from their own site.config.json). */
export const RELATED = [
  {
    slug: 'm2timeline-motion',
    title: 'Timelines',
    tagline: 'Production-ready timeline and progress components for React.',
    accent: '#6550d6',
  },
  {
    slug: 'upload-motion',
    title: 'Upload Motion',
    tagline: 'Animated, accessible file uploads for React, on a real upload engine.',
    accent: '#7357ff',
  },
  {
    slug: 'smooth-tabs',
    title: 'Smooth Tabs',
    tagline: 'Accessible, scrollable React tabs with an animated indicator.',
    accent: '#4f46e5',
  },
  {
    slug: 'react-advanced-rating',
    title: 'React Advanced Rating',
    tagline: 'Accessible, animated rating components for React.',
    accent: '#f5a524',
  },
].map((p) => ({ ...p, url: `${PACKAGES_URL}/${p.slug}` }));

/** Measured with `npm run size` (minified + gzip, React external). */
export const SIZES = {
  engine: '6.85 kB',
  hook: '7.40 kB',
  curl: '4.11 kB',
  store: '19.13 kB',
  viewer: '10.19 kB',
  builder: '22.74 kB',
  workspace: '50.11 kB',
  css: '8.58 kB',
};
