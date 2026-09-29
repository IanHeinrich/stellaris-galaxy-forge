import { afterEach, describe, expect, it, vi } from "vitest";

/** The texture fetch, which answers only once a test lets it. */
const fetch = vi.hoisted(() => ({ answers: false }));

vi.mock("../../../api/textures", () => ({
  getTextures: (keys: string[]) =>
    fetch.answers
      ? Promise.resolve(
          keys.map((key) => ({ key, width: 1, height: 1, png_base64: "", error: null })),
        )
      : new Promise(() => {}),
}));

import { BitmapText, Container, Graphics, NineSliceSprite, Sprite, Texture } from "pixi.js";
import { empireFlagKey } from "../../../lib/details/fleets";
import {
  ANOMALY_ICON_KEY,
  ARCHAEOLOGY_ICON_KEYS,
  CAPITAL_PLATE_KEY,
  MEGASTRUCTURE_ICON_KEY,
  PRE_FTL_ICON_KEY,
} from "../../../lib/details/icons";
import { ACCENT_COLOR } from "../../../lib/visual/style";
import { clearTextures, setTextureDecoder } from "../../../lib/visual/textures";
import { countryNode } from "../../../test/builders";
import { systemContext } from "../context";
import {
  EARTH,
  MARS,
  SUN,
  context,
  drawOps,
  resourceAmounts,
  strokes,
  stubTextMeasurement,
  viewport,
} from "../fixture";
import { NO_SOURCES } from "../sources";
import { LabelsLayer } from "./LabelsLayer";
import { NO_HIGHLIGHT } from "./SystemLayer";

stubTextMeasurement();

