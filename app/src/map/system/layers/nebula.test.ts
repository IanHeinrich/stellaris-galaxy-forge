import { Sprite, Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import { byId, placedNode, systemDetails } from "../../../test/builders";
import { NO_SOURCES, systemContext, type SystemContext } from "../context";
import { viewport } from "../fixture";
import { NebulaLayer } from "./NebulaLayer";

const INNER = 120;
const FIELD = new Texture();

function context(id: number, nebula: number | null, nebulaShown = true): SystemContext {
  return systemContext({
    ...NO_SOURCES,
    nebulaShown,
    id,
    systems: byId({ ...placedNode(id, 0, 0), nebula }),
    details: systemDetails({ id, inner_radius: INNER }),
  });
}

function drawn(ctx: SystemContext): NebulaLayer {
  const layer = new NebulaLayer(FIELD);
  layer.rebuild(ctx);
  viewport(layer, 1);
  return layer;
}

const sprites = (layer: NebulaLayer) => layer.field.children as Sprite[];
const poses = (layer: NebulaLayer) => sprites(layer).map((s) => [s.rotation, s.scale.x, s.scale.y]);

describe("NebulaLayer", () => {
  it("draws the field faintly about the centre of a system in a nebula, well past its edge", () => {
    const layer = drawn(context(5, 0));
    expect(sprites(layer).length).toBeGreaterThan(0);
    for (const sprite of sprites(layer)) {
      expect(sprite.texture).toBe(FIELD);
      expect([sprite.x, sprite.y]).toEqual([0, 0]);
      expect(Math.min(sprite.width, sprite.height)).toBeGreaterThanOrEqual(5 * INNER);
      expect(sprite.alpha).toBeLessThanOrEqual(0.2);
    }
  });

  it("draws nothing outside a nebula or while the scene's Nebulae switch is off, and the same once it is back on", () => {
    expect(sprites(drawn(context(6, null)))).toHaveLength(0);
    const layer = drawn(context(5, 0));
    const before = poses(layer);
    layer.rebuild(context(5, 0, false));
    expect(sprites(layer)).toHaveLength(0);
    layer.rebuild(context(5, null));
    expect(sprites(layer)).toHaveLength(0);
    layer.rebuild(context(5, 0));
    expect(poses(layer)).toEqual(before);
  });

  it("keeps the same system's sprites across rebuilds, and turns or mirrors another system's", () => {
    const layer = drawn(context(5, 0));
    const before = [...sprites(layer)];
    layer.rebuild(context(5, 0));
    expect(sprites(layer)).toHaveLength(before.length);
    sprites(layer).forEach((sprite, i) => expect(sprite).toBe(before[i]));
    expect(poses(drawn(context(5, 2)))).toEqual(poses(layer));
    expect(poses(drawn(context(6, 0)))).not.toEqual(poses(layer));
  });
});
