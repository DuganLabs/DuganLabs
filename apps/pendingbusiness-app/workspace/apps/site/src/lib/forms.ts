/**
 * Form submission helpers.
 *
 * `withSubmitting` wraps an async submit handler with two affordances:
 *   - The form's submit button (`button[type="submit"]`) is disabled
 *     while the work is in flight, preventing double-submission.
 *   - The form gets `aria-busy="true"`, which lets screen readers and
 *     CSS (`form[aria-busy="true"]`) react to the loading state.
 *
 * Both are restored in `finally`, so a thrown error or rejected promise
 * still leaves the form interactive again.
 *
 * Usage:
 *
 *   form.addEventListener('submit', async event => {
 *     event.preventDefault();
 *     await withSubmitting(form, async () => {
 *       const res = await apiFetch('/api/x', { ... });
 *       // ...
 *     });
 *   });
 */

export async function withSubmitting<T>(form: HTMLFormElement, work: () => Promise<T>): Promise<T> {
  const submitBtn = form.querySelector<HTMLButtonElement>('button[type="submit"]');
  // Avoid clobbering a button that the caller already disabled (e.g. when
  // a separate input gates submission); we only re-enable buttons we
  // ourselves disabled.
  const wasEnabled = submitBtn ? !submitBtn.disabled : false;
  if (submitBtn && wasEnabled) submitBtn.disabled = true;
  form.setAttribute('aria-busy', 'true');
  try {
    return await work();
  } finally {
    if (submitBtn && wasEnabled) submitBtn.disabled = false;
    form.removeAttribute('aria-busy');
  }
}
