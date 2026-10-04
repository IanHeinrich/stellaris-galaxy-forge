import { afterEach, describe, expect, it, vi } from "vitest";

/** The texture fetch, which answers only once a test lets it. */
const fetch = vi.hoisted(() => ({ answers: false }));

vi.mock("../../../api/gamedata", () => ({
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
import { NAME_ROW } from "../../../lib/details/layout";
import type { Camera } from "../../Camera";
import { DISC_PX } from "../../layers/details/cell";
import { NAME_STYLE } from "../../layers/nameWidth";
import { clearTextures, setTextureDecoder } from "../../../lib/visual/textures";
import { countryNode } from "../../../test/builders";
import { systemContext } from "../context";
import {
  EARTH,
  LUNA,
  MARS,
  SUN,
  saveBody,
  context,
  drawOps,
  plateTexts,
  resourceAmounts,
  strokes,
  stubTextMeasurement,
  viewport,
  WORMHOLE,
} from "../fixture";
import { drawnWormhole } from "../geometry";
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
      ...context({ planets: [SUN, MINED], wormholes: [] }),
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

  /** Decodes every texture the layer asks for as a blank one of its own, returned by key. */
  const decodeAll = () => {
    const decoded = new Map<string, Texture>();
    const textureFor = (key: string) => {
      if (!decoded.has(key)) decoded.set(key, new Texture());
      return decoded.get(key)!;
    };
    setTextureDecoder((view) => Promise.resolve(textureFor(view.key)));
    fetch.answers = true;
    return textureFor;
  };

  /** Body `id`'s shown marks, and the screen point over the middle of one of their sprites. */
  const markSprites = (layer: LabelsLayer, cam: Camera, id: number) => {
    const plate = layer.plates().find((p) => p.id === id);
    if (!plate) throw new Error(`no plate for ${id}`);
    const holder = shown(layer).find(
      (h) => h.position.x === plate.x && h.position.y === plate.y,
    ) as Container;
    const over = holder.children.find((c) => c.label === "marks") as Container;
    const k = Math.abs(holder.scale.x) * cam.scale;
    const top = cam.worldToScreen(plate.x, plate.y);
    return {
      top,
      sprites: () =>
        over.children
          .flatMap((c) => c.children)
          .filter((c): c is Sprite => c instanceof Sprite && c.visible)
          .sort((a, b) => a.x - b.x),
      pointOver: (sprite: Sprite) => ({
        x: top.x + (over.x + over.scale.x * (sprite.x + sprite.width / 2)) * k,
        y: top.y + (over.y + over.scale.y * (sprite.y + sprite.height / 2)) * k,
      }),
    };
  };

  it("draws a marked body's label at the galaxy row's size, a marked moon's smaller, and a plain body's as before", async () => {
    clearTextures();
    const textureFor = decodeAll();
    const empire = countryNode({
      id: 9,
      colors: ["red", "black"],
      flag_icon: { category: "human", file: "flag_human_9.dds" },
      flag_background: { category: "backgrounds", file: "00_solid.dds" },
    });
    const capital = { ...EARTH, colonised: true, capital: true, owner: empire.id };
    const natives = { ...MARS, colonised: true, owner: 10, pre_ftl: true };
    const plainWorld = saveBody(5, "pc_barren", [-150, 0], 150, SUN.id);
    const withDetails = (details: boolean) =>
      systemContext({
        ...context({
          planets: [SUN, capital, LUNA, natives, plainWorld],
          sites: [{ id: 60, kind: "site_zroni_ruins", planet: LUNA.id }],
        }),
        sceneLayers: { ...NO_SOURCES.sceneLayers, labels: true, details },
        countries: new Map([[empire.id, empire]]),
      });
    const holderOf = (layer: LabelsLayer, id: number) => {
      const plate = layer.plates().find((p) => p.id === id);
      if (!plate) throw new Error(`no plate for ${id}`);
      return shown(layer).find(
        (h) => h.position.x === plate.x && h.position.y === plate.y,
      ) as Container;
    };
    const nameSize = (layer: LabelsLayer, id: number) => {
      const name = holderOf(layer, id).children.find((c) => c.label === "name");
      if (!(name instanceof BitmapText)) throw new Error(`no name for ${id}`);
      return name.style.fontSize;
    };
    const sprites = (layer: LabelsLayer, id: number) =>
      holderOf(layer, id)
        .children.filter((c) => c.label === "marks")
        .flatMap(function all(c): Sprite[] {
          const own = c instanceof Sprite && c.visible ? [c] : [];
          return [...own, ...(c instanceof Container ? c.children.flatMap(all) : [])];
        });

    const layer = new LabelsLayer();
    layer.rebuild(withDetails(false));
    viewport(layer, 4);
    const plain = [capital, natives, plainWorld].map((p) => nameSize(layer, p.id));
    expect(parts(layer, "gamePlate")).toHaveLength(0);
    expect(parts(layer, "marks")).toHaveLength(0);

    layer.rebuild(withDetails(true));
    viewport(layer, 4);
    expect(nameSize(layer, capital.id)).toBe(NAME_STYLE.fontSize);
    expect(nameSize(layer, natives.id)).toBe(NAME_STYLE.fontSize);
    expect(nameSize(layer, plainWorld.id)).toBe(plain[2]);
    expect(plain[0]).toBeLessThan(NAME_STYLE.fontSize);
    const scaleOf = (id: number) => Math.abs(holderOf(layer, id).scale.x);
    expect(scaleOf(LUNA.id) / scaleOf(capital.id)).toBeCloseTo(0.85);
    expect(scaleOf(plainWorld.id)).toBeCloseTo(scaleOf(capital.id));

    const flag = textureFor(empireFlagKey(empire) ?? "");
    const preFtl = textureFor(PRE_FTL_ICON_KEY);
    await vi.waitFor(() => {
      expect(sprites(layer, capital.id).map((s) => s.texture)).toContain(flag);
      expect(sprites(layer, natives.id).map((s) => s.texture)).toContain(preFtl);
    });
    const flagSprite = sprites(layer, capital.id).find((s) => s.texture === flag);
    const icon = sprites(layer, natives.id).find((s) => s.texture === preFtl);
    expect(flagSprite?.width).toBeCloseTo((DISC_PX * 70) / 60);
    expect(icon?.width).toBeCloseTo(NAME_ROW.iconPx);
    expect(sprites(layer, plainWorld.id)).toHaveLength(0);
    const [plate, ...others] = parts(layer, "gamePlate");
    expect(others).toHaveLength(0);
    if (!(plate instanceof NineSliceSprite)) throw new Error("no game plate");
    expect(plate.visible).toBe(true);
    expect(plate.texture).toBe(textureFor(CAPITAL_PLATE_KEY));

    layer.rebuild(withDetails(false));
    viewport(layer, 4);
    expect(parts(layer, "marks")).toHaveLength(0);
    expect(nameSize(layer, capital.id)).toBe(plain[0]);
    layer.destroy();
  });

  it("shows a body's megastructure, dig site, anomaly and pre-FTL icons in the galaxy's order, each with its tooltip", async () => {
    clearTextures();
    const textureFor = decodeAll();
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
    const earth = markSprites(layer, cam, EARTH.id);
    const icons = [
      MEGASTRUCTURE_ICON_KEY,
      ARCHAEOLOGY_ICON_KEYS[0],
      ANOMALY_ICON_KEY,
      PRE_FTL_ICON_KEY,
    ].map(textureFor);
    await vi.waitFor(() => expect(earth.sprites().map((s) => s.texture)).toEqual(icons));

    const tipOver = (sprite: Sprite, body = EARTH.id) => {
      const at = earth.pointOver(sprite);
      return layer.tipAt(body, at.x, at.y);
    };
    const [megastructure, site, anomaly] = earth.sprites();
    expect(tipOver(megastructure)?.title).toBe("Dyson Sphere (stage 2)");
    expect(tipOver(site)).toEqual({
      title: "Tiyanki Graveyard",
      lines: [ctx.templateName(holding)],
    });
    expect(tipOver(anomaly)).toEqual({ title: "Research Depot", lines: ["Anomaly"] });
    expect(layer.tipAt(EARTH.id, earth.top.x - 50, earth.top.y - 50)).toBeNull();
    layer.destroy();
  });

  it("gives no mark tooltip for a body other than the one hovered, whose disc may lie under another's plate", async () => {
    clearTextures();
    const textureFor = decodeAll();
    const holding = { ...EARTH, anomaly: "time_loop_world" };
    const layer = new LabelsLayer();
    layer.rebuild(
      systemContext({
        ...context({ planets: [SUN, holding, LUNA] }),
        sceneLayers: { ...NO_SOURCES.sceneLayers, labels: true, details: true },
      }),
    );
    const cam = viewport(layer, 2);
    const earth = markSprites(layer, cam, EARTH.id);
    await vi.waitFor(() =>
      expect(earth.sprites().map((s) => s.texture)).toEqual([textureFor(ANOMALY_ICON_KEY)]),
    );
    const at = earth.pointOver(earth.sprites()[0]);
    expect(layer.tipAt(EARTH.id, at.x, at.y)?.title).toBe("Time Loop World");
    expect(layer.tipAt(LUNA.id, at.x, at.y)).toBeNull();
    layer.destroy();
  });

  it("names a flag's owner as the context now does after a change that leaves the labels standing", async () => {
    clearTextures();
    const textureFor = decodeAll();
    const empire = countryNode({
      id: 9,
      colors: ["red", "black"],
      flag_icon: { category: "human", file: "flag_human_9.dds" },
      flag_background: { category: "backgrounds", file: "00_solid.dds" },
    });
    const colony = { ...EARTH, colonised: true, owner: empire.id };
    const ownership = (label: string) => ({
      owners: new Map<number, number>(),
      table: new Map([
        [
          empire.id,
          {
            id: empire.id,
            label,
            kind: "country" as const,
            colors: { outline: 0x3366cc, fill: 0 },
          },
        ],
      ]),
    });
    const sources = {
      ...context({ planets: [SUN, colony] }),
      sceneLayers: { ...NO_SOURCES.sceneLayers, labels: true, details: true },
      countries: new Map([[empire.id, empire]]),
    };
    const layer = new LabelsLayer();
    layer.rebuild(systemContext({ ...sources, ownership: ownership("Old Empire") }));
    const cam = viewport(layer, 2);
    const flag = textureFor(empireFlagKey(empire) ?? "");
    const earth = markSprites(layer, cam, EARTH.id);
    await vi.waitFor(() => expect(earth.sprites().map((s) => s.texture)).toContain(flag));
    const flagTitle = () => {
      const sprite = earth.sprites().find((s) => s.texture === flag);
      if (!sprite) throw new Error("no flag");
      const at = earth.pointOver(sprite);
      return layer.tipAt(EARTH.id, at.x, at.y)?.title;
    };
    expect(flagTitle()).toBe("Old Empire");

    const before = layer.container.children[0];
    layer.rebuild(systemContext({ ...sources, ownership: ownership("New Empire") }));
    expect(layer.container.children[0]).toBe(before);
    expect(flagTitle()).toBe("New Empire");
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

describe("the system scene's labels layer at wormholes", () => {
  it("names each wormhole on a plate under its swirl with Labels on, never picked as a body's", () => {
    const layer = new LabelsLayer();
    const ctx = context({ planets: [SUN] });
    layer.rebuild(ctx);
    const cam = viewport(layer, 2);
    const names = plateTexts(layer.container, "name");
    expect(names).toContain("S5 Wormhole");
    expect(names).toContain("S5 Shroud Tunnel");
    const holder = layer.container.children.find((h) =>
      (h as Container).children.some((c) => c instanceof BitmapText && c.text === "S5 Wormhole"),
    )!;
    const swirl = cam.worldToScreen(WORMHOLE.x, WORMHOLE.y);
    const top = cam.worldToScreen(holder.x, holder.y);
    expect(top.y).toBeGreaterThan(swirl.y + drawnWormhole(cam.scale) * cam.scale);
    expect(layer.plates().map((p) => p.id)).toEqual([SUN.id]);
    const glyph = (holder as Container).children.find((c) => c.label === "glyph");
    expect(glyph?.visible).toBe(false);

    const was = holder.y;
    const dragged = new Map([[WORMHOLE.id, { x: WORMHOLE.x, y: WORMHOLE.y + 60 }]]);
    layer.rebuild(systemContext(ctx, { override: { wormholes: dragged }, marks: null }));
    expect(layer.container.children).toContain(holder);
    expect(holder.y).toBeCloseTo(was + 60);

    const unnamed = { ...ctx.sceneLayers, labels: false };
    layer.rebuild(systemContext({ ...ctx, sceneLayers: unnamed }));
    expect(plateTexts(layer.container, "name")).toEqual([]);
    layer.destroy();
  });
});
