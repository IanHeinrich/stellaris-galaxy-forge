import type { Entry } from "../../../store/inspectorStore";
import { LaneView } from "../LaneView";
import { NebulaView } from "../NebulaView";
import { SystemView } from "../system/SystemView";

/** The bodies the registry hands an `Entry`, each unwrapping the ref its own view is drawn from. */
export function LaneEntry({ entry }: { entry: Entry }) {
  return entry.ref.kind === "lane" ? <LaneView a={entry.ref.a} b={entry.ref.b} /> : null;
}

export function NebulaEntry({ entry }: { entry: Entry }) {
  return entry.ref.kind === "nebula" ? <NebulaView index={entry.ref.index} /> : null;
}

export function SystemEntry({ entry }: { entry: Entry }) {
  return entry.ref.kind === "system" ? <SystemView id={entry.ref.id} /> : null;
}
