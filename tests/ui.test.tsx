import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ApiClient,
  ApiError,
  createApiClient,
  createCollection,
  createMockTransport,
  createRequest,
  createWorkspace,
  RequestBuilder,
  ResponseViewer,
  sanitizeHtml,
  toCollectionRequest,
  useApiRequest,
  type ApiResponse,
  type MockResponseInit,
  type PreparedRequest,
  type RequestDefinition,
} from '../src';

function mockClient(handler: (req: PreparedRequest) => MockResponseInit = () => ({ body: { ok: true } })) {
  const calls: PreparedRequest[] = [];
  const client = createApiClient({
    transport: createMockTransport((req) => {
      calls.push(req);
      return handler(req);
    }),
  });
  return { client, calls };
}

function makeResponse(init: Partial<ApiResponse> = {}): ApiResponse {
  const text = 'text' in init ? (init.text ?? null) : '{"name":"Ada","tags":["a","b"]}';
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    url: 'https://api.test/users/1',
    redirected: false,
    headers: { 'content-type': 'application/json', 'x-request-id': 'abc' },
    data: 'data' in init ? init.data : text && JSON.parse(text),
    text,
    bodyKind: 'json',
    contentType: 'application/json',
    size: text?.length ?? 0,
    raw: text === null ? null : (new TextEncoder().encode(text).buffer as ArrayBuffer),
    timing: { startTime: Date.now(), duration: 42 },
    request: {
      method: 'GET',
      url: 'https://api.test/users/1',
      headers: { authorization: 'Bearer ••••••' },
      bodySource: null,
      timeout: 30000,
      warnings: [],
      unresolvedVariables: [],
    },
    ...init,
  };
}

