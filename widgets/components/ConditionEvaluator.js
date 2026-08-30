/**
 * ConditionEvaluator.js
 * FDWS v1.2 §2.4's visibleWhen predicate/compound-expression grammar
 * (allOf/anyOf, equals/notEquals/gt/gte/lt/lte/between, FDWS v1.13's
 * nested/indexed state-path support), extracted from BaseComponent.js so
 * FDWS v1.15's `style.rules` (Widget Studio 2.0, Phase 2) can reuse the exact
 * same evaluator instead of a second, differently-shaped condition grammar —
 * visibleWhen decides WHETHER a component renders; style.rules decides WHICH
 * style it renders with. One evaluator, two consumers.
 */

import { readStateRef } from '../utils/StateRefPath.js';

/**
 * Recursively evaluates a visibleWhen-shaped predicate/compound expression.
 * @param {object} expr - {allOf:[...]} | {anyOf:[...]} | {state, equals|notEquals|gt|gte|lt|lte|between}
 * @param {object} allState
 * @param {{getLocalState: (name: string) => any}} widget - needed for readStateRef() on nested/indexed paths
 * @returns {boolean}
 */
export function evaluateConditionExpr(expr, allState, widget) {
  if (!expr || typeof expr !== 'object') return true;

  if (Array.isArray(expr.allOf)) {
    return expr.allOf.every((sub) => evaluateConditionExpr(sub, allState, widget));
  }
  if (Array.isArray(expr.anyOf)) {
    return expr.anyOf.some((sub) => evaluateConditionExpr(sub, allState, widget));
  }

  // Leaf predicate: { state, equals|notEquals|gt|gte|lt|lte|between }
  if (!expr.state) return true;
  // FDWS v1.13: a `[` or `.` in expr.state can never appear in a flat state
  // var name (those are plain identifiers), so it unambiguously means a
  // nested/indexed path — resolve it the same way binding.stateRef does
  // (v1.11), instead of the flat allState[expr.state]/getLocalState()
  // lookup below, which can only ever address a whole top-level var.
  const isStateRefPath = /[[.]/.test(expr.state);
  const stateVal = isStateRefPath
    ? readStateRef(widget, expr.state)
    : (allState[expr.state] !== undefined ? allState[expr.state] : widget.getLocalState(expr.state));
  const num = Number(stateVal);

  if (expr.equals !== undefined) return String(stateVal) === String(expr.equals);
  if (expr.notEquals !== undefined) return String(stateVal) !== String(expr.notEquals);
  if (expr.gt !== undefined) return num > Number(expr.gt);
  if (expr.gte !== undefined) return num >= Number(expr.gte);
  if (expr.lt !== undefined) return num < Number(expr.lt);
  if (expr.lte !== undefined) return num <= Number(expr.lte);
  if (Array.isArray(expr.between) && expr.between.length === 2) {
    return num >= Number(expr.between[0]) && num <= Number(expr.between[1]);
  }
  return Boolean(stateVal);
}

/**
 * FDWS v1.15 §style.rules: returns the `style` payload of the FIRST rule
 * whose `when` condition evaluates true, or {} if none match (or `rules` is
 * empty/absent). First-match-wins, same convention as a CSS-like rule list —
 * author more specific conditions earlier.
 * @param {Array<{when: object, style: object}>} [rules]
 * @param {object} allState
 * @param {{getLocalState: (name: string) => any}} widget
 * @returns {object}
 */
export function resolveActiveRuleStyle(rules, allState, widget) {
  if (!Array.isArray(rules)) return {};
  for (const rule of rules) {
    if (rule && evaluateConditionExpr(rule.when, allState, widget)) {
      return rule.style || {};
    }
  }
  return {};
}
