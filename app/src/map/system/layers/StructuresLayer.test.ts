import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../api/ipc");
vi.mock("../../../api/gamedata", () => import("../../../test/textures"));

import { MEGASTRUCTURE_ICON_KEY } from "../../../lib/details/icons";
import { SAVE_GEOMETRY } from "../../../lib/details/saveGeometry";
import { SAVE_X_SIGN, SAVE_Y_SIGN } from "../../../lib/geometry/geometry";
import { megastructureSummary, starbaseSummary } from "../../../test/builders";
import { textureFetch } from "../../../test/textures";
import { until } from "../../../test/wait";
import { systemContext, type SystemContext } from "../context";
import {
  FURNACE,
  NEXUS,
  onlyStructure,
  PLACEMENT,
  RELAY,
  STARPORT,
  structuredSave,
} from "../contextFixture";
import { EARTH, MARS, SYSTEM, viewport } from "../fixture";
import { answerFetch, decodeByKey, holderAt, resetTextures, sprite } from "./bodiesFixture";
import { StructuresLayer } from "./StructuresLayer";

beforeEach(resetTextures);

/** The sprite labelled `label` in the holder of `ctx`'s one structure. */
const drawnPart = (layer: StructuresLayer, ctx: SystemContext, label: string) => {
  const { x, y } = onlyStructure(ctx);
  return sprite(holderAt(layer, x, y), label);
};

describe("how a megastructure or a starbase is drawn", () => {
  it("sizes the sprite from its placement once it lands, mirrored against the scene's axis flip", async () => {
    const textureFor = decodeByKey();
    textureFetch.model = () => PLACEMENT;
    const layer = new StructuresLayer();
    const furnace = megastructureSummary({ id: 2, kind: FURNACE.key, planet: MARS.id });
    const ctx = structuredSave([furnace]);
    layer.rebuild(ctx);
    viewport(layer, 2);
    const model = drawnPart(layer, ctx, "model");
    expect(model.visible).toBe(false);

    await answerFetch();
    await until(() => expect(model.visible).toBe(true));
    const { scale } = onlyStructure(ctx);
    const texture = textureFor("model:none:arc_furnace_entity");
    expect(model.texture).toBe(texture);
    expect(model.anchor.x).toBe(0.25);
    expect(model.anchor.y).toBe(0.5);
    expect(model.scale.x * texture.width).toBeCloseTo(SAVE_X_SIGN * PLACEMENT.width * scale);
    expect(model.scale.y * texture.height).toBeCloseTo(SAVE_Y_SIGN * PLACEMENT.height * scale);
    layer.destroy();
  });

  it("asks for every model and icon of the system in one batch", async () => {
    const { getTextures } = await import("../../../test/textures");
    getTextures.mockClear();
    const layer = new StructuresLayer();
    layer.rebuild(
      structuredSave(
        [megastructureSummary({ id: 1, kind: RELAY.key })],
        [starbaseSummary({ level: STARPORT.key })],
      ),
    );
    await answerFetch();
    expect(getTextures).toHaveBeenCalledTimes(1);
    expect(getTextures.mock.calls[0][0]).toEqual([
      "model:none:hyper_relay_entity",
      MEGASTRUCTURE_ICON_KEY,
      "model:none:starbase_starport_section_entity",
      "sprite:GFX_starbase_ship_size_small#2",
    ]);
    layer.destroy();
  });

  it("shows the map icon in place of a model that could not be baked", async () => {
    decodeByKey();
    textureFetch.mode = "views";
    textureFetch.fails = (key) => key.startsWith("model:");
    const layer = new StructuresLayer();
    const ctx = structuredSave([megastructureSummary({ id: 5, kind: RELAY.key })]);
    layer.rebuild(ctx);
    viewport(layer, 2);
    await until(() => expect(drawnPart(layer, ctx, "icon").visible).toBe(true));
    expect(drawnPart(layer, ctx, "model").visible).toBe(false);
    layer.destroy();
  });
});

describe("a drag that moves a body a structure stands on", () => {
  it("keeps drawing the last bake while a turned model's is made", async () => {
    const textureFor = decodeByKey();
    textureFetch.model = () => PLACEMENT;
    const layer = new StructuresLayer();
    const at = (point: [number, number]) =>
      structuredSave([
        megastructureSummary({ id: 7, kind: NEXUS.key, planet: EARTH.id, at: point }),
      ]);
    const first = at([40, 0]);
    layer.rebuild(first);
    viewport(layer, 2);
    await answerFetch();
    const was = onlyStructure(first).modelKey!;
    await until(() => expect(drawnPart(layer, first, "model").texture).toBe(textureFor(was)));

    const turned = at([0, 40]);
    expect(onlyStructure(turned).modelKey).not.toBe(was);
    layer.rebuild(turned);
    const model = drawnPart(layer, turned, "model");
    expect(model.visible).toBe(true);
    expect(model.texture).toBe(textureFor(was));

    await answerFetch();
    await until(() => expect(model.texture).toBe(textureFor(onlyStructure(turned).modelKey!)));
    layer.destroy();
  });

  it("moves the structure's sprite and keeps it, rebuilding nothing", () => {
    const furnace = megastructureSummary({ id: 9, kind: FURNACE.key, planet: MARS.id });
    const base = structuredSave([furnace]);
    const layer = new StructuresLayer();
    layer.rebuild(base);
    const was = onlyStructure(base);
    const before = holderAt(layer, was.x, was.y);
    const model = sprite(before, "model");
    const override = SAVE_GEOMETRY.preview(
      { kind: "move", system: SYSTEM, body: MARS.id, radius: 200, angle: 0 },
      base,
    );
    const moved = systemContext(base, { override, marks: null });
    layer.rebuild(moved);
    const now = onlyStructure(moved);
    const after = holderAt(layer, now.x, now.y);
    expect(after).toBe(before);
    expect(sprite(after, "model")).toBe(model);
    layer.destroy();
  });
});
