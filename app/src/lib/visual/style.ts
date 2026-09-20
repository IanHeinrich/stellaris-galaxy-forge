/** The typeface every text style on the map is built from. */
export const MAP_FONT = "Segoe UI, Inter, Helvetica, Arial, sans-serif";

/** A dragged system's own art, left behind at the position it is being moved from. */
export const ORIGIN_ALPHA = 0.25;

/** A lane touching a dragged system: its ghost lane takes over from it. */
export const ORIGIN_LANE_ALPHA = 0.08;

/** A system whose initializer the initializers legend filters out: star and name recede. */
export const FILTERED_ALPHA = 0.25;

/** What follows a drag ghost to its destination: the previewed name, badge and details row. */
export const GHOST_ALPHA = 0.4;

/** A system with no name of its own: the initializer key standing in for it sits a step back. */
export const INITIALIZER_ALPHA = 0.6;
