/**
 * Unit tests for parseStringOrArray utility.
 * Run: npm test
 */
import { describe, it, expect } from 'vitest';
import { parseStringOrArray } from '../src/utils/parseStringOrArray';

describe('parseStringOrArray', () => {
  it('returns array when input is array', () => {
    expect(parseStringOrArray(['a', 'b'])).toEqual(['a', 'b']);
    expect(parseStringOrArray([])).toEqual([]);
    expect(parseStringOrArray(['1', '0'])).toEqual(['1', '0']);
  });

  it('parses JSON string to array', () => {
    expect(parseStringOrArray('["a","b"]')).toEqual(['a', 'b']);
    expect(parseStringOrArray('["1","0"]')).toEqual(['1', '0']);
    expect(parseStringOrArray('[]')).toEqual([]);
  });

  it('returns empty array for invalid JSON string', () => {
    expect(parseStringOrArray('{invalid}')).toEqual([]);
    expect(parseStringOrArray('')).toEqual([]);
  });

  it('returns empty array when parsed JSON is not array', () => {
    expect(parseStringOrArray('{"foo":"bar"}')).toEqual([]);
    expect(parseStringOrArray('123')).toEqual([]);
  });

  it('returns only string elements from mixed array', () => {
    expect(parseStringOrArray(['a', 1, null, 'b'])).toEqual(['a', 'b']);
    expect(parseStringOrArray(['1', 0, undefined, '0'])).toEqual(['1', '0']);
  });

  it('returns empty array for non-string non-array input', () => {
    expect(parseStringOrArray(null)).toEqual([]);
    expect(parseStringOrArray(undefined)).toEqual([]);
    expect(parseStringOrArray(42)).toEqual([]);
    expect(parseStringOrArray(true)).toEqual([]);
  });
});
