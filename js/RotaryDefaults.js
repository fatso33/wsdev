/**
 * Authoring-time defaults for a Rotary: what a new one is created with, what changing its
 * Write Mode does to an existing one, what typing a Feel does, and how the Feel field reads
 * in Pulse.
 *
 * Feel is the one value whose right default differs by Write Mode. Absolute's 1 is a
 * heading knob covering 0-360 in a single turn; in Pulse the same number is hundreds of
 * steps per revolution. The numbers themselves live in the engine (resolveFeelDefault) so
 * they sit next to the Feel floor they must clear; this module only decides where they
 * apply.
 *
 * A Write Mode or Gesture change moves Feel to the new default only when Feel still equals
 * the old default, and raises a Feel that would fall below the new floor to that floor. Any
 * other Feel, including every one at or above the new floor, is left exactly as the Author
 * set it. It never touches a write event: a stored `binding.writeEvent` is kept (so
 * switching back finds it) and is simply not declared for a Pulse Rotary — see
 * isWriteEventFieldSent in PropertyRegistry.js.
 *
 * A Feel typed into the field is held to the floor of its context too: a finer one is
 * committed as the floor. Together these keep the Feel Studio stores at or above the floor
 * of its own context. A file that already holds a finer Feel is not rewritten when it is
 * opened; the engine holds it to the floor at runtime.
 *
 * @module RotaryDefaults
 */

import {
  resolveFeelFloor,
  resolveFeelDefault,
  resolveGesture,
  resolveWriteMode,
  resolveDegreesPerUnit
} from '../widgets/components/rotaryEngine.js';

/**
 * The read and write binding of the heading knob the palette's Rotary and the HDG/ALT
 * starter template both model. One object so the two cannot drift apart. Frozen: callers
 * spread it into their own binding rather than sharing it.
 * @type {Readonly<{readSimVar: string, writeEvent: string}>}
 */
export const HEADING_KNOB_BINDING = Object.freeze({
  readSimVar: 'apHdgBugValue',
  writeEvent: 'apHdgSet'
});

/**
 * The props and binding a new Rotary is created with.
 *
 * Absolute is the heading-shaped knob a first-time Author drops on the canvas: 0-360, Feel
 * 1, bound to the heading bug's read and write. Pulse has no value of its own to set, so it
 * keeps the read but carries no write event, and starts at a Pulse-shaped Feel.
 *
 * @param {string|undefined} writeMode - 'absolute' | 'pulse'; anything else creates an Absolute Rotary.
 * @returns {{props: object, binding: object}} Fresh objects on every call.
 */
export function resolveRotaryCreationDefaults(writeMode) {
  if (resolveWriteMode(writeMode) === 'pulse') {
    return {
      props: { min: 0, max: 360, degreesPerUnit: resolveFeelDefault(undefined, 'pulse'), writeMode: 'pulse' },
      binding: { readSimVar: HEADING_KNOB_BINDING.readSimVar }
    };
  }
  return {
    props: { min: 0, max: 360, degreesPerUnit: resolveFeelDefault(undefined, 'absolute') },
    binding: { ...HEADING_KNOB_BINDING }
  };
}

/**
 * The context Feel is judged in: the pair of write mode and Gesture, which together fix a
 * Feel's default and its floor. Named as an Author would read it.
 * @param {string|undefined} gesture
 * @param {string|undefined} writeMode
 * @returns {string} e.g. "Pulse Arc".
 */
function describeContext(gesture, writeMode) {
  const mode = resolveWriteMode(writeMode) === 'pulse' ? 'Pulse' : 'Absolute';
  const resolved = resolveGesture(gesture);
  return `${mode} ${resolved.charAt(0).toUpperCase()}${resolved.slice(1)}`;
}

