import type { SystemNode } from "../../../generated/SystemNode";
import { documentCapabilities, supports } from "../../../lib/capabilities";
import { linkChange, type LinkChange } from "../../../lib/feLinks";
import { useSystemNames } from "../../../store/browserRows";
import { useEditorStore } from "../../../store/editorStore";
import { useFileSessionStore, usePaintLayer } from "../../../store/fileSessionStore";
import { useGalaxyStore } from "../../../store/galaxyStore";

export const NO_SYSTEMS: number[] = [];

export function useCanCreate(): boolean {
  const capabilities = useFileSessionStore((s) => s.capabilities);
  return supports(documentCapabilities({ capabilities }), "create_systems");
}

export function useCanNebulae(): boolean {
  const capabilities = useFileSessionStore((s) => s.capabilities);
  return supports(documentCapabilities({ capabilities }), "nebulae");
}

/** Whether the menus offer fallen empire zones: a document that creates systems, under the paint layer. */
export function useZones(): boolean {
  const canCreate = useCanCreate();
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
