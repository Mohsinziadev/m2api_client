import { useState } from 'react';
import { createRequest, prepareDefinition, RequestBuilder, ResponseViewer, useApiRequest, type RequestDefinition } from 'm2api-client';
import 'm2api-client/styles.css';

/** RequestBuilder and ResponseViewer without a workspace: you own the state. */
export function ControlledEditor() {
  const [request, setRequest] = useState<RequestDefinition>(() =>
    createRequest({ method: 'POST', url: 'https://httpbin.org/anything', body: { type: 'json', content: '{\n  "hello": "{{name}}"\n}' } }),
  );
  const variables = { name: 'world' };
  const { execute, response, error, loading, cancel } = useApiRequest({ validateStatus: null });

  const send = (definition: RequestDefinition) => {
    const prepared = prepareDefinition(definition, { variables });
    // `PreparedRequest` is accepted by `client.send`; useApiRequest takes a config, so pass the resolved parts.
    void execute({ url: prepared.url, method: prepared.method, headers: prepared.headers, body: prepared.body, timeout: prepared.timeout });
  };

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <RequestBuilder
        request={request}
        onRequestChange={setRequest}
        onSend={send}
        onCancel={cancel}
        loading={loading}
        variables={variables}
      />
      <ResponseViewer response={response ?? null} error={error} loading={loading} onCancel={cancel} />
    </div>
  );
}
