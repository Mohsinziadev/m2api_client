import { createApiClient, isApiError, type Middleware } from 'm2api-client';

// Adds a request id and logs status + timing. Never log `request.headers`: they may contain credentials.
const logging: Middleware = async (request, next) => {
  const response = await next({ ...request, headers: { ...request.headers, 'X-Request-Id': crypto.randomUUID() } });
  console.info(`${request.method} ${response.status} in ${Math.round(response.timing.duration)} ms`);
  return response;
};

export const api = createApiClient({
  baseUrl: 'https://jsonplaceholder.typicode.com',
  headers: { Accept: 'application/json' },
  timeout: 10_000,
  middleware: [logging],
});

export interface Post {
  id: number;
  title: string;
  body: string;
  userId: number;
}

export async function loadPosts(userId: number): Promise<Post[]> {
  try {
    const { data } = await api.get<Post[]>('/posts', { params: { userId } });
    return data;
  } catch (error) {
    if (isApiError(error) && error.kind === 'http' && error.status === 404) return [];
    throw error;
  }
}

export async function createPost(post: Omit<Post, 'id'>): Promise<Post> {
  // Plain objects are sent as JSON with Content-Type: application/json.
  const { data } = await api.post<Post>('/posts', post);
  return data;
}
