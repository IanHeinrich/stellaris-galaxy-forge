import type { Container, Graphics } from "pixi.js";
import { describe, expect, it } from "vitest";
import { ACCENT_COLOR, MATCHED_COLOR } from "../../../lib/visual/style";
import { selectedWormhole, systemContext } from "../context";
import {
  EARTH,
  LUNA,
  MARS,
  SCENARIO_STAR,
  SUN,
  SYSTEM,
  context,
  drawOps,
  fixed,
  plateTexts,
  scenarioBody,
  strokes,
  stubTextMeasurement,
  viewport,
  WORMHOLE,
} from "../fixture";
import { drawnWormhole, SELECTED_GAP_PX } from "../geometry";
import { HighlightLayer } from "./HighlightLayer";
import { NO_HIGHLIGHT } from "./SystemLayer";
import { HOVER_GROW } from "./WormholesLayer";

stubTextMeasurement();

/** The radius of every hole cut out of the graphics' fills, rounded. */
function holeRadii(g: Graphics): number[] {
  return g.context.instructions.flatMap((instruction) => {
    const { hole } = instruction.data as {
      hole?: { instructions: { action: string; data: unknown[] }[] };
    };
    const circles = (hole?.instructions ?? []).filter((step) => step.action === "circle");
    return circles.map((step) => Math.round(step.data[2] as number));
  });
}

describe("the system scene's radius line", () => {
  const readouts = (container: Container) => plateTexts(container, "radius");

  it("draws a line out to the selected body with its radius on a plate, and nothing without a selection", () => {
    const layer = new HighlightLayer();
    layer.rebuild(context({ planets: [SUN, EARTH, LUNA, MARS] }));
    viewport(layer, 2);
    expect(strokes(layer.walk.radiusLine)).toEqual([]);
    expect(readouts(layer.container)).toEqual([]);

    layer.setHighlighted({ ...NO_HIGHLIGHT, selectedBody: EARTH.id });
    expect(strokes(layer.walk.radiusLine)).toHaveLength(1);
    expect(readouts(layer.container)).toEqual(["90"]);

    layer.setHighlighted({ ...NO_HIGHLIGHT, selectedBody: SUN.id });
    expect(strokes(layer.walk.radiusLine)).toEqual([]);
    expect(readouts(layer.container)).toEqual([]);
    layer.destroy();
  });

  it("gives a banded body's line its range alone", () => {
    const fixedOn = scenarioBody(2, "pc_arid", { orbit: fixed(100), angle: fixed(0) }, 1);
    const banded = scenarioBody(
      3,
      "pc_arid",
      { orbit: { min: 80, max: 120 }, angle: fixed(90) },
      1,
    );
    const line = new HighlightLayer();
    line.rebuild(context({ planets: [SCENARIO_STAR, fixedOn, banded] }));
    viewport(line, 2);
    line.setHighlighted({ ...NO_HIGHLIGHT, selectedBody: banded.id });
    expect(readouts(line.container)).toEqual(["80–120"]);
    line.destroy();
  });
});

describe("the system scene's orbit band", () => {
  it("shows the selected body's band faintly, and none for a body on a fixed orbit", () => {
    const banded = scenarioBody(
      2,
      "pc_arid",
      { orbit: { min: 60, max: 100 }, angle: fixed(45) },
      1,
    );
    const turning = scenarioBody(
      3,
      "pc_desert",
      { orbit: fixed(130), angle: { min: 0, max: 90 } },
      1,
    );
    const bandOf = (selected: number | null) => {
      const highlight = new HighlightLayer();
      highlight.rebuild(context({ planets: [SCENARIO_STAR, banded, turning] }));
      viewport(highlight, 2);
      highlight.setHighlighted({ ...NO_HIGHLIGHT, selectedBody: selected });
      const band = drawOps(highlight.walk.band);
      const holes = holeRadii(highlight.walk.band);
      highlight.destroy();
      return { fills: band.filter((op) => op.action === "fill"), holes };
    };
    const { fills, holes } = bandOf(2);
    expect(fills.map((op) => op.segments)).toEqual([[[0, 0, 100]]]);
    expect(fills[0].alpha).toBeLessThan(1);
    expect(holes).toEqual([60]);
    expect(bandOf(null).fills).toEqual([]);
    expect(bandOf(3).fills).toEqual([]);
  });
});

