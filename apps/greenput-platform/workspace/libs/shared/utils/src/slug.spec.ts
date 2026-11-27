import { describe, it, expect } from 'vitest';
import { generateSlug, isValidSlug } from './slug';

describe('generateSlug', () => {
  it('lowercases and replaces spaces with hyphens', () => {
    expect(generateSlug('Hello World')).toBe('hello-world');
  });

  it('replaces special characters with hyphens', () => {
    expect(generateSlug("Bob's Plumbing & Co.")).toBe('bob-s-plumbing-co');
  });

  it('collapses multiple hyphens', () => {
    expect(generateSlug('a   b   c')).toBe('a-b-c');
  });

  it('trims leading and trailing hyphens', () => {
    expect(generateSlug('  --hello--  ')).toBe('hello');
  });

  it('returns empty string for empty input', () => {
    expect(generateSlug('')).toBe('');
  });

  it('handles only special characters', () => {
    expect(generateSlug('!@#$%')).toBe('');
  });

  it('handles numeric input', () => {
    expect(generateSlug('Area 51')).toBe('area-51');
  });

  it('handles already-slugified input', () => {
    expect(generateSlug('already-a-slug')).toBe('already-a-slug');
  });

  it('handles all uppercase input', () => {
    expect(generateSlug('ABC DEF')).toBe('abc-def');
  });

  it('handles numeric-only input', () => {
    expect(generateSlug('123')).toBe('123');
  });

  it('strips Unicode/accented characters', () => {
    expect(generateSlug('Café')).toBe('caf');
  });

  it('handles forward slashes as separators', () => {
    expect(generateSlug('foo/bar')).toBe('foo-bar');
  });

  it('handles leading whitespace', () => {
    expect(generateSlug('  leading space')).toBe('leading-space');
  });

  it('handles business name with ampersand', () => {
    expect(generateSlug('Smith & Sons HVAC')).toBe('smith-sons-hvac');
  });
});

describe('isValidSlug', () => {
  it('returns true for a valid slug', () => {
    expect(isValidSlug('hello-world')).toBe(true);
  });

  it('returns true for single word', () => {
    expect(isValidSlug('hello')).toBe(true);
  });

  it('returns true for numbers', () => {
    expect(isValidSlug('area-51')).toBe(true);
  });

  it('returns false for empty string', () => {
    expect(isValidSlug('')).toBe(false);
  });

  it('returns false for uppercase letters', () => {
    expect(isValidSlug('Hello')).toBe(false);
  });

  it('returns false for spaces', () => {
    expect(isValidSlug('hello world')).toBe(false);
  });

  it('returns false for leading hyphen', () => {
    expect(isValidSlug('-hello')).toBe(false);
  });

  it('returns false for trailing hyphen', () => {
    expect(isValidSlug('hello-')).toBe(false);
  });

  it('returns false for consecutive hyphens', () => {
    expect(isValidSlug('hello--world')).toBe(false);
  });

  it('returns false for special characters', () => {
    expect(isValidSlug('hello_world')).toBe(false);
  });

  it('returns true for numeric-only slug', () => {
    expect(isValidSlug('123')).toBe(true);
  });

  it('returns true for alphanumeric mixed slug', () => {
    expect(isValidSlug('a1b2c3')).toBe(true);
  });

  it('returns true for single lowercase letter', () => {
    expect(isValidSlug('a')).toBe(true);
  });

  it('returns false for dots', () => {
    expect(isValidSlug('hello.world')).toBe(false);
  });

  it('returns false for slash', () => {
    expect(isValidSlug('hello/world')).toBe(false);
  });
});
