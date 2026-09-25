import type { Graphics } from "pixi.js";
import type { Icon, IconFrame } from "../../../lib/details/icons";
import { MAP_FONT, PLATE_COLOR } from "../../../lib/visual/style";
import type { MapTooltipLine } from "../../../store/mapChromeStore";
import { DISC_PX, GLYPH_STYLE, ICON_PX, type RowY, type Textures } from "./cell";
import type { Tip } from "./Hover";
import type { Row } from "./Row";

const BADGE_STYLE = { fontFamily: MAP_FONT, fontSize: 9, fill: 0xffffff };
const DISC_COLOR = PLATE_COLOR;
const DISC_ALPHA = 0.85;
const LGATE_DISC_COLOR = 0x6b1a1a;
const RING_WIDTH = 1.5;
const STATION_RING = 0xffffff;
const BYPASS_RING = 0x4fd66b;
const POI_RING = 0x3a7bd5;
const STATION_SEGMENT = (70 * Math.PI) / 180;
const BYPASS_DASHES = 12;
const ROW_GAP = 4;
const BADGE_R = 6;

/** Draws `item` on its disc at cell `x` when a key has rendered, its glyph when none can; advances a cell either way. */
export function icon(
  row: Row,
  tex: Textures,
  item: Icon,
  x: number,
  y: RowY,
  lines: MapTooltipLine[] = [],
): number {
  const tip = { title: item.label, lines };
  disc(row.marks, x + DISC_PX / 2, y.disc + DISC_PX / 2, item.frame);
  const texture = tex.resolve(item.keys);
  const inset = (DISC_PX - ICON_PX) / 2;
  if (texture) row.sprite(texture, x + inset, y.icon, ICON_PX, tip);
  else if (texture === null) {
    const w = row.text(item.glyph, x + DISC_PX / 2, y.icon + 1, tip, GLYPH_STYLE);
    row.nudgeLastText(-w / 2);
  }
  return x + DISC_PX + ROW_GAP;
}

/** One icon standing for every item of its kind, badged with the count past one. */
export function collapsed(
  row: Row,
  tex: Textures,
  item: Icon | null,
  x: number,
  count: number,
  lines: MapTooltipLine[],
  y: RowY,
): number {
  if (item === null) return x;
  const next = icon(row, tex, item, x, y, lines);
  if (count > 1) badge(row, x, count, { title: item.label, lines }, y.disc);
  return next;
}

function badge(row: Row, cell: number, count: number, tip: Tip, discY: number): void {
  const cx = cell + DISC_PX - BADGE_R + 1;
  const cy = discY + DISC_PX - BADGE_R + 1;
  row.marks.circle(cx, cy, BADGE_R).fill({ color: DISC_COLOR, alpha: 1 });
  const w = row.text(String(count), cx, cy - 6, tip, BADGE_STYLE);
  row.nudgeLastText(-w / 2);
}

function disc(marks: Graphics, cx: number, cy: number, frame: IconFrame): void {
  const color = frame === "lgate" ? LGATE_DISC_COLOR : DISC_COLOR;
  marks.circle(cx, cy, DISC_PX / 2).fill({ color, alpha: DISC_ALPHA });
  const r = DISC_PX / 2 - RING_WIDTH / 2;
  switch (frame) {
    case "station":
      arcs(marks, cx, cy, r, 4, STATION_SEGMENT);
      marks.stroke({ color: STATION_RING, width: RING_WIDTH });
      return;
    case "bypass":
    case "lgate":
      arcs(marks, cx, cy, r, BYPASS_DASHES, ((2 * Math.PI) / BYPASS_DASHES) * 0.6);
      marks.stroke({ color: BYPASS_RING, width: RING_WIDTH });
      return;
    case "poi":
      marks.circle(cx, cy, r).stroke({ color: POI_RING, width: RING_WIDTH });
  }
}

/** `count` equal arcs of `span` radians each, centred in their share of the circle. */
function arcs(
  marks: Graphics,
  cx: number,
  cy: number,
  r: number,
  count: number,
  span: number,
): void {
  const share = (2 * Math.PI) / count;
  for (let i = 0; i < count; i++) {
    const start = i * share + (share - span) / 2;
    marks.moveTo(cx + r * Math.cos(start), cy + r * Math.sin(start));
    marks.arc(cx, cy, r, start, start + span);
  }
}