afterEach(() => {
  fetch.answers = false;
  setTextureDecoder(null);
  clearTextures();
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
      sceneLayers: { ...NO_SOURCES.sceneLayers, labels: layers.labels, details: layers.details },
    });

  const shown = (layer: LabelsLayer) => layer.container.children.filter((h) => h.visible);

  /** What the shown holders draw, by the label each part was given. */
  const parts = (layer: LabelsLayer, label: string) =>
    shown(layer)
      .flatMap((holder) => holder.children)
      .filter((c) => c.label === label);

  const amounts = (layer: LabelsLayer) =>
    shown(layer).flatMap((h) => resourceAmounts(h as Container));

  it("moves the plates a preview moves with their bodies, keeping every display object", () => {
    const layer = new LabelsLayer();
    const base = labelled({ labels: true, details: true });
    layer.rebuild(base);
    viewport(layer, 2);
    const before = layer.container.children.map((h) => [h, ...(h as Container).children]);
    const override = { bodies: new Map([[MINED.id, { parent: SUN.id, radius: 90, angle: 90 }]]) };
    layer.rebuild(systemContext(base, { override, marks: null }));
    const after = layer.container.children.map((h) => [h, ...(h as Container).children]);
    expect(after).toHaveLength(before.length);
    after.forEach((objects, i) => objects.forEach((o, j) => expect(o).toBe(before[i][j])));
    const plate = layer.plates().find((p) => p.id === MINED.id);
    expect(plate?.y).toBeGreaterThan(45);
    layer.destroy();
  });

  it("centres each name's plate under its body, a dark translucent wash", () => {
    clearTextures();
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
      expect(fill.alpha).toBeLessThan(1);
    }
    clearTextures();
    layer.destroy();
  });

  it("marks a colonised body's plate in its owner's colour, and no other plate", () => {
    clearTextures();
    const owner = 7;
    const colour = 0x3366cc;
    const colony = { ...MINED, colonised: true, owner };
    const layer = new LabelsLayer();
    layer.rebuild(
      systemContext({
        ...context({ planets: [SUN, colony] }),
        sceneLayers: { ...NO_SOURCES.sceneLayers, labels: true },
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
    clearTextures();
    layer.destroy();
  });

  it("shows plates alone, plates with resources, resources alone, or nothing, as Labels and Details are set", () => {
    clearTextures();
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
    clearTextures();
    layer.destroy();
  });

  it("borders the selected body's plate in the selection colour, and no other", () => {
    clearTextures();
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
    clearTextures();
    layer.destroy();
  });

  it("shows a colony's flag on the game's plate and a pre-FTL world's icon with Details on only", async () => {
    clearTextures();
    const decoded = new Map<string, Texture>();
    const textureFor = (key: string) => {
      if (!decoded.has(key)) decoded.set(key, new Texture());
      return decoded.get(key)!;
    };
    setTextureDecoder((view) => Promise.resolve(textureFor(view.key)));
    fetch.answers = true;
    const empire = countryNode({
      id: 9,
      colors: ["red", "black"],
      flag_icon: { category: "human", file: "flag_human_9.dds" },
      flag_background: { category: "backgrounds", file: "00_solid.dds" },
    });
    const capital = { ...EARTH, colonised: true, capital: true, owner: empire.id };
    const natives = { ...MARS, colonised: true, owner: 10, pre_ftl: true };
    const withDetails = (details: boolean) =>
      systemContext({
        ...context({ planets: [SUN, capital, natives] }),
        sceneLayers: { ...NO_SOURCES.sceneLayers, labels: true, details },
        countries: new Map([[empire.id, empire]]),
      });
    const width = (layer: LabelsLayer, id: number) =>
      layer.plates().find((p) => p.id === id)?.w ?? 0;
    /** Where each shown name stands, in world units. */
    const names = (layer: LabelsLayer) =>
      shown(layer).flatMap((holder) =>
        holder.children.flatMap((c) =>
          c instanceof BitmapText && c.label === "name"
            ? [
                {
                  text: c.text,
                  x: holder.position.x + c.x * holder.scale.x,
                  y: holder.position.y + c.y * holder.scale.y,
                },
              ]
            : [],
        ),
      );
    const sprites = (layer: LabelsLayer) =>
      parts(layer, "marks").flatMap(function all(c): Sprite[] {
        const own = c instanceof Sprite && c.visible ? [c] : [];
        return [...own, ...(c instanceof Container ? c.children.flatMap(all) : [])];
      });

    const layer = new LabelsLayer();
    layer.rebuild(withDetails(false));
    viewport(layer, 2);
    const plain = { capital: width(layer, capital.id), natives: width(layer, natives.id) };
    const plainNames = names(layer);
    expect(parts(layer, "gamePlate")).toHaveLength(0);
    expect(parts(layer, "marks")).toHaveLength(0);

    layer.rebuild(withDetails(true));
    expect(width(layer, capital.id)).toBeGreaterThan(plain.capital);
    expect(width(layer, natives.id)).toBeGreaterThan(plain.natives);
    const marked = names(layer);
    expect(marked.map((n) => n.text)).toEqual(plainNames.map((n) => n.text));
    marked.forEach((n, i) => {
      expect(n.x).toBeCloseTo(plainNames[i].x);
      expect(n.y).toBeCloseTo(plainNames[i].y);
    });
    const flag = empireFlagKey(empire) ?? "";
    await vi.waitFor(() => {
      const shown = sprites(layer).map((s) => s.texture);
      expect(shown).toContain(textureFor(flag));
      expect(shown).toContain(textureFor(PRE_FTL_ICON_KEY));
    });
    const [plate, ...others] = parts(layer, "gamePlate");
    expect(others).toHaveLength(0);
    if (!(plate instanceof NineSliceSprite)) throw new Error("no game plate");
    expect(plate.visible).toBe(true);
    expect(plate.texture).toBe(textureFor(CAPITAL_PLATE_KEY));

    layer.rebuild(withDetails(false));
    expect(parts(layer, "marks")).toHaveLength(0);
    expect(width(layer, capital.id)).toBe(plain.capital);
    layer.destroy();
  });

  it("shows a body's megastructure, dig site, anomaly and pre-FTL icons in the galaxy's order, each with its tooltip", async () => {
    clearTextures();
    const decoded = new Map<string, Texture>();
    const textureFor = (key: string) => {
      if (!decoded.has(key)) decoded.set(key, new Texture());
      return decoded.get(key)!;
    };
    setTextureDecoder((view) => Promise.resolve(textureFor(view.key)));
    fetch.answers = true;
    const natives = { ...EARTH, colonised: true, owner: 10, pre_ftl: true };
    const holding = { ...natives, anomaly: "AIANOM_RESEARCHDEPO_CAT" };
    const ctx = systemContext({
      ...context({
        planets: [SUN, holding, MARS],
        megastructures: [{ id: 50, kind: "dyson_sphere_2", owner: null, planet: EARTH.id }],
        sites: [
          { id: 60, kind: "site_tiyanki_graveyard", planet: EARTH.id },
          { id: 61, kind: "site_zroni_ruins", planet: MARS.id },
        ],
      }),
      sceneLayers: { ...NO_SOURCES.sceneLayers, labels: true, details: true },
      names: new Map([["AIANOM_RESEARCHDEPO_CAT", "Research Depot"]]),
    });
    const layer = new LabelsLayer();
    layer.rebuild(ctx);
    const cam = viewport(layer, 2);
    const plate = layer.plates().find((p) => p.id === EARTH.id);
    if (!plate) throw new Error("no plate for the planet");
    const holder = shown(layer).find(
      (h) => h.position.x === plate.x && h.position.y === plate.y,
    ) as Container;
    const over = holder.children.find((c) => c.label === "marks") as Container;
    const sprites = () =>
      over.children
        .flatMap((c) => c.children)
        .filter((c): c is Sprite => c instanceof Sprite && c.visible)
        .sort((a, b) => a.x - b.x);
    const icons = [
      MEGASTRUCTURE_ICON_KEY,
      ARCHAEOLOGY_ICON_KEYS[0],
      ANOMALY_ICON_KEY,
      PRE_FTL_ICON_KEY,
    ].map(textureFor);
    await vi.waitFor(() => expect(sprites().map((s) => s.texture)).toEqual(icons));

    const k = Math.abs(holder.scale.x) * cam.scale;
    const top = cam.worldToScreen(plate.x, plate.y);
    const tipOver = (sprite: Sprite) =>
      layer.tipAt(
        top.x + (over.x + over.scale.x * (sprite.x + sprite.width / 2)) * k,
        top.y + (over.y + over.scale.y * (sprite.y + sprite.height / 2)) * k,
      );
    const [megastructure, site, anomaly] = sprites();
    expect(tipOver(megastructure)?.title).toBe("Dyson Sphere (stage 2)");
    expect(tipOver(site)).toEqual({
      title: "Tiyanki Graveyard",
      lines: [ctx.templateName(holding)],
    });
    expect(tipOver(anomaly)).toEqual({ title: "Research Depot", lines: ["Anomaly"] });
    expect(layer.tipAt(top.x - 50, top.y - 50)).toBeNull();
    layer.destroy();
  });

  it("draws the resource row under the body, where the plate would be, while Labels is off", () => {
    clearTextures();
    const layer = new LabelsLayer();
    layer.rebuild(labelled({ labels: false, details: true }));
    const cam = viewport(layer, 2);
    const [x, y] = MINED.layout?.at ?? [0, 0];
    const earthAt = cam.worldToScreen(x, y);
    const [row] = layer.plates();
    const top = cam.worldToScreen(row.x, row.y);
    expect(top.x + row.w / 2).toBeCloseTo(earthAt.x);
    expect(top.y).toBeGreaterThan(earthAt.y);
    clearTextures();
    layer.destroy();
  });
});
