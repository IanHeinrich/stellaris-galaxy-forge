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

/** The app's accent (`--accent`): the selection, what an edit adds, and the brush that adds. */
export const ACCENT_COLOR = 0xffd166;

/** What an edit may go ahead with: a valid target, a lane being drawn, a system joining. */
export const ALLOWED_COLOR = 0x6ee7b7;

/** What an edit refuses or removes: an invalid target, a blocked slot, the brush that erases. */
export const REFUSED_COLOR = 0xf87171;

/** What is set apart without being refused: a system leaving, a special an eraser spares, a spawn. */
export const CAUTION_COLOR = 0xfbbf24;

/** A fallen empire zone's ring, wherever it is drawn or dragged. */
export const FE_ZONE_COLOR = 0xf0abfc;

/** A nebula's selected edge, its handles and label, and the ring a nebula drag proposes. */
export const NEBULA_COLOR = 0xc4b5fd;

/** The dark plate a badge, an icon or an added system's mark sits on. */
export const PLATE_COLOR = 0x0b0f14;

/** The fill of a handle or a lane's midpoint mark: a step lighter than a plate. */
export const HANDLE_COLOR = 0x1c2333;

/** The rings round the systems using the initializer the browser is highlighting. */
export const MATCHED_COLOR = 0x7dd3fc;

/** The rings round the systems the search palette's query finds. */
export const SEARCHED_COLOR = 0xf472b6;

/**
 * How far from its star each kind of ring sits, in marker pixels, innermost first. A ring's
 * stroke clears its neighbours'; the kinds that share a radius are named under it.
 */
export const RING_RADIUS = {
  hover: 9,
  selection: 11,
  /** The browser's matches and a lane drag's target. */
  target: 13,
  /** A nebula drag's joining and leaving systems, and a special system's badge. */
  joining: 15,
  searched: 17,
  issue: 20,
  /** The first watchlist entry's; each entry after it sits `WATCH_RING_STEP` further out. */
  watchlist: 23,
} as const;

/** How much further out each watchlist entry's ring sits than the one before it. */
export const WATCH_RING_STEP = 3;
