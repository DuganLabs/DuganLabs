import type { ZodType } from 'zod';
import type { IRequest } from 'itty-router';
import { error } from '../lib/response';

/**
 * Validation middleware for itty-router.
 * Parses the request JSON body against a Zod schema.
 * On failure, returns a 400 response with field-level errors.
 * On success, attaches the parsed body to `req.validatedBody`.
 */
export function validate<T>(schema: ZodType<T>) {
  return async (req: IRequest): Promise<Response | void> => {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return error('Invalid JSON body', 400, 'INVALID_JSON');
    }

    const result = schema.safeParse(body);

    if (!result.success) {
      const issues = result.error.issues;
      const firstIssue = issues[0];
      const field = firstIssue?.path?.join('.') || undefined;
      const message = firstIssue?.message ?? 'Validation failed';

      return new Response(
        JSON.stringify({
          error: {
            code: 'VALIDATION_ERROR',
            message,
            field,
            details: issues.map((i) => ({
              field: i.path.join('.'),
              message: i.message,
            })),
          },
        }),
        {
          status: 400,
          headers: {
            'Content-Type': 'application/json',
            'X-Content-Type-Options': 'nosniff',
          },
        },
      );
    }

    (req as Record<string, unknown>)['validatedBody'] = result.data;
  };
}
