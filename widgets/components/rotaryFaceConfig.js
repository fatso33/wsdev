/**
 * rotaryFaceConfig.js
 *
 * The step between a Rotary's authored `props` and the pure Face generator
 * (rotaryFace.js): which prop feeds which Face key, what the scale's labels read, and
 * what the widget's light or dark theme does to every colour on the Face.
 *
 * It is separate from the Face so the Face can stay a pure function of plain values with
 * no knowledge of ranges, themes or props, and separate from the Component so the two
 * places that draw a Rotary — the live Component and Widget Studio's canvas thumbnail —
 * resolve a Rotary's appearance identically instead of each keeping a copy.
 */

import { ROTARY_FACE_DEFAULTS } from './rotaryFace.js';
import { resolveThemedColor } from './ThemeColor.js';

const DEFAULT_MIN = 0;
const DEFAULT_MAX = 100;
const DEFAULT_START_ANGLE = -135;
const DEFAULT_SWEEP_DEGREES = 270;
const FULL_CIRCLE_DEGREES = 360;
const MAX_LABELED_MAJORS = 60;

/**
 * Which theme-derivation role a Face colour plays. The derivation infers a role from
 * this and the colour's own saturation: a rim reads as a border, a disc as a surface, a
 * pointer or scale mark as text.
 */
const COLOR_KIND = {
  rimColor: 'border',
  faceColor: 'background',
  faceColor2: 'background',
  capColor: 'background',
  indicatorColor: 'typography',
  scaleColor: 'typography'
};

/** Label text for one scale value: trimmed to two decimals, no trailing zeros. */
function formatScaleLabel(value) {
  return String(Math.round(value * 100) / 100);
}

/**
 * The text at each major mark of the scale, evenly spaced across the range.
 * A Detented range labels its own positions and gets none here, so the two are never
 * drawn on top of each other.
 */
function buildScaleLabels(props, { min, max, rangeMode, span }) {
  const majors = Math.min(MAX_LABELED_MAJORS, Math.round(Number(props.scaleMajorDivisions) || 0));
  if (props.scaleLabels !== true || majors < 1 || rangeMode === 'detented') return [];
  // A full circle draws its first mark only once, so it has one label fewer.
  const marks = span >= FULL_CIRCLE_DEGREES ? majors : majors + 1;
  const labels = [];
  for (let i = 0; i < marks; i++) labels.push(formatScaleLabel(min + ((max - min) * i) / majors));
  return labels;
}

/**
 * Resolves one Rotary's authored props into the config `buildRotaryFace` takes.
 *
 * Every colour, including an unset one's default, is theme-adjusted for the theme being
 * rendered, the same way BaseComponent adjusts a Component's own style colours: it is
 * untouched while the widget renders in the theme it was authored for, and re-derived
 * for the other one. A manual per-theme override applies only to the colours
 * `style.themeOverride` already names, so a Face colour in manual mode is derived like
 * any other. A colour that is not a plain hex literal passes through unchanged.
 *
 * @param {object} [props] - the Rotary's `props`
 * @param {object} [options]
 * @param {number} [options.valueAngle=0] - degrees the knob has turned from its start angle
 * @param {number} [options.startAngle=-135] - where the indicator rests at the minimum
 * @param {number} [options.sweepDegrees=270] - how far the knob turns across its range
 * @param {number} [options.min=0] - low end of the range, for the scale's labels
 * @param {number} [options.max=100] - high end of the range, for the scale's labels
 * @param {string} [options.rangeMode] - 'bounded' | 'continuous' | 'detented'
 * @param {'dark'|'light'} [options.theme='dark'] - the theme being rendered
 * @param {'dark'|'light'} [options.baseTheme='dark'] - the theme the widget was authored for
 * @param {'auto'|'manual'} [options.themeMode='auto']
 * @param {string} [options.componentType='core.rotary']
 * @param {string} [options.layerGroup]
 * @returns {object} a config for buildRotaryFace
 */
export function resolveRotaryFaceConfig(props = {}, options = {}) {
  const {
    valueAngle = 0,
    startAngle = DEFAULT_START_ANGLE,
    sweepDegrees = DEFAULT_SWEEP_DEGREES,
    min = DEFAULT_MIN,
    max = DEFAULT_MAX,
    rangeMode,
    theme = 'dark',
    baseTheme = 'dark',
    themeMode = 'auto',
    componentType = 'core.rotary',
    layerGroup
  } = options;

  const themed = (key, raw) => {
    if (raw === undefined || raw === null || raw === '') return raw;
    return resolveThemedColor(raw, undefined, { componentType, layerGroup, colorKind: COLOR_KIND[key] }, theme, baseTheme, themeMode);
  };

  const blended = props.fillStyle !== undefined && props.fillStyle !== 'solid';
  const span = props.scaleSpan ?? sweepDegrees;
  const capContent = props.capContent;

  return {
    angle: startAngle + valueAngle,

    fillStyle: props.fillStyle,
    faceColor: themed('faceColor', props.faceColor ?? (blended ? ROTARY_FACE_DEFAULTS.blendColor : undefined)),
    faceColor2: themed('faceColor2', props.faceColor2 ?? ROTARY_FACE_DEFAULTS.blendColor2),
    rimColor: themed('rimColor', props.rimColor ?? ROTARY_FACE_DEFAULTS.rimColor),
    rimWidth: props.rimWidth,
    innerShadow: props.innerShadow,

    knurlStyle: props.knurlStyle,
    knurlCount: props.knurlCount,
    knurlDepth: props.knurlDepth,

    indicatorShape: props.indicatorShape,
    indicatorColor: themed('indicatorColor', props.indicatorColor ?? ROTARY_FACE_DEFAULTS.indicatorColor),
    indicatorWidth: props.indicatorWidth,
    indicatorLength: props.indicatorLength,
    indicatorGlow: props.indicatorGlow,

    capDiameter: props.capDiameter,
    capColor: themed('capColor', props.capColor ?? ROTARY_FACE_DEFAULTS.capColor),
    capLabel: capContent === 'label' ? props.capLabel : undefined,
    capIcon: capContent === 'icon' ? props.capIcon : undefined,

    scaleMajorDivisions: props.scaleMajorDivisions,
    scaleMinorDivisions: props.scaleMinorDivisions,
    scaleTickLength: props.scaleTickLength,
    scaleColor: themed('scaleColor', props.scaleColor ?? ROTARY_FACE_DEFAULTS.scaleColor),
    scaleStartAngle: startAngle,
    scaleSpan: span,
    scaleLabels: buildScaleLabels(props, { min, max, rangeMode, span }),

    dropShadow: props.dropShadow
  };
}
