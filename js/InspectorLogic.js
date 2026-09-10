/**
 * InspectorLogic.js
 * Pure utility functions for the Property Inspector, separated from DOM/rendering logic.
 * Designed to be extensible — tickets 06 and 11 add further functions here.
 */

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
