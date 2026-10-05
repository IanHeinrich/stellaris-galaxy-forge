import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/gamedata", () => import("../../../test/textures"));

import { BitmapText, Container, Sprite } from "pixi.js";
import { starGlyph } from "../../../lib/visual/starGlyphs";
import { clearTextures } from "../../../lib/visual/textures";
import { byId, placedNode, saveBody, starClassView, systemDetails } from "../../../test/builders";
import { textureFetch } from "../../../test/textures";
import { until } from "../../../test/wait";
import { STAR_ART_BLEND } from "../../layers/StarClusters";
import { systemContext } from "../context";
import { scenario, scenarioNode } from "../contextFixture";
import { SYSTEM, blankSceneTextures, viewport } from "../drawFixture";
import { NO_SOURCES } from "../sources";
import { BodiesLayer } from "./BodiesLayer";
import { answerFetch, decodeByKey, resetTextures, starContext } from "./bodiesFixture";

beforeEach(resetTextures);

describe("the stars of the system scene's bodies layer", () => {
  it("draws a scenario system still loading as its initializer's star, beams and no question mark", () => {
    const layer = new BodiesLayer(blankSceneTextures());
    layer.rebuild(scenario(null, null, scenarioNode("sc_pulsar")));
    viewport(layer, 2);
    const holder = layer.container.children[0] as Container;
    expect(holder.children.some((c) => c instanceof BitmapText)).toBe(false);
    expect(holder.children.map((c) => c.label)).toContain("beams");
    layer.destroy();
  });

  it("draws a star as its tinted disc in a soft added glow, then its surface in place of the disc once it lands, its art behind and a bloom on its limb", async () => {
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
    await until(() => expect(labelled("lit").visible).toBe(true));
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
    layer.destroy();
  });

  it("keeps a star's tinted disc when the install bakes no surface for it", async () => {
    textureFetch.fails = (key) => key.startsWith("star_disc:");
    const textureFor = decodeByKey();
    const layer = new BodiesLayer(blankSceneTextures());
    layer.rebuild(starContext("pc_modded_star", "sc_modded"));
    viewport(layer, 2);
    const star = layer.container.children[0] as Container;
    const labelled = (label: string) => star.children.find((c) => c.label === label) as Sprite;

    await answerFetch();
    await until(() => expect(labelled("art").visible).toBe(true));
    expect(labelled("art").texture).toBe(textureFor("star_class:sc_modded"));
    expect(labelled("disc").visible).toBe(true);
    expect(labelled("lit").visible).toBe(false);
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

  it("draws a black hole black, its swirl behind the disc and no ring or glow round it", () => {
    const ctx = systemContext({
      ...NO_SOURCES,
      id: SYSTEM,
      systems: byId(placedNode(SYSTEM, 0, 0)),
      details: systemDetails({
        id: SYSTEM,
        planets: [{ ...saveBody(1, "pc_black_hole", [0, 0], 0, 16), star_class: "sc_black_hole" }],
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
});
