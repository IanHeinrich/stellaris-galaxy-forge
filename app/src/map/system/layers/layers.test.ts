import { describe, expect, it, vi } from "vitest";

/** The texture fetch, held until a test lets it answer, failing the keys `fails` names. */
const fetch = vi.hoisted(() => ({
  release: null as (() => void) | null,
  fails: (() => false) as (key: string) => boolean,
}));

vi.mock("../../../api/textures", () => ({
  getTextures: (keys: string[]) =>
    new Promise((resolve) => {
      fetch.release = () =>
        resolve(
          keys.map((key) =>
            fetch.fails(key)
              ? { key, width: 0, height: 0, png_base64: null, error: "no map" }
              : { key, width: 1, height: 1, png_base64: "", error: null },
          ),
        );
    }),
}));

import { BitmapText, Container, Graphics, Sprite, Texture } from "pixi.js";
import type { BodyLayout } from "../../../generated/BodyLayout";
import type { PlanetClassView } from "../../../generated/PlanetClassView";
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
import { drawOps, strokes, stubTextMeasurement, viewport } from "../fixture";
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

/** Answers every lit-disc request with an error, as for a class with no surface map. */
function noLitDiscs(): void {
  fetch.fails = (key) => key.startsWith("planet_disc:");
}

/** Lets the held fetch answer, once the layer has asked. */
async function answerFetch(): Promise<void> {
  await vi.waitFor(() => expect(fetch.release).not.toBeNull());
  const release = fetch.release;
  forgetFetch();
  release?.();
}

/** One texture per key, so a test can tell which key a sprite shows. */
function decodeByKey(): (key: string) => Texture {
  const decoded = new Map<string, Texture>();
  const textureFor = (key: string) => {
    let texture = decoded.get(key);
    if (!texture) decoded.set(key, (texture = new Texture()));
    return texture;
  };
  setTextureDecoder((view) => Promise.resolve(textureFor(view.key)));
  return textureFor;
}

