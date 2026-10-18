import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { FILES, highlight } from './code';
import { resetDemoData, setTheme, useTheme } from './client';
import { LiveExample, LiveWorkspace, type ExampleId } from './Live';
import { installCommand, M2TOOLKIT, NPM_URL, PACKAGE_MANAGERS, PACKAGES_URL, PKG, RELATED, SIZES, type PackageManager } from './meta';

/** Section index, Warp-style: press the letter to jump to the section. */
const SECTIONS = [
  { key: 'W', id: 'workspace', label: 'workspace' },
  { key: 'F', id: 'features', label: 'features' },
  { key: 'C', id: 'code', label: 'code' },
  { key: 'E', id: 'engine', label: 'engine' },
  { key: 'L', id: 'layers', label: 'layers' },
  { key: 'K', id: 'keyboard', label: 'keyboard' },
  { key: 'P', id: 'packages', label: 'packages' },
  { key: 'Q', id: 'faq', label: 'faq' },
] as const;

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(text);
      setTimeout(() => setCopied((c) => (c === text ? null : c)), 1400);
    });
  };
  return { copied, copy };
}

function Logo() {
  return (
    <svg className="logo" viewBox="0 0 20 20" aria-hidden="true">
      <rect width="20" height="20" rx="4" />
      <path d="M5.5 6.5L9 10l-3.5 3.5M10.5 13.5h4" />
    </svg>
  );
}

