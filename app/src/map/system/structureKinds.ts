import type { CapabilityFlag } from "../../lib/capabilities";
import { placedAmbientObject } from "../../lib/details/ambientObjects";
import { editableId, megastructurePageNeeds, originOf } from "../../lib/details/placedRows";
import { capabilityFor } from "../../lib/entities";
import type { Pt } from "../../lib/geometry/pt";
import { ambientObjectEntry, type Entry } from "../../store/inspectorStore";
import type { ContextTarget } from "../../store/mapChromeStore";
import type { Drag } from "./drag";
import type { SystemContext } from "./context";
import { AmbientObjectDrag, MegastructureDrag } from "./drags";
import type { SceneTarget } from "./picking";
import type { StructureKind } from "./structures";

/** What the scene does with a megastructure, a starbase or an ambient object. */
interface StructureKindRow {
  /** The Inspector page a click opens, named `label`. */
  entry(system: number, id: number, label: string): Entry;
  /**
   * What the open document must support for the page of structure `id`, as the scene `ctx` shows
   * it; null where the structure has no page.
   */
  pageNeeds(ctx: SystemContext, id: number): CapabilityFlag | undefined | null;
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
    pageNeeds: (ctx, id) => {
      const row = ctx.details?.megastructures.find((m) => m.id === id);
      return megastructurePageNeeds(row === undefined ? undefined : originOf(row));
    },
    menu: (system, id) => ({ kind: "megastructure", system, id }),
    drag: (frame, id, from) => MegastructureDrag.start(frame, id, from),
    tips: true,
  },
  starbase: {
    entry: (system, id, label) => ({ ref: { kind: "starbase", system, id }, label }),
    pageNeeds: () => capabilityFor("starbase"),
    menu: () => null,
    drag: () => null,
    tips: false,
  },
  ambient_object: {
    entry: (system, id, label) => ambientObjectEntry(system, id, label),
    pageNeeds: (ctx, id) => {
      const object = placedAmbientObject(ctx.details, id);
      return object !== undefined && editableId(object.origin) !== null ? "ambient_objects" : null;
    },
    menu: () => null,
    drag: (frame, id, from) => AmbientObjectDrag.start(frame, id, from),
    tips: false,
  },
};

/** Whether `target` names a megastructure or a starbase. */
export function isStructure(
  target: SceneTarget | null,
): target is { readonly kind: StructureKind; readonly id: number } {
  return target !== null && Object.prototype.hasOwnProperty.call(STRUCTURE_KINDS, target.kind);
}
