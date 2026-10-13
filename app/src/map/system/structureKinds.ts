import type { Capabilities } from "../../generated/Capabilities";
import { capabilityFor } from "../../lib/entities";
import type { Pt } from "../../lib/geometry/pt";
import type { Entry } from "../../store/inspectorStore";
import type { ContextTarget } from "../../store/mapChromeStore";
import type { Drag } from "./bodyDrag";
import type { SystemContext } from "./context";
import { MegastructureDrag } from "./drags";
import type { SceneTarget } from "./picking";
import type { StructureKind } from "./structures";

/** What the scene does with a megastructure or a starbase. */
interface StructureKindRow {
  /** The Inspector page a click opens, named `label`. */
  entry(system: number, id: number, label: string): Entry;
  /** What the open document must support for that page. */
  capability: keyof Capabilities | undefined;
  /** The menu a right-click opens; null for the system space's. */
  menu(system: number, id: number): ContextTarget | null;
  /** The drag a press starts, from the scene `frame`; null where it may not move. */
  drag(frame: SystemContext, id: number, from: Pt): Drag | null;
  /** Its plate's resource icons show tooltips. */
  tips: boolean;
}

export const STRUCTURE_KINDS: Readonly<Record<StructureKind, StructureKindRow>> = {
  megastructure: {
    entry: (_system, id, label) => ({ ref: { kind: "megastructure", id }, label }),
    capability: capabilityFor("megastructure"),
    menu: (system, id) => ({ kind: "megastructure", system, id }),
    drag: (frame, id, from) => MegastructureDrag.start(frame, id, from),
    tips: true,
  },
  starbase: {
    entry: (system, id, label) => ({ ref: { kind: "starbase", system, id }, label }),
    capability: capabilityFor("starbase"),
    menu: () => null,
    drag: () => null,
    tips: false,
  },
};

/** Whether `target` names a megastructure or a starbase. */
export function isStructure(
  target: SceneTarget | null,
): target is { readonly kind: StructureKind; readonly id: number } {
  return target !== null && Object.prototype.hasOwnProperty.call(STRUCTURE_KINDS, target.kind);
}
