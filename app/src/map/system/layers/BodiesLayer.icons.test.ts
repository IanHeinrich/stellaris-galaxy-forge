import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/gamedata", () => import("../../../test/textures"));

import { Sprite } from "pixi.js";
import { until } from "../../../test/wait";
import { STAR_ART_BLEND } from "../../layers/StarClusters";
import { EARTH, MARS, blankSceneTextures, viewport } from "../drawFixture";
import { FLAT_BODY_MAX_PX } from "../geometry";
import { ICY_TINT } from "../look";
import { pickBody } from "../picking";
import { BodiesLayer } from "./BodiesLayer";
import {
  answerFetch,
  classedContext,
  decodeByKey,
  EARTH_AT,
  hazy,
  holderAt,
  iconed,
  MARS_AT,
  noLitDiscs,
  part,
  resetTextures,
  sprite,
} from "./bodiesFixture";

beforeEach(resetTextures);

describe("the icons of the system scene's bodies layer", () => {
  it("draws a shattered class as its shards alone, broken by its id, with no haze, shading or disc round them", async () => {
    const textureFor = decodeByKey();
    const layer = new BodiesLayer(blankSceneTextures());
    const broken = { ...EARTH, class: "pc_shattered" };
    const view = { ...hazy("pc_shattered"), shattered: true };
    layer.rebuild(classedContext([broken], [view]));
    viewport(layer, 2);
    const drawn = holderAt(layer, ...EARTH_AT);
    expect(part(drawn, "shade")).toBeUndefined();
    expect(part(drawn, "rim")).toBeUndefined();
    expect(part(drawn, "glow")).toBeUndefined();

    await answerFetch();
    await until(() => expect(sprite(drawn, "lit").visible).toBe(true));
    const shards = textureFor(`planet_disc_shattered:pc_shattered:${EARTH.id}`);
    expect(sprite(drawn, "lit").texture).toBe(shards);
    expect(sprite(drawn, "disc").visible).toBe(false);
    expect(sprite(drawn, "art").visible).toBe(false);
    layer.destroy();
  });

  it("draws an asteroid as its icon alone once it lands, with no round disc or shading under it", async () => {
    const textureFor = decodeByKey();
    const layer = new BodiesLayer(blankSceneTextures());
    const rock = { ...EARTH, class: "pc_asteroid" };
    layer.rebuild(classedContext([rock], [{ ...iconed("pc_asteroid"), asteroid: true }]));
    viewport(layer, 2);
    const drawn = holderAt(layer, ...EARTH_AT);
    expect(sprite(drawn, "disc").visible).toBe(true);
    expect(part(drawn, "shade")).toBeUndefined();
    expect(part(drawn, "lit")).toBeUndefined();

    await answerFetch();
    await until(() => expect(sprite(drawn, "art").visible).toBe(true));
    expect(sprite(drawn, "art").texture).toBe(textureFor("sprite:GFX_pc_asteroid"));
    expect(sprite(drawn, "disc").visible).toBe(false);
    layer.destroy();
  });

  it("draws a modded asteroid class whose key does not say so with no shading, as its class view says", () => {
    const layer = new BodiesLayer(blankSceneTextures());
    const rock = { ...EARTH, class: "pc_mod_rock" };
    layer.rebuild(classedContext([rock], [{ ...iconed("pc_mod_rock"), asteroid: true }]));
    viewport(layer, 2);
    const drawn = holderAt(layer, ...EARTH_AT);
    expect(part(drawn, "shade")).toBeUndefined();
    expect(part(drawn, "lit")).toBeUndefined();
    layer.destroy();
  });

  it("draws a class with no surface as its icon unshaded in a glow, never wider on screen than the flat cap, and picks it only there", async () => {
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
    await until(() => expect(sprite(drawn, "art").visible).toBe(true));
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
    layer.destroy();
  });

  it("glazes the icon the game shares between asteroid kinds: icy for ice, and violet for crystal", async () => {
    const textureFor = decodeByKey();
    const glazeOf = async (planetClass: string) => {
      const layer = new BodiesLayer(blankSceneTextures());
      const rock = { ...iconed(planetClass), asteroid: true };
      layer.rebuild(classedContext([{ ...EARTH, class: planetClass }], [rock]));
      viewport(layer, 2);
      const drawn = holderAt(layer, ...EARTH_AT);
      await answerFetch();
      await until(() => expect(sprite(drawn, "art").visible).toBe(true));
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
  });

  it("draws an astral scar's glow added over the dark, with no surface bake, disc or shading", async () => {
    const textureFor = decodeByKey();
    const layer = new BodiesLayer(blankSceneTextures());
    const scar = { ...EARTH, class: "pc_astral_scar" };
    layer.rebuild(classedContext([scar], [iconed("pc_astral_scar")]));
    viewport(layer, 2);
    const drawn = holderAt(layer, ...EARTH_AT);
    expect(part(drawn, "shade")).toBeUndefined();
    expect(part(drawn, "lit")).toBeUndefined();

    await answerFetch();
    await until(() => expect(sprite(drawn, "art").visible).toBe(true));
    expect(sprite(drawn, "art").texture).toBe(textureFor("sprite:GFX_pc_astral_scar"));
    expect(sprite(drawn, "art").blendMode).toBe(STAR_ART_BLEND);
    expect(sprite(drawn, "disc").visible).toBe(false);
    layer.destroy();
  });

  it("shows the class's large icon while the disc is large on screen, and its small one otherwise", async () => {
    noLitDiscs();
    const textureFor = decodeByKey();
    const layer = new BodiesLayer(blankSceneTextures());
    layer.rebuild(classedContext([MARS], [iconed("pc_arid", "GFX_pc_arid_big")]));
    viewport(layer, 1);
    const art = () => sprite(holderAt(layer, ...MARS_AT), "art");

    await answerFetch();
    await until(() => expect(art().texture).toBe(textureFor("sprite:GFX_pc_arid")));

    viewport(layer, 12);
    expect(art().texture).toBe(textureFor("sprite:GFX_pc_arid"));
    expect(art().visible).toBe(true);
    await answerFetch();
    await until(() => expect(art().texture).toBe(textureFor("sprite:GFX_pc_arid_big")));

    expect(art().visible).toBe(true);

    viewport(layer, 1);
    expect(art().texture).toBe(textureFor("sprite:GFX_pc_arid"));
    layer.destroy();
  });
});
