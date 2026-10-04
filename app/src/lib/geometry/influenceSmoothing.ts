/**
 * The influence a territory ends at, measured on the game's open-space edges and holes: 0.79 close
 * up to 0.82 zoomed out, a world unit apart, so one level serves every zoom.
 */
export const EDGE = 0.8;
/**
 * How far the smooth max and min that round a territory's corners blend, in influence units:
 * where two owners' borders meet, or a border meets open space. Where two vanilla countries and
 * an unowned system meet, it rounds the corner to a radius of 5 to 6 world units.
 */
const CORNER_BLEND = 0.2;
/** The most the smooth max and min together raise φ above the hard max. */
export const CORNER_RISE = CORNER_BLEND / 2;
/**
 * The furthest inside the outline a band's inner edge runs, in influence units. It bounds how
 * near a border the field must be measured texel by texel, whatever band is asked for later.
 */
export const MAX_BAND_DEPTH = 0.3;
/**
 * How far the band's depth rounds off into its cap, in influence units, and its slope into the
 * slope round a lone system, as a share of that slope, so the band's inner edge has no kink
 * where either takes over.
 */
export const DEPTH_BLEND = 0.1;
export const SLOPE_BLEND_SHARE = 0.5;
/** How far above 0 the lowest hard φ at a cell's corners may lie for a contour to cross the cell. */
export const HARD_SLACK = DEPTH_BLEND / 4;

/** The max of a and b, rounded off where they are within `blend` of each other. */
export function smoothMax(a: number, b: number, blend = CORNER_BLEND): number {
  const h = blend - Math.abs(a - b);
  return h > 0 ? Math.max(a, b) + (h * h) / (4 * blend) : Math.max(a, b);
}

/** The min of a and b, rounded off likewise. */
export function smoothMin(a: number, b: number, blend = CORNER_BLEND): number {
  const h = blend - Math.abs(a - b);
  return h > 0 ? Math.min(a, b) - (h * h) / (4 * blend) : Math.min(a, b);
}

/**
 * The x at which `smoothMin(x, MAX_BAND_DEPTH, DEPTH_BLEND)` reaches `depth`: 0 when it is not
 * inside, and infinite when it is deeper than any band reaches.
 */
export function depthReach(depth: number): number {
  const m = MAX_BAND_DEPTH;
  const b = DEPTH_BLEND;
  if (depth <= 0) return 0;
  if (depth >= m) return Infinity;
  if (depth <= m - b) return depth;
  if (depth < m - b / 4) return m + b - 2 * Math.sqrt(b * b - b * (depth - m + b));
  return m + b - 2 * Math.sqrt(b * (m - depth));
}