function Arrow() {
  return (
    <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
      <path d="M4 12L12 4M5.5 4H12v6.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function SectionHead({ k, eyebrow, title, children }: { k: string; eyebrow: string; title: ReactNode; children?: ReactNode }) {
  return (
    <header className="section-head">
      <p className="eyebrow mono">
        <span className="key">[{k}]</span> {eyebrow}
      </p>
      <h2>{title}</h2>
      {children && <p className="lede">{children}</p>}
    </header>
  );
}

function Fig({ n, caption, children, className = '' }: { n: string; caption: string; children: ReactNode; className?: string }) {
  return (
    <figure className={`fig ${className}`}>
      {children}
      <figcaption className="mono">
        fig. {n} — {caption}
      </figcaption>
    </figure>
  );
}

function InstallBox({ large = false }: { large?: boolean }) {
  const [pm, setPm] = useState<PackageManager>('npm');
  const { copied, copy } = useCopy();
  const cmd = installCommand(pm);
  return (
    <div className={`install${large ? ' install-lg' : ''}`}>
      <div className="install-tabs" role="tablist" aria-label="Package manager">
        {PACKAGE_MANAGERS.map((p) => (
          <button key={p} type="button" role="tab" aria-selected={pm === p} onClick={() => setPm(p)}>
            {p}
          </button>
        ))}
      </div>
      <div className="install-cmd">
        <code>
          <span className="prompt">&gt;_</span> {cmd}
        </code>
        <button type="button" className="btn btn-ghost" onClick={() => copy(cmd)}>
          {copied === cmd ? 'copied' : 'copy'}
        </button>
      </div>
    </div>
  );
}

const FEATURES = [
  {
    title: 'request builder',
    body: 'All seven HTTP methods, params and headers tables, JSON, text, URL-encoded and multipart bodies, timeouts and redirects.',
    fig: 'methods',
    visual: (
      <div className="vis-methods mono">
        {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((m) => (
          <span key={m} className={`m m-${m.toLowerCase()}`}>
            {m}
          </span>
        ))}
      </div>
    ),
  },
  {
    title: 'response inspector',
    body: 'Status, time, size and a timing breakdown. Pretty JSON, a collapsible tree, raw text, sanitized previews and search.',
    fig: 'timing',
    visual: (
      <div className="vis-timing mono">
        <div className="vis-status">
          <span className="ok">200 OK</span>
          <span>142 ms</span>
          <span>1.2 kB</span>
        </div>
        {[
          ['prepare', 6, 0],
          ['waiting', 58, 6],
          ['download', 22, 64],
        ].map(([label, w, x]) => (
          <div key={label} className="bar-row">
            <span>{label}</span>
            <i style={{ marginLeft: `${x}%`, width: `${w}%` }} />
          </div>
        ))}
      </div>
    ),
  },
  {
    title: 'auth',
    body: 'Bearer, Basic, API key, an OAuth 2.0 integration point, custom headers and reusable auth profiles.',
    fig: 'auth types',
    visual: (
      <ul className="vis-list mono">
        <li>
          <b>bearer</b> Authorization: Bearer &lt;token&gt;
        </li>
        <li>
          <b>basic</b> Authorization: Basic &lt;base64&gt;
        </li>
        <li>
          <b>apiKey</b> header or query
        </li>
        <li>
          <b>profile</b> reusable credentials
        </li>
      </ul>
    ),
  },
  {
    title: 'environments',
    body: 'Write {{variables}} in URLs, params, headers, bodies and auth, with scoped precedence and secret masking.',
    fig: 'resolve',
    visual: (
      <div className="vis-vars mono">
        <div>
          <span className="var">{'{{baseUrl}}'}</span>/users/<span className="var">{'{{userId}}'}</span>
        </div>
        <div className="resolved">→ https://api.example.com/users/1</div>
        <div className="secret">
          <span className="var">{'{{apiToken}}'}</span> ••••••••
        </div>
      </div>
    ),
  },
  {
    title: 'collections & history',
    body: 'Folders, drag and drop, OpenAPI 3 / Swagger 2 import, a documented JSON export and replayable history.',
    fig: 'tree',
    visual: (
      <ul className="vis-tree mono">
        <li>▾ JSONPlaceholder</li>
        <li className="l2">▾ Posts</li>
        <li className="l3">
          <span className="m-get">GET</span> List posts
        </li>
        <li className="l3">
          <span className="m-post">POST</span> Create post
        </li>
        <li className="l2">
          <span className="m-get">GET</span> User by id
        </li>
      </ul>
    ),
  },
  {
    title: 'curl in, curl out',
    body: 'Copy any request as cURL, or paste a cURL command into the URL bar to import it.',
    fig: 'import',
    visual: (
      <div className="vis-curl mono">
        <div>
          <span className="prompt">$</span> curl https://api.example.com/users \
        </div>
        <div className="indent">-H &apos;Accept: application/json&apos;</div>
        <div className="resolved">→ GET /users · 1 header</div>
      </div>
    ),
  },
];

const LAYERS = [
  {
    title: 'engine',
    api: 'createApiClient()',
    body: 'Middleware, custom transports, typed errors and timeouts. No UI and no React required.',
    size: SIZES.engine,
  },
  {
    title: 'hooks',
    api: 'useApiRequest()',
    body: 'Loading, error and cancellation state for your own components, on the same engine.',
    size: SIZES.hook,
  },
  {
    title: 'panels',
    api: '<RequestBuilder /> <ResponseViewer />',
    body: 'Compose your own layout from panels that share one workspace store, or control them yourself.',
    size: `${SIZES.builder} + ${SIZES.viewer}`,
  },
  {
    title: 'workspace',
    api: '<ApiClient />',
    body: 'The complete Postman-style workspace: sidebar, tabs, environments, history and import/export.',
    size: SIZES.workspace,
  },
];

const KEYS: Array<[string[], string]> = [
  [['⌘/Ctrl', 'Enter'], 'Send request'],
  [['⌘/Ctrl', 'S'], 'Save request'],
  [['⌘/Ctrl', 'Shift', 'F'], 'Format the JSON body'],
  [['Esc'], 'Cancel the running request'],
  [['←', '→', 'Home', 'End'], 'Move between tabs'],
  [['Enter', 'F2', 'Del'], 'Open, rename and delete in the collection tree'],
  [['Enter', 'Shift + Enter'], 'Next / previous search match'],
  [['Esc', 'Tab'], 'Leave a code editor (Tab indents)'],
];

const FAQ: Array<[string, ReactNode]> = [
  [
    'Does it get around CORS?',
    <>
      No. Frontend code cannot bypass CORS, and this library does not try to. A cross-origin request only succeeds when the server allows
      your page&apos;s origin. When it doesn&apos;t, the workspace shows a network error with the likely causes. Use a small server-side
      proxy for APIs you don&apos;t control.
    </>,
  ],
  [
    'Can I use it with Next.js?',
    <>
      Yes. All components are marked <code>&apos;use client&apos;</code>, so you can render them from a Server Component page. Import{' '}
      <code>m2api-client/styles.css</code> once in your root layout.
    </>,
  ],
  [
    'Where is my data stored?',
    <>
      Nothing is stored by default. Opt in with the <code>persistence</code> option: local or session storage, memory, or your own adapter
      (IndexedDB, an encrypted store or a backend). Secret values and literal credentials are not stored unless you opt in.
    </>,
  ],
  [
    'Should I put API keys in it?',
    <>
      Never embed OAuth client secrets, API keys for privileged accounts, or production credentials in frontend code. Use short-lived tokens
      from your backend, or a proxy that adds credentials. Literal credentials are masked in history, snapshots and errors.
    </>,
  ],
  [
    'Can I use the engine without React?',
    <>
      Yes. <code>createApiClient()</code> has no UI and no React dependency, so it runs in browsers, Node 18+, workers and tests.
    </>,
  ],
  [
    'What isn’t supported yet?',
    <>
      Pre-request and test scripts (deliberately absent), GraphQL schema introspection, WebSockets and server-sent events, Postman
      collection import, request chaining and response diffing.
    </>,
  ],
];

const EXAMPLES: Array<{ id: ExampleId; label: string; file: string; text: ReactNode }> = [
  {
    id: 'composed',
    label: 'composed layout',
    file: 'examples/composed-layout.tsx',
    text: (
      <>
        <code>ApiClientProvider</code> holds one workspace store; <code>CollectionExplorer</code>, <code>RequestBuilder</code>,{' '}
        <code>ResponseViewer</code> and <code>EnvironmentSelector</code> connect to it.
      </>
    ),
  },
  {
    id: 'controlled',
    label: 'controlled',
    file: 'examples/controlled.tsx',
    text: (
      <>
        Without a provider, <code>RequestBuilder</code> and <code>ResponseViewer</code> are controlled by your own state.
      </>
    ),
  },
  {
    id: 'hook',
    label: 'hook',
    file: 'examples/user-profile.tsx',
    text: (
      <>
        <code>useApiRequest()</code> gives your own UI loading, error and cancellation state, using the same engine as the workspace.
      </>
    ),
  },
];

export function App() {
  const theme = useTheme();
  const [file, setFile] = useState(0);
  const [example, setExample] = useState<ExampleId>('composed');
  const { copied, copy } = useCopy();

  // Press a section letter to jump there, unless typing or working inside the live workspace.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest('input, textarea, select, [contenteditable], .m2a, [role="tab"]')) return;
      const s = SECTIONS.find((x) => x.key === e.key.toUpperCase());
      if (!s) return;
      document
        .getElementById(s.id)
        ?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const current = FILES[file];
  const ex = EXAMPLES.find((e) => e.id === example)!;

  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <div className="wrap topbar-inner">
          <a className="brand" href="#top" aria-label={`${PKG.name} home`}>
            <Logo />
            <span>{PKG.name}</span>
            <span className="chip mono">v{PKG.version}</span>
          </a>
          <nav className="topnav" aria-label="Page">
            <a href="#features">features</a>
            <a href="#code">docs</a>
            <a href="#layers">api</a>
            <a href={PACKAGES_URL}>npm packages</a>
          </nav>
          <div className="topbar-actions">
            <button
              type="button"
              className="btn btn-icon"
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            >
              {theme === 'dark' ? '☀' : '☾'}
            </button>
            <a className="btn btn-primary" href={NPM_URL} target="_blank" rel="noreferrer">
              view on npm <Arrow />
            </a>
          </div>
        </div>
      </header>

      <main id="main">
        <div className="wrap index-row mono" aria-label="Sections">
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`}>
              <span className="key">[{s.key}]</span> {s.label}
            </a>
          ))}
        </div>

        <section className="hero wrap" id="top">
          <p className="eyebrow mono">
            <span className="dot" /> open source · {PKG.license} · react 18 & 19 · v{PKG.version}
          </p>
          <h1>
            The API testing workspace, <em>inside your React app.</em>
          </h1>
          <p className="hero-sub">
            drop a Postman-style workspace into internal tools, developer portals, admin panels and docs. or use the panels, hooks and typed
            engine to build your own.
          </p>
          <div className="hero-ctas">
            <a className="btn btn-primary btn-lg" href="#workspace">
              try it live ↓
            </a>
            <button type="button" className="btn btn-lg btn-code" onClick={() => copy(`npm install ${PKG.name}`)}>
              <span className="prompt">&gt;_</span> npm install {PKG.name}
              <span className="btn-hint">{copied === `npm install ${PKG.name}` ? 'copied' : 'copy'}</span>
            </button>
          </div>
        </section>

        <section className="wrap" id="workspace" aria-label="Live workspace">
          <Fig n="1" caption="the complete workspace, running live. send a request." className="fig-hero">
            <div className="window">
              <div className="window-bar">
                <span className="lights" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                <span className="window-title mono">&lt;ApiClient /&gt;</span>
                <button type="button" className="btn btn-ghost" onClick={() => void resetDemoData()}>
                  reset demo data
                </button>
              </div>
              <div className="window-body">
                <LiveWorkspace theme={theme} />
              </div>
            </div>
          </Fig>
          <dl className="stats">
            <div>
              <dt className="mono">http methods</dt>
              <dd>7</dd>
            </div>
            <div>
              <dt className="mono">complete workspace</dt>
              <dd>
                {SIZES.workspace} <small>gzip</small>
              </dd>
            </div>
            <div>
              <dt className="mono">engine only</dt>
              <dd>
                {SIZES.engine} <small>gzip</small>
              </dd>
            </div>
            <div>
              <dt className="mono">runtime dependencies</dt>
              <dd>
                0 <small>besides React</small>
              </dd>
            </div>
          </dl>
        </section>

        <section className="wrap built-for" aria-label="Works with">
          <p className="mono">built for</p>
          <ul>
            {['React 18', 'React 19', 'Next.js App Router', 'Vite', 'Node 18+', 'ESM + CJS', 'TypeScript'].map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </section>

        <section className="section wrap" id="features">
          <SectionHead
            k="F"
            eyebrow="features"
            title={
              <>
                Everything a request needs. <em>Nothing it doesn&apos;t.</em>
              </>
            }
          >
            Request builder, response inspector, auth, environments, collections, history and cURL, in one component.
          </SectionHead>
          <ol className="cards">
            {FEATURES.map((f, i) => (
              <li key={f.title} className="card">
                <span className="num mono">{String(i + 1).padStart(2, '0')}</span>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
                <Fig n={`2.${i + 1}`} caption={f.fig}>
                  <div className="vis">{f.visual}</div>
                </Fig>
              </li>
            ))}
          </ol>
        </section>

        <section className="section wrap" id="code">
          <SectionHead
            k="C"
            eyebrow="quick start"
            title={
              <>
                Your API workspace, <em>defined in code.</em>
              </>
            }
          >
            Import the component and the stylesheet. Every style is scoped under <code>.m2a</code>, so nothing leaks into the rest of your
            page.
          </SectionHead>
          <div className="editor">
            <div className="tree mono" role="tablist" aria-label="Example files" aria-orientation="vertical">
              <p className="tree-root">▾ your-app</p>
              {FILES.map((f, i) => (
                <button key={f.path} type="button" role="tab" aria-selected={file === i} onClick={() => setFile(i)}>
                  <span className="tree-path">{f.path}</span>
                  <span className="tree-label">{f.label}</span>
                </button>
              ))}
            </div>
            <div className="codepane" role="tabpanel" aria-label={current.path}>
              <div className="codepane-bar mono">
                <span>{current.path}</span>
                <button type="button" className="btn btn-ghost" onClick={() => copy(current.code)}>
                  {copied === current.code ? 'copied' : 'copy'}
                </button>
              </div>
              <pre className="code mono">
                {current.code.split('\n').map((line, i) => (
                  <span key={`${file}-${i}`} className="line">
                    <span className="ln" aria-hidden="true">
                      {i + 1}
                    </span>
                    <span>{highlight(line)}</span>
                    {'\n'}
                  </span>
                ))}
              </pre>
            </div>
          </div>
        </section>

        <section className="section wrap" id="engine">
          <div className="split">
            <SectionHead
              k="E"
              eyebrow="engine"
              title={
                <>
                  One engine. <em>No UI required.</em>
                </>
              }
            >
              <code>createApiClient()</code> is the engine behind everything. It runs in browsers, Node 18+, workers and tests, with
              middleware, custom transports, typed errors and timeouts.
            </SectionHead>
            <Fig n="3" caption="sample run">
              <div className="run mono">
                <div className="run-row">
                  <span className="run-k">prepare</span>
                  <span>
                    GET <span className="var">{'{{baseUrl}}'}</span>/users?page=2
                  </span>
                  <span className="run-ok">resolved</span>
                </div>
                <div className="run-row">
                  <span className="run-k">auth</span>
                  <span>bearer · {'{{apiToken}}'} → ••••••••</span>
                  <span className="run-ok">masked</span>
                </div>
                <div className="run-row">
                  <span className="run-k">middleware</span>
                  <span>logging</span>
                  <span className="run-ok">next()</span>
                </div>
                <div className="run-row">
                  <span className="run-k">transport</span>
                  <span>fetch · timeout 10s</span>
                  <span className="run-ok">200 OK · 142 ms</span>
                </div>
                <div className="run-row run-err">
                  <span className="run-k">ApiError</span>
                  <span>kind: http | network | timeout | aborted | parse | invalid-request</span>
                  <span className="run-bad">typed</span>
                </div>
              </div>
            </Fig>
          </div>
        </section>

        <section className="section wrap" id="layers">
          <SectionHead
            k="L"
            eyebrow="architecture"
            title={
              <>
                Open at <em>every layer.</em>
              </>
            }
          >
            Use the whole workspace, compose the panels, or call the hooks and engine from your own UI. Sizes are minified and gzipped with
            React external.
          </SectionHead>
          <ol className="layers">
            {LAYERS.map((l, i) => (
              <li key={l.title} className="layer">
                <span className="num mono">{String(i + 1).padStart(2, '0')}</span>
                <h3>{l.title}</h3>
                <code className="layer-api">{l.api}</code>
                <p>{l.body}</p>
                <span className="layer-size mono">{l.size}</span>
              </li>
            ))}
          </ol>

          <div className="examples" id="examples">
            <div className="examples-head">
              <div className="seg mono" role="tablist" aria-label="Live examples">
                {EXAMPLES.map((e) => (
                  <button key={e.id} type="button" role="tab" aria-selected={example === e.id} onClick={() => setExample(e.id)}>
                    {e.label}
                  </button>
                ))}
              </div>
              <p>
                {ex.text} <span className="mono muted">source: {ex.file}</span>
              </p>
            </div>
            <Fig n="4" caption={`${ex.label}, running live`}>
              <div className={`example-frame example-${ex.id}`} role="tabpanel">
                <LiveExample id={example} theme={theme} />
              </div>
            </Fig>
          </div>
        </section>

        <section className="section wrap" id="keyboard">
          <SectionHead
            k="K"
            eyebrow="accessibility"
            title={
              <>
                Built for <em>the keyboard.</em>
              </>
            }
          >
            All controls have accessible names, focus is visible everywhere, dialogs trap and restore focus, and status changes are
            announced to screen readers.
          </SectionHead>
          <ul className="keys">
            {KEYS.map(([keys, action]) => (
              <li key={action}>
                <span className="kbds">
                  {keys.map((k) => (
                    <kbd key={k}>{k}</kbd>
                  ))}
                </span>
                <span>{action}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="section wrap" id="packages">
          <SectionHead
            k="P"
            eyebrow="m2toolkit"
            title={
              <>
                More open-source packages <em>from M2Toolkit.</em>
              </>
            }
          />
          <ul className="related">
            {RELATED.map((p) => (
              <li key={p.slug}>
                <a href={p.url} style={{ '--accent': p.accent } as CSSProperties}>
                  <span className="related-dot" aria-hidden="true" />
                  <span className="related-title">{p.title}</span>
                  <span className="related-tag">{p.tagline}</span>
                  <span className="related-go mono">
                    /npm-packages/{p.slug} <Arrow />
                  </span>
                </a>
              </li>
            ))}
            <li>
              <a href={PACKAGES_URL} className="related-all">
                <span className="related-title">All npm packages</span>
                <span className="related-tag">Every React package we publish, with live previews.</span>
                <span className="related-go mono">
                  browse all <Arrow />
                </span>
              </a>
            </li>
          </ul>
        </section>

        <section className="section wrap" id="faq">
          <SectionHead k="Q" eyebrow="faq" title="Questions, answered." />
          <div className="faq">
            {FAQ.map(([q, a]) => (
              <details key={q}>
                <summary>
                  <span>{q}</span>
                  <span className="mono plus" aria-hidden="true" />
                </summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="cta wrap">
          <h2>
            Start testing APIs <em>where your users already are.</em>
          </h2>
          <InstallBox large />
          <div className="hero-ctas">
            <a className="btn btn-primary btn-lg" href={`${NPM_URL}#readme`} target="_blank" rel="noreferrer">
              read the docs <Arrow />
            </a>
            <a className="btn btn-lg" href="#workspace">
              open the live workspace
            </a>
          </div>
        </section>
      </main>

      <footer className="footer">
        <div className="wrap footer-cols">
          <div className="footer-brand">
            <a className="brand" href="#top">
              <Logo />
              <span>{PKG.name}</span>
            </a>
            <p>An API testing workspace for React, with a typed request engine you can use without the UI.</p>
          </div>
          <div>
            <p className="mono">package</p>
            <a href={NPM_URL}>npm</a>
            <a href={`${NPM_URL}#readme`}>readme</a>
            <a href="#code">quick start</a>
            <a href="#faq">faq</a>
          </div>
          <div>
            <p className="mono">packages</p>
            {RELATED.map((p) => (
              <a key={p.slug} href={p.url}>
                {p.title}
              </a>
            ))}
            <a href={PACKAGES_URL}>All packages</a>
          </div>
          <div>
            <p className="mono">m2toolkit</p>
            <a href={M2TOOLKIT}>Home</a>
            <a href={`${M2TOOLKIT}/tools`}>Free tools</a>
            <a href={`${M2TOOLKIT}/about`}>About</a>
          </div>
        </div>
        <div className="wrap footer-base mono">
          <span>
            {PKG.name} v{PKG.version} · {PKG.license} license
          </span>
          <span>
            hosted on <a href={PACKAGES_URL}>m2toolkit.com/npm-packages</a>
          </span>
        </div>
      </footer>
    </>
  );
}
