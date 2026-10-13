import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../api/gamedata", () => import("../../test/textures"));

import { SAVE_GEOMETRY } from "../../lib/details/saveGeometry";
import { SAVE_X_SIGN, SAVE_Y_SIGN } from "../../lib/geometry/geometry";
import { getTexture, requestTextures } from "../../lib/visual/textures";
import { megastructureSummary, orbitClasses, orbitSystem } from "../../test/builders";
import { textureFetch } from "../../test/textures";
import { until } from "../../test/wait";
import { Camera } from "../Camera";
import { systemContext, type SystemContext } from "./context";
import { FURNACE, PLACEMENT, RELAY, structuredSave } from "./contextFixture";
import { EARTH, MARS, WORMHOLE } from "./fixture";
import { drawnDisc } from "./geometry";
import { decodeByKey, resetTextures } from "./layers/bodiesFixture";
import { handleOwnerAt, pickHandle, pickTarget } from "./picking";
import { NO_SOURCES } from "./sources";

textureFetch.mode = "never";

describe("the handles shown", () => {
  const base = systemContext({
    ...NO_SOURCES,
    id: 140,
    details: orbitSystem(),
    planetClasses: orbitClasses(),
    geometry: SAVE_GEOMETRY,
  });
  const cam = new Camera();
  cam.setViewport(800, 800);
  const first = { kind: "belt", index: 0 } as const;
  /** The world point `px` screen pixels out from the centre, straight up the screen. */
  const up = (px: number) => cam.screenToWorld(400, 400 - px);

  it("are the band's the pointer is over, or the inner radius's it is near, and none elsewhere", () => {
    const half = (base.belts[0].outer - base.belts[0].inner) / 2;
    expect(handleOwnerAt(base, cam, up(120))).toEqual(first);
    expect(handleOwnerAt(base, cam, up(120 + half + 4))).toEqual(first);
    expect(handleOwnerAt(base, cam, up(170 - half))).toEqual({ kind: "belt", index: 1 });
    expect(handleOwnerAt(base, cam, up(203))).toEqual({ kind: "innerRadius" });
    expect(handleOwnerAt(base, cam, up(60))).toBeNull();
    expect(handleOwnerAt(base, cam, up(260))).toBeNull();
  });

  it("pick a belt from any of its six handles, and a hidden handle never", () => {
    for (const { x, y } of base.handles.slice(0, 6)) {
      const s = cam.worldToScreen(x, y);
      const at = cam.screenToWorld(s.x + 2, s.y - 1);
      expect(pickHandle(base.handles, cam, at, first), `${x},${y}`).toEqual(first);
      expect(pickHandle(base.handles, cam, at, null)).toBeNull();
      expect(pickHandle(base.handles, cam, at, { kind: "innerRadius" })).toBeNull();
    }
    const between = cam.screenToWorld(400 + 120, 400);
    expect(pickHandle(base.handles, cam, between, first)).toBeNull();
  });
});

describe("clicking a megastructure", () => {
  beforeEach(resetTextures);
  afterEach(resetTextures);

  const furnace = megastructureSummary({ id: 9, kind: FURNACE.key, planet: MARS.id });
  const relay = megastructureSummary({ id: 8, kind: RELAY.key, at: [-168, 60] });
  const cam = new Camera();
  cam.setViewport(800, 600);
  cam.scale = 2;

  /** Lands the model of each of `ctx`'s structures at `PLACEMENT`. */
  async function landModels(ctx: SystemContext): Promise<void> {
    decodeByKey();
    textureFetch.mode = "views";
    textureFetch.model = () => PLACEMENT;
    const keys = ctx.structures.flatMap((s) => (s.modelKey === null ? [] : [s.modelKey]));
    requestTextures(keys);
    await until(() => keys.forEach((key) => expect(getTexture(key)).toBeTruthy()));
  }

  it("picks the body under a structure drawn over it, and the structure where no body is", () => {
    const ctx = structuredSave([furnace, relay]);
    const pick = (x: number, y: number) => pickTarget(ctx, cam, { x, y }, () => null, null);
    expect(pick(0, 130)).toEqual({ kind: "body", id: MARS.id });
    expect(pick(-168, 60)).toEqual({ kind: "megastructure", id: 8 });
  });

  it("picks a structure in the ellipse inside its landed model, and what lies under the model's empty corners", async () => {
    const ctx = structuredSave([relay]);
    await landModels(ctx);
    // Screen-right is −save x: the model reaches three quarters of its width that way.
    const right = -168 + SAVE_X_SIGN * 0.7 * PLACEMENT.width;
    expect(pickTarget(ctx, cam, { x: right, y: 60 }, () => null, null)).toEqual({
      kind: "megastructure",
      id: 8,
    });
    // Inside the sprite's rectangle, outside its ellipse and the pick radius about its point.
    const corner = { x: -168 + SAVE_X_SIGN * 6.5, y: 60 + SAVE_Y_SIGN * 2.7 };
    expect(pickTarget(ctx, cam, corner, () => null, null)).toBeNull();
  });

  it("picks the structure on its landed sprite over a body, the body on its own disc or a plate over it, and a bare body elsewhere", async () => {
    const ctx = structuredSave([furnace]);
    await landModels(ctx);
    const mars = ctx.bodyById.get(MARS.id)!;
    const earth = ctx.bodyById.get(EARTH.id)!.placement;
    const at = (p: { x: number; y: number }, plate: number | null = null) =>
      pickTarget(
        ctx,
        cam,
        { x: p.x, y: p.y },
        () => (plate === null ? null : { kind: "body", id: plate }),
        null,
      );
    const { x, y, disc } = mars.placement;
    expect(at(mars.placement)).toEqual({ kind: "body", id: MARS.id });
    const past = drawnDisc(disc, cam.scale, mars.look) * 1.1;
    expect(at({ x, y: y + past })).toEqual({ kind: "megastructure", id: 9 });
    expect(at(mars.placement, MARS.id)).toEqual({ kind: "body", id: MARS.id });
    expect(at(earth)).toEqual({ kind: "body", id: EARTH.id });

    const hole = { ...WORMHOLE, x: x + 0.5, y };
    const withHole = systemContext({
      ...ctx,
      details: { ...ctx.details!, wormholes: [hole] },
      sceneLayers: { ...ctx.sceneLayers, bypasses: true },
    });
    expect(pickTarget(withHole, cam, hole, () => null, null)).toEqual({
      kind: "wormhole",
      id: hole.id,
    });
  });
});
