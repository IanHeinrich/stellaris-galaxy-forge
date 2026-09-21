/** How a territory is painted, shared by every layer that paints one so they read alike. */
export const TERRITORY_FILL_ALPHA = 0.55;
export const TERRITORY_EDGE_PX = 6;
export const TERRITORY_EDGE_ALPHA = 0.95;
/** Strokes hold their screen width until a pixel spans this many world units, then stop growing. */
const STROKE_MAX_UNIT = 2;
/** The stroke width is snapped to steps of √2 so zooming redraws it rarely. */
const STROKE_STEPS_PER_OCTAVE = 2;

/** World units per screen pixel for the strokes, capped and snapped. */
export function strokeUnit(camScale: number): number {
  const wanted = Math.min(STROKE_MAX_UNIT, 1 / camScale);
  const step = Math.round(Math.log2(wanted) * STROKE_STEPS_PER_OCTAVE);
  return Math.pow(2, step / STROKE_STEPS_PER_OCTAVE);
}
