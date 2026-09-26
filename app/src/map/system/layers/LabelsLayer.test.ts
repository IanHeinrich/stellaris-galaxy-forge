import { describe, expect, it, vi } from "vitest";

vi.mock("../../../api/textures", () => ({ getTextures: () => new Promise(() => {}) }));

import { BitmapText, Graphics } from "pixi.js";
import { ACCENT_COLOR } from "../../../lib/visual/style";
import { clearTextures } from "../../../lib/visual/textures";
import { systemContext } from "../context";
import { EARTH, SUN, context, drawOps, strokes, stubTextMeasurement, viewport } from "../fixture";
import { NO_SOURCES } from "../sources";
import { LabelsLayer } from "./LabelsLayer";
import { NO_HIGHLIGHT } from "./SystemLayer";

stubTextMeasurement();

describe("the system scene's labels layer", () => {
  const MINED = {
    ...EARTH,
    deposits: [
      { resource: "engineering", amount: 5 },
      { resource: "energy", amount: 13 },
    ],
  };

  const labelled = (layers: { labels: boolean; details: boolean }) =>
    systemContext({
      ...context({ planets: [SUN, MINED] }),
      sceneLayers: { ...NO_SOURCES.sceneLayers, labels: layers.labels, details: layers.details },
    });

  const shown = (layer: LabelsLayer) => layer.container.children.filter((h) => h.visible);

  /** What the shown holders draw, by the label each part was given. */
  const parts = (layer: LabelsLayer, label: string) =>
    shown(layer)
      .flatMap((holder) => holder.children)
      .filter((c) => c.label === label);

  const amounts = (layer: LabelsLayer) =>
    parts(layer, "amount").map((c) => (c instanceof BitmapText ? c.text : ""));

  it("centres each name's plate under its body, a dark translucent wash", () => {
    clearTextures();
    const layer = new LabelsLayer();
    layer.rebuild(labelled({ labels: true, details: false }));
    const cam = viewport(layer, 2);
    const [x, y] = MINED.layout?.at ?? [0, 0];
    const earthAt = cam.worldToScreen(x, y);
    const plate = layer.plates().find((p) => p.id === MINED.id);
    if (!plate) throw new Error("no plate for the planet");
    const top = cam.worldToScreen(plate.x, plate.y);
    expect(top.x + plate.w / 2).toBeCloseTo(earthAt.x);
    expect(top.y).toBeGreaterThan(earthAt.y);
    const fills = parts(layer, "plate").flatMap((g) =>
      g instanceof Graphics ? drawOps(g).filter((op) => op.action === "fill") : [],
    );
    expect(fills).toHaveLength(2);
    for (const fill of fills) {
      expect(fill.color).toBe(0x000000);
      expect(fill.alpha).toBeLessThan(0.5);
    }
    clearTextures();
    layer.destroy();
  });

  it("marks a colonised body's plate in its owner's colour, and no other plate", () => {
    clearTextures();
    const owner = 7;
    const colour = 0x3366cc;
    const colony = { ...MINED, colonised: true, owner };
    const layer = new LabelsLayer();
    layer.rebuild(
      systemContext({
        ...context({ planets: [SUN, colony] }),
        sceneLayers: { ...NO_SOURCES.sceneLayers, labels: true },
        ownership: {
          owners: new Map(),
          table: new Map([
            [
              owner,
              { id: owner, label: "", kind: "country", colors: { outline: colour, fill: 0 } },
            ],
          ]),
        },
      }),
    );
    viewport(layer, 2);
    const fills = parts(layer, "plate").flatMap((g) =>
      g instanceof Graphics ? drawOps(g).filter((op) => op.action === "fill") : [],
    );
    expect(fills.filter((fill) => fill.color === colour)).toHaveLength(1);
    clearTextures();
    layer.destroy();
  });

  it("shows plates alone, plates with resources, resources alone, or nothing, as Labels and Details are set", () => {
    clearTextures();
    const layer = new LabelsLayer();
    viewport(layer, 2);
    const drawn = (labels: boolean, details: boolean) => {
      layer.rebuild(labelled({ labels, details }));
      return {
        plates: parts(layer, "plate").length,
        names: parts(layer, "name").length,
        amounts: amounts(layer),
        picks: layer.plates().map((p) => p.id),
      };
    };

    expect(drawn(true, false)).toEqual({
      plates: 2,
      names: 2,
      amounts: [],
      picks: [SUN.id, MINED.id],
    });
    expect(drawn(true, true)).toEqual({
      plates: 2,
      names: 2,
      amounts: ["13", "5"],
      picks: [SUN.id, MINED.id],
    });
    expect(drawn(false, true)).toEqual({
      plates: 0,
      names: 0,
      amounts: ["13", "5"],
      picks: [MINED.id],
    });
    expect(drawn(false, false)).toEqual({ plates: 0, names: 0, amounts: [], picks: [] });
    clearTextures();
    layer.destroy();
  });

  it("borders the selected body's plate in the selection colour, and no other", () => {
    clearTextures();
    const layer = new LabelsLayer();
    layer.rebuild(labelled({ labels: true, details: false }));
    viewport(layer, 2);
    const edgeOf = (id: number) => {
      const plate = layer.plates().find((p) => p.id === id);
      const holder = shown(layer).find(
        (h) => h.position.x === plate?.x && h.position.y === plate?.y,
      );
      const g = holder?.children.find((c) => c.label === "plate");
      if (!(g instanceof Graphics)) throw new Error(`no plate for ${id}`);
      return strokes(g)[0]?.color;
    };
    layer.setHighlighted({ ...NO_HIGHLIGHT, selectedBody: MINED.id });
    expect(edgeOf(MINED.id)).toBe(ACCENT_COLOR);
    expect(edgeOf(SUN.id)).not.toBe(ACCENT_COLOR);

    layer.setHighlighted(NO_HIGHLIGHT);
    expect(edgeOf(MINED.id)).not.toBe(ACCENT_COLOR);
    clearTextures();
    layer.destroy();
  });

  it("draws the resource row under the body, where the plate would be, while Labels is off", () => {
    clearTextures();
    const layer = new LabelsLayer();
    layer.rebuild(labelled({ labels: false, details: true }));
    const cam = viewport(layer, 2);
    const [x, y] = MINED.layout?.at ?? [0, 0];
    const earthAt = cam.worldToScreen(x, y);
    const [row] = layer.plates();
    const top = cam.worldToScreen(row.x, row.y);
    expect(top.x + row.w / 2).toBeCloseTo(earthAt.x);
    expect(top.y).toBeGreaterThan(earthAt.y);
    clearTextures();
    layer.destroy();
  });
});
