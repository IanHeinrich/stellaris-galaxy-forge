import { BitmapText, type Container } from "pixi.js";
import { describe, expect, it } from "vitest";
import { MAP_FONT } from "../../../lib/visual/style";
import { stubTextMeasurement } from "../fixture";
import type { Textures } from "./cell";
import { PickedTips } from "./Hover";
import { RESOURCE_TEXT_GAP_PX, resourceIcons } from "./resources";
import { Row } from "./Row";

stubTextMeasurement();

const NO_ICONS: Textures = { texture: () => null, resolve: () => null };
const ICONS: Textures = {
  texture: () => ({ width: 15, height: 15 }) as never,
  resolve: () => null,
};

/** The stub measures text far narrower than the game's font; this size gives a digit about 6 px. */
const DIGIT_SIZE = 100;

function rowOf(amounts: readonly number[], tex: Textures) {
  const row = new Row(new PickedTips());
  row.begin();
  const rows = amounts.map((amount, i) => ({ resource: `r${i}`, amount, sprite: `s${i}` }));
  const reach = resourceIcons(row, new Map(), tex, rows, 0, {
    amount: { fontFamily: MAP_FONT, fontSize: DIGIT_SIZE, fill: 0xffffff },
  });
  row.end();
  return { reach, amounts: amountBoxes(row.root) };
}

/** The visible numeric texts of the row, left to right, as [left, right] edges. */
function amountBoxes(root: Container): [number, number][] {
  const found: BitmapText[] = [];
  const walk = (c: Container): void => {
    if (c instanceof BitmapText && c.visible && /^\d/.test(c.text)) found.push(c);
    c.children.forEach((child) => walk(child as Container));
  };
  walk(root);
  return found.map((t) => [t.x, t.x + t.width]);
}

describe("a resource row's spacing", () => {
  it("keeps a row of short amounts at the game's dense stride", () => {
    const { amounts } = rowOf([4, 5, 6], ICONS);
    const centres = amounts.map(([l, r]) => (l + r) / 2);
    [-17, 0, 17].forEach((x, i) => expect(centres[i]).toBeCloseTo(x));
  });

  it("keeps the dense stride of a long row of short amounts", () => {
    const { amounts } = rowOf([1, 2, 3, 4, 5, 6, 7, 8], ICONS);
    const centres = amounts.map(([l, r]) => (l + r) / 2);
    expect(centres[1] - centres[0]).toBeCloseTo(12);
    expect(centres[7] - centres[6]).toBeCloseTo(12);
  });

  it("keeps three- and four-digit amounts apart, with or without icons", () => {
    for (const tex of [ICONS, NO_ICONS]) {
      const { amounts } = rowOf([420, 250, 100, 180, 1080], tex);
      for (let i = 1; i < amounts.length; i++) {
        expect(amounts[i][0] - amounts[i - 1][1]).toBeGreaterThanOrEqual(RESOURCE_TEXT_GAP_PX);
      }
    }
  });

  it("spreads a row of eight three-digit amounts past the dense stride", () => {
    const { amounts } = rowOf([100, 100, 100, 100, 100, 100, 100, 100], ICONS);
    for (let i = 1; i < amounts.length; i++) {
      expect(amounts[i][0] - amounts[i - 1][1]).toBeGreaterThanOrEqual(RESOURCE_TEXT_GAP_PX);
    }
  });

  it("centres a spread row and reports how far it reaches", () => {
    const { amounts, reach } = rowOf([420, 250], ICONS);
    const [first, last] = [amounts[0], amounts[1]];
    expect(first[0] + last[1]).toBeCloseTo(0);
    expect(reach.half).toBeCloseTo(last[1]);
    expect(last[0] - first[1]).toBeGreaterThanOrEqual(RESOURCE_TEXT_GAP_PX);
  });
});
