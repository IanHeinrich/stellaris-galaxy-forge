/**
 * The ghost of what Paint a Galaxy spawns in a fallen empire zone: the home star at the
 * centre and the kind's satellites about it, each laned to the home or to the satellite that
 * spawned before it. The bearings and distances are the mod's own, from each kind's spawn
 * event; one roll of them is taken per anchor, so a ring keeps its scatter between redraws.
 */

import type { FeKind } from "../generated/FeKind";
import type { Pt } from "./geometry/pt";
import { seeded } from "./random";

/** How much fainter the spawn ghosts are drawn than the ring that carries them. */
export const SPAWN_GHOST_ALPHA_FRACTION = 1 / 3;

/** The home star's radius: hollow, so the centre text stays legible drawn over it. */
export const HOME_STAR_RADIUS = 3.5;
export const SATELLITE_RADIUS = 1.4;
export const SATELLITE_MIN_DISTANCE = 15;
export const SATELLITE_MAX_DISTANCE = 25;

/** One satellite the mod spawns: its bearing range from the home, and the satellite it lanes to. */
interface Satellite {
  readonly angle: readonly [number, number];
  /** Index into the kind's list, or `null` for the home. */
  readonly parent: number | null;
}

const sat = (min: number, max: number, parent: number | null = null): Satellite => ({
  angle: [min, max],
  parent,
});

/**
 * What the mod spawns around each kind's home: every satellite 15 to 25 from the home at these
 * bearings, the first tier laned to the home and the rest to the satellite that spawned before
 * it. The random kind gets three short chains.
 */
export const SPAWN_TREES: Readonly<Record<FeKind, readonly Satellite[]>> = {
  materialist: [
    sat(0, 20),
    sat(100, 120),
    sat(50, 70, 1),
    sat(150, 170, 1),
    sat(250, 260),
    sat(200, 220, 4),
    sat(300, 320, 4),
  ],
  spiritualist: [
    sat(60, 80),
    sat(0, 20, 0),
    sat(120, 140, 0),
    sat(240, 260),
    sat(180, 200, 3),
    sat(300, 320, 3),
  ],
  xenophile: [
    sat(0, 20),
    sat(100, 120),
    sat(50, 70, 1),
    sat(150, 170, 1),
    sat(250, 270),
    sat(200, 220, 4),
    sat(300, 320, 4),
  ],
  xenophobe: [
    sat(40, 50),
    sat(0, 10, 0),
    sat(80, 90, 0),
    sat(120, 130, 2),
    sat(200, 210),
    sat(160, 170, 4),
    sat(240, 250, 4),
    sat(280, 290, 6),
    sat(320, 330),
  ],
  machine: [sat(0, 30), sat(90, 120), sat(180, 210), sat(270, 300)],
  hive: [
    sat(40, 50),
    sat(0, 10, 0),
    sat(80, 90, 0),
    sat(160, 170),
    sat(120, 130, 3),
    sat(200, 210, 3),
    sat(280, 290),
    sat(240, 250, 6),
    sat(320, 330, 6),
  ],
  random: [
    sat(0, 20),
    sat(60, 80, 0),
    sat(120, 140),
    sat(180, 200, 2),
    sat(240, 260),
    sat(300, 320, 4),
  ],
};

/** Spreads an id's bits before it seeds the generator, so consecutive ids do not draw alike. */
function hashId(id: number): number {
  let x = Math.imul(id ^ (id >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return (x ^ (x >>> 16)) >>> 0;
}

/** One spawned satellite about the home at the origin, and where its ghost lane starts. */
export interface SpawnSatellite extends Pt {
  /** The home, or the satellite that spawned before it. */
  readonly from: Pt;
}

/** The kind's satellites placed about the home, one roll of the mod's ranges, seeded by anchor id. */
export function spawnSatellites(id: number, kind: FeKind): SpawnSatellite[] {
  const rand = seeded(hashId(id));
  const placed: SpawnSatellite[] = [];
  for (const {
    angle: [min, max],
    parent,
  } of SPAWN_TREES[kind]) {
    const bearing = ((min + rand() * (max - min)) * Math.PI) / 180;
    const distance =
      SATELLITE_MIN_DISTANCE + rand() * (SATELLITE_MAX_DISTANCE - SATELLITE_MIN_DISTANCE);
    const from = parent === null ? { x: 0, y: 0 } : placed[parent];
    placed.push({ x: Math.cos(bearing) * distance, y: -Math.sin(bearing) * distance, from });
  }
  return placed;
}
