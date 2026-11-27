import { describe, expect, it } from 'vitest';
import { GP4_SPRITE } from './gp4-sprite.js';

describe('gp4 sprite', () => {
  it('is one hidden svg symbol sheet', () => {
    expect(GP4_SPRITE.startsWith('<svg')).toBe(true);
    expect(GP4_SPRITE).toContain('hidden');
    expect(GP4_SPRITE).toContain('aria-hidden="true"');
    expect(GP4_SPRITE.match(/<symbol /g)?.length).toBeGreaterThan(10);
  });
});
