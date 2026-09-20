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
