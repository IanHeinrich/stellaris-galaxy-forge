export interface Pt {
  x: number;
  y: number;
}

/** The squared distance between two points. */
export function dist2(a: Pt, b: Pt): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}
