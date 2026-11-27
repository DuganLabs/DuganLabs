import { describe, it, expect, beforeEach } from 'vitest';
import { withSubmitting } from '../src/lib/forms.js';

beforeEach(() => {
  document.body.innerHTML = '';
});

function makeForm(): { form: HTMLFormElement; submit: HTMLButtonElement } {
  document.body.innerHTML =
    '<form id="f"><input name="x"/><button type="submit">Save</button></form>';
  const form = document.getElementById('f') as HTMLFormElement;
  const submit = form.querySelector('button[type="submit"]') as HTMLButtonElement;
  return { form, submit };
}

describe('withSubmitting', () => {
  it('disables the submit button while the work is pending', async () => {
    const { form, submit } = makeForm();
    let observedDisabled = false;
    await withSubmitting(form, async () => {
      observedDisabled = submit.disabled;
    });
    expect(observedDisabled).toBe(true);
    expect(submit.disabled).toBe(false);
  });

  it('sets aria-busy="true" on the form during the work', async () => {
    const { form } = makeForm();
    let observedBusy: string | null = null;
    await withSubmitting(form, async () => {
      observedBusy = form.getAttribute('aria-busy');
    });
    expect(observedBusy).toBe('true');
    expect(form.hasAttribute('aria-busy')).toBe(false);
  });

  it('restores button + aria-busy even when the work rejects', async () => {
    const { form, submit } = makeForm();
    await expect(
      withSubmitting(form, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(submit.disabled).toBe(false);
    expect(form.hasAttribute('aria-busy')).toBe(false);
  });

  it('returns the work function value', async () => {
    const { form } = makeForm();
    const result = await withSubmitting(form, async () => 42);
    expect(result).toBe(42);
  });

  it('does not re-enable a button that was already disabled by the caller', async () => {
    const { form, submit } = makeForm();
    submit.disabled = true;
    await withSubmitting(form, async () => {});
    expect(submit.disabled).toBe(true);
  });
});
