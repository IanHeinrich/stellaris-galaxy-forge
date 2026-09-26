/** A body to label: its point and disc radius on screen, and its measured name. */
export interface LabelItem {
  id: number;
  x: number;
  y: number;
  r: number;
  w: number;
  h: number;
}

/** A placed label's box on screen, top-left corner and size. */
export interface LabelBox {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Between a body's disc and its label, in screen pixels. */
const GAP_PX = 3;

/** The boxes a label may take about its body: right, left, below, above. */
function slots(item: LabelItem): LabelBox[] {
  const { id, x, y, r, w, h } = item;
  const off = r + GAP_PX;
  return [
    { id, x: x + off, y: y - h / 2, w, h },
    { id, x: x - off - w, y: y - h / 2, w, h },
    { id, x: x - w / 2, y: y + off, w, h },
    { id, x: x - w / 2, y: y - off - h, w, h },
  ];
}

function overlaps(a: LabelBox, b: LabelBox): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * Places each label, in the order given, in the first of its slots that clears every label
 * already placed; a label with no clear slot is left out.
 */
export function placeLabels(items: readonly LabelItem[]): LabelBox[] {
  const placed: LabelBox[] = [];
  for (const item of items) {
    const box = slots(item).find((slot) => placed.every((other) => !overlaps(slot, other)));
    if (box) placed.push(box);
  }
  return placed;
}
