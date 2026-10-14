/** Thin fetch wrapper for the API. Same origin, cookie session, JSON in and out. */

export interface FieldIssue {
  path: string;
  message: string;
}

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

  /** Field-level validation problems keyed by field path. */
  fieldErrors(): Record<string, string> {
    if (!Array.isArray(this.details)) return {};
    const result: Record<string, string> = {};
    for (const issue of this.details as FieldIssue[]) {
      if (typeof issue?.path === 'string' && typeof issue.message === 'string' && result[issue.path] === undefined) {
        result[issue.path] = issue.message;
      }
    }
    return result;
  }
}

/** Fired when the session ended (expired, revoked, deactivated) so the app can send the person to sign in. */
export const SESSION_ENDED_EVENT = 'clinic:session-ended';
export const ORG_SUSPENDED_EVENT = 'clinic:organization-suspended';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export async function api<T>(method: Method, path: string, body?: unknown, options: { idempotencyKey?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (options.idempotencyKey !== undefined) headers['Idempotency-Key'] = options.idempotencyKey;

  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method,
      headers,
      credentials: 'same-origin',
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(0, 'network', 'Cannot reach the server. Check the internet connection and try again.');
  }

  const text = await response.text();
  const data: unknown = text === '' ? undefined : safeJson(text);
  if (response.ok) return data as T;

  const error = (data as { error?: { code?: string; message?: string; details?: unknown; requestId?: string } } | undefined)?.error;
  const apiError = new ApiError(
    response.status,
    error?.code ?? 'error',
    error?.message ?? 'Something went wrong. Please try again.',
    error?.details,
    error?.requestId,
  );
  if (response.status === 401 && !path.startsWith('/auth/login')) {
    window.dispatchEvent(new CustomEvent(SESSION_ENDED_EVENT));
  }
  if (apiError.code === 'organization_suspended') {
    window.dispatchEvent(new CustomEvent(ORG_SUSPENDED_EVENT));
  }
  throw apiError;
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export const get = <T>(path: string) => api<T>('GET', path);
export const post = <T>(path: string, body?: unknown) => api<T>('POST', path, body ?? {});
export const put = <T>(path: string, body: unknown) => api<T>('PUT', path, body);

/** Readable message for any thrown value. */
export function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return 'Something went wrong. Please try again.';
}
