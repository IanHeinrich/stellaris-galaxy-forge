/**
 * The op that deletes a save's megastructure, the row facts its confirm reads, and the sentence
 * the confirm asks.
 */
import { NULL_ID } from "../../generated/constants";
import type { EntityNode } from "../../generated/EntityNode";
import type { EntityView } from "../../generated/EntityView";
import type { MegastructureDismantle } from "../../generated/MegastructureDismantle";
import type { MegastructureSummary } from "../../generated/MegastructureSummary";
import type { Op } from "../../generated/Op";
import type { PlanetPage } from "../../generated/PlanetPage";
import { colonyParts } from "./planetRemoval";

export const DELETE_MEGASTRUCTURE = "Delete megastructure";

/** The planet flag the game sets on a planet a megastructure made, such as a cosmogenesis world. */
export const MADE_BY_MEGASTRUCTURE = "megastructure";

export function deleteMegastructureOp(megastructure: number): Op {
  return { type: "DeleteMegastructure", megastructure };
}

export { megastructureName } from "./labels";

/** The system of `details` that lists megastructure `id`, or null where none read so far does. */
export function systemOfMegastructure(
  details: ReadonlyMap<number, { megastructures: readonly MegastructureSummary[] }>,
  id: number,
): number | null {
  for (const [system, d] of details) {
    if (d.megastructures.some((m) => m.id === id)) return system;
  }
  return null;
}

/** What a megastructure row says of itself that its deletion takes along. */
export interface MegastructureRow {
  kind: string;
  /** The planet it stands on or around, or null. */
  planet: number | null;
  /** Whether it has a bypass: a hyper relay's link or a gateway's. */
  bypass: boolean;
}

/** The id a row's `key` names, or null when the key is absent or names nothing. */
function reference(nodes: readonly EntityNode[], key: string): number | null {
  const node = nodes.find((n) => n.key === key);
  if (node?.value.kind !== "scalar") return null;
  const id = Number(node.value.text);
  return Number.isInteger(id) && id !== NULL_ID ? id : null;
}

/** A megastructure row's facts, from the top level of its entity. */
export function megastructureRow(nodes: readonly EntityNode[]): MegastructureRow {
  const type = nodes.find((n) => n.key === "type");
  return {
    kind: type?.value.kind === "scalar" ? type.value.text : "",
    planet: reference(nodes, "planet"),
    bypass: reference(nodes, "bypass") !== null,
  };
}

/** Whether an entity was added since the file was opened: its statement has no bytes in the file. */
export function addedThisSession(view: EntityView): boolean {
  return view.span[0] === view.span[1];
}

/** Whether a planet's `flags` say a megastructure made it. */
export function madeByMegastructure(flags: readonly EntityNode[]): boolean {
  return flags.some((n) => n.key === MADE_BY_MEGASTRUCTURE);
}

/** What a deletion takes besides the row: read before the confirm asks. */
export interface MegastructureLoss {
  row: MegastructureRow;
  /** The row was added since the file was opened, so its removal takes back what its add wrote. */
  added: boolean;
  /** The planet a megastructure made, with the colony on it that goes first; null otherwise. */
  colony: { planet: string; page: PlanetPage } | null;
  /** What the game data says its dismantle takes back; null without game data. */
  dismantle: MegastructureDismantle | null;
}

/** A type whose dismantle takes nothing back. */
export const EMPTY_DISMANTLE: MegastructureDismantle = {
  modifiers: [],
  deposits: [],
  variables: [],
};

/**
 * The confirm for deleting the megastructure named `name` in the system named `system`, or in
 * no system read so far.
 */
export function deleteMegastructureQuestion(
  name: string,
  system: string | null,
  { colony, dismantle, added }: MegastructureLoss,
): string {
  const where = system === null ? "" : ` in ${system}`;
  const settled =
    colony === null
      ? ""
      : ` The colony on ${colony.planet} goes with it: ${colonyParts(colony.page)}. The planet stays.`;
  const kept =
    dismantle === null && !added
      ? " Without game data, the modifiers its construction added stay."
      : "";
  return `Delete ${name}${where}? It is removed from the save.${settled}${kept}`;
}
