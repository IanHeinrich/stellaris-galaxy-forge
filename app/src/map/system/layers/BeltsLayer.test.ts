import type { Sprite } from "pixi.js";
import { describe, expect, it } from "vitest";
import type { BeltLook } from "../../../generated/BeltLook";
import { EMPTY_SYSTEM_CONTEXT, type SceneBelt, type SystemContext } from "../context";
import { blankSceneTextures, context, viewport } from "../fixture";
import { BeltsLayer, MAX_ROCKS } from "./BeltsLayer";
import type { BeltTextures } from "./textures";

const beltTextures = () => blankSceneTextures().belt;

describe("the system scene's belts layer", () => {
  const rocky = (radius: number) =>
    context({ belts: [{ kind: "rocky_asteroid_belt", inner_radius: radius }] });

  const drawn = (look: BeltLook, over: Partial<SceneBelt> = {}): SystemContext => ({
    ...EMPTY_SYSTEM_CONTEXT,
    belts: [
      { kind: look, radius: 80, inner: 70, outer: 90, look, emissive: false, density: 1, ...over },
    ],
  });

  /** The pieces a belt is drawn with, by the name of each piece's texture. */
  const piecesOf = (layer: BeltsLayer, textures: BeltTextures): Set<string> => {
    const names = new Map(Object.entries(textures).map(([name, t]) => [t, name]));
    return new Set(layer.rocks.children.map((s) => names.get((s as Sprite).texture) ?? "?"));
  };

  const layerFor = (belt: SystemContext) => {
    const textures = beltTextures();
    const layer = new BeltsLayer(textures);
    layer.rebuild(belt);
    return { layer, pieces: piecesOf(layer, textures) };
  };

  it("scatters more rocks about a wider belt, in step with its circumference", () => {
    const narrow = new BeltsLayer(beltTextures());
    narrow.rebuild(rocky(30));
    const wide = new BeltsLayer(beltTextures());
    wide.rebuild(rocky(60));
    const few = narrow.rocks.children.length;
    const many = wide.rocks.children.length;
    expect(few).toBeGreaterThan(0);
    expect(many / few).toBeCloseTo(2, 1);
  });

  it("draws no more than its cap of rocks about a belt far out", () => {
    const layer = new BeltsLayer(beltTextures());
    layer.rebuild(rocky(1000));
    expect(layer.rocks.children.length).toBe(MAX_ROCKS);
  });

  it("keeps every rock where it was across a pan, a zoom and a rebuild from the same belt", () => {
    const layer = new BeltsLayer(beltTextures());
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

  it("draws each look from its own pieces", () => {
    const looks: BeltLook[] = ["rocky", "icy", "crystal", "debris", "dust", "fauna"];
    const sets = looks.map((look) => [...layerFor(drawn(look)).pieces].sort().join(","));
    expect(new Set(sets).size).toBe(looks.length);
    expect(layerFor(drawn("debris")).pieces).toEqual(new Set(["rock", "container", "glint"]));
    expect(layerFor(drawn("icy")).pieces).toContain("glint");
  });

  it("adds a glow among an emissive kind's pieces, and adds its light over the belt", () => {
    expect(layerFor(drawn("rocky")).pieces).not.toContain("glow");
    const { layer, pieces } = layerFor(drawn("rocky", { emissive: true }));
    expect(pieces).toContain("glow");
    const modes = new Set(layer.rocks.children.map((s) => (s as Sprite).blendMode));
    expect(modes).toContain("add");
  });

  it("scatters fewer pieces about a thinner kind", () => {
    const count = (belt: SystemContext) => layerFor(belt).layer.rocks.children.length;
    expect(count(drawn("rocky", { density: 0.3 }))).toBeLessThan(count(drawn("rocky")) / 2);
    expect(count(drawn("dust"))).toBeLessThan(count(drawn("rocky")));
  });
});
