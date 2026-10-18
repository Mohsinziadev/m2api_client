import { ApiClient } from 'm2api-client';
import 'm2api-client/styles.css';

export default function App() {
  return (
    <div style={{ height: '100vh' }}>
      <ApiClient baseUrl="https://jsonplaceholder.typicode.com" theme="light" initialMethod="GET" initialUrl="{{baseUrl}}/users/1" />
    </div>
  );
}
