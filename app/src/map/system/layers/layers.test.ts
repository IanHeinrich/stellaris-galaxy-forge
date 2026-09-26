import { describe, expect, it, vi } from "vitest";

/** The texture fetch, held until a test lets it answer. */
const fetch = vi.hoisted(() => ({ release: null as (() => void) | null }));

vi.mock("../../../api/textures", () => ({
  getTextures: (keys: string[]) =>
    new Promise((resolve) => {
      fetch.release = () =>
        resolve(keys.map((key) => ({ key, width: 1, height: 1, png_base64: "", error: null })));
    }),
}));

import { BitmapText, Container, Graphics, Sprite, Texture } from "pixi.js";
import type { BodyLayout } from "../../../generated/BodyLayout";
import type { PlanetSummary } from "../../../generated/PlanetSummary";
import type { SystemDetails } from "../../../generated/SystemDetails";
import { clearTextures, setTextureDecoder } from "../../../lib/visual/textures";
import {
  byId,
  placedNode,
  planetClassView,
  planetSummary,
  starClassView,
  systemDetails,
} from "../../../test/builders";
import { NO_SOURCES, systemContext, type SystemContext } from "../context";
import { drawOps, stubTextMeasurement, viewport } from "../fixture";
import { BeltsLayer, MAX_ROCKS } from "./BeltsLayer";
import { BodiesLayer } from "./BodiesLayer";
import { ExitsLayer } from "./ExitsLayer";
import { OrbitsLayer } from "./OrbitsLayer";
import type { SceneTextures } from "./textures";

stubTextMeasurement();

const SYSTEM = 5;

/** Drops the last fetch's answer, so a test waits for its own. */
function forgetFetch(): void {
  fetch.release = null;
}

function saveBody(
  id: number,
  planetClass: string,
  at: [number, number],
  orbit: number,
  parent: number | null = null,
): PlanetSummary {
  const layout: BodyLayout = {
    orbit: { min: orbit, max: orbit },
    angle: null,
    at,
    size: { min: 16, max: 16 },
  };
  return planetSummary({ id, class: planetClass, parent, moon: parent !== null, orbit, layout });
}

const SUN = saveBody(1, "pc_g_star", [0, 0], 0);
const EARTH = saveBody(2, "pc_continental", [90, 0], 90, 1);
const LUNA = saveBody(3, "pc_barren", [102, 0], 12, 2);
const MARS = saveBody(4, "pc_arid", [0, 130], 130, 1);

const fixed = (value: number) => ({ min: value, max: value });

/** A scenario body: placed by `orbit` and `angle` about its parent, with no point of its own. */
function scenarioBody(
  id: number,
  planetClass: string,
  layout: Partial<BodyLayout>,
  parent: number | null = null,
): PlanetSummary {
  return planetSummary({
    id,
    class: planetClass,
    parent,
    layout: { orbit: null, angle: null, at: null, size: fixed(16), ...layout },
  });
}

const SCENARIO_STAR = scenarioBody(1, "pc_g_star", { orbit: fixed(0), angle: fixed(0) });

function blankTextures(): SceneTextures {
  return {
    disc: new Texture(),
    glow: new Texture(),
    shade: new Texture(),
    gloss: new Texture(),
    rock: new Texture(),
  };
}

function context(details: Partial<SystemDetails>): SystemContext {
  const home = placedNode(SYSTEM, 0, 0, [6, 7]);
  return systemContext({
    ...NO_SOURCES,
    id: SYSTEM,
    systems: byId(
      { ...home, bypass_ids: [8] },
      placedNode(6, 100, 0, [SYSTEM]),
      placedNode(7, 0, 100, [SYSTEM]),
      placedNode(8, -100, 0),
    ),
    details: systemDetails({ id: SYSTEM, inner_radius: 160, ...details }),
  });
}

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

/** The radius of every arc the graphics has stroked, rounded, once each. */
function arcRadii(g: Graphics): number[] {
  const radii = new Set<number>();
  for (const op of drawOps(g)) {
    if (op.action !== "stroke") continue;
    for (const segment of op.segments) {
      if (segment.length >= 5) radii.add(Math.round(segment[4]));
    }
  }
  return [...radii].sort((a, b) => a - b);
}