describe("the system scene's turn wedge", () => {
  const turns = (container: Container) => plateTexts(container, "turn");

  const walk = [
    SCENARIO_STAR,
    scenarioBody(2, "pc_arid", {
      orbit: fixed(60),
      angle: { min: 90, max: 270 },
      orbit_step: fixed(60),
      angle_step: { min: 90, max: 270 },
      turns_from: 1,
    }),
    scenarioBody(3, "pc_arid", {
      orbit: fixed(100),
      orbit_step: fixed(40),
      turns_from: 2,
    }),
    scenarioBody(4, "pc_arid", {
      orbit: fixed(140),
      angle: { min: 90, max: 630 },
      orbit_step: fixed(40),
      angle_step: { min: 0, max: 360 },
      turns_from: 3,
    }),
    scenarioBody(
      5,
      "pc_barren",
      {
        orbit: fixed(10),
        angle: { min: 270, max: 450 },
        orbit_step: fixed(10),
        angle_step: { min: 90, max: 270 },
      },
      2,
    ),
  ];
  const wedged = (kind: "save" | "scenario", selected: number | null) => {
    const layer = new HighlightLayer();
    const ctx = context({ planets: walk });
    layer.rebuild(systemContext({ ...ctx, roll: kind === "save" ? null : ctx.roll }));
    viewport(layer, 2);
    layer.setHighlighted({ ...NO_HIGHLIGHT, selectedBody: selected });
    const drawn = {
      rays: [layer.walk.turnRayMin, layer.walk.turnRayMax].map((g) => strokes(g).length),
      arc: strokes(layer.walk.turnArc).length,
      labels: turns(layer.container),
    };
    layer.destroy();
    return drawn;
  };

  it("shows two rays, the lit stretch of ring and the turn for a selected scenario body, the whole ring for one naming no angle, and nothing without a selection", () => {
    expect(wedged("scenario", 2)).toEqual({ rays: [1, 1], arc: 1, labels: ["+90–270°"] });
    expect(wedged("scenario", 4)).toEqual({ rays: [0, 0], arc: 1, labels: ["any angle"] });
    expect(wedged("scenario", 3)).toEqual({ rays: [0, 0], arc: 1, labels: ["any angle"] });
    const none = { rays: [0, 0], arc: 0, labels: [] };
    expect(wedged("scenario", null)).toEqual(none);
    expect(wedged("save", 2)).toEqual(none);
  });

  const measured = (
    kind: "save" | "scenario",
    selected: number | null,
    linked = null as number | null,
  ) => {
    const layer = new HighlightLayer();
    const ctx = context({ planets: walk });
    layer.rebuild(systemContext({ ...ctx, roll: kind === "save" ? null : ctx.roll }));
    viewport(layer, 2);
    layer.setHighlighted({ ...NO_HIGHLIGHT, selectedBody: selected, linkedBody: linked });
    const texts = plateTexts(layer.container, "step");
    const outline = strokes(layer.walk.anchorRing);
    const drawn = {
      anchor: outline.length,
      anchorColor: outline[0]?.color,
      anchorAlpha: outline[0]?.alpha,
      ray: strokes(layer.walk.anchorRay).length,
      base: strokes(layer.walk.baseCircle).length,
      step: strokes(layer.walk.stepLine).length,
      steps: texts,
    };
    layer.destroy();
    return drawn;
  };

  it("marks what a selected scenario body is measured from in cyan: the body it turns from, the orbit it steps out from and the step", () => {
    const { anchorAlpha, ...marks } = measured("scenario", 4);
    expect(marks).toEqual({
      anchor: 1,
      anchorColor: MATCHED_COLOR,
      ray: 1,
      base: 1,
      step: 1,
      steps: ["+40"],
    });
    expect(measured("scenario", 4, 3).anchorAlpha).toBeGreaterThan(anchorAlpha ?? 1);
    const none = {
      anchor: 0,
      anchorColor: undefined,
      anchorAlpha: undefined,
      ray: 0,
      base: 0,
      step: 0,
      steps: [],
    };
    expect(measured("scenario", null)).toEqual(none);
    expect(measured("save", 4)).toEqual(none);
  });

  it("marks no anchor for the first planet after the star or a planet's first moon, and keeps their wedge", () => {
    for (const id of [2, 5]) {
      expect(measured("scenario", id)).toMatchObject({ anchor: 0, ray: 0, base: 0, step: 0 });
      expect(wedged("scenario", id)).toEqual({ rays: [1, 1], arc: 1, labels: ["+90–270°"] });
    }
  });
});

describe("the system scene's selected wormhole", () => {
  it("rings the wormhole whose page is open just past its swirl, grown with it under the pointer", () => {
    const ctx = context({});
    const page = { kind: "wormhole" as const, system: SYSTEM, id: WORMHOLE.id };
    expect(selectedWormhole(ctx, page)).toBe(WORMHOLE.id);
    expect(selectedWormhole(ctx, { ...page, system: SYSTEM + 1 })).toBeNull();

    const layer = new HighlightLayer();
    layer.rebuild(ctx);
    viewport(layer, 1);
    expect(strokes(layer.wormholeRing)).toEqual([]);

    layer.setHighlighted({ ...NO_HIGHLIGHT, selectedWormhole: WORMHOLE.id });
    const [ring] = strokes(layer.wormholeRing);
    expect(ring.color).toBe(ACCENT_COLOR);
    expect(ring.segments).toEqual([[WORMHOLE.x, WORMHOLE.y, drawnWormhole(1) + SELECTED_GAP_PX]]);

    layer.setHighlighted({
      ...NO_HIGHLIGHT,
      selectedWormhole: WORMHOLE.id,
      hover: { kind: "wormhole", id: WORMHOLE.id },
    });
    const [grown] = strokes(layer.wormholeRing);
    expect(grown.segments[0][2]).toBeCloseTo(drawnWormhole(1) * HOVER_GROW + SELECTED_GAP_PX);

    layer.setHighlighted(NO_HIGHLIGHT);
    expect(strokes(layer.wormholeRing)).toEqual([]);
    layer.destroy();
  });
});
