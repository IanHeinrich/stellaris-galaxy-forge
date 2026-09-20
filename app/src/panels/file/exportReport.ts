import type { DroppedBypasses } from "../../generated/DroppedBypasses";

const DROPPED_NOUNS: [keyof DroppedBypasses, string][] = [
  ["wormhole_pairs", "wormhole pair"],
  ["gateways", "gateway"],
  ["lgates", "L-Gate"],
];

/** `6 wormhole pairs, 1 L-Gate`, worded as the Rust side words it; null when nothing was dropped. */
export function droppedSummary(dropped: DroppedBypasses): string | null {
  const parts = DROPPED_NOUNS.filter(([kind]) => dropped[kind] > 0).map(
    ([kind, noun]) => `${dropped[kind]} ${noun}${dropped[kind] === 1 ? "" : "s"}`,
  );
  return parts.length === 0 ? null : parts.join(", ");
}
