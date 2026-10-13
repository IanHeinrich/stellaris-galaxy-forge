import { FURNACE_ENTITY } from "../../generated/constants";
import type { MegastructurePlace } from "../../generated/MegastructurePlace";
import type { MegastructureSummary } from "../../generated/MegastructureSummary";
import type { MegastructureView } from "../../generated/MegastructureView";
import type { StarbaseSummary } from "../../generated/StarbaseSummary";
import type { StructureSpawn } from "../../generated/StructureSpawn";
import type { SystemRoll } from "../../generated/SystemRoll";
import { MEGASTRUCTURE_ICON_KEY } from "../../lib/details/icons";
import {
  megastructureName,
  randomlyPlacedLabel,
  starbaseKeys,
  starbaseLabel,
} from "../../lib/details/labels";
import {
  floatsFree,
  megastructureMove,
  type MegastructureMove,
} from "../../lib/details/megastructureMoves";
import type { LayoutOverride, SceneEditing } from "../../lib/details/orbitIntent";
import type { BodyPlacement, SystemLayout } from "../../lib/details/orbits";
import { producedRows, type ResourceRow } from "../../lib/details/resources";
import {
  megastructureLook,
  megastructureYaw,
  modelKey,
  planetScale,
  starbaseLook,
  type StructureLook,
} from "../../lib/details/structures";
import type { SceneBody } from "./context";
import type { SystemSources } from "./sources";

/** What a structure the scene draws is: a megastructure row or a starbase, by its own id. */
export type StructureKind = "megastructure" | "starbase";

/** What a scenario leaves to chance about a megastructure or a starbase; a save leaves nothing. */
export interface StructureChance {
  /** The game may not place it: it is written under a condition, or in a body the game may not place. */
  readonly mayNotSpawn: boolean;
  /**
   * The game places it at random when a new game starts: it stands in at a typical spot, faint,
   * and is not picked.
   */
  readonly random: boolean;
}

/** What a structure's sprite and halo are drawn from. */
export interface StructureArt {
  /** The model's texture key; null where only the map icon is drawn. */
  readonly modelKey: string | null;
  /** The map icon drawn in place of a model the game data does not know or that cannot be baked. */
  readonly iconKeys: readonly string[];
  /** What its source leaves to chance, each drawn as a marker. */
  readonly chance: StructureChance;
}

/** What a structure's name plate shows. */
export interface StructurePlate {
  /** What its tooltip and its name plate call it. */
  readonly name: string;
  /**
   * The body it stands on, under whose plate its own goes; null where it stands alone or is drawn
   * off its body.
   */
  readonly on: number | null;
  /** What it produces each month, per resource, as the Details layer shows it under its plate. */
  readonly resources: readonly ResourceRow[];
}

/**
 * A megastructure or starbase, drawn from the game's model at its point: on the body it is tied
 * to, where that body is drawn now, else where its source puts it. `art` and `plate` are the same
 * objects while what they hold is, so a layer tells a structure that only moved by identity.
 */
export interface SceneStructure extends StructureArt, StructurePlate {
  readonly kind: StructureKind;
  readonly id: number;
  /** Where the model's origin stands, its type's offset included, in save units. */
  readonly x: number;
  readonly y: number;
  readonly art: StructureArt;
  readonly plate: StructurePlate;
  /** How many times its placement's size the model is drawn: more than 1 on a planet it grows with. */
  readonly scale: number;
  /** Its starbase level as the Station section names it; null for a megastructure. */
  readonly level: string | null;
  /** How a drag moves it, where the source may be edited; null for a starbase or a source that may not. */
  readonly move: MegastructureMove | null;
}

/** The fields of the system's sources its structures are drawn from. */
export const STRUCTURE_KEYS = [
  "details",
  "roll",
  "megastructureTypes",
  "starbaseLevels",
  "names",
  "countries",
  "resourceIcons",
  "templateName",
] as const;

/** What the scene places its structures from. */
export interface StructureScene {
  readonly src: Pick<SystemSources, (typeof STRUCTURE_KEYS)[number]>;
  readonly bodyById: ReadonlyMap<number, SceneBody>;
  /** The source's own layout, before any preview moves its bodies. */
  readonly base: SystemLayout;
  readonly editing: SceneEditing;
  /** Where a drag or an edit it sent holds a megastructure, by its id. */
  readonly moved: LayoutOverride["megastructures"];
}

const NOTHING: never[] = [];

