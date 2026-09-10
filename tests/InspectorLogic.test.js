import { describe, it, expect } from 'vitest';
import { reorderRules } from '../js/InspectorLogic.js';

describe('reorderRules', () => {
  it('moves a rule from one index to another, preserving the rest in order', () => {
    const rules = [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }];
    const result = reorderRules(rules, 2, 0);
    expect(result.map((r) => r.id)).toEqual(['r3', 'r1', 'r2']);
  });

  it('moves a rule to the front', () => {
    const rules = [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }];
    const result = reorderRules(rules, 2, 0);
    expect(result.map((r) => r.id)).toEqual(['r3', 'r1', 'r2']);
  });

  it('moves a rule to the back', () => {
    const rules = [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }];
    const result = reorderRules(rules, 0, 3);
    expect(result.map((r) => r.id)).toEqual(['r2', 'r3', 'r1']);
  });

  it('swaps two adjacent rules', () => {
    const rules = [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }];
    const result = reorderRules(rules, 0, 1);
    expect(result.map((r) => r.id)).toEqual(['r2', 'r1', 'r3']);
  });

  it('does not mutate the original array', () => {
    const rules = [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }];
    const original = [...rules];
    reorderRules(rules, 0, 2);
    expect(rules).toEqual(original);
  });

  it('returns the same array when indices are invalid', () => {
    const rules = [{ id: 'r1' }, { id: 'r2' }];
    expect(reorderRules(rules, -1, 0)).toEqual(rules);
    expect(reorderRules(rules, 0, -1)).toEqual(rules);
    expect(reorderRules(rules, 5, 0)).toEqual(rules);
    expect(reorderRules(rules, 0, 5)).toEqual(rules);
  });

  it('returns the same array when given non-array input', () => {
    expect(reorderRules(null, 0, 1)).toEqual(null);
    expect(reorderRules(undefined, 0, 1)).toEqual(undefined);
    expect(reorderRules({}, 0, 1)).toEqual({});
  });

  it('handles a single-element array', () => {
    const rules = [{ id: 'r1' }];
    const result = reorderRules(rules, 0, 0);
    expect(result.map((r) => r.id)).toEqual(['r1']);
  });

  it('handles moving an element to the same position', () => {
    const rules = [{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }];
    const result = reorderRules(rules, 1, 1);
    expect(result.map((r) => r.id)).toEqual(['r1', 'r2', 'r3']);
  });

  it('preserves rule object structure during reordering', () => {
    const rules = [
      { when: { state: 'temp', gt: 100 }, style: { typography: { color: '#f00' } } },
      { when: { state: 'pressure', lt: 50 }, style: { typography: { color: '#0f0' } } },
      { when: { state: 'speed', gte: 200 }, style: { typography: { color: '#00f' } } }
    ];
    const result = reorderRules(rules, 2, 0);
    expect(result.map((r) => r.when.state)).toEqual(['speed', 'temp', 'pressure']);
    expect(result[0].style.typography.color).toEqual('#00f');
  });
});
