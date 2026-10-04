import type { Bounds } from "../../../generated/Bounds";
import type { PlanetSummary } from "../../../generated/PlanetSummary";
import { boundsText } from "../../../lib/details/labels";

/** A body's size as its layout gives it, else the summary's one value; `null` for none. */
export function bodySize(body: PlanetSummary): Bounds | null {
  if (body.layout?.size) return body.layout.size;
  return body.size === null ? null : { min: body.size, max: body.size };
}

/** `16`, or `10–20` for a value the game rolls between two bounds; `random` for none given. */
export function rangeText(bounds: Bounds | null): string {
  return bounds === null ? "random" : boundsText(bounds);
}
