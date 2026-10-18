import {
  ApiClientProvider,
  CollectionExplorer,
  EnvironmentSelector,
  RequestBuilder,
  ResponseViewer,
  ThemeProvider,
  useApiClient,
} from 'm2api-client';
import 'm2api-client/styles.css';

function Toolbar() {
  const { state, actions } = useApiClient();
  return (
    <div style={{ display: 'flex', gap: 8, padding: 8, alignItems: 'center' }}>
      <EnvironmentSelector />
      <button type="button" onClick={() => actions.newTab({ method: 'GET', url: '{{baseUrl}}/todos/1' })}>
        New todo request
      </button>
      <span>{state.history.length} sent</span>
    </div>
  );
}

/** Build your own layout from the individual panels. They share one workspace store. */
export function ComposedLayout() {
  return (
    <ApiClientProvider
      baseUrl="https://jsonplaceholder.typicode.com"
      environments={[{ id: 'dev', name: 'Development', variables: [{ key: 'userId', value: '1' }] }]}
      initialRequest={{ method: 'GET', url: '{{baseUrl}}/users/{{userId}}' }}
    >
      <ThemeProvider theme="system" style={{ display: 'grid', gridTemplateColumns: '240px 1fr', height: 640 }}>
        <CollectionExplorer />
        <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr 1fr', minHeight: 0 }}>
          <Toolbar />
          <RequestBuilder />
          <ResponseViewer />
        </div>
      </ThemeProvider>
    </ApiClientProvider>
  );
}
