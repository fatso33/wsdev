import { describe, it, expect } from 'vitest';
import { reorderRules, summarizeCondition } from '../js/InspectorLogic.js';

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

describe('summarizeCondition', () => {
  it('renders a single leaf condition in plain language', () => {
    const when = { state: 'fuel', lt: 10 };
    const summary = summarizeCondition(when);
    expect(summary).toContain('fuel');
    expect(summary).toContain('10');
  });

  it('renders an empty/unset condition as a clear empty-state string', () => {
    expect(summarizeCondition(null)).toBeTruthy();
    expect(summarizeCondition(undefined)).toBeTruthy();
    expect(summarizeCondition({})).toBeTruthy();
  });

  it('renders an AND group with multiple leaves', () => {
    const when = {
      allOf: [
        { state: 'fuel', lt: 10 },
        { state: 'engineRunning', equals: true }
      ]
    };
    const summary = summarizeCondition(when);
    expect(summary).toContain('fuel');
    expect(summary).toContain('10');
    expect(summary).toContain('engineRunning');
    expect(summary).toContain('AND');
  });

  it('renders an OR group with multiple leaves', () => {
    const when = {
      anyOf: [
        { state: 'altitude', gte: 10000 },
        { state: 'speed', gt: 100 }
      ]
    };
    const summary = summarizeCondition(when);
    expect(summary).toContain('altitude');
    expect(summary).toContain('10000');
    expect(summary).toContain('speed');
    expect(summary).toContain('100');
    expect(summary).toContain('OR');
  });

  it('handles different operators with correct symbols', () => {
    expect(summarizeCondition({ state: 'x', equals: 5 })).toContain('=');
    expect(summarizeCondition({ state: 'x', notEquals: 5 })).toContain('≠');
    expect(summarizeCondition({ state: 'x', lt: 5 })).toContain('<');
    expect(summarizeCondition({ state: 'x', lte: 5 })).toContain('≤');
    expect(summarizeCondition({ state: 'x', gt: 5 })).toContain('>');
    expect(summarizeCondition({ state: 'x', gte: 5 })).toContain('≥');
  });

  it('handles between operator with range', () => {
    const when = { state: 'temp', between: [50, 100] };
    const summary = summarizeCondition(when);
    expect(summary).toContain('temp');
    expect(summary).toContain('50');
    expect(summary).toContain('100');
  });

  it('handles a leaf with no operator set', () => {
    const when = { state: 'myVar', equals: '' };
    const summary = summarizeCondition(when);
    expect(summary).toContain('myVar');
  });

  it('handles empty state var name in a leaf condition', () => {
    const when = { state: '', equals: '' };
    const summary = summarizeCondition(when);
    expect(summary).toBe('No condition set');
    // Verify it's not a blank/whitespace-only string like " = "
    expect(summary).not.toMatch(/^\s*=\s*$/);
  });

  it('handles a group with empty-state leaves', () => {
    const when = { allOf: [{ state: '', equals: '' }] };
    const summary = summarizeCondition(when);
    expect(summary).toBe('No condition set');
    // Verify it's not a blank/whitespace-only string like " AND  = "
    expect(summary).not.toMatch(/\s*AND\s*/);
  });

  it('handles nested groups recursively', () => {
    const when = {
      allOf: [
        { state: 'fuel', lt: 10 },
        {
          anyOf: [
            { state: 'engineRunning', equals: true },
            { state: 'auxPower', equals: true }
          ]
        }
      ]
    };
    const summary = summarizeCondition(when);
    expect(summary).toContain('fuel');
    expect(summary).toContain('engineRunning');
    expect(summary).toContain('auxPower');
    expect(summary).toContain('AND');
    expect(summary).toContain('OR');
  });
});