const NO_STRUCTURE_CHANCE: StructureChance = Object.freeze({ mayNotSpawn: false, random: false });

function structureChance(spawn: StructureSpawn | undefined): StructureChance {
  if (spawn === undefined) return NO_STRUCTURE_CHANCE;
  return { mayNotSpawn: !spawn.always, random: spawn.place.kind === "random" };
}

const keptArt = new WeakMap<object, StructureArt>();
const keptPlate = new WeakMap<object, StructurePlate>();

function sameArt(a: StructureArt, b: StructureArt): boolean {
  return (
    a.modelKey === b.modelKey &&
    a.chance.mayNotSpawn === b.chance.mayNotSpawn &&
    a.chance.random === b.chance.random &&
    a.iconKeys.length === b.iconKeys.length &&
    a.iconKeys.every((key, i) => key === b.iconKeys[i])
  );
}

function samePlate(a: StructurePlate, b: StructurePlate): boolean {
  return a.name === b.name && a.on === b.on && a.resources === b.resources;
}

/** `fresh`, or the object kept for `row` while it holds what `fresh` does. */
function stable<T extends object>(
  kept: WeakMap<object, T>,
  row: object,
  fresh: T,
  same: (a: T, b: T) => boolean,
): T {
  const last = kept.get(row);
  if (last && same(last, fresh)) return last;
  kept.set(row, fresh);
  return fresh;
}

/** Each type's production rows as last worked out, so a structure redrawn keeps its rows. */
const keptProduced = new WeakMap<
  MegastructureView,
  { icons: SystemSources["resourceIcons"]; rows: readonly ResourceRow[] }
>();

function producedOf(
  type: MegastructureView,
  icons: SystemSources["resourceIcons"],
): readonly ResourceRow[] {
  if (type.produces.length === 0) return NOTHING;
  const kept = keptProduced.get(type);
  if (kept?.icons === icons) return kept.rows;
  const rows = producedRows(type.produces, icons);
  keptProduced.set(type, { icons, rows });
  return rows;
}

/** Where a structure stands: about `body` where it has one, else at `at`. */
interface Standing {
  readonly body: SceneBody | undefined;
  readonly at: readonly [number, number] | null;
  readonly offset: readonly [number, number];
  /** The planet whose size it grows with; none for a structure that keeps its own size. */
  readonly sizeBody: SceneBody | undefined;
}

function placeStructure(
  look: Exclude<StructureLook, { kind: "none" }>,
  { body, at, offset, sizeBody }: Standing,
): Pick<SceneStructure, "x" | "y" | "scale"> | null {
  const point = body ? [body.placement.x, body.placement.y] : at;
  if (point == null) return null;
  const scale = look.kind === "model" ? look.scale : 1;
  return {
    x: point[0] + offset[0],
    y: point[1] + offset[1],
    scale: sizeBody ? scale * planetScale(sizeBody.placement.disc) : scale,
  };
}

/** Within this many save units of its body's point, a floating row stands at its standard spot. */
const ON_BODY = 1e-3;

/**
 * Where `row` stands in `roll`: a scenario row at a body stands where the roll lands the body;
 * any other row where its source puts it.
 */
function rolledAt(
  roll: SystemRoll | null,
  row: MegastructureSummary,
): readonly [number, number] | null {
  return roll?.structures?.find((s) => s.id === row.id)?.at ?? row.at;
}

