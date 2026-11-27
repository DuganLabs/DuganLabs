import { describe, expect, it } from 'vitest';
import { slotTaken } from './job-slots';

// The guard itself — slotStartsFor, isSlotConflict, bookInFreeLane over the
// real schema — is tested where it lives, libs/shared/scheduling/src/job-slots.spec.ts.
// Only the HTTP answer is this Worker's.
describe('slotTaken', () => {
  it('is a 409 SLOT_TAKEN with the message the platform shows', async () => {
    const res = slotTaken();
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: {
        code: 'SLOT_TAKEN',
        message: 'That time just went — pick another',
      },
    });
  });
});
