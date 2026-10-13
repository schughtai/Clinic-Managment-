import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Inject } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Logger } from 'pino';
import { LOGGER } from './tokens';
import { AppError } from './errors';

interface ClientError {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

/** Friendly messages for database rules that can be hit by normal use. */
const CONSTRAINT_ERRORS: Readonly<Record<string, ClientError>> = {
  users_phone_unique: { status: 409, code: 'phone_in_use', message: 'This phone number is already registered.' },
  appointments_no_overlap: {
    status: 409,
    code: 'slot_taken',
    message: 'That time is no longer available for this doctor.',
  },
  appointments_token_unique: { status: 409, code: 'conflict', message: 'Please try again.' },
  patients_no_unique: { status: 409, code: 'conflict', message: 'Please try again.' },
  invoices_no_unique: { status: 409, code: 'conflict', message: 'Please try again.' },
  prescription_templates_name_unique: {
    status: 409,
    code: 'name_in_use',
    message: 'A template with this name already exists.',
  },
  visits_appointment_unique: {
    status: 409,
    code: 'visit_exists',
    message: 'A visit was already recorded for this appointment.',
  },
  doctor_leaves_unique: { status: 409, code: 'already_exists', message: 'This day is already marked as leave.' },
  day_closings_unique: { status: 409, code: 'already_closed', message: 'This day has already been closed.' },
  payments_idempotency_unique: { status: 409, code: 'duplicate_request', message: 'This payment was already recorded.' },
};

interface PgLikeError {
  code: string;
  constraint?: string;
}

function isPgError(error: unknown): error is PgLikeError {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string' &&
    /^[0-9A-Z]{5}$/.test((error as { code: string }).code)
  );
}

function fromDatabase(error: PgLikeError): ClientError | null {
  const known = error.constraint === undefined ? undefined : CONSTRAINT_ERRORS[error.constraint];
  switch (error.code) {
    case '23505':
    case '23P01':
      return known ?? { status: 409, code: 'conflict', message: 'This record already exists or conflicts with another.' };
    case '23503':
      return { status: 409, code: 'in_use', message: 'This record is linked to other records.' };
    case '23514':
    case '22001':
    case '22003':
      return { status: 400, code: 'invalid_value', message: 'A value is outside the allowed range.' };
    case '22P02':
    case '22007':
    case '22008':
      return { status: 400, code: 'invalid_value', message: 'A value has the wrong format.' };
    case '57014':
    case '40P01':
    case '40001':
      return { status: 503, code: 'busy', message: 'The system is busy. Please try again.' };
    default:
      return null;
  }
}

function fromHttp(error: HttpException): ClientError {
  const status = error.getStatus();
  const codes: Readonly<Record<number, string>> = {
    400: 'bad_request',
    401: 'unauthorized',
    403: 'forbidden',
    404: 'not_found',
    413: 'payload_too_large',
    429: 'rate_limited',
  };
  const messages: Readonly<Record<number, string>> = {
    404: 'That address does not exist.',
    413: 'The request is too large.',
    429: 'Too many requests. Please wait a moment and try again.',
  };
  return {
    status,
    code: codes[status] ?? 'error',
    message: messages[status] ?? 'The request could not be completed.',
  };
}

/** Body parser failures carry a status and a type instead of being Nest exceptions. */
function fromParser(error: unknown): ClientError | null {
  if (typeof error !== 'object' || error === null) return null;
  const { status, type } = error as { status?: unknown; type?: unknown };
  if (typeof status !== 'number' || status < 400 || status >= 500 || typeof type !== 'string') return null;
  if (type === 'entity.too.large') {
    return { status: 413, code: 'payload_too_large', message: 'The request is too large.' };
  }
  return { status: 400, code: 'invalid_request', message: 'The request body could not be read.' };
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(@Inject(LOGGER) private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request>();
    const requestId = request.requestId;

    let client: ClientError | null = null;
    if (exception instanceof AppError) {
      client = { status: exception.status, code: exception.code, message: exception.message, details: exception.details };
    } else if (exception instanceof HttpException) {
      client = fromHttp(exception);
    } else if (isPgError(exception)) {
      client = fromDatabase(exception);
    } else {
      client = fromParser(exception);
    }

    if (client === null) {
      // An unexpected failure. Log everything useful, but tell the user nothing internal.
      this.logger.error({ err: exception, requestId, method: request.method, path: request.path }, 'unhandled error');
      client = { status: 500, code: 'internal_error', message: 'Something went wrong. Please try again.' };
    } else if (client.status >= 500) {
      this.logger.warn({ code: client.code, requestId, path: request.path }, 'service unavailable');
    }

    response.status(client.status).json({
      error: {
        code: client.code,
        message: client.message,
        ...(client.details === undefined ? {} : { details: client.details }),
        requestId,
      },
    });
  }
}
