import { createContext } from "react";
import type { SystemNode } from "../../../generated/SystemNode";
import { linkChange, type LinkChange } from "../../../lib/feLinks";
import type { Side } from "../../../lib/menuAim";
import { useSystemNames } from "../../../store/browserRows";
import { useEditorStore } from "../../../store/editorStore";
import { useCanEdit, usePaintLayer } from "../../../store/fileSessionStore";
import { useGalaxyStore } from "../../../store/galaxyStore";

export const NO_SYSTEMS: number[] = [];

/** The side the menu around an entry opened on, which its own submenu and cards keep to. */
export const MenuSide = createContext<Side>("right");

/** Whether the menus offer fallen empire zones: a document that creates systems, under the paint layer. */
export function useZones(): boolean {
  const canCreate = useCanEdit("create_systems");
  const paint = usePaintLayer();
  return canCreate && paint;
}

/** The one selected system, if exactly one is, and its name. */
export function useSelected(): {
  selection: number[];
  selected: SystemNode | undefined;
  selectedName: string;
} {
  const selection = useEditorStore((s) => s.selection);
  const systems = useGalaxyStore((s) => s.systems);
  const [selectedName] = useSystemNames(selection.length === 1 ? selection : NO_SYSTEMS);
  const selected = selection.length === 1 ? systems.get(selection[0]) : undefined;
  return { selection, selected, selectedName };
}

export interface ZoneLink {
  change: LinkChange;
  run: () => void;
}

/** The link or unlink between a zone's anchor and a system, or null where there is none to offer. */
export function useZoneLink(): (
  anchor: SystemNode | undefined,
  system: SystemNode | undefined,
) => ZoneLink | null {
  const zones = useZones();
  const linkToFeZone = useEditorStore((s) => s.linkToFeZone);
  const unlinkFromFeZone = useEditorStore((s) => s.unlinkFromFeZone);
  return (anchor, system) => {
    if (!zones || !anchor || !system) return null;
    const change = linkChange(anchor, system);
    if (change === null) return null;
    return {
      change,
      run: () =>
        void (change === "link"
          ? linkToFeZone(anchor.id, system.id)
          : unlinkFromFeZone(anchor.id, system.id)),
    };
  };
}
