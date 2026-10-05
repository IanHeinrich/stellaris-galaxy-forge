/** Scenes, bodies and targets a system view test builds, without PixiJS. */
import type { BodyLayout } from "../../generated/BodyLayout";
import type { Bounds } from "../../generated/Bounds";
import type { PlanetSummary } from "../../generated/PlanetSummary";
import type { SystemDetails } from "../../generated/SystemDetails";
import type { SystemRoll } from "../../generated/SystemRoll";
import type { WormholeSummary } from "../../generated/WormholeSummary";
import {
  bodyLayout,
  byId,
  placedNode,
  planetSummary,
  saveBody,
  systemDetails,
} from "../../test/builders";
import { rolledBody, systemRoll } from "../../test/rolls";
import { Camera } from "../Camera";
import type { HandleRef } from "./bodyDrag";
import { systemContext, type SystemContext } from "./context";
import type { SystemLayer } from "./layers/SystemLayer";
import type { SceneTarget } from "./picking";
import { NO_SOURCES, placeIn } from "./sources";

/** The body, wormhole or arrow `id` as an input's target. */
export const over = (kind: "body" | "wormhole" | "exit", id: number): SceneTarget => ({ kind, id });
/** A handle as an input's target. */
export const grip = (ref: HandleRef): SceneTarget => ({ kind: "handle", ref });

/** Drives one viewport pass at `scale`, centred on `at`, as the scene's tick would. */
export function viewport(layer: SystemLayer, scale: number, at = { x: 0, y: 0 }): Camera {
  const cam = new Camera();
  cam.setViewport(800, 600);
  cam.scale = scale;
  cam.x = at.x;
  cam.y = at.y;
  cam.rev++;
  layer.onViewport?.(cam);
  return cam;
}

export const SYSTEM = 5;

export const fixed = (value: number): Bounds => ({ min: value, max: value });

export const SUN = saveBody(1, "pc_g_star", [0, 0], 0, 16);
export const EARTH = saveBody(2, "pc_continental", [90, 0], 90, 16, SUN);
export const LUNA = saveBody(3, "pc_barren", [102, 0], 12, 16, EARTH);
export const MARS = saveBody(4, "pc_arid", [0, 130], 130, 16, SUN);

export const RADII_SHOWN = { ...NO_SOURCES.sceneLayers, orbitRadii: true };

/** The angle each scenario body names, where the roll `rollOf` gives lands it. */
const ANGLES = new WeakMap<PlanetSummary, number>();

/** A scenario body: placed by `orbit` and `angle` about its parent, with no point of its own. */
export function scenarioBody(
  id: number,
  planetClass: string,
  { angle, ...layout }: Omit<Partial<BodyLayout>, "angle"> & { angle?: Bounds },
  parent: number | null = null,
  over: Partial<PlanetSummary> = {},
): PlanetSummary {
  const body = planetSummary({
    id,
    class: planetClass,
    parent,
    layout: bodyLayout({ size: fixed(16), ...layout }),
    ring: false,
    ...over,
  });
  if (angle) ANGLES.set(body, angle.min);
  return body;
}

/**
 * The roll the core gives the scenario bodies of `planets`: each mid-orbit, a step out from where
 * the walk stood, at the angle `angles` gives it by id, or else the one it names.
 */
export function rollOf(
  planets: readonly PlanetSummary[],
  angles: Readonly<Record<number, number>> = {},
): SystemRoll | null {
  const rolled = planets.filter((p) => p.layout !== null && p.layout.at === null);
  if (rolled.length === 0) return null;
  const angleOf = new Map(rolled.map((p) => [p.id, angles[p.id] ?? ANGLES.get(p) ?? 0]));
  return systemRoll({
    system: SYSTEM,
    bodies: rolled.map((p) => {
      const before = p.layout?.turns_from;
      const mid = (b: Bounds | null | undefined) => (b ? (b.min + b.max) / 2 : 0);
      const orbit = mid(p.layout?.orbit);
      return rolledBody({
        id: p.id,
        orbit,
        base: orbit - mid(p.layout?.orbit_step),
        angle: angleOf.get(p.id),
        from: before == null ? 180 : (angleOf.get(before) ?? 180),
      });
    }),
  });
}

export const SCENARIO_STAR = scenarioBody(1, "pc_g_star", { orbit: fixed(0), angle: fixed(0) });

/** A natural wormhole to system 8, and a shroud tunnel with no partner. */
export const WORMHOLE: WormholeSummary = {
  id: 30,
  bypass: 31,
  kind: "wormhole",
  partner: 8,
  x: 120,
  y: 40,
};
export const SHROUD_TUNNEL: WormholeSummary = {
  id: 32,
  bypass: 33,
  kind: "shroud_tunnel",
  partner: null,
  x: -60,
  y: -90,
};

/** System 5 of `details`, with lanes to 6 and 7, a bypass to 8, and its two wormholes. */
export function context(details: Partial<SystemDetails>): SystemContext {
  const home = placedNode(SYSTEM, 0, 0, [6, 7]);
  const systems = byId(
    { ...home, bypass_ids: [8] },
    placedNode(6, 100, 0, [SYSTEM]),
    placedNode(7, 0, 100, [SYSTEM]),
    placedNode(8, -100, 0),
  );
  return systemContext({
    ...NO_SOURCES,
    id: SYSTEM,
    systems,
    ...placeIn(systems, SYSTEM),
    details: systemDetails({
      id: SYSTEM,
      inner_radius: 160,
      wormholes: [WORMHOLE, SHROUD_TUNNEL],
      ...details,
    }),
    roll: rollOf(details.planets ?? []),
  });
}
