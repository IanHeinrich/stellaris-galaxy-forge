import type { HeaderField } from "../../../generated/HeaderField";
import type { Op } from "../../../generated/Op";

/** Why a repeated key carries no controls of its own, shown on hover. */
export const DUPLICATE_KEY_TITLE = "Duplicate key: the first statement is the one edited";

/** Why the add row refuses a key the header already states. */
export const KEY_TAKEN = "That key is already in the header; edit the row above instead.";

/** Writes `key`: the op rewrites the first statement the header holds under that name. */
export function setHeaderField(key: string, value: string): Op {
  return { type: "SetHeaderField", key, value: value.trim() };
}

export function removeHeaderField(key: string): Op {
  return { type: "SetHeaderField", key, value: null };
}

/** Whether `header` already states `key`, which the add row may not write a second time. */
export function hasHeaderKey(header: readonly HeaderField[], key: string): boolean {
  return header.some((field) => field.key === key.trim());
}

/** What the add row writes; `null` while it has no key, or while the header holds that key. */
export function addHeaderField(
  header: readonly HeaderField[],
  key: string,
  value: string,
): Op | null {
  const name = key.trim();
  if (name === "" || hasHeaderKey(header, name)) return null;
  return setHeaderField(name, value);
}

/** Whether an earlier statement carries this one's key: only the first of a key is editable. */
export function isRepeatedKey(header: readonly HeaderField[], index: number): boolean {
  return header.slice(0, index).some((field) => field.key === header[index].key);
}

/** A stable key for a statement the file may write more than once under the same name. */
export function headerRowKey(field: HeaderField, index: number): string {
  return `${field.key}-${field.line}-${index}`;
}

/** What the Name field at the top of a scenario's Galaxy page says under it. */
export const NAME_HINT = "The game lists this map under this name as a galaxy size.";

/** Writes the scenario's `name`, quoted as the game reads it; null for an empty name. */
export function setScenarioName(name: string): Op | null {
  const text = name.replace(/"/g, "").trim();
  return text === "" ? null : setHeaderField("name", `"${text}"`);
}

/** The line under each header key the game reads in a way its value does not show. */
export const HEADER_KEY_NOTES: Readonly<Record<string, string>> = {
  random_hyperlanes: "no: the game uses only this map's hyperlanes. yes: it draws its own.",
  colonizable_planet_odds:
    "Multiplies the habitable worlds in systems the game rolls. The Habitable Worlds slider does not show it.",
  primitive_odds: "Meant to set the pre-FTL odds. No effect seen in Stellaris 4.5.",
  crisis_strength: "Where the Crisis Strength slider starts.",
  extra_crisis_strength: "Extra steps the Crisis Strength slider offers.",
  core_radius:
    "The empty core of the galaxy shape. Changes nothing with fixed positions unless a mod reads it.",
};
