/**
 * InspectorLogic.js
 * Pure utility functions for the Property Inspector, separated from DOM/rendering logic.
 * Designed to be extensible — tickets 06 and 11 add further functions here.
 */

const RULE_OP_SYMBOLS = { equals: '=', notEquals: '≠', gt: '>', gte: '≥', lt: '<', lte: '≤' };

/**
 * Reorders an array element from one index to another, preserving relative order of the rest.
 * Standard array move/splice semantics: removes element at fromIndex, inserts at toIndex.
 * Returns a new array; does not mutate the input.
 *
 * @param {Array} rules - The array to reorder (e.g., style.rules[])
 * @param {number} fromIndex - Current index of the element to move
 * @param {number} toIndex - Target index where the element should be inserted
 * @returns {Array} A new array with the element moved
 *
 * @example
 * reorderRules([{id: 'r1'}, {id: 'r2'}, {id: 'r3'}], 2, 0)
 * // => [{id: 'r3'}, {id: 'r1'}, {id: 'r2'}]
 */
export function reorderRules(rules, fromIndex, toIndex) {
  if (!Array.isArray(rules) || fromIndex < 0 || toIndex < 0 || fromIndex >= rules.length || toIndex > rules.length) {
    return rules;
  }

  const result = [...rules];
  const [removed] = result.splice(fromIndex, 1);
  result.splice(toIndex, 0, removed);
  return result;
}

/**
 * Summarizes a condition tree into a plain-language string.
 * Handles leaf conditions (e.g., { state: 'fuel', lt: 10 }), AND groups (allOf), and OR groups (anyOf).
 * Returns a truthy string even for empty/unset conditions (e.g., "No condition set").
 *
 * @param {object|null|undefined} when - The condition tree to summarize
 * @returns {string} A plain-language summary of the condition
 *
 * @example
 * summarizeCondition({ state: 'fuel', lt: 10 })
 * // => "fuel < 10"
 *
 * summarizeCondition({ allOf: [{ state: 'fuel', lt: 10 }, { state: 'engineRunning', equals: true }] })
 * // => "fuel < 10 AND engineRunning = true"
 *
 * summarizeCondition(null)
 * // => "No condition set"
 */
export function summarizeCondition(when) {
  // Handle empty/null/undefined conditions
  if (!when) {
    return 'No condition set';
  }

  // Check if it's a group (has allOf or anyOf)
  const isGroup = (obj) => !!obj && typeof obj === 'object' && (Array.isArray(obj.allOf) || Array.isArray(obj.anyOf));

  if (isGroup(when)) {
    const combinator = when.anyOf ? 'anyOf' : 'allOf';
    const leaves = when[combinator] || [];

    if (!Array.isArray(leaves) || leaves.length === 0) {
      return 'No condition set';
    }

    // Recursively summarize each leaf/group
    const summaries = leaves.map(summarizeCondition);
    const joinStr = combinator === 'anyOf' ? ' OR ' : ' AND ';
    return summaries.join(joinStr);
  }

  // Handle leaf condition
  if (typeof when === 'object' && typeof when.state === 'string') {
    const varName = when.state;

    // If state var name is empty, treat as unset condition
    if (!varName) {
      return 'No condition set';
    }

    // Special case: 'between' operator (has array value)
    if (Array.isArray(when.between)) {
      return `${varName} in [${when.between.join(', ')}]`;
    }

    // Find which operator is set
    const op = Object.keys(RULE_OP_SYMBOLS).find((o) => when[o] !== undefined);

    if (op) {
      const symbol = RULE_OP_SYMBOLS[op];
      return `${varName} ${symbol} ${when[op]}`;
    }

    // If no operator is set, just show the variable name
    return varName;
  }

  // Fallback for unrecognized structures
  return 'No condition set';
}
