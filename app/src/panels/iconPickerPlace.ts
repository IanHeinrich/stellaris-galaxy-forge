/** A stretch of the window from left to right, in pixels. */
export interface Across {
  left: number;
  right: number;
}

/**
 * Where an icon picker's popup hangs: under the left or the right edge of its picker, and the
 * widest it may be; `null` for as wide as its rows make it.
 */
export interface PopupPlace {
  edge: "left" | "right";
  maxWidth: number | null;
}

/**
 * Where a popup `width` wide hangs from `picker` so it stays inside `box`, the part of the window
 * that shows it: from the picker's left edge where it fits, else from its right edge, else from
 * the edge with more room, no wider than that room.
 */
export function popupPlace(picker: Across, box: Across, width: number): PopupPlace {
  if (picker.left + width <= box.right) return { edge: "left", maxWidth: null };
  if (picker.right - width >= box.left) return { edge: "right", maxWidth: null };
  const leftRoom = box.right - picker.left;
  const rightRoom = picker.right - box.left;
  return leftRoom >= rightRoom
    ? { edge: "left", maxWidth: Math.max(0, leftRoom) }
    : { edge: "right", maxWidth: rightRoom };
}

/** A stretch of the window from top to bottom, in pixels. */
export interface Down {
  top: number;
  bottom: number;
}

/**
 * Whether a popup `height` tall opens above `picker` inside `box`, the part of the window that
 * shows it: only when it would not fit below and there is more room above.
 */
export function opensUp(picker: Down, height: number, box: Down): boolean {
  const below = box.bottom - picker.bottom;
  return height > below && picker.top - box.top > below;
}
