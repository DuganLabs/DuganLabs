import { describe, expect, it } from 'vitest';
import { stylesheetVersion } from './css.js';

describe('stylesheetVersion', () => {
  it('is eight hex characters and follows the sheet', () => {
    const first = stylesheetVersion('body{color:red}');
    expect(first).toMatch(/^[0-9a-f]{8}$/);
    expect(stylesheetVersion('body{color:red}')).toBe(first);
    expect(stylesheetVersion('body{color:blue}')).not.toBe(first);
  });
});
