import type { MapInput, MapIntent } from "../map/interaction/MapIntent";
import type { SystemContext } from "../map/system/context";
import type { SystemInput, SystemIntent } from "../map/system/SystemGestureModel";

type Call<T> = [keyof T, ...unknown[]];
type Recorder<T> = T & { calls: Array<Call<T>> };

/** An intent whose every method, each listed in `methods`, records its calls. */
function recording<T>(methods: Record<keyof T, true>): Recorder<T> {
  const calls: Array<Call<T>> = [];
  const names = Object.keys(methods) as Array<keyof T>;
  const intent = Object.fromEntries(
    names.map((name) => [name, (...args: unknown[]) => void calls.push([name, ...args])]),
  );
  return { ...intent, calls } as Recorder<T>;
}

/** A `MapIntent` that records every call, for driving a control model without a canvas. */
export function recorder(): Recorder<MapIntent> {
  return recording<MapIntent>({
    select: true,
    toggleSelect: true,
    selectLane: true,
    clearSelection: true,
    enterSystem: true,
    previewMarquee: true,
    endMarquee: true,
    selectInRect: true,
    previewMove: true,
    commitMove: true,
    previewMoveGroup: true,
    commitMoveGroup: true,
    cancelMove: true,
    previewLane: true,
    endLane: true,
    connect: true,
    cut: true,
    selectNebula: true,
    previewNebula: true,
    commitNebula: true,
    previewNebulaRadius: true,
    commitNebulaRadius: true,
    endNebula: true,
    selectFeZone: true,
    previewFeZone: true,
    commitFeZone: true,
    endFeZone: true,
    contextMenu: true,
    hoverBrush: true,
    beginStroke: true,
    extendStroke: true,
    commitStroke: true,
    cancelStroke: true,
    endBrush: true,
  });
}

/**
 * A `SystemIntent` that records every call but `frame`, which gives `frame`, for driving the system
 * scene's model without a canvas. Without one, a drag that asks for it fails the test.
 */
export function sceneRecorder(frame?: SystemContext): Recorder<SystemIntent> {
  const intent = recording<SystemIntent>({
    hover: true,
    selectLane: true,
    enterSystem: true,
    contextMenu: true,
    openBody: true,
    showSystem: true,
    frame: true,
    preview: true,
    commit: true,
    refuse: true,
  });
  const given = () => {
    if (!frame) throw new Error("the model asked for the scene's frame, and the test gave none");
    return frame;
  };
  return { ...intent, frame: given };
}

/** The gap between the default times of two inputs: wide enough that no two double a click. */
const DEFAULT_TIME_STEP_MS = 1000;
let clock = 0;

/**
 * One input at screen (sx, sy), which is also its world point; a system or ring under it sets its
 * zone. Its time runs on from the last input's unless `extra` states one.
 */
export function at(
  kind: MapInput["kind"],
  sx: number,
  sy: number,
  extra: Partial<MapInput> = {},
): MapInput {
  return {
    kind,
    sx,
    sy,
    wx: sx,
    wy: sy,
    button: kind === "move" ? -1 : 0,
    shift: false,
    ctrl: false,
    alt: false,
    time: (clock += DEFAULT_TIME_STEP_MS),
    selection: [],
    system: null,
    zone:
      extra.system !== undefined && extra.system !== null ? "star" : extra.feZone ? "ring" : null,
    edge: null,
    midpointHit: false,
    snap: null,
    feZone: null,
    nebula: null,
    prevented: null,
    ...extra,
  };
}

/** The system `sceneAt`'s inputs are in, unless `extra` states another. */
export const SCENE_SYSTEM = 5;

/**
 * One input in the system scene at screen (sx, sy), which is also its scene point at one pixel a
 * unit, over nothing.
 */
export function sceneAt(
  kind: SystemInput["kind"],
  sx: number,
  sy: number,
  extra: Partial<SystemInput> = {},
): SystemInput {
  return {
    kind,
    sx,
    sy,
    wx: sx,
    wy: sy,
    button: kind === "move" ? -1 : 0,
    shift: false,
    ctrl: false,
    scale: 1,
    time: (clock += DEFAULT_TIME_STEP_MS),
    system: SCENE_SYSTEM,
    body: null,
    wormhole: null,
    handle: null,
    exit: null,
    draggable: false,
    ...extra,
  };
}
