import { SELECTED_GAP_PX, SELECTED_WIDTH_PX } from "../geometry";

/** A body to label: its point and disc radius on screen, and its measured plate. */
export interface LabelItem {
  id: number;
  x: number;
  y: number;
  r: number;
  w: number;
  h: number;
  /**
   * The body's moons, outermost first. Each takes the slot under itself when it is clear, and
   * otherwise stacks in a column running away from the body past this body's plate, the
   * outermost furthest out.
   */
  moons?: readonly LabelItem[];
}

/** A placed label's box on screen, top-left corner and size. */
export interface LabelBox {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The zoom, as a multiple of the system's fit, at and above which a plate is full size. */
const FULL_SIZE_ZOOM = 2;
/** The zoom at and below which a plate is smallest, and its size there. */
const SMALLEST_ZOOM = 0.5;
const SMALLEST_SCALE = 0.75;

/**
 * How large a plate is drawn at `zoom`, the camera's scale over the system's fit: full size close
 * in, easing down to three quarters as the view zooms out.
 */
export function plateScale(zoom: number): number {
  const t = Math.log(zoom / SMALLEST_ZOOM) / Math.log(FULL_SIZE_ZOOM / SMALLEST_ZOOM);
  const clamped = Math.min(1, Math.max(0, t));
  const eased = clamped * clamped * (3 - 2 * clamped);
  return SMALLEST_SCALE + (1 - SMALLEST_SCALE) * eased;
}

/** Between a body's disc and its plate, in screen pixels: clear of the selected ring, so a plate
 * stays put when its body is selected. */
export const GAP_PX = SELECTED_GAP_PX + SELECTED_WIDTH_PX + 2;
/** Between one plate of a moon column and the next. */
const COLUMN_GAP_PX = 1;

function below(item: LabelItem): LabelBox {
  const { id, x, y, r, w, h } = item;
  return { id, x: x - w / 2, y: y + r + GAP_PX, w, h };
}

/** A candidate plate box for a body's label, tagged with which way its moon column must run. */
interface Slot {
  box: LabelBox;
  /** "down" and "up" push the column away from the body, past the plate. "beside" stacks it up
   * from the plate as before, for the right and left slots. */
  direction: "down" | "up" | "beside";
}

/** The boxes a label may take about its body: below, above, right, left. */
function slots(item: LabelItem): Slot[] {
  const { id, x, y, r, w, h } = item;
  const off = r + GAP_PX;
  return [
    { box: below(item), direction: "down" },
    { box: { id, x: x - w / 2, y: y - off - h, w, h }, direction: "up" },
    { box: { id, x: x + off, y: y - h / 2, w, h }, direction: "beside" },
    { box: { id, x: x - off - w, y: y - h / 2, w, h }, direction: "beside" },
  ];
}

/** The box about a body's disc and its selected ring: nothing in a block may cross it. */
function discBox(item: LabelItem): LabelBox {
  const { id, x, y, r } = item;
  // The ring's outer edge, short of GAP_PX, so a plate in a slot never grazes it by rounding.
  const off = r + SELECTED_GAP_PX + SELECTED_WIDTH_PX;
  return { id, x: x - off, y: y - off, w: 2 * off, h: 2 * off };
}

export function overlaps(a: LabelBox, b: LabelBox): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function clear(box: LabelBox, placed: readonly LabelBox[]): boolean {
  return placed.every((other) => !overlaps(box, other));
}

/**
 * `moons` stacked in a column running away from the body, past `head`: below or above it when the
 * plate itself sits below or above the body, so the column never doubles back over the disc; up
 * from the top of `head`, centred on it, when the plate sits beside the body. The outermost moon
 * is furthest from the body in every case.
 */
function column(
  head: LabelBox,
  moons: readonly LabelItem[],
  direction: "down" | "up" | "beside",
): LabelBox[] {
  const cx = head.x + head.w / 2;
  const boxes: LabelBox[] = [];
  if (direction === "down") {
    let top = head.y + head.h;
    for (const { id, w, h } of [...moons].reverse()) {
      const y = top + COLUMN_GAP_PX;
      boxes.push({ id, x: cx - w / 2, y, w, h });
      top = y + h;
    }
  } else {
    let bottom = head.y;
    for (const { id, w, h } of [...moons].reverse()) {
      const y = bottom - COLUMN_GAP_PX - h;
      boxes.push({ id, x: cx - w / 2, y, w, h });
      bottom = y;
    }
  }
  return boxes.reverse();
}

/**
 * The plate at `slot` with the item's moons: each under itself where that clears the rest and the
 * body's own disc, the others in a column running away from the body. Null when the plate, or the
 * column, is not clear, or crosses the body's disc box.
 */
function block(
  slot: Slot,
  moons: readonly LabelItem[],
  placed: readonly LabelBox[],
  disc: LabelBox,
): LabelBox[] | null {
  const { box: head, direction } = slot;
  if (!clear(head, placed) || overlaps(head, disc)) return null;
  const own = new Map<number, LabelBox>();
  for (const moon of moons) {
    const box = below(moon);
    if (
      clear(box, placed) &&
      !overlaps(box, head) &&
      !overlaps(box, disc) &&
      clear(box, [...own.values()])
    ) {
      own.set(moon.id, box);
    }
  }
  for (;;) {
    const stacked = column(
      head,
      moons.filter((moon) => !own.has(moon.id)),
      direction,
    );
    if (!stacked.every((box) => clear(box, placed) && !overlaps(box, disc))) return null;
    const bumped = [...own.values()].filter((box) => !clear(box, stacked));
    if (bumped.length === 0) return [head, ...own.values(), ...stacked];
    for (const box of bumped) own.delete(box.id);
  }
}

/**
 * Places each label, in the order given, in the first of its slots where it and its moon column
 * clear every label already placed. A label with no clear slot is left out with its column,
 * and only those of its moons whose own slot is clear are shown.
 */
export function placeLabels(items: readonly LabelItem[]): LabelBox[] {
  const placed: LabelBox[] = [];
  for (const item of items) {
    const moons = item.moons ?? [];
    const disc = discBox(item);
    const boxes = slots(item).reduce<LabelBox[] | null>(
      (found, slot) => found ?? block(slot, moons, placed, disc),
      null,
    );
    if (boxes) {
      placed.push(...boxes);
      continue;
    }
    for (const moon of moons) {
      const own = below(moon);
      if (clear(own, placed)) placed.push(own);
    }
  }
  return placed;
}
