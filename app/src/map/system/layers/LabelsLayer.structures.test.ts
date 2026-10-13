import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flush } from "../../../test/flush";
import { until } from "../../../test/wait";

vi.mock("../../../api/gamedata", () => import("../../../test/textures"));

import { BitmapText, Container, Texture } from "pixi.js";
import { clearTextures, requestTextures, setTextureDecoder } from "../../../lib/visual/textures";
import {
  megastructureSummary,
  megastructureTypeView,
  starbaseLevelView,
  starbaseSummary,
} from "../../../test/builders";
import { textureFetch } from "../../../test/textures";
import { systemContext } from "../context";
import {
  EARTH,
  SUN,
  context,
  resourceAmounts,
  stubTextMeasurement,
  viewport,
} from "../drawFixture";
import { withStructures } from "../contextFixture";
import { plateUnder } from "../picking";
import { LabelsLayer } from "./LabelsLayer";
import { BASE_OUTPUT_LINE } from "./structureLabels";

stubTextMeasurement();

beforeEach(() => {
  textureFetch.mode = "never";
});

afterEach(() => {
  setTextureDecoder(null);
  clearTextures();
});

describe("the system scene's labels layer at megastructures and starbases", () => {
  const NEXUS = megastructureTypeView("think_tank_3", {
    entity: "thinktank_phase_03_entity",
    produces: [["physics_research", 300]],
  });
  const RELAY = megastructureTypeView("hyper_relay");
  const PORT = starbaseLevelView("starbase_level_starport", {
    station_entity: "starbase_starport_section_entity",
  });

  const structured = (layers: { labels: boolean; details: boolean }) => {
    const base = context({ planets: [SUN, EARTH], wormholes: [] });
    const rows = [
      megastructureSummary({ id: 1, kind: NEXUS.key, planet: EARTH.id, at: [90, 0] }),
      megastructureSummary({ id: 2, kind: RELAY.key, at: [-120, 60] }),
    ];
    return withStructures(
      systemContext({ ...base, sceneLayers: { ...base.sceneLayers, ...layers } }),
      rows,
      {
        types: [NEXUS, RELAY],
        levels: [PORT],
        names: { [NEXUS.key]: "Science Nexus", [RELAY.key]: "Hyper Relay" },
        stations: [starbaseSummary({ level: PORT.key, name_key: "Sol Station", at: [30, -40] })],
      },
    );
  };

  const shownHolders = (layer: LabelsLayer) =>
    layer.container.children.filter((h) => h.visible) as Container[];
  const texts = (holder: Container) =>
    holder.children.flatMap((c) => (c instanceof BitmapText && c.label === "name" ? [c] : []));
  const holderNaming = (layer: LabelsLayer, name: string) =>
    shownHolders(layer).find((h) => texts(h).some((t) => t.text === name));

  it("keeps every label object while a preview drags the body a producing megastructure stands on", () => {
    const layer = new LabelsLayer();
    const base = structured({ labels: true, details: true });
    layer.rebuild(base);
    viewport(layer, 2);
    const objects = () => layer.container.children.map((h) => [h, ...(h as Container).children]);
    const before = objects();
    for (const angle of [80, 70]) {
      const override = { bodies: new Map([[EARTH.id, { parent: SUN.id, radius: 90, angle }]]) };
      layer.rebuild(systemContext(base, { override, marks: null }));
    }
    const after = objects();
    expect(after).toHaveLength(before.length);
    after.forEach((list, i) => list.forEach((o, j) => expect(o).toBe(before[i][j])));
    layer.destroy();
  });

  it("names a megastructure under its body's plate, what it produces under its name, and a lone one or a starbase under its own point", () => {
    const layer = new LabelsLayer();
    const ctx = structured({ labels: true, details: true });
    layer.rebuild(ctx);
    const cam = viewport(layer, 2);

    const earth = holderNaming(layer, "Science Nexus");
    expect(earth).toBeDefined();
    const names = texts(earth!);
    expect(names).toHaveLength(2);
    const nexus = names.find((t) => t.text === "Science Nexus")!;
    const own = names.find((t) => t !== nexus)!;
    expect(nexus.y).toBeGreaterThan(own.y);
    expect(resourceAmounts(earth!)).toEqual(["300"]);
    expect(layer.plates().map((p) => p.id)).toEqual([SUN.id, EARTH.id]);

    for (const [name, at] of [
      ["Hyper Relay", [-120, 60]],
      ["Sol Station", [30, -40]],
    ] as const) {
      const holder = holderNaming(layer, name);
      expect(holder, name).toBeDefined();
      const point = cam.worldToScreen(at[0], at[1]);
      const top = cam.worldToScreen(holder!.position.x, holder!.position.y);
      expect(top.y).toBeGreaterThan(point.y);
    }
    layer.destroy();
  });

  it("picks a megastructure by its own plate under its body's, the body by the body's own, and tells its output is the base", () => {
    const layer = new LabelsLayer();
    layer.rebuild(structured({ labels: true, details: true }));
    const cam = viewport(layer, 2);
    const nexus = layer.structurePlates().find((p) => p.target.id === 1);
    const earth = layer.plates().find((p) => p.id === EARTH.id);
    if (!nexus || !earth) throw new Error("no plate");
    const inside = (p: { x: number; y: number; h: number }) => {
      const top = cam.worldToScreen(p.x, p.y);
      return { x: top.x + 2, y: top.y + p.h / 2 };
    };
    expect(plateUnder(layer.structurePlates(), cam, inside(nexus))?.target).toEqual({
      kind: "megastructure",
      id: 1,
    });
    expect(plateUnder(layer.plates(), cam, inside(nexus))).toBeNull();
    expect(plateUnder(layer.plates(), cam, inside(earth))?.id).toBe(EARTH.id);
    expect(plateUnder(layer.structurePlates(), cam, inside(earth))).toBeNull();

    const top = cam.worldToScreen(nexus.x, nexus.y);
    const tips = [];
    for (let dy = 0; dy < nexus.h; dy++) {
      for (let dx = 0; dx < nexus.w; dx++) {
        const tip = layer.structureTipAt(nexus.target, top.x + dx, top.y + dy);
        if (tip) tips.push(tip);
      }
    }
    expect(tips.length).toBeGreaterThan(0);
    for (const tip of tips) expect(tip.lines).toContain(BASE_OUTPUT_LINE);
    layer.destroy();
  });

  it("places the plates again when a model of the scene lands, and not for any other texture", async () => {
    setTextureDecoder(() => Promise.resolve(Texture.EMPTY));
    textureFetch.mode = "views";
    const layer = new LabelsLayer();
    const ctx = structured({ labels: true, details: false });
    layer.rebuild(ctx);
    viewport(layer, 2);
    const placed = layer.plates();
    requestTextures(["sprite:GFX_unrelated"]);
    await flush();
    expect(layer.plates()).toBe(placed);

    const relay = ctx.structures.find((s) => s.id === 2)!;
    requestTextures([relay.modelKey!]);
    await until(() => expect(layer.plates()).not.toBe(placed));
    layer.destroy();
  });

  it("leaves the structures' names to the Labels switch and what they produce to Details", () => {
    const layer = new LabelsLayer();
    viewport(layer, 2);
    layer.rebuild(structured({ labels: false, details: true }));
    expect(shownHolders(layer).flatMap(texts)).toEqual([]);
    expect(shownHolders(layer).flatMap(resourceAmounts)).toContain("300");
    layer.rebuild(structured({ labels: true, details: false }));
    expect(shownHolders(layer).flatMap(resourceAmounts)).toEqual([]);
    expect(
      shownHolders(layer)
        .flatMap(texts)
        .map((t) => t.text),
    ).toEqual(expect.arrayContaining(["Science Nexus", "Hyper Relay", "Sol Station"]));
    layer.destroy();
  });
});
