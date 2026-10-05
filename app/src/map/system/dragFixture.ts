/** The orbit system, inputs and recorded intents a system view drag test drives, without PixiJS. */
import { polar } from "../../lib/details/orbits";
import { SAVE_GEOMETRY } from "../../lib/details/saveGeometry";
import type { Pt } from "../../lib/geometry/pt";
import { orbitClasses, orbitSystem, saveBody } from "../../test/builders";
import { sceneAt as at, sceneRecorder as recorder } from "../../test/mapIntent";
import type { DragStep } from "./bodyDrag";
import { systemContext, type SystemContext } from "./context";
import { over } from "./fixture";
import { NO_SOURCES } from "./sources";
import { SystemGestureModel, type SystemInput, type SystemIntent } from "./SystemGestureModel";

export type Call = ReturnType<typeof recorder>["calls"][number];

export const without = (calls: Call[], name: keyof SystemIntent) =>
  calls.filter(([n]) => n !== name);
export const named = (calls: Call[], name: keyof SystemIntent) => calls.filter(([n]) => n === name);

export const ORBITS = 140;
export const [STAR, PLANET, MOON, LONE, ASTEROID, BESIDE] = [1, 2, 3, 5, 6, 7];

/** `orbitSystem` with each body named `P<id>`, and planet 7 at 60 and 90°, beside planet 2. */
export function orbitFrame(): SystemContext {
  const details = orbitSystem();
  const at = polar(0, 0, 60, 90);
  const beside = saveBody(BESIDE, "pc_arid", [at.x, at.y], 60, 12);
  const planets = [...details.planets, beside].map((p) => ({ ...p, name_key: `NAME_P${p.id}` }));
  return systemContext({
    ...NO_SOURCES,
    id: ORBITS,
    details: { ...details, planets },
    planetClasses: orbitClasses(),
    geometry: SAVE_GEOMETRY,
  });
}

export function pointOf(frame: SystemContext, id: number): Pt {
  const body = frame.layout.bodies.find((b) => b.id === id);
  if (!body) throw new Error(`no body ${id}`);
  return { x: body.x, y: body.y };
}

/** An input at the scene point `p`, in the orbit system. */
export function on(
  kind: SystemInput["kind"],
  p: Pt | [number, number],
  extra: Partial<SystemInput> = {},
): SystemInput {
  const [x, y] = Array.isArray(p) ? p : [p.x, p.y];
  return at(kind, x, y, { system: ORBITS, ...extra });
}

/** Presses body `id` where it stands and moves it by `nudge`, past the threshold, with `extra`. */
export function grab(
  model: SystemGestureModel,
  intent: SystemIntent,
  id: number,
  nudge: Pt,
  extra: Partial<SystemInput> = {},
): void {
  const from = pointOf(intent.frame(), id);
  model.handle(on("down", from, { target: over("body", id), draggable: true }), intent);
  model.handle(on("move", { x: from.x + nudge.x, y: from.y + nudge.y }, extra), intent);
}

/** Four pixels out from the centre at `angle`, and four round it. */
export const outward = (angle: number): Pt => polar(0, 0, 4, angle);
export const around = (angle: number): Pt => polar(0, 0, 4, angle + 90);

export function lastStep(intent: ReturnType<typeof recorder>): DragStep | null {
  const previews = named(intent.calls, "preview");
  return (previews[previews.length - 1]?.[1] as DragStep | null | undefined) ?? null;
}

/** A fresh gesture model and an intent recording what it asks of `frame`. */
export function start(frame: SystemContext = orbitFrame()) {
  return { model: new SystemGestureModel(), intent: recorder(frame) };
}
