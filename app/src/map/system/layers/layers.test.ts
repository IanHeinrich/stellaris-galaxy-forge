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

import { BitmapText, Container, Graphics, Mesh, Sprite, Texture } from "pixi.js";
import type { BodyLayout } from "../../../generated/BodyLayout";
import type { PlanetClassView } from "../../../generated/PlanetClassView";
import type { PlanetSummary } from "../../../generated/PlanetSummary";
import type { SystemDetails } from "../../../generated/SystemDetails";
import { starGlyph } from "../../../lib/visual/starGlyphs";
import { ACCENT_COLOR } from "../../../lib/visual/style";
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
import { STAR_ART_BLEND } from "../../layers/StarClusters";
import { BeltsLayer, ICY_TINT, MAX_ROCKS } from "./BeltsLayer";
import { BodiesLayer } from "./BodiesLayer";
import { ExitsLayer } from "./ExitsLayer";
import { LabelsLayer } from "./LabelsLayer";
import { OrbitsLayer } from "./OrbitsLayer";
import { NO_HIGHLIGHT } from "./SystemLayer";
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
    nebula: new Texture(),
    glow: new Texture(),
    corona: new Texture(),
    beam: new Texture(),
    plume: new Texture(),
    halo: new Texture(),
    swirl: new Texture(),
    wisps: new Texture(),
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

/** The radii of the dashed arcs `g` strokes. */
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

/** The radii of the whole circles `g` strokes, each laid down as `[x, y, r]`. */
function circleRadii(g: Graphics): number[] {
  const radii: number[] = [];
  for (const op of drawOps(g)) {
    if (op.action !== "stroke" || !op.steps.every((step) => step === "circle")) continue;
    const numbers = op.segments.flat();
    for (let i = 2; i < numbers.length; i += 3) radii.push(Math.round(numbers[i]));
  }
  return radii.sort((a, b) => a - b);
}