function megastructure(
  { src, bodyById, base, editing }: StructureScene,
  row: MegastructureSummary,
  moved: MegastructurePlace | undefined,
): SceneStructure | null {
  const type = src.megastructureTypes.get(row.kind);
  const look = megastructureLook(type);
  if (look.kind === "none") return null;
  const homeBody = row.planet === null ? undefined : bodyById.get(row.planet);
  const home = {
    star: homeBody?.placement.star === true,
    hidden: homeBody?.planet?.entity_name === FURNACE_ENTITY,
  };
  const floats = row.planet !== null && floatsFree(type, home.star);
  const offset = type?.entity_offset ?? [0, 0];
  const centred = offset[0] === 0 && offset[1] === 0;
  const sourceAt = rolledAt(src.roll, row);
  let body: SceneBody | undefined;
  let at: readonly [number, number] | null;
  let on: number | null;
  if (moved !== undefined && moved.place !== "body") {
    [body, at, on] = [undefined, [moved.x, moved.y], null];
  } else if (moved !== undefined) {
    body = bodyById.get(moved.body);
    [at, on] = [null, centred ? (body?.placement.id ?? null) : null];
  } else if (floats && homeBody) {
    const was = base.bodies.find((b) => b.id === homeBody.placement.id);
    const point = sourceAt ?? (was ? ([was.x, was.y] as const) : null);
    at = drifted(point, homeBody.placement, was);
    body = undefined;
    const standard = point !== null && was !== undefined && atBody(point, was);
    on = centred && standard ? homeBody.placement.id : null;
  } else {
    [body, at] = [homeBody, sourceAt];
    on = centred ? (body?.placement.id ?? null) : null;
  }
  // Held off its body, it keeps its home planet's size.
  const sizeBody = type?.scales_with_planet === true ? (body ?? homeBody) : undefined;
  const placed = placeStructure(look, { body, at, offset, sizeBody });
  if (placed === null) return null;
  // Turned from where it is drawn, so a drag turns it as it goes.
  const yaw = megastructureYaw(type, at);
  const chance = structureChance(row.spawn);
  const name = megastructureName(row.kind, src.names);
  const art = stable(
    keptArt,
    row,
    {
      modelKey: look.kind === "model" ? modelKey(row.culture, look.entity, yaw) : null,
      iconKeys: [MEGASTRUCTURE_ICON_KEY],
      chance,
    },
    sameArt,
  );
  const plate = stable(
    keptPlate,
    row,
    {
      name: chance.random ? randomlyPlacedLabel(name) : name,
      // One drawn off its body, as a Strategic Coordination Center beside its star, has its own plate.
      on,
      resources: type ? producedOf(type, src.resourceIcons) : NOTHING,
    },
    samePlate,
  );
  return {
    kind: "megastructure",
    id: row.id,
    ...placed,
    ...art,
    ...plate,
    art,
    plate,
    level: null,
    move: editing.megastructures ? megastructureMove(row, type, home) : null,
  };
}

/** `point`, moved by as much as its body was moved from `was` to `now`, as a preview moves it. */
function drifted(
  point: readonly [number, number] | null,
  now: BodyPlacement,
  was: BodyPlacement | undefined,
): readonly [number, number] | null {
  if (point === null || was === undefined) return point;
  return [point[0] + now.x - was.x, point[1] + now.y - was.y];
}

/** Whether `point` is `body`'s own point. */
function atBody(point: readonly [number, number], body: BodyPlacement): boolean {
  return Math.abs(point[0] - body.x) < ON_BODY && Math.abs(point[1] - body.y) < ON_BODY;
}

function starbase(
  { src, bodyById }: StructureScene,
  station: StarbaseSummary,
): SceneStructure | null {
  const level = src.starbaseLevels.get(station.level);
  const look = starbaseLook(level);
  if (look.kind === "none" || station.at === null) return null;
  const grows = level?.scales_with_planet === true;
  // An orbital ring stands on the planet it rings; any other station keeps its own point.
  const body = grows && station.planet !== null ? bodyById.get(station.planet) : undefined;
  const placed = placeStructure(look, { body, at: station.at, offset: [0, 0], sizeBody: body });
  if (placed === null) return null;
  const owner = station.owner === null ? undefined : src.countries.get(station.owner);
  const label = starbaseLabel(station.level);
  const art = stable(
    keptArt,
    station,
    {
      modelKey: look.kind === "model" ? modelKey(station.culture, look.entity) : null,
      iconKeys: starbaseKeys(station.level, src.starbaseLevels, owner),
      chance: structureChance(station.spawn),
    },
    sameArt,
  );
  const plate = stable(
    keptPlate,
    station,
    {
      name: src.templateName(station) || label,
      on: body?.placement.id ?? null,
      resources: NOTHING,
    },
    samePlate,
  );
  return {
    kind: "starbase",
    id: station.id,
    ...placed,
    ...art,
    ...plate,
    art,
    plate,
    level: label,
    move: null,
  };
}

/** Each megastructure and starbase of the system. */
export function sceneStructures(scene: StructureScene): SceneStructure[] {
  const { details } = scene.src;
  if (details === null) return NOTHING;
  const stations = details.starbase ? [details.starbase, ...details.other_starbases] : [];
  return [
    ...details.megastructures.map((row) => megastructure(scene, row, scene.moved?.get(row.id))),
    ...stations.map((station) => starbase(scene, station)),
  ].filter((s): s is SceneStructure => s !== null);
}
