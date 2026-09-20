import type { Capabilities } from "../generated/Capabilities";
import type { EntityKind } from "../generated/EntityKind";
import type { ScalarForm } from "../generated/ScalarForm";

/** The save's null reference: a field holding it names nothing. */
export const NULL_ID = 4294967295;

/** What a value reads as, with the title it needs when the text alone does not say it. */
export interface ValueText {
  text: string;
  title?: string;
}

const TRUE = new Set(["yes", "true", "1"]);

/** A scalar as the Data tab shows it: the form decides, since a key may have no schema entry. */
export function scalarText(text: string, form: ScalarForm): ValueText {
  switch (form) {
    case "bool":
      return { text: TRUE.has(text) ? "yes" : "no" };
    case "null":
      return { text: "—", title: "no reference" };
    case "empty":
      return { text: "—", title: "written empty" };
    default:
      return { text };
  }
}

/**
 * A reference's cell: `#42`, or nothing at all. A reference names nothing as the null id, as
 * the literal `none` the save also writes, and as anything that is not a number.
 */
export function referenceText(text: string, form: ScalarForm): ValueText {
  const id = Number(text);
  if (form === "null" || form === "empty" || !Number.isInteger(id) || id === NULL_ID) {
    return { text: "—", title: "no reference" };
  }
  return { text: `#${id}` };
}

/** `survey_planet_order` → `survey planet`: what a fleet is doing, in words. */
export function orderLabel(order: string): string {
  return order.replace(/_order$/, "").replace(/_/g, " ");
}

/** `pop_group` → `pop group`: a kind in words, for a row the save gives no name. */
export function kindWords(kind: EntityKind): string {
  return kind.replace(/_/g, " ");
}

/** A fact's `GFX_` key as the texture cache wants it. */
export function iconKeys(icon: string): string[] {
  return [icon.startsWith("sprite:") ? icon : `sprite:${icon}`];
}

/** What the open document must support for a kind to be worth drilling into. */
export function capabilityFor(kind: EntityKind): keyof Capabilities | undefined {
  if (kind === "system") return undefined;
  return kind === "country" || kind === "sector" ? "empires" : "details";
}

export interface SourceSegment {
  text: string;
  changed: boolean;
}

/** `text` cut into the ranges an op changed and the ones it left alone, in order. */
export function sourceSegments(
  text: string,
  changed: readonly (readonly [number, number])[],
): SourceSegment[] {
  const segments: SourceSegment[] = [];
  let at = 0;
  for (const [start, end] of [...changed].sort((a, b) => a[0] - b[0])) {
    const from = Math.max(at, Math.min(start, text.length));
    const to = Math.max(from, Math.min(end, text.length));
    if (from > at) segments.push({ text: text.slice(at, from), changed: false });
    if (to > from) segments.push({ text: text.slice(from, to), changed: true });
    at = Math.max(at, to);
  }
  if (at < text.length) segments.push({ text: text.slice(at), changed: false });
  return segments;
}

/** Whether a row answers the filter, which narrows by key and by value alike. */
export function rowMatches(label: string, value: string, needle: string): boolean {
  if (needle === "") return true;
  const query = needle.toLowerCase();
  return label.toLowerCase().includes(query) || value.toLowerCase().includes(query);
}
