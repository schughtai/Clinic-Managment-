import { z } from 'zod';
import { badRequest } from './errors';

/** Parses untrusted input and raises a 400 with a field-level list of problems. */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    throw badRequest('validation_failed', 'Some fields are not valid.', issues);
  }
  return result.data;
}

export const uuidSchema = z.string().uuid();

export function parseId(value: unknown): string {
  return parse(uuidSchema, value);
}

/** Empty strings from forms become undefined so optional fields behave predictably. */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((value) => (value === undefined || value === '' ? undefined : value));

/** Null clears the stored value, undefined leaves it alone, an empty string clears it. */
export const nullableText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullable()
    .optional()
    .transform((value) => (value === undefined ? undefined : value === null || value === '' ? null : value));

export const pageSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).max(100_000).default(0),
});

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD.');
