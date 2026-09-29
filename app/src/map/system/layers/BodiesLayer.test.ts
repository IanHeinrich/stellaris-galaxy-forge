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
import type { PlanetClassView } from "../../../generated/PlanetClassView";
import type { PlanetSummary } from "../../../generated/PlanetSummary";
import { starGlyph } from "../../../lib/visual/starGlyphs";
import { clearTextures, setTextureDecoder } from "../../../lib/visual/textures";
import {
  byId,
  placedNode,
  planetClassView,
  starClassView,
  systemDetails,
} from "../../../test/builders";
import { STAR_ART_BLEND } from "../../layers/StarClusters";
import { systemContext } from "../context";
import {
  EARTH,
  MARS,
  SCENARIO_STAR,
  SUN,
  SYSTEM,
  blankSceneTextures,
  fixed,
  rollOf,
  saveBody,
  scenarioBody,
  strokes,
  viewport,
} from "../fixture";
import { FLAT_BODY_MAX_PX } from "../geometry";
import { ICY_TINT } from "../look";
import { pickBody } from "../picking";
import { NO_SOURCES } from "../sources";
import { BodiesLayer } from "./BodiesLayer";

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

describe("the system scene's bodies layer", () => {
  /** A system of the one star `planetClass`, of the star class `starClass`. */
  const starContext = (planetClass: string, starClass: string) =>
    systemContext({
      ...NO_SOURCES,
      id: SYSTEM,
      systems: byId(placedNode(SYSTEM, 0, 0)),
      details: systemDetails({
        id: SYSTEM,
        planets: [{ ...saveBody(1, planetClass, [0, 0], 0), star_class: starClass }],
      }),
      starClasses: new Map([[starClass, starClassView(starClass, planetClass)]]),
    });

  it("draws a pulsar's beams about a scenario's star of that class", () => {
    const ctx = systemContext({
      ...NO_SOURCES,
      kind: "scenario",
      id: SYSTEM,
      systems: byId({ ...placedNode(SYSTEM, 0, 0), star_class: "", initializer: "pulsar_init" }),
      details: systemDetails({
        id: SYSTEM,
        planets: [scenarioBody(1, "pc_pulsar", { orbit: fixed(0), angle: fixed(0) })],
      }),
      starClasses: new Map([["sc_pulsar", starClassView("sc_pulsar", "pc_pulsar")]]),
      initializerClasses: new Map([["pulsar_init", "sc_pulsar"]]),
    });
    const layer = new BodiesLayer(blankSceneTextures());
    layer.rebuild(ctx);
    viewport(layer, 2);
    const drawn = layer.container.children[0] as Container;
    expect(drawn.children.map((c) => c.label)).toContain("beams");
    layer.destroy();
  });

  it("draws a star as its tinted disc in a soft added glow, then its surface in place of the disc once it lands, its art behind and a bloom on its limb", async () => {
    resetTextures();
    const textureFor = decodeByKey();
    const textures = blankSceneTextures();
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
    expect(labelled("disc").tint).toBe(starGlyph("sc_g").tint);

    await answerFetch();
    await vi.waitFor(() => expect(labelled("lit").visible).toBe(true));
    const lit = labelled("lit");
    const art = labelled("art");
    expect(lit.texture).toBe(textureFor("star_disc:pc_g_star"));
    expect(shown().map((s) => s.label)).toEqual(["glow", "art", "lit", "halo"]);
    expect(art.texture).toBe(textureFor("star_class:sc_g"));
    expect(art.blendMode).toBe(STAR_ART_BLEND);
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
    const layer = new BodiesLayer(blankSceneTextures());
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
    const layer = new BodiesLayer(blankSceneTextures());
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
    expect(beams.rotation % (Math.PI / 2)).not.toBeCloseTo(0);
    expectBloomsOnTheLimb(star, beams.rotation);
    const haze = star.labelled("haze");
    expect(star.labels.indexOf("haze")).toBeLessThan(star.labels.indexOf("disc"));
    expect(haze.blendMode).toBe("add");
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
    expectBloomsOnTheLimb(star, jets.rotation);
    const wisps = star.labelled("wisps");
    expect(star.labels.indexOf("wisps")).toBeLessThan(star.labels.indexOf("disc"));
    expect(wisps.blendMode).toBe("add");
    expect(star.labelled("aura").blendMode).toBe("add");
    expect(star.labels.indexOf("aura")).toBeLessThan(star.labels.indexOf("disc"));
    expect(star.labelled("beams")).toBeUndefined();
    star.layer.destroy();
  });

  it("moves the drawn bodies a preview moves, keeping every display object, and turns their light", () => {
    const src = {
      ...NO_SOURCES,
      id: SYSTEM,
      kind: "save" as const,
      systems: byId(placedNode(SYSTEM, 0, 0)),
      details: systemDetails({ id: SYSTEM, planets: [SUN, EARTH, MARS] }),
      planetClasses: new Map([
        ["pc_g_star", planetClassView("pc_g_star")],
        ["pc_continental", planetClassView("pc_continental", false)],
        ["pc_arid", planetClassView("pc_arid", false)],
      ]),
    };
    const layer = new BodiesLayer(blankSceneTextures());
    layer.rebuild(systemContext(src));
    viewport(layer, 2);
    const before = layer.container.children.map((h) => [h, ...(h as Container).children]);
    const override = { bodies: new Map([[EARTH.id, { parent: SUN.id, radius: 90, angle: 90 }]]) };
    const moved = systemContext(src, { override, marks: null });
    layer.rebuild(moved);
    const after = layer.container.children.map((h) => [h, ...(h as Container).children]);
    expect(after).toHaveLength(before.length);
    after.forEach((objects, i) => objects.forEach((o, j) => expect(o).toBe(before[i][j])));
    const earth = moved.bodyById.get(EARTH.id)!.placement;
    const holder = layer.container.children.find(
      (h) => h.position.x === earth.x && h.position.y === earth.y,
    ) as Container;
    expect(earth.y).toBeCloseTo(90);
    expect(holder).toBeDefined();
    const shade = holder.children.find((c) => c.label === "shade");
    expect(shade?.rotation).toBe(earth.light);
    layer.destroy();
  });

  it("draws a black hole black, its swirl behind the disc and no ring or glow round it", () => {
    const ctx = systemContext({
      ...NO_SOURCES,
      id: SYSTEM,
      systems: byId(placedNode(SYSTEM, 0, 0)),
      details: systemDetails({
        id: SYSTEM,
        planets: [{ ...saveBody(1, "pc_black_hole", [0, 0], 0), star_class: "sc_black_hole" }],
      }),
      starClasses: new Map([["sc_black_hole", starClassView("sc_black_hole", "pc_black_hole")]]),
    });
    const layer = new BodiesLayer(blankSceneTextures());
    layer.rebuild(ctx);
    viewport(layer, 2);
    const hole = layer.container.children[0] as Container;
    const labels = hole.children.map((c) => c.label);
    expect(labels).not.toContain("glow");
    expect(labels.indexOf("art")).toBeLessThan(labels.indexOf("disc"));
    const disc = hole.children.find((c) => c.label === "disc") as Sprite;
    expect(disc.tint).toBe(0x000000);
    expect(labels).not.toContain("halo");
    layer.destroy();
  });

  const scenarioContext = (planets: PlanetSummary[]) =>
    systemContext({
      ...NO_SOURCES,
      id: SYSTEM,
      systems: byId(placedNode(SYSTEM, 0, 0)),
      details: systemDetails({ id: SYSTEM, planets }),
      roll: rollOf(planets),
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
  it("draws a body with no angle as fully as any other", () => {
    clearTextures();
    const free = scenarioBody(2, "pc_arid", { orbit: fixed(70) }, 1);
    const placed = scenarioBody(3, "pc_arid", { orbit: fixed(90), angle: fixed(90) }, 1);
    const layer = new BodiesLayer(blankSceneTextures());
    layer.rebuild(scenarioContext([SCENARIO_STAR, free, placed]));
    viewport(layer, 2);

    const [, freeHolder, placedHolder] = layer.container.children as Container[];
    const alphas = (holder: Container) => sprites(holder).map((drawn) => drawn.alpha);
    expect(alphas(freeHolder)).toEqual(alphas(placedHolder));
    layer.destroy();
  });

  it("draws a random class as its tinted disc with a question mark, and no class icon", async () => {
    resetTextures();
    noLitDiscs();
    setTextureDecoder(() => Promise.resolve(new Texture()));
    const known = scenarioBody(2, "pc_arid", { orbit: fixed(60), angle: fixed(0) }, 1);
    const random = scenarioBody(
      3,
      "random_colonizable",
      { orbit: fixed(90), angle: fixed(90) },
      1,
      { drawn: true },
    );
    const layer = new BodiesLayer(blankSceneTextures());
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
    const layer = new BodiesLayer(blankSceneTextures());
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

  it("draws a ring's far half behind the disc and its near half in front in the game's ring texture once it lands, baked halves until then, a ring left to chance faded, and no ring when there is none", async () => {
    resetTextures();
    const textureFor = decodeByKey();
    const textures = blankSceneTextures();
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
      expect(sprite(chance, label).alpha).toBeLessThan(1);
    }
    for (const label of ["ringBackStrip", "ringFrontStrip"]) {
      expect(mesh(chance, label).visible).toBe(true);
      expect(mesh(chance, label).alpha).toBeLessThan(1);
    }

    const none = holderAt(layer, -150, 0);
    for (const label of ["ringBack", "ringFront", "ringBackStrip", "ringFrontStrip"]) {
      expect(part(none, label)).toBeUndefined();
    }
    resetTextures();
    layer.destroy();
  });

  it("swaps the tinted disc for the class's lit disc once it lands, turned to face the star under the same shading, or for its icon when it has none", async () => {
    resetTextures();
    const textureFor = decodeByKey();
    fetch.fails = (key) => key === "planet_disc:pc_continental";
    const layer = new BodiesLayer(blankSceneTextures());
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

  it("draws a planet's own model as its lit disc, and its class's disc when the model has none", async () => {
    resetTextures();
    const textureFor = decodeByKey();
    fetch.fails = (key) => key === "planet_model:modded_planet_entity";
    const layer = new BodiesLayer(blankSceneTextures());
    const paradise = { ...EARTH, entity_name: "ocean_paradise_planet_01_entity" };
    const modded = { ...MARS, entity_name: "modded_planet_entity" };
    layer.rebuild(
      classedContext([paradise, modded], [iconed("pc_continental"), iconed("pc_arid")]),
    );
    viewport(layer, 2);
    const earth = holderAt(layer, ...EARTH_AT);
    const mars = holderAt(layer, ...MARS_AT);

    await answerFetch();
    await vi.waitFor(() => expect(sprite(earth, "lit").visible).toBe(true));
    const model = textureFor("planet_model:ocean_paradise_planet_01_entity");
    expect(sprite(earth, "lit").texture).toBe(model);
    expect(sprite(mars, "lit").visible).toBe(false);

    await answerFetch();
    await vi.waitFor(() => expect(sprite(mars, "lit").visible).toBe(true));
    expect(sprite(mars, "lit").texture).toBe(textureFor("planet_disc:pc_arid"));
    expect(sprite(mars, "disc").visible).toBe(false);
    resetTextures();
    layer.destroy();
  });

  it("draws an asteroid as its icon alone once it lands, with no round disc or shading under it", async () => {
    resetTextures();
    const textureFor = decodeByKey();
    const layer = new BodiesLayer(blankSceneTextures());
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

  it("draws a class with no surface as its icon unshaded in a glow, never wider on screen than the flat cap, and picks it only there", async () => {
    resetTextures();
    const textureFor = decodeByKey();
    const layer = new BodiesLayer(blankSceneTextures());
    const habitat = { ...EARTH, class: "pc_habitat" };
    const view = { ...hazy("pc_habitat"), icon_sprite: "GFX_pc_habitat", flat_art: true };
    const ctx = classedContext([habitat], [view]);
    layer.rebuild(ctx);
    const scale = 40;
    const cam = viewport(layer, scale, { x: EARTH_AT[0], y: EARTH_AT[1] });
    const drawn = holderAt(layer, ...EARTH_AT);
    expect(part(drawn, "shade")).toBeUndefined();
    expect(part(drawn, "lit")).toBeUndefined();
    expect(part(drawn, "rim")).toBeUndefined();

    await answerFetch();
    await vi.waitFor(() => expect(sprite(drawn, "art").visible).toBe(true));
    const art = sprite(drawn, "art");
    expect(art.texture).toBe(textureFor("sprite:GFX_pc_habitat"));
    expect(art.width * scale).toBeCloseTo(FLAT_BODY_MAX_PX);
    const glow = sprite(drawn, "glow");
    expect(drawn.children.indexOf(glow)).toBeLessThan(drawn.children.indexOf(art));
    expect(glow.blendMode).toBe("add");
    expect(glow.width).toBeCloseTo(art.width * 1.5);

    const offCentre = (px: number) => ({ x: EARTH_AT[0] + px / scale, y: EARTH_AT[1] });
    expect(pickBody(ctx.bodies, cam, offCentre(FLAT_BODY_MAX_PX / 2 - 1))).toBe(habitat.id);
    expect(pickBody(ctx.bodies, cam, offCentre(FLAT_BODY_MAX_PX / 2 + 1))).toBeNull();
    resetTextures();
    layer.destroy();
  });

  it("glazes the icon the game shares between asteroid kinds: icy for ice, and violet for crystal", async () => {
    resetTextures();
    const textureFor = decodeByKey();
    const glazeOf = async (planetClass: string) => {
      const layer = new BodiesLayer(blankSceneTextures());
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
    const layer = new BodiesLayer(blankSceneTextures());
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
    const layer = new BodiesLayer(blankSceneTextures());
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