/**
 * A Feel held to a floor: anything finer is raised to the floor, keeping its sign the way
 * the engine does (the floor applies to the magnitude). The one place the clamp is written,
 * shared by the Write Mode / Gesture reconciliation and by a typed Feel.
 * @param {number} feel - A finite Feel.
 * @param {number} floor - The context's Feel floor, always positive.
 * @returns {number} `feel` when its magnitude is at or above the floor, else the floor with
 *   `feel`'s sign (a zero takes the positive floor).
 */
function raiseToFloor(feel, floor) {
  if (Math.abs(feel) >= floor) return feel;
  return feel < 0 ? -floor : floor;
}

/**
 * Whether a props path is one whose change moves a Rotary's Feel default and floor, and so
 * has to go through applyRotaryContextChange rather than a plain field commit.
 * @param {string} path - A component path such as 'props.writeMode'.
 * @returns {boolean}
 */
export function isRotaryFeelContextPath(path) {
  return path === 'props.writeMode' || path === 'props.gesture';
}

/**
 * What a change of write mode or Gesture should do to a Rotary's stored Feel, so that the
 * Feel it leaves is not below the floor of the context it moves to.
 *
 *  - Feel still exactly equals the old context's default: it moves to the new context's
 *    default.
 *  - Any other stored Feel finer than the new floor is raised to the floor, keeping its
 *    sign the way the engine does (the floor applies to the magnitude).
 *  - Any other stored Feel at or above the new floor is left alone.
 *  - An unset or non-numeric Feel is left as it is: nothing stored means nothing to
 *    overwrite, and the engine already runs it at the default held to the floor.
 *
 * "Still the default" is judged by equality, so an Author-typed value that happens to equal
 * the old default is indistinguishable from an untouched one and moves with it. That is
 * accepted rather than tracked: recording "touched" would put authoring state in the file.
 * Nothing changes when neither the write mode nor the Gesture does, since the floor has not
 * moved.
 *
 * @param {object|undefined} props - The Rotary's current props, before the change.
 * @param {{writeMode?: string, gesture?: string}} change - The prop being changed and its new value.
 * @returns {{propsPatch: object, message: string|null}} `propsPatch` holds only Feel, or is
 *   empty; `message` says which of the two adjustments happened and why, or is null.
 */
export function resolveFeelReconciliation(props, change) {
  const none = { propsPatch: {}, message: null };
  const previousGesture = props?.gesture;
  const previousMode = resolveWriteMode(props?.writeMode);
  const nextGesture = 'gesture' in change ? change.gesture : previousGesture;
  const nextMode = resolveWriteMode('writeMode' in change ? change.writeMode : props?.writeMode);
  if (previousMode === nextMode && resolveGesture(previousGesture) === resolveGesture(nextGesture)) return none;

  const stored = props?.degreesPerUnit;
  if (typeof stored !== 'number' || !Number.isFinite(stored)) return none;

  const from = resolveFeelDefault(previousGesture, previousMode);
  const to = resolveFeelDefault(nextGesture, nextMode);
  const floor = resolveFeelFloor(nextGesture, nextMode);
  const before = describeContext(previousGesture, previousMode);
  const after = describeContext(nextGesture, nextMode);

  if (stored === from) {
    if (from === to) return none;
    return {
      propsPatch: { degreesPerUnit: to },
      message: `Feel was still at the default for ${before} (${from}), so it moved to the default for ${after} (${to}). Ctrl+Z undoes this.`
    };
  }
  if (Math.abs(stored) < floor) {
    return {
      propsPatch: { degreesPerUnit: raiseToFloor(stored, floor) },
      message: `Feel ${stored} is finer than ${after} allows, so it was raised to the floor of ${floor}. Ctrl+Z undoes this.`
    };
  }
  return none;
}

/**
 * Applies a write mode or Gesture change to a Rotary's props together with the Feel
 * adjustment that change implies, so both land as one update.
 *
 * @param {object|undefined} props - The Rotary's current props.
 * @param {'writeMode'|'gesture'} key - The prop being changed.
 * @param {*} value - Its new value.
 * @returns {{props: object, message: string|null}} A new props object, and the notice for the
 *   Author when Feel was adjusted.
 */
