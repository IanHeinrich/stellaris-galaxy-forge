import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/gamedata", () => import("../../../test/textures"));

import { BitmapText, Container, Graphics, Texture } from "pixi.js";
import { clearTextures, setTextureDecoder } from "../../../lib/visual/textures";
import { byId, placedNode, planetClassView, saveBody, systemDetails } from "../../../test/builders";
import { textureFetch } from "../../../test/textures";
import { until } from "../../../test/wait";
import { systemContext } from "../context";
import { body, scenario, scenarioSun } from "../contextFixture";
import {
  EARTH,
  MARS,
  SCENARIO_STAR,
  SUN,
  SYSTEM,
  blankSceneTextures,
  fixed,
  rollOf,
  scenarioBody,
  strokes,
  viewport,
} from "../drawFixture";
import { NO_SOURCES } from "../sources";
import { BodiesLayer } from "./BodiesLayer";
import {
  answerFetch,
  classedContext,
  decodeByKey,
  EARTH_AT,
  graphics,
  hazy,
  holderAt,
  iconed,
  MARS_AT,
  mesh,
  noLitDiscs,
  part,
  resetTextures,
  scenarioContext,
  sprite,
  sprites,
} from "./bodiesFixture";

beforeEach(resetTextures);

describe("the planets of the system scene's bodies layer", () => {
  it("marks a class the core says is a draw with a question mark", () => {
    const planets = [
      scenarioSun,
      body(2, "rl_unhabitable_planets", { orbit: fixed(60) }, { drawn: true }),
      body(3, "ideal_planet_class", { orbit: fixed(90) }, { drawn: true }),
      body(4, "pc_barren", { orbit: fixed(120) }),
    ];
    const layer = new BodiesLayer(blankSceneTextures());
    layer.rebuild(scenario(planets, rollOf(planets)));
    viewport(layer, 2);
    const glyphs = (layer.container.children as Container[]).map(
      (h) => h.children.filter((c) => c instanceof BitmapText).length,
    );
    expect(glyphs.sort()).toEqual([0, 0, 1, 1]);
    layer.destroy();
  });

  it("moves the drawn bodies a preview moves, keeping every display object, and turns their light", () => {
    const src = {
      ...NO_SOURCES,
      id: SYSTEM,
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
    await until(() => expect(artShown(holderAt(layer, 60, 0))).toBe(true));

    const drawn = holderAt(layer, 0, 90);
    expect(artShown(drawn)).toBe(false);
    expect(sprite(drawn, "disc").visible).toBe(true);
    const glyphs = drawn.children.filter((c): c is BitmapText => c instanceof BitmapText);
    expect(glyphs.map((g) => [g.text, g.visible])).toEqual([["?", true]]);
    expect(holderAt(layer, 60, 0).children.some((c) => c instanceof BitmapText)).toBe(false);
    layer.destroy();
  });

  it("adds a haze in the class's atmosphere colour, brightest on the limb and fading both ways, and none for a class without one", () => {
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
    const textureFor = decodeByKey();
    const textures = blankSceneTextures();
    const bare = saveBody(5, "pc_barren", [-150, 0], 150, 16, SUN);
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
    await until(() => expect(mesh(ringed, "ringBackStrip").visible).toBe(true));
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
    layer.destroy();
  });

  it("swaps the tinted disc for the class's lit disc once it lands, turned to face the star under the same shading, or for its icon when it has none", async () => {
    const textureFor = decodeByKey();
    textureFetch.fails = (key) => key === "planet_disc:pc_continental";
    const layer = new BodiesLayer(blankSceneTextures());
    layer.rebuild(classedContext([EARTH, MARS], [iconed("pc_continental"), iconed("pc_arid")]));
    viewport(layer, 2);
    const mars = holderAt(layer, ...MARS_AT);
    expect(sprite(mars, "disc").visible).toBe(true);
    expect(sprite(mars, "lit").visible).toBe(false);

    await answerFetch();
    await until(() => expect(sprite(mars, "lit").visible).toBe(true));
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
    layer.destroy();
  });

  it("draws a planet's own model as its lit disc, and its class's disc when the model has none", async () => {
    const textureFor = decodeByKey();
    textureFetch.fails = (key) => key === "planet_model:modded_planet_entity";
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
    await until(() => expect(sprite(earth, "lit").visible).toBe(true));
    const model = textureFor("planet_model:ocean_paradise_planet_01_entity");
    expect(sprite(earth, "lit").texture).toBe(model);
    expect(sprite(mars, "lit").visible).toBe(false);

    await answerFetch();
    await until(() => expect(sprite(mars, "lit").visible).toBe(true));
    expect(sprite(mars, "lit").texture).toBe(textureFor("planet_disc:pc_arid"));
    expect(sprite(mars, "disc").visible).toBe(false);
    layer.destroy();
  });
});
