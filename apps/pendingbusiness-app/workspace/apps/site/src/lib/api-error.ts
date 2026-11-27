/**
 * The worker's error envelope carries a sentence meant for a person — the
 * 409 explaining that a filing status has no 2026 brackets yet, the 400
 * naming which household field is out of range. It used to be thrown away in
 * favour of "HTTP 409", which tells the reader nothing they can act on. Falls
 * back to the status code when the body isn't the shape we expect.
 */
export async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.clone().json()) as { error?: { message?: string } | string };
    const message = typeof body.error === 'string' ? body.error : body.error?.message;
    if (typeof message === 'string' && message.length > 0) return message;
  } catch {
    /* not JSON — fall through to the status code */
  }
  return `HTTP ${res.status}`;
}

/** The field the worker's envelope names, if any — for `aria-invalid` on the control. */
export async function errorField(res: Response): Promise<string | null> {
  try {
    const body = (await res.clone().json()) as { error?: { field?: string } };
    return typeof body.error?.field === 'string' ? body.error.field : null;
  } catch {
    return null;
  }
}
