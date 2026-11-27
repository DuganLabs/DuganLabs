import { error } from './response';

/**
 * 409 for a direct price edit on something that now changes only through a
 * change order (POST /api/change-orders). Shared by the jobs and estimates
 * PATCH routes so the code and wording stay the same.
 */
export function changeOrderRequired(kind: 'job' | 'estimate'): Response {
  return error(
    kind === 'job'
      ? "A job's line items and total change only through a change order."
      : "A sent estimate's line items and tax change only through a change order.",
    409,
    'CHANGE_ORDER_REQUIRED',
  );
}
