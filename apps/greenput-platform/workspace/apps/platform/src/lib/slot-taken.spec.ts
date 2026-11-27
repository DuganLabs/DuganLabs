import { describe, expect, it } from 'vitest';
import { ApiError } from '@basenative/fetch';
import { isSlotTaken } from './slot-taken';

describe('isSlotTaken', () => {
  it('recognises the API 409 SLOT_TAKEN', () => {
    const err = new ApiError('That time just went — pick another', {
      status: 409,
      code: 'SLOT_TAKEN',
      url: '/api/jobs',
    });
    expect(isSlotTaken(err)).toBe(true);
    expect(err.message).toBe('That time just went — pick another');
  });

  it('recognises it structurally, without instanceof', () => {
    expect(
      isSlotTaken({ name: 'ApiError', status: 409, code: 'SLOT_TAKEN' }),
    ).toBe(true);
  });

  it('is false for other API errors and for non-errors', () => {
    expect(
      isSlotTaken(
        new ApiError('Job not found', {
          status: 404,
          code: 'NOT_FOUND',
          url: '/api/jobs/x',
        }),
      ),
    ).toBe(false);
    expect(isSlotTaken(new Error('offline'))).toBe(false);
    expect(isSlotTaken(null)).toBe(false);
    expect(isSlotTaken('SLOT_TAKEN')).toBe(false);
  });
});
