import { BitmapText, Texture, type Container } from "pixi.js";
import type { BodyLayout } from "../../generated/BodyLayout";
import type { Bounds } from "../../generated/Bounds";
import type { PlanetSummary } from "../../generated/PlanetSummary";
import type { SystemDetails } from "../../generated/SystemDetails";
import type { SystemRoll } from "../../generated/SystemRoll";
import { bodyLayout, byId, placedNode, planetSummary, systemDetails } from "../../test/builders";
import { rolledBody, systemRoll } from "../../test/rolls";
import { Camera } from "../Camera";
import { systemContext, type SystemContext } from "./context";
import type { SystemLayer } from "./layers/SystemLayer";
import type { SceneTextures } from "./layers/textures";
import { NO_SOURCES } from "./sources";

export { drawOps, strokes, stubTextMeasurement } from "../layers/fixture";

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

/** Every scene texture, blank. */
export function blankSceneTextures(): SceneTextures {
  const t = () => new Texture();
  return {
    disc: t(),
    corona: t(),
    beam: t(),
    plume: t(),
    wisps: t(),
    halo: t(),
    swirl: t(),
    shade: t(),
    gloss: t(),
    belt: {
      rock: t(),
      shard: t(),
      crystal: t(),
      container: t(),
      blob: t(),
      speck: t(),
      glint: t(),
      glow: t(),
    },
    ringBack: t(),
    ringFront: t(),
    nebula: t(),
  };
}

/** The amounts a label's resource row shows, in order: its visible texts that are numbers. */
export function resourceAmounts(holder: Container): string[] {
  const row = holder.children.find((c) => c.label === "resources");
  if (!row) return [];
  const texts = (c: Container): string[] => [
    ...(c instanceof BitmapText && c.visible && /^\d/.test(c.text) ? [c.text] : []),
    ...c.children.flatMap(texts),
  ];
  return texts(row);
}

/** The texts labelled `label` on the plates shown in `container`. */
export function plateTexts(container: Container, label: string): string[] {
  return container.children
    .filter((holder) => holder.visible)
    .flatMap((holder) => holder.children)
    .flatMap((c) => (c instanceof BitmapText && c.label === label ? [c.text] : []));
}

export const SYSTEM = 5;

export const fixed = (value: number): Bounds => ({ min: value, max: value });

/** A save body at `at`, a moon where it orbits a body other than the star, body 1. */
export function saveBody(
  id: number,
  planetClass: string,
  at: [number, number],
  orbit: number,
  parent: number | null = null,
): PlanetSummary {
  const layout = bodyLayout({ orbit: fixed(orbit), at, size: fixed(16) });
  const moon = parent !== null && parent !== 1;
  return planetSummary({ id, class: planetClass, parent, moon, orbit, layout });
}

export const SUN = saveBody(1, "pc_g_star", [0, 0], 0);
export const EARTH = saveBody(2, "pc_continental", [90, 0], 90, 1);
export const LUNA = saveBody(3, "pc_barren", [102, 0], 12, 2);
export const MARS = saveBody(4, "pc_arid", [0, 130], 130, 1);

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

/** System 5 of `details`, with lanes to 6 and 7 and a bypass to 8. */
export function context(details: Partial<SystemDetails>): SystemContext {
  const home = placedNode(SYSTEM, 0, 0, [6, 7]);
  return systemContext({
    ...NO_SOURCES,
    id: SYSTEM,
    systems: byId(
      { ...home, bypass_ids: [8] },
      placedNode(6, 100, 0, [SYSTEM]),
      placedNode(7, 0, 100, [SYSTEM]),
      placedNode(8, -100, 0),
    ),
    details: systemDetails({ id: SYSTEM, inner_radius: 160, ...details }),
    roll: rollOf(details.planets ?? []),
  });
}
