import { useApiRequest } from 'm2api-client';

interface User {
  id: number;
  name: string;
  email: string;
}

export function UserProfile() {
  const { execute, data, loading, error } = useApiRequest<User>();

  async function loadUser() {
    await execute({
      url: 'https://jsonplaceholder.typicode.com/users/1',
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
    });
  }

  return (
    <div>
      <button onClick={loadUser} disabled={loading}>
        {loading ? 'Loading...' : 'Load user'}
      </button>

      {error && <p role="alert">{error.message}</p>}

      {data !== undefined && <pre>{JSON.stringify(data, null, 2)}</pre>}
    </div>
  );
}
