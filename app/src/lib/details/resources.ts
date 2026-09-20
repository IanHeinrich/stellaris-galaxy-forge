/** What a system's deposits yield, as the details row, its chips and the inspector show it. */
import type { SystemDetails } from "../../generated/SystemDetails";
import { canonicalResource, resourceRows as rowsInOrder, type ResourceRow } from "../resources";
import { titleCase } from "../text";

const ABBREVIATIONS: Record<string, string> = {
  physics_research: "Phy",
  society_research: "Soc",
  engineering_research: "Eng",
};

export type { ResourceRow };

/** What the system's deposits yield per resource, the save's names mapped onto the game's. */
export function resourceRows(
  d: SystemDetails,
  icons: ReadonlyMap<string, string> = new Map(),
): ResourceRow[] {
  const totals = new Map<string, number>();
  for (const { resource, amount } of d.resources) {
    const key = canonicalResource(resource);
    totals.set(key, (totals.get(key) ?? 0) + amount);
  }
  return rowsInOrder(totals, icons);
}

/** Width of one resource cell for `count` resources: the game's row stays dense, to slight overlap. */
export function resourceStride(count: number): number {
  const t = Math.min(1, Math.max(0, (count - 3) / 5));
  return 17 - 5 * t;
}

export function formatAmount(n: number): string {
  return String(Math.round(n * 10) / 10);
}

/** `E`, `M`, `Eng`, `CG`: the chip shown for a resource when its icon is unavailable. */
export function resourceAbbrev(resource: string): string {
  const known = ABBREVIATIONS[resource];
  if (known) return known;
  const words = resource.replace(/^sr_/, "").split("_").filter(Boolean);
  if (words.length === 0) return "?";
  const letters = words.length === 1 ? words[0][0] : words.map((w) => w[0]).join("");
  return letters.toUpperCase();
}

/** `sr_dark_matter` → `Dark Matter`, the stand-in for a resource's localised name. */
export function resourceLabel(resource: string): string {
  const words = resource.replace(/^sr_/, "").split("_").filter(Boolean);
  return words.length === 0 ? resource : titleCase(words);
}

export function resourceChips(d: SystemDetails): string {
  return resourceRows(d)
    .map((r) => `${resourceAbbrev(r.resource)} ${formatAmount(r.amount)}`)
    .join(" · ");
}
