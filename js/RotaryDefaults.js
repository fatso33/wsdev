/**
 * Authoring-time defaults for a Rotary: what a new one is created with, what changing its
 * Write Mode does to an existing one, and how the Feel field reads in Pulse.
 *
 * Feel is the one value whose right default differs by Write Mode. Absolute's 1 is a
 * heading knob covering 0-360 in a single turn; in Pulse the same number is hundreds of
 * steps per revolution. The numbers themselves live in the engine (resolveFeelDefault) so
 * they sit next to the Feel floor they must clear; this module only decides where they
 * apply.
 *
 * A Write Mode switch never rewrites a value the Author chose. It moves Feel only when
 * Feel still equals the previous mode's default, and it never touches a write event: a
 * stored `binding.writeEvent` is kept (so switching back finds it) and is simply not
 * declared for a Pulse Rotary — see isWriteEventFieldSent in PropertyRegistry.js.
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
 * What switching a Rotary's Write Mode should change, given the props it has now.
 *
 * Feel moves from the old mode's default to the new mode's default only when it is stored
 * and still exactly equals the old default: that is the one case where nothing the Author
 * chose is being replaced. Any other stored value, and an unset one, is left alone. A
 * Gesture whose Feel means the same in both modes (Tap) resolves to the same default on
 * both sides and so never changes.
 *
 * @param {object|undefined} props - The Rotary's current props, before the switch.
 * @param {string|undefined} nextWriteMode - 'absolute' | 'pulse'.
 * @returns {{propsPatch: object, message: string|null}} `propsPatch` is spread onto props
 *   alongside the new writeMode; `message` says what changed and why, or is null when
 *   nothing did.
 */
export function resolveWriteModeSwitch(props, nextWriteMode) {
  const gesture = props?.gesture;
  const previousMode = resolveWriteMode(props?.writeMode);
  const nextMode = resolveWriteMode(nextWriteMode);
  const from = resolveFeelDefault(gesture, previousMode);
  const to = resolveFeelDefault(gesture, nextMode);
  if (previousMode === nextMode || from === to || props?.degreesPerUnit !== from) {
    return { propsPatch: {}, message: null };
  }
  const modeLabel = (mode) => (mode === 'pulse' ? 'Pulse' : 'Absolute');
  return {
    propsPatch: { degreesPerUnit: to },
    message: `Write Mode is now ${modeLabel(nextMode)}: Feel was still at the ${modeLabel(previousMode)} default (${from}), so it moved to the ${modeLabel(nextMode)} default (${to}). A Feel you set yourself is never changed. Ctrl+Z undoes this.`
  };
}

/**
 * How the Feel field should read for a Pulse Rotary: in Pulse, Feel is the size of one
 * step, not degrees per unit of a value the Ring does not own.
 *
 * The note reports the Feel the engine will actually run, so a value authored below the
 * Feel floor is shown at the floor rather than as typed.
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
