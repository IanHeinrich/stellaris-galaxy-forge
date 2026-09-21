import type { Category } from "../../generated/Category";
import type { DroppedBypasses } from "../../generated/DroppedBypasses";
import type { ExportReport } from "../../generated/ExportReport";
import { feKindLabel } from "../../lib/feZone";

export const CATEGORY_LABELS: Record<Category, string> = {
  home: "Home",
  fallen_empire: "Fallen empire",
  marauder: "Marauder",
  ratling: "Ratling",
  l_cluster: "L-Cluster",
  guaranteed_colony: "Guaranteed colony",
  special: "Special",
  generic: "Generic",
};

const DROPPED_NOUNS: [keyof DroppedBypasses, string][] = [
  ["wormhole_pairs", "wormhole pair"],
  ["gateways", "gateway"],
  ["lgates", "L-Gate"],
];

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** `6 wormhole pairs, 1 L-Gate`, worded as the Rust side words it; null when nothing was dropped. */
export function droppedSummary(dropped: DroppedBypasses): string | null {
  const parts = DROPPED_NOUNS.filter(([kind]) => dropped[kind] > 0).map(
    ([kind, noun]) => `${dropped[kind]} ${noun}${dropped[kind] === 1 ? "" : "s"}`,
  );
  return parts.length === 0 ? null : parts.join(", ");
}

/** A system's name for a sentence; `nameOf` is the galaxy's, falling back to the id. */
export type NameOf = (system: number) => string;

/** `17 seats. Your capital, Sol, is the Sol seat: player 1 spawns there.` */
export function seatsSummary(report: ExportReport, nameOf: NameOf): string {
  const seats = `${plural(report.seats, "seat")}.`;
  if (report.player_seat === null) return seats;
  return `${seats} Your capital, ${nameOf(report.player_seat)}, is the Sol seat: player 1 spawns there.`;
}

/**
 * The fallen empires the export left out for the mod to rebuild, and where their zones landed;
 * null when the save had none or the profile keeps them.
 */
export function fallenEmpiresSummary(report: ExportReport): string | null {
  const empires = report.fallen_empires;
  if (empires.length === 0) return null;
  const kinds = empires.map((fe) => feKindLabel(fe.kind)).join(", ");
  const leftOut = empires.reduce((sum, fe) => sum + fe.systems_left_out, 0);
  const added = empires.filter((fe) => fe.anchor !== null && fe.exact).length;
  const nearby = empires.filter((fe) => fe.anchor !== null && !fe.exact).length;
  const parts = [
    `${plural(empires.length, "fallen empire zone")} at the old ${empires.length === 1 ? "capital" : "capitals"}: ${kinds}.`,
    `${plural(leftOut, "system")} left out for the mod to rebuild.`,
  ];
  if (added > 0) parts.push(`${plural(added, "anchor system")} added.`);
  if (nearby > 0) parts.push(`${nearby} placed nearby: the old spot was not clear.`);
  for (const fe of empires) {
    if (fe.anchor === null) parts.push(`${fe.name} has no clear spot within reach.`);
  }
  return parts.join(" ");
}

/** One line per category the export left out: `9 L-Cluster systems left out: the game adds its own.` */
export function omittedLines(report: ExportReport): string[] {
  return report.omitted.map(
    (count) =>
      `${plural(count.systems, `${CATEGORY_LABELS[count.category]} system`)} left out: the game adds its own.`,
  );
}

/** Where the header's counts come from; null when the export chose them itself. */
export function countsSummary(report: ExportReport): string | null {
  return report.setup_from_save ? "Counts from the save's setup." : null;
}

/** The seats whose initializer is not a generic start, as the export left them and as it rewrote them. */
export function homeInitializerLines(
  report: ExportReport,
  nameOf: NameOf,
): { review: string; replaced: string[] } {
  const review = report.home_initializers
    .filter((h) => !h.replaced)
    .map((h) => `${h.initializer} (${nameOf(h.system)})`)
    .join(", ");
  const replaced = report.home_initializers
    .filter((h) => h.replaced)
    .map((h) => `${nameOf(h.system)} had ${h.initializer}, replaced with a generic start.`);
  return { review, replaced };
}
