import type { Pt } from "./geometry/pt";

/** How long a submenu stays open after the pointer leaves it and its entry. */
export const SUBMENU_CLOSE_MS = 280;

/** A screen rectangle, as `getBoundingClientRect` gives one. */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** How near the window's edge a menu or card may come. */
export const EDGE_PX = 8;

/** Which side of its anchor a menu or card opens on. */
export type Side = "right" | "left";

/** Where a box goes beside its anchor, and the side it took. */
export interface Placed {
  left: number;
  top: number;
  side: Side;
}

/**
 * Where a box of `size` goes beside `anchor`, its top at `top`: on the `prefer` side, reaching
 * back over the anchor by `overlap` (a negative one leaves a gap), unless the viewport has no
 * room there and has it on the other side. With room on neither, it goes on the left, kept inside
 * the edge. It moves up to stay above the bottom edge.
 */
export function placeBeside(
  anchor: Rect,
  top: number,
  size: { width: number; height: number },
  viewport: { width: number; height: number },
  overlap = 0,
  prefer: Side = "right",
): Placed {
  const right = anchor.right - overlap;
  const left = anchor.left + overlap - size.width;
  const fitsRight = right + size.width <= viewport.width - EDGE_PX;
  const fitsLeft = left >= EDGE_PX;
  const side: Side =
    prefer === "right" ? (fitsRight ? "right" : "left") : fitsLeft || !fitsRight ? "left" : "right";
  const lowest = viewport.height - EDGE_PX - size.height;
  return {
    left: side === "right" ? right : Math.max(EDGE_PX, left),
    top: Math.max(EDGE_PX, Math.min(top, lowest)),
    side,
  };
}

function cross(o: Pt, a: Pt, b: Pt): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** Whether `p` lies in the triangle `abc`, edges included, whichever way round it winds. */
export function inTriangle(p: Pt, a: Pt, b: Pt, c: Pt): boolean {
  const d1 = cross(a, b, p);
  const d2 = cross(b, c, p);
  const d3 = cross(c, a, p);
  const negative = d1 < 0 || d2 < 0 || d3 < 0;
  const positive = d1 > 0 || d2 > 0 || d3 > 0;
  return !(negative && positive);
}

/**
 * Whether the pointer at `p`, having left its entry at `from`, is still heading for the submenu at
 * `menu`: inside the triangle from `from` to the menu's nearer side.
 */
export function aimsAt(p: Pt, from: Pt, menu: Rect): boolean {
  const side = from.x <= menu.left ? menu.left : menu.right;
  return inTriangle(p, from, { x: side, y: menu.top }, { x: side, y: menu.bottom });
}

/**
 * When a submenu opens and closes as the pointer moves: at once on its entry, a short while
 * after the pointer leaves both, and not while the pointer travels on towards it.
 */
export class SubmenuAim {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private from: Pt | null = null;

  constructor(
    private readonly setOpen: (open: boolean) => void,
    private readonly delay = SUBMENU_CLOSE_MS,
  ) {}

  /** Whether the submenu is waiting to close. */
  get closing(): boolean {
    return this.timer !== null;
  }

  /** The pointer came onto the entry or the submenu. */
  enter(open: boolean): void {
    this.cancel();
    if (open) this.setOpen(true);
  }

  /** The pointer left both at `at`: the submenu closes unless it comes back or heads for it. */
  leave(at: Pt): void {
    this.from = at;
    this.schedule();
  }

  /** The pointer moved while the submenu waits to close; heading for `menu` keeps it open longer. */
  move(p: Pt, menu: Rect | null): void {
    if (this.timer === null || this.from === null || menu === null) return;
    if (aimsAt(p, this.from, menu)) this.schedule();
  }

  closeNow(): void {
    this.cancel();
    this.setOpen(false);
  }

  cancel(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.from = null;
      this.setOpen(false);
    }, this.delay);
  }
}
