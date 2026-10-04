import { describe, expect, it, vi } from "vitest";

vi.mock("../../api/gamedata", () => import("../../test/textures"));

import { SAVE_GEOMETRY } from "../../lib/details/saveGeometry";
import { orbitClasses, orbitSystem } from "../../test/builders";
import { textureFetch } from "../../test/textures";
import { Camera } from "../Camera";
import { systemContext } from "./context";
import { handleOwnerAt, pickHandle } from "./picking";
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