describe("the system scene's orbits layer", () => {
  it("strokes each orbit about its parent, and the inner radius on its own", () => {
    const layer = new OrbitsLayer();
    layer.rebuild(context({ planets: [SUN, EARTH, LUNA, MARS] }));
    viewport(layer, 2);
    expect(arcRadii(layer.rings)).toEqual([12, 90, 130]);
    expect(arcRadii(layer.inner)).toEqual([160]);
    expect(drawOps(layer.bands)).toEqual([]);
    expect(drawOps(layer.arcs)).toEqual([]);
  });

  it("fills a ranged orbit's band between its two radii, and strokes a ranged angle's arc along its ring", () => {
    const layer = new OrbitsLayer();
    const banded = scenarioBody(
      2,
      "pc_arid",
      { orbit: { min: 60, max: 100 }, angle: fixed(45) },
      1,
    );
    const arced = scenarioBody(
      3,
      "pc_desert",
      { orbit: fixed(130), angle: { min: 0, max: 90 } },
      1,
    );
    layer.rebuild(context({ planets: [SCENARIO_STAR, banded, arced] }));
    viewport(layer, 2);

    const fills = drawOps(layer.bands).filter((op) => op.action === "fill");
    expect(fills.map((op) => op.segments)).toEqual([[[0, 0, 100]]]);
    expect(fills[0].alpha).toBeLessThan(0.5);
    expect(holeRadii(layer.bands)).toEqual([60]);

    const arcs = drawOps(layer.arcs).filter((op) => op.action === "stroke");
    expect(arcs).toHaveLength(1);
    expect(arcs[0].segments).toHaveLength(1);
    const [, , cx, cy, radius, from, to] = arcs[0].segments[0];
    expect([cx, cy, radius]).toEqual([0, 0, 130]);
    expect(from).toBeCloseTo(0);
    expect(to).toBeCloseTo(Math.PI / 2);
    expect(arcs[0].alpha).toBeGreaterThan(0.45);
    expect(arcRadii(layer.rings)).toEqual([80, 130]);
  });

  it("strokes a ghost's whole ring as its arc", () => {
    const layer = new OrbitsLayer();
    const ghost = scenarioBody(2, "pc_arid", { orbit: fixed(70) }, 1);
    layer.rebuild(context({ planets: [SCENARIO_STAR, ghost] }));
    viewport(layer, 2);
    const [arc] = drawOps(layer.arcs).filter((op) => op.action === "stroke");
    const [, , , , radius, from, to] = arc.segments[0];
    expect(radius).toBe(70);
    expect(to - from).toBeCloseTo(2 * Math.PI);
  });
});

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

describe("the system scene's exits layer", () => {
  it("draws one arrow per hyperlane, named for the neighbour, and none for a bypass", () => {
    const layer = new ExitsLayer();
    const ctx = context({});
    layer.rebuild(ctx);
    viewport(layer, 2);
    expect(drawOps(layer.arrows).filter((op) => op.action === "fill").length).toBe(2);
    expect(ctx.exits.map((exit) => exit.neighbour).sort()).toEqual([6, 7]);
    expect(ctx.exits.map((exit) => exit.name).sort()).toEqual(["S6", "S7"]);
  });

  it("points each arrow along the galaxy bearing to its neighbour, outside the inner radius", () => {
    const ctx = context({});
    const east = ctx.exits.find((exit) => exit.neighbour === 6);
    expect(east?.dx).toBeCloseTo(1);
    expect(east?.dy).toBeCloseTo(0);
    expect(east?.radius).toBe(160);
  });
});