function resetTextures(): void {
  clearTextures();
  forgetFetch();
  fetch.fails = () => false;
  setTextureDecoder(null);
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
    ring: false,
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
    ringBack: new Texture(),
    ringFront: new Texture(),
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
  /** The part of a body the layer labelled `label`, if it drew one. */
  const part = (holder: Container, label: string) => holder.children.find((c) => c.label === label);
  const sprite = (holder: Container, label: string) => {
    const found = part(holder, label);
    if (!(found instanceof Sprite)) throw new Error(`no ${label} sprite`);
    return found;
  };
  const graphics = (holder: Container, label: string) => {
    const found = part(holder, label);
    return found instanceof Graphics ? found : undefined;
  };
  const outline = (holder: Container) => graphics(holder, "outline");

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
    resetTextures();
    noLitDiscs();
    setTextureDecoder(() => Promise.resolve(new Texture()));
    const known = scenarioBody(2, "pc_arid", { orbit: fixed(60), angle: fixed(0) }, 1);
    const random = scenarioBody(3, "random_colonizable", { orbit: fixed(90), angle: fixed(90) }, 1);
    const layer = new BodiesLayer(blankTextures());
    layer.rebuild(scenarioContext([SCENARIO_STAR, known, random]));
    viewport(layer, 2);
    const artShown = (holder: Container) => sprite(holder, "art").visible;

    await answerFetch();
    await vi.waitFor(() => expect(artShown(holderAt(layer, 60, 0))).toBe(true));

    const drawn = holderAt(layer, 0, 90);
    expect(artShown(drawn)).toBe(false);
    expect(sprite(drawn, "disc").visible).toBe(true);
    const glyphs = drawn.children.filter((c): c is BitmapText => c instanceof BitmapText);
    expect(glyphs.map((g) => [g.text, g.visible])).toEqual([["?", true]]);
    expect(holderAt(layer, 60, 0).children.some((c) => c instanceof BitmapText)).toBe(false);
    resetTextures();
    layer.destroy();
  });

  const hazy = (key: string): PlanetClassView => ({
    ...planetClassView(key, false),
    atmosphere_color: "#3366cc",
    atmosphere_intensity: 1,
    atmosphere_width: 0.5,
  });
  const iconed = (key: string, large: string | null = null): PlanetClassView => ({
    ...planetClassView(key, false),
    icon_sprite: `GFX_${key}`,
    icon_large_sprite: large,
  });

  /** A G star with `planets` about it, of the classes `classes` define. */
  const classedContext = (planets: PlanetSummary[], classes: PlanetClassView[]) =>
    systemContext({
      ...NO_SOURCES,
      id: SYSTEM,
      systems: byId(placedNode(SYSTEM, 0, 0)),
      details: systemDetails({ id: SYSTEM, planets: [SUN, ...planets] }),
      planetClasses: new Map(
        [planetClassView("pc_g_star"), ...classes].map((view) => [view.key, view]),
      ),
    });
  const EARTH_AT: [number, number] = [90, 0];
  const MARS_AT: [number, number] = [0, 130];

  it("draws a soft rim in the class's atmosphere colour outside the limb, and none for a class without one", () => {
    resetTextures();
    const layer = new BodiesLayer(blankTextures());
    layer.rebuild(
      classedContext([EARTH, MARS], [hazy("pc_continental"), planetClassView("pc_arid", false)]),
    );
    viewport(layer, 2);

    const earth = holderAt(layer, ...EARTH_AT);
    const limb = sprite(earth, "disc").width / 2;
    const rim = strokes(graphics(earth, "rim") ?? new Graphics());
    expect(rim.length).toBeGreaterThan(1);
    for (const stroke of rim) {
      expect(stroke.color).toBe(0x3366cc);
      const [circle] = stroke.segments;
      expect(circle[circle.length - 1]).toBeGreaterThan(limb);
    }
    const alphas = rim.map((stroke) => stroke.alpha ?? 1);
    expect(alphas).toEqual([...alphas].sort((a, b) => b - a));
    expect(alphas[alphas.length - 1]).toBeLessThan(alphas[0]);
    const at = (label: string) => earth.children.indexOf(part(earth, label) ?? earth);
    expect(at("rim")).toBeGreaterThan(at("shade"));

    expect(part(holderAt(layer, ...MARS_AT), "rim")).toBeUndefined();
    layer.destroy();
  });

  it("fades a ghost's rim with the body", () => {
    resetTextures();
    const ghost = scenarioBody(2, "pc_continental", { orbit: fixed(70) }, 1);
    const layer = new BodiesLayer(blankTextures());
    layer.rebuild(
      systemContext({
        ...NO_SOURCES,
        id: SYSTEM,
        systems: byId(placedNode(SYSTEM, 0, 0)),
        details: systemDetails({ id: SYSTEM, planets: [SCENARIO_STAR, ghost] }),
        planetClasses: new Map([["pc_continental", hazy("pc_continental")]]),
      }),
    );
    viewport(layer, 2);
    expect(graphics(holderAt(layer, 70, 0), "rim")?.alpha).toBeLessThan(0.6);
    layer.destroy();
  });

  it("draws a ring's far half behind the disc and its near half in front, a ring left to chance faded and dashed, and no ring when there is none", () => {
    resetTextures();
    const textures = blankTextures();
    const bare = saveBody(5, "pc_barren", [-150, 0], 150, 1);
    const layer = new BodiesLayer(textures);
    layer.rebuild(
      classedContext(
        [
          { ...EARTH, ring: true },
          { ...MARS, ring: null },
          { ...bare, ring: false },
        ],
        [planetClassView("pc_continental", false), planetClassView("pc_arid", false)],
      ),
    );
    viewport(layer, 2);

    const ringed = holderAt(layer, ...EARTH_AT);
    const at = (label: string) => ringed.children.indexOf(sprite(ringed, label));
    expect(at("ringBack")).toBeLessThan(at("disc"));
    expect(at("ringFront")).toBeGreaterThan(at("shade"));
    expect(sprite(ringed, "ringBack").texture).toBe(textures.ringBack);
    expect(sprite(ringed, "ringFront").texture).toBe(textures.ringFront);
    const disc = sprite(ringed, "disc").width;
    for (const half of [sprite(ringed, "ringBack"), sprite(ringed, "ringFront")]) {
      expect(half.alpha).toBe(1);
      expect(half.width).toBeGreaterThan(2 * disc);
      expect(half.height).toBeLessThan(disc);
      expect(half.rotation).not.toBe(0);
    }
    expect(part(ringed, "ringDashes")).toBeUndefined();

    const chance = holderAt(layer, ...MARS_AT);
    for (const label of ["ringBack", "ringFront"]) {
      expect(sprite(chance, label).alpha).toBeLessThan(0.6);
    }
    const dashes = strokes(graphics(chance, "ringDashes") ?? new Graphics());
    expect(dashes).toHaveLength(1);
    expect(dashes[0].segments.length).toBeGreaterThan(1);

    const none = holderAt(layer, -150, 0);
    for (const label of ["ringBack", "ringFront", "ringDashes"]) {
      expect(part(none, label)).toBeUndefined();
    }
    layer.destroy();
  });

  it("swaps the tinted disc for the class's lit disc once it lands, turned to face the star under the same shading", async () => {
    resetTextures();
    const textureFor = decodeByKey();
    fetch.fails = (key) => key === "planet_disc:pc_continental";
    const layer = new BodiesLayer(blankTextures());
    layer.rebuild(classedContext([EARTH, MARS], [iconed("pc_continental"), iconed("pc_arid")]));
    viewport(layer, 2);
    const mars = holderAt(layer, ...MARS_AT);
    expect(sprite(mars, "disc").visible).toBe(true);
    expect(sprite(mars, "lit").visible).toBe(false);

    await answerFetch();
    await vi.waitFor(() => expect(sprite(mars, "lit").visible).toBe(true));
    const lit = sprite(mars, "lit");
    const shade = sprite(mars, "shade");
    expect(lit.texture).toBe(textureFor("planet_disc:pc_arid"));
    expect(sprite(mars, "disc").visible).toBe(false);
    expect(sprite(mars, "art").visible).toBe(false);
    expect(shade.visible).toBe(true);
    expect(mars.children.indexOf(shade)).toBeGreaterThan(mars.children.indexOf(lit));
    expect(shade.rotation).toBeCloseTo(-Math.PI / 2);
    expect(lit.rotation).toBe(shade.rotation);
    // Mirrored, so the left-lit bake's light lies along +x, where the mask's does.
    expect(lit.scale.x).toBeLessThan(0);
    expect(lit.width).toBeCloseTo(sprite(mars, "disc").width);

    const earth = holderAt(layer, ...EARTH_AT);
    expect(sprite(earth, "disc").visible).toBe(true);
    expect(sprite(earth, "lit").visible).toBe(false);
    expect(sprite(earth, "art").visible).toBe(true);
    expect(sprite(earth, "art").texture).toBe(textureFor("sprite:GFX_pc_continental"));
    resetTextures();
    layer.destroy();
  });

  it("shows the class's large icon while the disc is large on screen, and its small one otherwise", async () => {
    resetTextures();
    noLitDiscs();
    const textureFor = decodeByKey();
    const layer = new BodiesLayer(blankTextures());
    layer.rebuild(classedContext([MARS], [iconed("pc_arid", "GFX_pc_arid_big")]));
    viewport(layer, 1);
    const art = () => sprite(holderAt(layer, ...MARS_AT), "art");

    await answerFetch();
    await vi.waitFor(() => expect(art().texture).toBe(textureFor("sprite:GFX_pc_arid")));

    viewport(layer, 12);
    await answerFetch();
    await vi.waitFor(() => expect(art().texture).toBe(textureFor("sprite:GFX_pc_arid_big")));
    expect(art().visible).toBe(true);

    viewport(layer, 1);
    expect(art().texture).toBe(textureFor("sprite:GFX_pc_arid"));
    resetTextures();
    layer.destroy();
  });
});
