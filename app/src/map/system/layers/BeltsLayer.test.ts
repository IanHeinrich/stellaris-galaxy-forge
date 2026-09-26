import { Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import { context, viewport } from "../fixture";
import { BeltsLayer, MAX_ROCKS } from "./BeltsLayer";

describe("the system scene's belts layer", () => {
  const rocky = (radius: number) =>
    context({ belts: [{ kind: "rocky_asteroid_belt", inner_radius: radius }] });

  it("scatters more rocks about a wider belt, in step with its circumference", () => {
    const narrow = new BeltsLayer(Texture.WHITE);
    narrow.rebuild(rocky(30));
    const wide = new BeltsLayer(Texture.WHITE);
    wide.rebuild(rocky(60));
    const few = narrow.rocks.children.length;
    const many = wide.rocks.children.length;
    expect(few).toBeGreaterThan(0);
    expect(many / few).toBeCloseTo(2, 1);
  });

  it("draws no more than its cap of rocks about a belt far out", () => {
    const layer = new BeltsLayer(Texture.WHITE);
    layer.rebuild(rocky(1000));
    expect(layer.rocks.children.length).toBe(MAX_ROCKS);
  });

  it("keeps every rock where it was across a pan, a zoom and a rebuild from the same belt", () => {
    const layer = new BeltsLayer(Texture.WHITE);
    layer.rebuild(rocky(80));
    viewport(layer, 2);
    const where = () => layer.rocks.children.map((rock) => [rock.x, rock.y]);
    const before = where();
    viewport(layer, 2, { x: 30, y: -12 });
    viewport(layer, 5, { x: 30, y: -12 });
    expect(where()).toEqual(before);
    layer.rebuild(rocky(80));
    expect(where()).toEqual(before);
  });
});