describe("the system scene's bodies layer", () => {
  it("draws a star's art only once it has landed, added over the dark, with no disc or glow", async () => {
    clearTextures();
    const art = new Texture();
    setTextureDecoder(() => Promise.resolve(art));
    const textures = blankTextures();
    const ctx = systemContext({
      ...NO_SOURCES,
      id: SYSTEM,
      systems: byId(placedNode(SYSTEM, 0, 0)),
      details: systemDetails({ id: SYSTEM, planets: [SUN] }),
      starClasses: new Map([["sc_g", starClassView("sc_g", "pc_g_star")]]),
    });
    const layer = new BodiesLayer(textures);
    layer.rebuild(ctx);
    viewport(layer, 2);
    const star = layer.container.children[0] as Container;
    const shown = () => star.children.filter((c): c is Sprite => c instanceof Sprite && c.visible);

    expect(shown().map((s) => s.texture)).toEqual([textures.glow, textures.disc]);
    expect(shown().some((s) => s.blendMode === "add")).toBe(false);

    await vi.waitFor(() => expect(fetch.release).not.toBeNull());
    fetch.release?.();
    await vi.waitFor(() => expect(shown().map((s) => s.texture)).toEqual([art]));
    expect(shown()[0].blendMode).toBe("add");

    clearTextures();
    expect(shown().map((s) => s.texture)).toEqual([textures.glow, textures.disc]);
    setTextureDecoder(null);
    layer.destroy();
  });

  const scenarioContext = (planets: PlanetSummary[]) =>
    systemContext({
      ...NO_SOURCES,
      id: SYSTEM,
      systems: byId(placedNode(SYSTEM, 0, 0)),
      details: systemDetails({ id: SYSTEM, planets }),
      planetClasses: new Map([
        ["pc_g_star", planetClassView("pc_g_star")],
        ["pc_arid", { ...planetClassView("pc_arid", false), icon_sprite: "GFX_arid" }],
        [
          "random_colonizable",
          { ...planetClassView("random_colonizable", false), icon_sprite: "GFX_random" },
        ],
      ]),
    });

  /** The holder a body is drawn in, found by its drawn point. */
  const holderAt = (layer: BodiesLayer, x: number, y: number) => {
    const holder = layer.container.children.find(
      (c) => Math.abs(c.x - x) < 1e-6 && Math.abs(c.y - y) < 1e-6,
    );
    if (!(holder instanceof Container)) throw new Error(`no body at ${x}, ${y}`);
    return holder;
  };
  const sprites = (holder: Container) =>
    holder.children.filter((c): c is Sprite => c instanceof Sprite);
  const outline = (holder: Container) =>
    holder.children.find((c): c is Graphics => c instanceof Graphics);

  it("draws a body with no angle as a faded disc with a dashed outline", () => {
    clearTextures();
    const ghost = scenarioBody(2, "pc_arid", { orbit: fixed(70) }, 1);
    const placed = scenarioBody(3, "pc_arid", { orbit: fixed(90), angle: fixed(90) }, 1);
    const layer = new BodiesLayer(blankTextures());
    layer.rebuild(scenarioContext([SCENARIO_STAR, ghost, placed]));
    viewport(layer, 2);

    const faded = holderAt(layer, 70, 0);
    for (const sprite of sprites(faded)) expect(sprite.alpha).toBeLessThan(0.6);
    const dashes = drawOps(outline(faded) ?? new Graphics()).filter((op) => op.action === "stroke");
    expect(dashes).toHaveLength(1);
    expect(dashes[0].segments.length).toBeGreaterThan(1);

    const solid = holderAt(layer, 0, 90);
    for (const sprite of sprites(solid)) expect(sprite.alpha).toBe(1);
    expect(outline(solid)).toBeUndefined();
    layer.destroy();
  });

  it("draws a random class as its tinted disc with a question mark, and no class icon", async () => {
    clearTextures();
    forgetFetch();
    setTextureDecoder(() => Promise.resolve(new Texture()));
    const known = scenarioBody(2, "pc_arid", { orbit: fixed(60), angle: fixed(0) }, 1);
    const random = scenarioBody(3, "random_colonizable", { orbit: fixed(90), angle: fixed(90) }, 1);
    const layer = new BodiesLayer(blankTextures());
    layer.rebuild(scenarioContext([SCENARIO_STAR, known, random]));
    viewport(layer, 2);
    const artShown = (holder: Container) => sprites(holder)[1].visible;

    await vi.waitFor(() => expect(fetch.release).not.toBeNull());
    fetch.release?.();
    await vi.waitFor(() => expect(artShown(holderAt(layer, 60, 0))).toBe(true));

    const drawn = holderAt(layer, 0, 90);
    expect(artShown(drawn)).toBe(false);
    expect(sprites(drawn)[0].visible).toBe(true);
    const glyphs = drawn.children.filter((c): c is BitmapText => c instanceof BitmapText);
    expect(glyphs.map((g) => [g.text, g.visible])).toEqual([["?", true]]);
    expect(holderAt(layer, 60, 0).children.some((c) => c instanceof BitmapText)).toBe(false);
    setTextureDecoder(null);
    layer.destroy();
  });
});
