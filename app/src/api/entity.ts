/**
 * Reading one system, entity or planet of the open document, and searching it.
 * Command and argument names match `app/src-tauri/src/commands/entity.rs`.
 */
import { invoke } from "@tauri-apps/api/core";
import type { EntityAddr } from "../generated/EntityAddr";
import type { EntityKind } from "../generated/EntityKind";
import type { EntitySchema } from "../generated/EntitySchema";
import type { EntitySource } from "../generated/EntitySource";
import type { EntityView } from "../generated/EntityView";
import type { NewBody } from "../generated/NewBody";
import type { Op } from "../generated/Op";
import type { OrbitPlacement } from "../generated/OrbitPlacement";
import type { PlanetMoveCheck } from "../generated/PlanetMoveCheck";
import type { PlanetMoveTargets } from "../generated/PlanetMoveTargets";
import type { PlanetPage } from "../generated/PlanetPage";
import type { SearchResult } from "../generated/SearchResult";
import type { SystemDetail } from "../generated/SystemDetail";

/** One system with its neighbours resolved. Rejects with `SgfError` when no save is open or `id` is unknown. */
export function getSystem(id: number): Promise<SystemDetail> {
  return invoke<SystemDetail>("get_system", { id });
}

/**
 * What matches `query` by id, name or what a system holds, best first, at most `limit` of each
 * kind, with every system the matches locate.
 */
export function search(query: string, limit = 20): Promise<SearchResult> {
  return invoke<SearchResult>("search", { query, limit });
}

/** One level of an entity: the children at `path`, each flagged when an op changed it. */
export function getEntity(addr: EntityAddr, path: string[] = []): Promise<EntityView> {
  return invoke<EntityView>("get_entity", { addr, path });
}

/** An entity's current bytes with the ranges an op changed. */
export function getEntitySource(addr: EntityAddr): Promise<EntitySource> {
  return invoke<EntitySource>("get_entity_source", { addr });
}

/** A save body's own Overview. Rejects with `not_found` on a scenario or for an absent planet. */
export function getPlanetPage(id: number): Promise<PlanetPage> {
  return invoke<PlanetPage>("get_planet_page", { id });
}

/** Where the save planets may move together, and which of them cannot move. */
export function planetMoveTargets(planets: number[]): Promise<PlanetMoveTargets> {
  return invoke<PlanetMoveTargets>("planet_move_targets", { planets });
}

/**
 * Why moving `planets` to system `to` would be refused, or else the colonies and stations it takes
 * into another country's system.
 */
export function planetMoveCheck(
  planets: number[],
  to: number,
  at: OrbitPlacement | null = null,
): Promise<PlanetMoveCheck> {
  return invoke<PlanetMoveCheck>("planet_move_check", { planets, to, at });
}

/** The op that moves `planets` to system `to`, the first at `at` when given, for `applyOp`. */
export function planetMoveOp(
  planets: number[],
  to: number,
  at: OrbitPlacement | null = null,
): Promise<Op> {
  return invoke<Op>("planet_move_op", { planets, to, at });
}

/**
 * The save bodies as copies to paste, each planet with its moons; a moon whose planet is among them
 * goes with it. Rejects with `SgfError` for a star, a megastructure or habitat, a ring world segment
 * or a save before Stellaris 4.0.
 */
export function copyBodies(bodies: number[]): Promise<NewBody[]> {
  return invoke<NewBody[]>("copy_bodies", { bodies });
}

/**
 * The op that pastes `copies` into system `system`, a single copy at `at` when given, else each on
 * the next free orbit past the system's reach, for `applyOp`.
 */
export function pasteBodiesOp(
  system: number,
  copies: NewBody[],
  at: OrbitPlacement | null = null,
): Promise<Op> {
  return invoke<Op>("paste_bodies_op", { system, copies, at });
}

/** The labelled fields of a kind; keys outside it render raw. */
export function getEntitySchema(kind: EntityKind): Promise<EntitySchema> {
  return invoke<EntitySchema>("get_entity_schema", { kind });
}