export function applyRotaryContextChange(props, key, value) {
  const { propsPatch, message } = resolveFeelReconciliation(props, { [key]: value });
  return { props: { ...(props || {}), [key]: value, ...propsPatch }, message };
}

/**
 * Whether a props path is the Feel field, whose typed value goes through applyRotaryFeelEntry.
 * @param {string} path - A component path such as 'props.degreesPerUnit'.
 * @returns {boolean}
 */
export function isRotaryFeelPath(path) {
  return path === 'props.degreesPerUnit';
}

/**
 * Applies a Feel typed into the Feel field to a Rotary's props, holding it to the floor of
 * the Rotary's own context: a value finer than the floor is committed as the floor, keeping
 * its sign, so the Author sees the input replaced rather than accepted and quietly ignored.
 *
 * The context is the stored Gesture and write mode, unset ones resolving as the engine
 * resolves them. A value at or above the floor is committed as typed, and a cleared field
 * (`undefined`) stays unset: nothing stored is not a value below the floor.
 *
 * @param {object|undefined} props - The Rotary's current props.
 * @param {number|undefined} typed - The Feel the Author entered; `undefined` when cleared.
 * @returns {{props: object, message: string|null}} A new props object, and the notice for
 *   the Author when the typed Feel was raised.
 */
export function applyRotaryFeelEntry(props, typed) {
  const next = (degreesPerUnit) => ({ ...(props || {}), degreesPerUnit });
  if (typeof typed !== 'number' || !Number.isFinite(typed)) return { props: next(typed), message: null };

  const floor = resolveFeelFloor(props?.gesture, props?.writeMode);
  const value = raiseToFloor(typed, floor);
  if (value === typed) return { props: next(typed), message: null };
  return {
    props: next(value),
    message: `Feel ${typed} is below the ${describeContext(props?.gesture, props?.writeMode)} floor of ${floor}, so it was set to ${value}. Ctrl+Z undoes this.`
  };
}

/**
 * How the Feel field should read for a Pulse Rotary: in Pulse, Feel is the size of one
 * step, not degrees per unit of a value the Ring does not own.
 *
 * The note reports the Feel the engine will actually run, so a stored or loaded Feel below
 * the Feel floor is described at the floor rather than as authored.
 *
 * @param {string|undefined} gesture - Raw authored Gesture; unset resolves to Arc.
 * @param {string|undefined} writeMode - Raw authored write mode.
 * @param {number|undefined} feel - The Feel as currently stored or defaulted; unset resolves to the default.
 * @returns {{label: string, note: string}|null} null for Absolute and for Tap, where Feel keeps its usual meaning.
 */
export function describePulseFeel(gesture, writeMode, feel) {
  if (resolveWriteMode(writeMode) !== 'pulse') return null;
  const resolvedGesture = resolveGesture(gesture);
  if (resolvedGesture === 'tap') return null;

  const running = Math.abs(resolveDegreesPerUnit(feel, resolvedGesture, 'pulse'));
  const floor = resolveFeelFloor(resolvedGesture, 'pulse');
  // Absolute has no floor, so resolving as Absolute yields the authored magnitude with the
  // engine's own handling of unset and non-finite values, before the Pulse floor applies.
  const authored = Math.abs(resolveDegreesPerUnit(feel, resolvedGesture, 'absolute'));
  const floorNote = authored < floor
    ? ` Runs at the Feel floor of ${floor}; a finer Feel is not honoured.`
    : '';

  if (resolvedGesture === 'scrub') {
    return {
      label: 'Feel (pixels per step)',
      note: `One step per ${running} px of drag.${floorNote}`
    };
  }
  const stepsPerRevolution = Math.round((360 / running) * 10) / 10;
  return {
    label: 'Feel (degrees per step)',
    note: `${stepsPerRevolution} steps per revolution.${floorNote}`
  };
}
