/** A failure reported by the API, with the stable code the server uses. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Query = Record<string, string | number | boolean | undefined | null>;

let onUnauthorized: (() => void) | undefined;

/** Called when the server says the session ended, so the app can return to the sign-in page. */
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

function withQuery(path: string, query?: Query): string {
  if (query === undefined) return path;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') params.set(key, String(value));
  }
  const text = params.toString();
  return text === '' ? path : `${path}?${text}`;
}

async function request<T>(method: string, path: string, options: { body?: unknown; form?: FormData; query?: Query; headers?: Record<string, string> } = {}): Promise<T> {
  const headers: Record<string, string> = { ...options.headers };
  let body: BodyInit | undefined;
  if (options.form !== undefined) {
    body = options.form;
  } else if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(options.body);
  }

  let response: Response;
  try {
    response = await fetch(`/api${withQuery(path, options.query)}`, { method, headers, body, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'network', 'Cannot reach the server. Check the internet connection and try again.');
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  let data: unknown = null;
  if (text !== '') {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }

  if (!response.ok) {
    const failure = (data as { error?: { code?: string; message?: string; details?: unknown; requestId?: string } } | null)?.error;
    const error = new ApiError(
      response.status,
      failure?.code ?? 'error',
      failure?.message ?? 'Something went wrong. Please try again.',
      failure?.details,
      failure?.requestId,
    );
    if (response.status === 401 && path !== '/auth/login') onUnauthorized?.();
    throw error;
  }
  return data as T;
}

export const api = {
  get: <T>(path: string, query?: Query) => request<T>('GET', path, { query }),
  post: <T>(path: string, body?: unknown, headers?: Record<string, string>) => request<T>('POST', path, { body: body ?? {}, headers }),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, { body }),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, { body }),
  del: <T = void>(path: string) => request<T>('DELETE', path),
  upload: <T>(path: string, form: FormData, query?: Query) => request<T>('POST', path, { form, query }),
};
