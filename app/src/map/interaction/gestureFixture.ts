/** The click and the targets a galaxy map gesture test drives the model with. */
import { at } from "../../test/mapIntent";
import type { MapInput, MapIntent, MapModel } from "./MapIntent";

/** A press, a move under the drag threshold and a release at one point. */
export function click(model: MapModel, intent: MapIntent, extra: Partial<MapInput>): void {
  model.handle(at("down", 10, 10, extra), intent);
  model.handle(at("move", 11, 12, extra), intent);
  model.handle(at("up", 11, 12, extra), intent);
}

export const LANE = { a: 1, b: 2 };
export const LANE_EDGE = { kind: "lane", lane: LANE } as const;
export const LINK = { kind: "feLink", anchor: 9, system: 4 } as const;
export const RING = { index: 3, part: "ring" } as const;
export const CENTRE = { index: 3, part: "centre" } as const;
export const HANDLE_X = { index: 3, part: "handle", axis: "x" } as const;
export const HANDLE_Y = { index: 3, part: "handle", axis: "y" } as const;
export const ZONE = { anchor: 9, zone: "ring" } as const;
export const ZONE_PORT = { anchor: 9, zone: "port" } as const;
export const ONE = { kind: "systems", ids: [7] } as const;
export const FROM_ZONE = { kind: "feZone", anchor: 9 } as const;
export const AT_ZONE = { kind: "feZone", anchor: 9, valid: true } as const;
