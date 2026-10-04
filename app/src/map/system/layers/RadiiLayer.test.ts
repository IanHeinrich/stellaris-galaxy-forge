import { BitmapText, type Container } from "pixi.js";
import { describe, expect, it } from "vitest";
import type { PlanetSummary } from "../../../generated/PlanetSummary";
import { systemContext } from "../context";
import {
  EARTH,
  LUNA,
  MARS,
  RADII_SHOWN,
  SCENARIO_STAR,
  SUN,
  context,
  fixed,
  plateTexts,
  scenarioBody,
  stubTextMeasurement,
  viewport,
} from "../drawFixture";
import { saveBody } from "../../../test/builders";
import { drawnDisc, SELECTED_GAP_PX, SELECTED_WIDTH_PX } from "../geometry";
import { RadiiLayer } from "./RadiiLayer";

stubTextMeasurement();

describe("the system scene's radius labels", () => {
  const readouts = (container: Container) => plateTexts(container, "radius");

  it("labels each ring with its radius only while Orbit radii is on, a moon's once its ring is large on screen", () => {
    const layer = new RadiiLayer();
    const planets = [SUN, EARTH, LUNA, MARS];
    layer.rebuild(context({ planets }));
    viewport(layer, 2);
    expect(readouts(layer.container)).toEqual([]);

    const shown = systemContext({ ...context({ planets }), sceneLayers: RADII_SHOWN });
    layer.rebuild(shown);
    viewport(layer, 2);
    expect(readouts(layer.container)).toEqual(["90", "130"]);
    layer.destroy();

    const closer = new RadiiLayer();
    closer.rebuild(shown);
    viewport(closer, 4);
    expect(readouts(closer.container).sort()).toEqual(["12", "130", "90"]);
    closer.destroy();
  });

  it("gives rings drawn as one a single label spanning every radius on them", () => {
    const fixedOn = scenarioBody(2, "pc_arid", { orbit: fixed(100), angle: fixed(0) }, 1);
    const banded = scenarioBody(
      3,
      "pc_arid",
      { orbit: { min: 80, max: 120 }, angle: fixed(90) },
      1,
    );
    const rings = new RadiiLayer();
    rings.rebuild(
      systemContext({
        ...context({ planets: [SCENARIO_STAR, fixedOn, banded] }),
        sceneLayers: RADII_SHOWN,
      }),
    );
    viewport(rings, 2);
    expect(readouts(rings.container)).toEqual(["80–120"]);
    rings.destroy();
  });

  it("slides a ring's label round the ring off a body standing where the label would go, and off the ring a selection draws round it", () => {
    const labelOn = (bodies: PlanetSummary[]) => {
      const ctx = systemContext({ ...context({ planets: bodies }), sceneLayers: RADII_SHOWN });
      const layer = new RadiiLayer();
      layer.rebuild(ctx);
      const cam = viewport(layer, 2);
      const holder = layer.container.children.find(
        (h) => h.visible && h.children.some((c) => c instanceof BitmapText && c.text === "90"),
      );
      const box = holder && {
        ...cam.worldToScreen(holder.position.x, holder.position.y),
        w: holder.getLocalBounds().width * Math.abs(holder.scale.x) * cam.scale,
        h: holder.getLocalBounds().height * Math.abs(holder.scale.y) * cam.scale,
      };
      layer.destroy();
      return { ctx, cam, box };
    };
    const alone = labelOn([SUN, EARTH]);
    if (!alone.box) throw new Error("no label on Earth's ring");
    const middle = { x: alone.box.x + alone.box.w / 2, y: alone.box.y + alone.box.h / 2 };
    const toward = alone.cam.screenToWorld(middle.x, middle.y);
    const angle = Math.atan2(toward.y, toward.x);
    const spot = { x: 90 * Math.cos(angle), y: 90 * Math.sin(angle) };
    const blocker = saveBody(9, "pc_barren", [spot.x, spot.y], 90, 16, SUN);

    const { ctx, cam, box } = labelOn([SUN, EARTH, blocker]);
    if (!box) throw new Error("the label is left out");
    const disc = ctx.layout.bodies.find((b) => b.id === blocker.id)?.disc ?? 0;
    const r = drawnDisc(disc, cam.scale) * cam.scale;
    const at = cam.worldToScreen(spot.x, spot.y);
    const nearest = {
      x: Math.max(box.x, Math.min(at.x, box.x + box.w)),
      y: Math.max(box.y, Math.min(at.y, box.y + box.h)),
    };
    const ring = r + SELECTED_GAP_PX + SELECTED_WIDTH_PX;
    expect(Math.hypot(at.x - nearest.x, at.y - nearest.y)).toBeGreaterThanOrEqual(ring);
  });

  it("leaves out a ring's label with no clear spot near, drawing no plate at all", () => {
    const crowd = Array.from({ length: 72 }, (_, i) => {
      const a = (i * 5 * Math.PI) / 180;
      return saveBody(10 + i, "pc_barren", [90 * Math.cos(a), 90 * Math.sin(a)], 90, 16, SUN);
    });
    const layer = new RadiiLayer();
    layer.rebuild(
      systemContext({ ...context({ planets: [SUN, ...crowd] }), sceneLayers: RADII_SHOWN }),
    );
    viewport(layer, 2);
    expect(readouts(layer.container)).toEqual([]);
    layer.destroy();
  });
});