describe('<ApiClient>', () => {
  it('renders the workspace and sends a request with the Send button', async () => {
    const { client, calls } = mockClient(() => ({ body: { id: 1, name: 'Ada' } }));
    const user = userEvent.setup();
    render(<ApiClient client={client} initialMethod="GET" initialUrl="https://api.test/users/1" />);

    expect(screen.getByRole('textbox', { name: 'Request URL' })).toHaveValue('https://api.test/users/1');
    await user.click(screen.getByRole('button', { name: /^Send/ }));

    const response = screen.getByRole('region', { name: 'Response' });
    expect(await within(response).findByText('200')).toBeInTheDocument();
    expect(within(response).getByLabelText('Response body')).toHaveTextContent('"name": "Ada"');
    expect(calls[0]).toMatchObject({ method: 'GET', url: 'https://api.test/users/1' });
  });

  it('sends with Cmd/Ctrl+Enter and records history', async () => {
    const { client, calls } = mockClient();
    const user = userEvent.setup();
    render(<ApiClient client={client} initialUrl="https://api.test/ping" />);
    const url = screen.getByRole('textbox', { name: 'Request URL' });
    await user.click(url);
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() => expect(calls).toHaveLength(1));

    await user.click(screen.getByRole('tab', { name: /History/ }));
    expect(await screen.findByRole('button', { name: /Open GET https:\/\/api.test\/ping, status 200/ })).toBeInTheDocument();
  });

  it('mirrors query parameters typed in the URL into the Params table', async () => {
    const user = userEvent.setup();
    render(<ApiClient client={mockClient().client} />);
    const url = screen.getByRole('textbox', { name: 'Request URL' });
    await user.type(url, 'https://api.test/search?q=react&page=2');
    expect(screen.getByRole('textbox', { name: 'Parameter 1 key' })).toHaveValue('q');
    expect(screen.getByRole('textbox', { name: 'Parameter 2 value' })).toHaveValue('2');
  });

  it('supports every HTTP method from the method selector', async () => {
    const { client, calls } = mockClient();
    const user = userEvent.setup();
    render(<ApiClient client={client} initialUrl="https://api.test/x" />);
    for (const method of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
      await user.selectOptions(screen.getByRole('combobox', { name: 'HTTP method' }), method);
      await user.click(screen.getByRole('button', { name: /^Send/ }));
      await waitFor(() => expect(calls.at(-1)?.method).toBe(method));
    }
  });

  it('shows readable errors without crashing and keeps the workspace usable', async () => {
    const { client } = mockClient(() => {
      throw new TypeError('Failed to fetch');
    });
    const user = userEvent.setup();
    render(<ApiClient client={client} initialUrl="https://api.test/down" />);
    await user.click(screen.getByRole('button', { name: /^Send/ }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not get a response');
    expect(alert).toHaveTextContent('CORS');
    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('cancels an in-flight request', async () => {
    const { client } = mockClient(() => ({ body: { slow: true }, delay: 10_000 }));
    const user = userEvent.setup();
    render(<ApiClient client={client} initialUrl="https://api.test/slow" />);
    await user.click(screen.getByRole('button', { name: /^Send/ }));
    expect(await screen.findByText('Sending request…')).toBeInTheDocument();
    await user.click(screen.getAllByRole('button', { name: /Cancel/ })[0]);
    expect(await screen.findByText('Request cancelled')).toBeInTheDocument();
  });

  it('imports a pasted cURL command into the request', async () => {
    const user = userEvent.setup();
    render(<ApiClient client={mockClient().client} />);
    const url = screen.getByRole('textbox', { name: 'Request URL' });
    await user.click(url);
    await user.paste(`curl -X POST https://api.test/items -H 'Content-Type: application/json' -d '{"a":1}'`);
    expect(url).toHaveValue('https://api.test/items');
    expect(screen.getByRole('combobox', { name: 'HTTP method' })).toHaveValue('POST');
  });

  it('opens saved requests from the collection tree with the keyboard', async () => {
    const collection = createCollection('Demo', {
      items: [
        toCollectionRequest(createRequest({ name: 'List users', url: 'https://api.test/users' })),
        toCollectionRequest(createRequest({ name: 'Create user', method: 'POST', url: 'https://api.test/users' })),
      ],
    });
    const user = userEvent.setup();
    render(<ApiClient client={mockClient().client} collections={[collection]} />);
    const tree = screen.getByRole('tree', { name: 'Collections' });
    const first = within(tree).getByRole('treeitem', { name: 'Demo' });
    first.focus();
    await user.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(screen.getByRole('textbox', { name: 'Request name' })).toHaveValue('Create user');
    expect(screen.getByRole('combobox', { name: 'HTTP method' })).toHaveValue('POST');
    // Collapsing with ArrowLeft hides the children.
    await user.keyboard('{ArrowUp}{ArrowUp}{ArrowLeft}');
    expect(within(tree).queryByRole('treeitem', { name: /List users/ })).not.toBeInTheDocument();
  });

  it('asks for confirmation before deleting a collection', async () => {
    const workspace = createWorkspace({ client: mockClient().client, collections: [createCollection('To delete')] });
    const user = userEvent.setup();
    render(<ApiClient workspace={workspace} />);
    await user.click(screen.getByRole('button', { name: 'Actions for To delete' }));
    await user.click(screen.getByRole('menuitem', { name: /Delete/ }));
    const dialog = screen.getByRole('dialog', { name: 'Delete collection?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(workspace.getState().collections).toHaveLength(0);
    expect(await screen.findByText('No collections yet')).toBeInTheDocument();
  });

  it('switches environments and masks secret values', async () => {
    const workspace = createWorkspace({
      client: mockClient().client,
      environments: [
        { id: 'dev', name: 'Development', variables: [{ key: 'apiToken', value: 's3cret', secret: true }] },
        { id: 'prod', name: 'Production', variables: [] },
      ],
    });
    const user = userEvent.setup();
    render(<ApiClient workspace={workspace} />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Active environment' }), 'prod');
    expect(workspace.getState().activeEnvironmentId).toBe('prod');

    await user.click(screen.getByRole('tab', { name: /Envs/ }));
    await user.click(screen.getByRole('button', { name: 'Development' }));
    const value = screen.getByRole('table', { name: 'Variables of Development' }).querySelector('input[type="password"]');
    expect(value).toHaveValue('s3cret');
    await user.click(screen.getByRole('button', { name: 'Show value of apiToken' }));
    expect(screen.getByDisplayValue('s3cret')).toHaveAttribute('type', 'text');
  });

  it('closes dialogs with Escape and returns focus', async () => {
    const user = userEvent.setup();
    render(<ApiClient client={mockClient().client} />);
    const trigger = screen.getByRole('button', { name: 'Keyboard shortcuts' });
    await user.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('toggles the theme', async () => {
    const onThemeChange = vi.fn();
    const user = userEvent.setup();
    const { container } = render(<ApiClient client={mockClient().client} onThemeChange={onThemeChange} />);
    expect(container.querySelector('.m2a')).toHaveAttribute('data-theme', 'light');
    await user.click(screen.getByRole('button', { name: 'Switch to dark theme' }));
    expect(container.querySelector('.m2a')).toHaveAttribute('data-theme', 'dark');
    expect(onThemeChange).toHaveBeenCalledWith('dark');
  });

  it('opens and closes request tabs with the keyboard', async () => {
    const workspace = createWorkspace({ client: mockClient().client, initialRequest: { url: 'https://api.test/a' } });
    const user = userEvent.setup();
    render(<ApiClient workspace={workspace} />);
    await user.click(screen.getByRole('button', { name: 'New request' }));
    const list = screen.getByRole('tablist', { name: 'Open requests' });
    expect(within(list).getAllByRole('tab')).toHaveLength(2);
    within(list).getAllByRole('tab')[1].focus();
    await user.keyboard('{ArrowLeft}');
    expect(within(list).getAllByRole('tab')[0]).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{Delete}');
    expect(within(list).getAllByRole('tab')).toHaveLength(1);
  });
});

describe('<RequestBuilder> (controlled)', () => {
  function Controlled({ onSend }: { onSend: (r: RequestDefinition) => void }) {
    const [request, setRequest] = useStateful(createRequest({ method: 'POST', url: 'https://api.test/{{path}}' }));
    return <RequestBuilder request={request} onRequestChange={setRequest} onSend={onSend} variables={{ path: 'items' }} />;
  }

  it('edits headers, switches tabs with arrow keys and resolves variables', async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<Controlled onSend={onSend} />);
    expect(screen.getByText('https://api.test/items')).toBeInTheDocument();

    const params = screen.getByRole('tab', { name: 'Params' });
    params.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /Headers/ })).toHaveAttribute('aria-selected', 'true');
    await user.type(screen.getByRole('combobox', { name: 'Header 1 header' }), 'X-Trace');
    await user.type(screen.getByRole('textbox', { name: 'Header 1 value' }), 'abc');

    await user.click(screen.getByRole('button', { name: /^Send/ }));
    const sent = onSend.mock.calls[0][0] as RequestDefinition;
    expect(sent.headers[0]).toMatchObject({ key: 'X-Trace', value: 'abc', enabled: true });
  });

  it('validates and formats the JSON body', async () => {
    const user = userEvent.setup();
    render(<Controlled onSend={() => {}} />);
    await user.click(screen.getByRole('tab', { name: /Body/ }));
    await user.click(screen.getByRole('radio', { name: 'JSON' }));
    const editor = screen.getByRole('textbox', { name: 'JSON body' });
    fireEvent.change(editor, { target: { value: '{"a":' } });
    expect((await screen.findAllByText(/Unexpected end of JSON input/)).length).toBeGreaterThan(0);
    fireEvent.change(editor, { target: { value: '{"a":1,"b":[1,2]}' } });
    expect(screen.getByText('Valid JSON')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Format/ }));
    expect(editor).toHaveValue('{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}');
  });
});

describe('<ResponseViewer> (controlled)', () => {
  it('shows an empty state before the first request', () => {
    render(<ResponseViewer response={null} />);
    expect(screen.getByText('No response yet')).toBeInTheDocument();
  });

  it('shows status, size, timing, headers and a tree view', async () => {
    const user = userEvent.setup();
    render(<ResponseViewer response={makeResponse()} />);
    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.getByText('42 ms')).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /Headers/ }));
    expect(screen.getByRole('button', { name: 'Copy header x-request-id' })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: 'Tree' }));
    expect(screen.getByRole('group', { name: 'JSON tree' })).toHaveTextContent('"Ada"');
    await user.click(screen.getByRole('tab', { name: 'Request' }));
    expect(screen.getByText('Bearer ••••••')).toBeInTheDocument();
  });

  it('searches the body and steps through matches with Enter', async () => {
    const user = userEvent.setup();
    render(<ResponseViewer response={makeResponse({ text: '{"a":"x","b":"x","c":"x"}' })} />);
    await user.type(screen.getByRole('searchbox', { name: 'Search response' }), '"x"');
    expect(screen.getByText('1/3')).toBeInTheDocument();
    await user.keyboard('{Enter}');
    expect(screen.getByText('2/3')).toBeInTheDocument();
    await user.keyboard('{Shift>}{Enter}{/Shift}{Shift>}{Enter}{/Shift}');
    expect(screen.getByText('3/3')).toBeInTheDocument();
  });

  it('handles empty, non-JSON, invalid JSON and binary bodies', () => {
    const { rerender } = render(
      <ResponseViewer
        response={makeResponse({
          status: 204,
          statusText: 'No Content',
          text: null,
          data: undefined,
          bodyKind: 'empty',
          size: 0,
          raw: null,
          contentType: null,
        })}
      />,
    );
    expect(screen.getByText('Empty response body')).toBeInTheDocument();

    rerender(
      <ResponseViewer response={makeResponse({ text: 'plain text', data: 'plain text', bodyKind: 'text', contentType: 'text/plain' })} />,
    );
    expect(screen.getByRole('tab', { name: 'Body' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Tree' })).toBeDisabled();

    rerender(
      <ResponseViewer
        response={makeResponse({ text: '{"broken', data: '{"broken', parseError: 'Unexpected end', timing: { startTime: 1, duration: 3 } })}
      />,
    );
    expect(screen.getByText(/body is not valid JSON/)).toBeInTheDocument();

    rerender(
      <ResponseViewer
        response={makeResponse({
          text: null,
          data: new Blob([]),
          bodyKind: 'binary',
          contentType: 'application/zip',
          size: 2048,
          timing: { startTime: 2, duration: 3 },
        })}
      />,
    );
    expect(screen.getByText(/Binary response/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Download/ }).length).toBeGreaterThan(0);
  });

  it('shows timeout errors with a hint', () => {
    render(<ResponseViewer error={new ApiError('timeout', 'Request timed out after 2 s', { hint: 'Increase the timeout.' })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Request timed out');
    expect(screen.getByRole('alert')).toHaveTextContent('Increase the timeout.');
  });

  it('renders HTML previews sanitized in a sandboxed frame', async () => {
    const user = userEvent.setup();
    const html = '<h1 onclick="alert(1)">Hi</h1><script>alert(1)</script>';
    render(<ResponseViewer response={makeResponse({ text: html, data: html, bodyKind: 'text', contentType: 'text/html' })} />);
    await user.click(screen.getByRole('tab', { name: 'Preview' }));
    const frame = screen.getByTitle('HTML preview of the response');
    expect(frame).toHaveAttribute('sandbox', '');
    expect(frame.getAttribute('srcdoc')).toContain('<h1>Hi</h1>');
    expect(frame.getAttribute('srcdoc')).not.toContain('script>alert');
  });
});

describe('sanitizeHtml', () => {
  it('removes scripts, handlers, frames and script URLs and adds a CSP', () => {
    const out = sanitizeHtml(
      '<a href="java\tscript:alert(1)">x</a><img src="x" onerror="alert(1)"><iframe src="https://evil.test"></iframe><a href="https://ok.test">ok</a><img src="data:text/html,<script>">',
    );
    expect(out).not.toMatch(/javascript|onerror|iframe|data:text/);
    expect(out).toContain('href="https://ok.test"');
    expect(out).toContain('Content-Security-Policy');
  });
});

describe('useApiRequest', () => {
  function Probe({ client }: { client: ReturnType<typeof createApiClient> }) {
    const { execute, data, loading, error, cancel, status } = useApiRequest<{ id: number }>({ client });
    return (
      <div>
        <button onClick={() => void execute({ url: 'https://api.test/users/1', headers: { Accept: 'application/json' } })}>load</button>
        <button onClick={() => void execute('https://api.test/fail')}>fail</button>
        <button onClick={cancel}>cancel</button>
        <span data-testid="status">{status}</span>
        {loading && <span>busy</span>}
        {error && <p role="alert">{error.kind}</p>}
        {data && <pre>{data.id}</pre>}
      </div>
    );
  }

  it('tracks loading, data, http errors and cancellation', async () => {
    const { client } = mockClient((req) =>
      req.url.endsWith('/fail') ? { status: 500, body: { error: 'boom' } } : { body: { id: 7 }, delay: 20 },
    );
    const user = userEvent.setup();
    render(<Probe client={client} />);

    await user.click(screen.getByText('load'));
    expect(screen.getByText('busy')).toBeInTheDocument();
    expect(await screen.findByText('7')).toBeInTheDocument();

    await user.click(screen.getByText('fail'));
    expect(await screen.findByRole('alert')).toHaveTextContent('http');

    await user.click(screen.getByText('load'));
    await user.click(screen.getByText('cancel'));
    await act(() => new Promise((r) => setTimeout(r, 40)));
    expect(screen.getByTestId('status')).not.toHaveTextContent('loading');
  });
});

// Minimal useState wrapper so the controlled test component stays readable.
import { useState } from 'react';
function useStateful<T>(initial: T) {
  return useState(initial);
}
