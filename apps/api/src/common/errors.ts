/** An expected failure with a stable code that clients can rely on. */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const badRequest = (code: string, message: string, details?: unknown): AppError =>
  new AppError(400, code, message, details);
export const unauthorized = (message = 'Please sign in again.'): AppError =>
  new AppError(401, 'unauthorized', message);
export const forbidden = (message = 'You do not have permission to do this.'): AppError =>
  new AppError(403, 'forbidden', message);
export const notFound = (what: string): AppError => new AppError(404, 'not_found', `${what} was not found.`);
export const conflict = (code: string, message: string, details?: unknown): AppError =>
  new AppError(409, code, message, details);
export const unprocessable = (code: string, message: string, details?: unknown): AppError =>
  new AppError(422, code, message, details);
