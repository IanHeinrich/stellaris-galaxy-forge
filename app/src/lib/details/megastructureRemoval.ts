/**
 * The op that deletes a save's megastructure, the row facts its confirm reads, and the sentence
 * the confirm asks; and the op and sentence that take a scenario's ruin out.
 */
import { NULL_ID } from "../../generated/constants";
import type { EntityNode } from "../../generated/EntityNode";
import type { EntityView } from "../../generated/EntityView";
import type { MegastructureDismantle } from "../../generated/MegastructureDismantle";
import type { MegastructureSummary } from "../../generated/MegastructureSummary";
import type { Op } from "../../generated/Op";
import type { RowOrigin } from "../../generated/RowOrigin";

export const DELETE_MEGASTRUCTURE = "Delete megastructure";

export function deleteMegastructureOp(megastructure: number): Op {
  return { type: "DeleteMegastructure", megastructure };
}

/** The op that takes ruin `megastructure` out of its scenario system's block. */
export function removeRuinOp(megastructure: number): Op {
  return { type: "RemoveMegastructure", megastructure };
}

/**
 * The confirm's opening for deleting the megastructure named `name` from the `document` ("save"
 * or "scenario"), in the system named `system`, or in no system read so far.
 */
function deleteOpening(name: string, system: string | null, document: string): string {
  const where = system === null ? "" : ` in ${system}`;
  return `Delete ${name}${where}? It is removed from the ${document}.`;
}

/**
 * The confirm for taking what the scenario's own block places, named `name`, out of the system
 * named `system`, or of no system read so far: a ruin or an ambient object.
 */
export function removePlacedQuestion(name: string, system: string | null): string {
  return deleteOpening(name, system, "scenario");
}

/**
 * The rows of a scenario system, from `origins`, that taking out row `id` takes or renumbers: it
 * and every later one of its kind, since a ruin's or an ambient object's id is its place in the
 * system's block.
 */
export function placedFrom(origins: readonly (RowOrigin | undefined)[], id: number): number[] {
  const later = origins.flatMap((origin) =>
    origin?.from === "effect" && origin.id > id ? [origin.id] : [],
  );
  return [id, ...later];
}

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
    bypass: reference(nodes, "bypass") !== null,
  };
}

/** Whether an entity was added since the file was opened: its statement has no bytes in the file. */
export function addedThisSession(view: EntityView): boolean {
  return view.span[0] === view.span[1];
}

/** What a deletion takes besides the row: read before the confirm asks. */
export interface MegastructureLoss {
  row: MegastructureRow;
  /** The row was added since the file was opened, so its removal takes back what its add wrote. */
  added: boolean;
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
  { dismantle, added }: MegastructureLoss,
): string {
  const kept =
    dismantle === null && !added
      ? " Game data isn't loaded, so the modifiers from building it stay."
      : "";
  return `${deleteOpening(name, system, "save")}${kept}`;
}