describe("the system scene's orbits layer", () => {
  it("strokes each orbit whole and faint about its parent, and the inner radius dashed on its own", () => {
    const layer = new OrbitsLayer();
    layer.rebuild(context({ planets: [SUN, EARTH, LUNA, MARS] }));
    viewport(layer, 2);
    expect(circleRadii(layer.rings)).toEqual([12, 90, 130]);
    const [rings] = drawOps(layer.rings).filter((op) => op.action === "stroke");
    expect(rings.alpha).toBeLessThan(0.2);
    expect(circleRadii(layer.inner)).toEqual([]);
    expect(arcRadii(layer.inner)).toEqual([160]);
    expect(drawOps(layer.bands)).toEqual([]);
    expect(drawOps(layer.arcs)).toEqual([]);
  });

  it("strokes an orbit bodies share once, within a pixel, so it shows no brighter than the rest", () => {
    const layer = new OrbitsLayer();
    const twin = saveBody(5, "pc_barren", [0, -130], 130, 1);
    // The save's orbits of bodies on one ring differ by a fraction of a unit.
    const near = saveBody(6, "pc_barren", [-130.3, 0], 130.3, 1);
    layer.rebuild(context({ planets: [SUN, EARTH, MARS, twin, near] }));
    viewport(layer, 2);
    expect(circleRadii(layer.rings)).toEqual([90, 130]);
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
    expect(circleRadii(layer.rings)).toEqual([80, 130]);
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
  /** A system of the one star `planetClass`, of the star class `starClass`. */
  const starContext = (planetClass: string, starClass: string) =>
    systemContext({
      ...NO_SOURCES,
      id: SYSTEM,
      systems: byId(placedNode(SYSTEM, 0, 0)),
      details: systemDetails({ id: SYSTEM, planets: [saveBody(1, planetClass, [0, 0], 0)] }),
      starClasses: new Map([[starClass, starClassView(starClass, planetClass)]]),
    });

  it("draws a scenario's bare star as the class its initializer gives the system, surface and beams alike", () => {
    const ctx = systemContext({
      ...NO_SOURCES,
      kind: "scenario",
      id: SYSTEM,
      systems: byId({ ...placedNode(SYSTEM, 0, 0), star_class: "", initializer: "pulsar_init" }),
      details: systemDetails({
        id: SYSTEM,
        planets: [scenarioBody(1, "star", { orbit: fixed(0), angle: fixed(0) })],
      }),
      starClasses: new Map([["sc_pulsar", starClassView("sc_pulsar", "pc_pulsar")]]),
      initializerClasses: new Map([["pulsar_init", "sc_pulsar"]]),
    });
    const [star] = ctx.bodies;
    expect(star.starClass).toBe("sc_pulsar");
    expect(star.surfaceClass).toBe("pc_pulsar");
    const layer = new BodiesLayer(blankTextures());
    layer.rebuild(ctx);
    viewport(layer, 2);
    const drawn = layer.container.children[0] as Container;
    expect(drawn.children.map((c) => c.label)).toContain("beams");
    layer.destroy();
  });

  it("draws a star as its tinted disc in a soft added glow, then its surface in place of the disc once it lands, its art faint behind and a mild bloom on its limb", async () => {
    resetTextures();
    const textureFor = decodeByKey();
    const textures = blankTextures();
    const layer = new BodiesLayer(textures);
    layer.rebuild(starContext("pc_g_star", "sc_g"));
    viewport(layer, 2);
    const star = layer.container.children[0] as Container;
    const shown = () => star.children.filter((c): c is Sprite => c instanceof Sprite && c.visible);
    const labelled = (label: string) => star.children.find((c) => c.label === label) as Sprite;

    const placeholder = [textures.corona, textures.disc, textures.halo];
    expect(shown().map((s) => s.texture)).toEqual(placeholder);
    expect(labelled("glow").blendMode).toBe("add");
    const halo = labelled("halo");
    expect(halo.blendMode).toBe("add");
    expect(halo.tint).toBe(starGlyph("sc_g").tint);
    expect(halo.alpha).toBeLessThan(0.5);
    expect(halo.width).toBeGreaterThan(labelled("disc").width);
    expect(halo.width).toBeLessThan(1.5 * labelled("disc").width);
    expect(labelled("glow").width).toBeGreaterThan(2 * labelled("disc").width);
    expect(labelled("disc").tint).toBe(starGlyph("sc_g").tint);

    await answerFetch();
    await vi.waitFor(() => expect(labelled("lit").visible).toBe(true));
    const lit = labelled("lit");
    const art = labelled("art");
    expect(lit.texture).toBe(textureFor("star_disc:pc_g_star"));
    expect(shown().map((s) => s.label)).toEqual(["glow", "art", "lit", "halo"]);
    expect(art.texture).toBe(textureFor("star_class:sc_g"));
    expect(art.blendMode).toBe(STAR_ART_BLEND);
    expect(art.alpha).toBeLessThan(0.5);
    expect(lit.scale.x).toBeGreaterThan(0);
    expect(lit.width).toBeCloseTo(labelled("disc").width);
    for (const flare of ["beams", "jets", "wisps", "wash", "haze", "aura", "bloom"]) {
      expect(labelled(flare)).toBeUndefined();
    }

    clearTextures();
    expect(shown().map((s) => s.texture)).toEqual(placeholder);
    resetTextures();
    layer.destroy();
  });

  it("keeps a star's tinted disc when the install bakes no surface for it", async () => {
    resetTextures();
    fetch.fails = (key) => key.startsWith("star_disc:");
    const textureFor = decodeByKey();
    const layer = new BodiesLayer(blankTextures());
    layer.rebuild(starContext("pc_modded_star", "sc_modded"));
    viewport(layer, 2);
    const star = layer.container.children[0] as Container;
    const labelled = (label: string) => star.children.find((c) => c.label === label) as Sprite;

    await answerFetch();
    await vi.waitFor(() => expect(labelled("art").visible).toBe(true));
    expect(labelled("art").texture).toBe(textureFor("star_class:sc_modded"));
    expect(labelled("disc").visible).toBe(true);
    expect(labelled("lit").visible).toBe(false);
    resetTextures();
    layer.destroy();
  });

  /** The one star `planetClass` of `starClass`, drawn: its parts by label, and the disc's width. */
  const drawnStar = (planetClass: string, starClass: string) => {
    const layer = new BodiesLayer(blankTextures());
    layer.rebuild(starContext(planetClass, starClass));
    viewport(layer, 2);
    const star = layer.container.children[0] as Container;
    const labels = star.children.map((c) => c.label);
    const labelled = (label: string) => star.children.find((c) => c.label === label) as Sprite;
    const all = (label: string) =>
      star.children.filter((c): c is Sprite => c instanceof Sprite && c.label === label);
    return { layer, labels, labelled, all, disc: labelled("disc").width };
  };

  /**
   * A pale wash and a strong near-white bloom round the limb over the surface, and a bloom on each
   * end of the star's lights, over the limb and above them all.
   */
  const expectBloomsOnTheLimb = (star: ReturnType<typeof drawnStar>, rotation: number) => {
    const lit = star.labels.indexOf("lit");
    expect(star.labels.indexOf("wash")).toBeGreaterThan(lit);
    expect(star.labels.indexOf("halo")).toBeGreaterThan(star.labels.indexOf("wash"));
    expect(star.labelled("wash").blendMode).toBe("add");
    const lettered = drawnStar("pc_g_star", "sc_g");
    expect(star.labelled("halo").alpha).toBeGreaterThan(lettered.labelled("halo").alpha);
    lettered.layer.destroy();
    const blooms = star.all("bloom");
    expect(blooms).toHaveLength(2);
    for (const bloom of blooms) {
      expect(star.labels.indexOf("bloom")).toBeGreaterThan(star.labels.indexOf("halo"));
      expect(bloom.blendMode).toBe("add");
      expect(Math.hypot(bloom.x, bloom.y)).toBeCloseTo(star.disc / 2);
      const along = Math.atan2(bloom.y, bloom.x);
      expect(Math.abs(Math.sin(along - rotation))).toBeCloseTo(0);
    }
  };

  it("passes a pulsar's two thin beams behind it on a slant, blooming where they leave the limb, in a large swirl of haze", () => {
    const star = drawnStar("pc_pulsar", "sc_pulsar");
    const beams = star.labelled("beams");
    expect(star.labels.indexOf("beams")).toBeLessThan(star.labels.indexOf("disc"));
    expect(beams.blendMode).toBe("add");
    expect(beams.width).toBeGreaterThan(3 * star.disc);
    expect(beams.height).toBeLessThan(star.disc);
    expect(beams.rotation % (Math.PI / 2)).not.toBeCloseTo(0);
    expectBloomsOnTheLimb(star, beams.rotation);
    const haze = star.labelled("haze");
    expect(star.labels.indexOf("haze")).toBeLessThan(star.labels.indexOf("disc"));
    expect(haze.blendMode).toBe("add");
    expect(haze.alpha).toBeGreaterThan(0.2);
    expect(haze.width).toBeGreaterThan(2.5 * star.disc);
    expect(star.labelled("jets")).toBeUndefined();
    star.layer.destroy();
  });

  it("sends a neutron star's broad jets up and down behind it, blazing over both poles, in a wide blue glow with faint wisps flung far out", () => {
    const star = drawnStar("pc_neutron_star", "sc_neutron_star");
    const jets = star.labelled("jets");
    expect(star.labels.indexOf("jets")).toBeLessThan(star.labels.indexOf("disc"));
    expect(jets.rotation).toBeCloseTo(Math.PI / 2);
    expect(jets.width).toBeGreaterThan(2 * star.disc);
    expect(jets.height).toBeGreaterThan(star.disc);
    expect(jets.height).toBeGreaterThan(star.labelled("beams")?.height ?? 0);
    expectBloomsOnTheLimb(star, jets.rotation);
    const wisps = star.labelled("wisps");
    expect(star.labels.indexOf("wisps")).toBeLessThan(star.labels.indexOf("disc"));
    expect(wisps.blendMode).toBe("add");
    expect(wisps.width).toBeGreaterThan(3 * star.disc);
    expect(wisps.alpha).toBeLessThan(0.5);
    const aura = star.labelled("aura");
    expect(star.labels.indexOf("aura")).toBeLessThan(star.labels.indexOf("disc"));
    expect(aura.width).toBeGreaterThan(wisps.width);
    expect(star.labelled("beams")).toBeUndefined();
    star.layer.destroy();
  });

  it("draws a black hole black, its swirl behind the disc and no ring or glow round it", () => {
    const ctx = systemContext({
      ...NO_SOURCES,
      id: SYSTEM,
      systems: byId(placedNode(SYSTEM, 0, 0)),
      details: systemDetails({ id: SYSTEM, planets: [saveBody(1, "pc_black_hole", [0, 0], 0)] }),
      starClasses: new Map([["sc_black_hole", starClassView("sc_black_hole", "pc_black_hole")]]),
    });
    const layer = new BodiesLayer(blankTextures());
    layer.rebuild(ctx);
    viewport(layer, 2);
    const hole = layer.container.children[0] as Container;
    const labels = hole.children.map((c) => c.label);
    expect(labels).not.toContain("glow");
    expect(labels.indexOf("art")).toBeLessThan(labels.indexOf("disc"));
    const disc = hole.children.find((c) => c.label === "disc") as Sprite;
    expect(disc.tint).toBe(0x000000);
    expect(labels).not.toContain("horizon");
    expect(labels).not.toContain("halo");
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
  const mesh = (holder: Container, label: string) => {
    const found = part(holder, label);
    if (!(found instanceof Mesh)) throw new Error(`no ${label} mesh`);
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

  it("adds a haze in the class's atmosphere colour, brightest on the limb and fading both ways, and none for a class without one", () => {
    resetTextures();
    const layer = new BodiesLayer(blankTextures());
    layer.rebuild(
      classedContext([EARTH, MARS], [hazy("pc_continental"), planetClassView("pc_arid", false)]),
    );
    viewport(layer, 2);

    const earth = holderAt(layer, ...EARTH_AT);
    const limb = sprite(earth, "disc").width / 2;
    const haze = graphics(earth, "rim") ?? new Graphics();
    expect(haze.blendMode).toBe("add");
    const rim = strokes(haze).map((stroke) => ({
      color: stroke.color,
      alpha: stroke.alpha ?? 1,
      radius: stroke.segments[0][stroke.segments[0].length - 1],
    }));
    expect(rim.length).toBeGreaterThan(1);
    for (const stroke of rim) expect(stroke.color).toBe(0x3366cc);
    const radii = rim.map((stroke) => stroke.radius);
    expect(Math.min(...radii)).toBeLessThan(limb);
    expect(Math.max(...radii)).toBeGreaterThan(limb);
    const brightest = rim.reduce((a, b) => (b.alpha > a.alpha ? b : a));
    const step = (Math.max(...radii) - Math.min(...radii)) / (rim.length - 1);
    expect(Math.abs(brightest.radius - limb)).toBeLessThanOrEqual(step);
    const outward = rim.filter((stroke) => stroke.radius > limb).map((stroke) => stroke.alpha);
    expect(outward).toEqual([...outward].sort((a, b) => b - a));
    expect(outward[outward.length - 1]).toBeLessThan(brightest.alpha);
    const inward = rim.filter((stroke) => stroke.radius < limb).map((stroke) => stroke.alpha);
    expect(inward).toEqual([...inward].sort((a, b) => a - b));
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

  it("draws a ring's far half behind the disc and its near half in front in the game's ring texture once it lands, baked halves until then, a ring left to chance faded and dashed, and no ring when there is none", async () => {
    resetTextures();
    const textureFor = decodeByKey();
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
    const at = (label: string) => ringed.children.indexOf(part(ringed, label) ?? ringed);
    const disc = sprite(ringed, "disc").width;
    expect(at("ringBack")).toBeLessThan(at("disc"));
    expect(at("ringFront")).toBeGreaterThan(at("shade"));
    expect(sprite(ringed, "ringBack").texture).toBe(textures.ringBack);
    expect(sprite(ringed, "ringFront").texture).toBe(textures.ringFront);
    for (const half of [sprite(ringed, "ringBack"), sprite(ringed, "ringFront")]) {
      expect(half.visible).toBe(true);
      expect(half.alpha).toBe(1);
      expect(half.width).toBeGreaterThan(2 * disc);
      expect(half.height).toBeLessThan(half.width);
      expect(half.rotation).not.toBe(0);
    }
    for (const label of ["ringBackStrip", "ringFrontStrip"]) {
      expect(mesh(ringed, label).visible).toBe(false);
    }
    expect(part(ringed, "ringDashes")).toBeUndefined();

    await answerFetch();
    await vi.waitFor(() => expect(mesh(ringed, "ringBackStrip").visible).toBe(true));
    expect(at("ringBackStrip")).toBeLessThan(at("disc"));
    expect(at("ringFrontStrip")).toBeGreaterThan(at("shade"));
    for (const label of ["ringBack", "ringFront"]) {
      expect(sprite(ringed, label).visible).toBe(false);
    }
    for (const half of [mesh(ringed, "ringBackStrip"), mesh(ringed, "ringFrontStrip")]) {
      expect(half.visible).toBe(true);
      expect(half.texture).toBe(textureFor("planet_ring"));
      expect(half.tint).toBe(0xffffff);
      expect(half.alpha).toBe(1);
      expect(half.width / 2 / (disc / 2)).toBeCloseTo(2.12, 2);
      expect(half.scale.y).toBeLessThan(half.scale.x);
      expect(half.rotation).not.toBe(0);
    }

    const chance = holderAt(layer, ...MARS_AT);
    for (const label of ["ringBack", "ringFront"]) {
      expect(sprite(chance, label).alpha).toBeLessThan(0.6);
    }
    for (const label of ["ringBackStrip", "ringFrontStrip"]) {
      expect(mesh(chance, label).visible).toBe(true);
      expect(mesh(chance, label).alpha).toBeLessThan(0.6);
    }
    const dashes = strokes(graphics(chance, "ringDashes") ?? new Graphics());
    expect(dashes).toHaveLength(1);
    expect(dashes[0].segments.length).toBeGreaterThan(1);

    const none = holderAt(layer, -150, 0);
    for (const label of [
      "ringBack",
      "ringFront",
      "ringBackStrip",
      "ringFrontStrip",
      "ringDashes",
    ]) {
      expect(part(none, label)).toBeUndefined();
    }
    resetTextures();
    layer.destroy();
  });

  it("swaps the tinted disc for the class's lit disc once it lands, turned to face the star under the same shading, or for its icon when it has none", async () => {
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
    expect(sprite(earth, "disc").visible).toBe(false);
    expect(sprite(earth, "lit").visible).toBe(false);
    expect(sprite(earth, "art").visible).toBe(true);
    expect(sprite(earth, "art").texture).toBe(textureFor("sprite:GFX_pc_continental"));
    resetTextures();
    layer.destroy();
  });

  it("draws an asteroid as its icon alone once it lands, with no round disc or shading under it", async () => {
    resetTextures();
    const textureFor = decodeByKey();
    const layer = new BodiesLayer(blankTextures());
    const rock = { ...EARTH, class: "pc_asteroid" };
    layer.rebuild(classedContext([rock], [iconed("pc_asteroid")]));
    viewport(layer, 2);
    const drawn = holderAt(layer, ...EARTH_AT);
    expect(sprite(drawn, "disc").visible).toBe(true);
    expect(part(drawn, "shade")).toBeUndefined();
    expect(part(drawn, "lit")).toBeUndefined();

    await answerFetch();
    await vi.waitFor(() => expect(sprite(drawn, "art").visible).toBe(true));
    expect(sprite(drawn, "art").texture).toBe(textureFor("sprite:GFX_pc_asteroid"));
    expect(sprite(drawn, "disc").visible).toBe(false);
    resetTextures();
    layer.destroy();
  });

  it("glazes the icon the game shares between asteroid kinds: icy for ice, and violet for crystal", async () => {
    resetTextures();
    const textureFor = decodeByKey();
    const glazeOf = async (planetClass: string) => {
      const layer = new BodiesLayer(blankTextures());
      layer.rebuild(classedContext([{ ...EARTH, class: planetClass }], [iconed(planetClass)]));
      viewport(layer, 2);
      const drawn = holderAt(layer, ...EARTH_AT);
      await answerFetch();
      await vi.waitFor(() => expect(sprite(drawn, "art").visible).toBe(true));
      const glaze = part(drawn, "glaze");
      const found =
        glaze instanceof Sprite
          ? { tint: glaze.tint, add: glaze.blendMode === "add", texture: glaze.texture }
          : null;
      layer.destroy();
      return found;
    };
    expect(await glazeOf("pc_asteroid")).toBeNull();
    const ice = await glazeOf("pc_ice_asteroid");
    expect(ice).toEqual({
      tint: ICY_TINT,
      add: true,
      texture: textureFor("sprite:GFX_pc_ice_asteroid"),
    });
    const crystal = await glazeOf("pc_rare_crystal_asteroid");
    expect(crystal?.add).toBe(true);
    expect([0xffffff, ICY_TINT]).not.toContain(crystal?.tint);
    resetTextures();
  });

  it("draws an astral scar's glow added over the dark, with no surface bake, disc or shading", async () => {
    resetTextures();
    const textureFor = decodeByKey();
    const layer = new BodiesLayer(blankTextures());
    const scar = { ...EARTH, class: "pc_astral_scar" };
    layer.rebuild(classedContext([scar], [iconed("pc_astral_scar")]));
    viewport(layer, 2);
    const drawn = holderAt(layer, ...EARTH_AT);
    expect(part(drawn, "shade")).toBeUndefined();
    expect(part(drawn, "lit")).toBeUndefined();

    await answerFetch();
    await vi.waitFor(() => expect(sprite(drawn, "art").visible).toBe(true));
    expect(sprite(drawn, "art").texture).toBe(textureFor("sprite:GFX_pc_astral_scar"));
    expect(sprite(drawn, "art").blendMode).toBe(STAR_ART_BLEND);
    expect(sprite(drawn, "disc").visible).toBe(false);
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
    expect(art().texture).toBe(textureFor("sprite:GFX_pc_arid"));
    expect(art().visible).toBe(true);
    await answerFetch();
    await vi.waitFor(() => expect(art().texture).toBe(textureFor("sprite:GFX_pc_arid_big")));

    expect(art().visible).toBe(true);

    viewport(layer, 1);
    expect(art().texture).toBe(textureFor("sprite:GFX_pc_arid"));
    resetTextures();
    layer.destroy();
  });
});

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
      labelsShown: layers.labels,
      detailsShown: layers.details,
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
    resetTextures();
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
    resetTextures();
    layer.destroy();
  });

  it("marks a colonised body's plate in its owner's colour, and no other plate", () => {
    resetTextures();
    const owner = 7;
    const colour = 0x3366cc;
    const colony = { ...MINED, colonised: true, owner };
    const layer = new LabelsLayer();
    layer.rebuild(
      systemContext({
        ...context({ planets: [SUN, colony] }),
        labelsShown: true,
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
    resetTextures();
    layer.destroy();
  });

  it("shows plates alone, plates with resources, resources alone, or nothing, as Labels and Details are set", () => {
    resetTextures();
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
    resetTextures();
    layer.destroy();
  });

  it("borders the selected body's plate in the selection colour, and no other", () => {
    resetTextures();
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
    resetTextures();
    layer.destroy();
  });

  it("draws the resource row under the body, where the plate would be, while Labels is off", () => {
    resetTextures();
    const layer = new LabelsLayer();
    layer.rebuild(labelled({ labels: false, details: true }));
    const cam = viewport(layer, 2);
    const [x, y] = MINED.layout?.at ?? [0, 0];
    const earthAt = cam.worldToScreen(x, y);
    const [row] = layer.plates();
    const top = cam.worldToScreen(row.x, row.y);
    expect(top.x + row.w / 2).toBeCloseTo(earthAt.x);
    expect(top.y).toBeGreaterThan(earthAt.y);
    resetTextures();
    layer.destroy();
  });
});
