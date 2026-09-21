import type { SystemNode } from "../../../../../generated/SystemNode";
import { linkedAnchors } from "../../../../../lib/feLinks";
import { useSystemNames } from "../../../../../store/browserRows";
import { useEditorStore } from "../../../../../store/editorStore";
import { usePaintLayer } from "../../../../../store/fileSessionStore";
import { useGalaxyStore } from "../../../../../store/galaxyStore";
import { Section } from "../../../parts";
import { useEditableSystem } from "../../editable";

export const FE_LINKS_INTRO =
  "At game start the Paint a Galaxy mod lays a hyperlane from this system to the nearest " +
  "system of the fallen empire it builds in each zone listed here.";

/**
 * The fallen empire zones a scenario system is linked to, by anchor, each with a way to the
 * anchor and a way out of the link. Shown only for a system that links to a zone and anchors
 * none; an anchor's own links are in its Fallen empire zone section.
 */
export function FeLinksSection({ system }: { system: SystemNode }) {
  const editable = useEditableSystem();
  const paint = usePaintLayer();
  const systems = useGalaxyStore((s) => s.systems);
  const select = useEditorStore((s) => s.select);
  const unlinkFromFeZone = useEditorStore((s) => s.unlinkFromFeZone);
  const anchors = system.fe_zone === null ? linkedAnchors(system, systems) : [];
  const names = useSystemNames(anchors.map((a) => a.id));
  if (!editable || !paint || anchors.length === 0) return null;
  return (
    <Section id="system.feLinks" title="Fallen empire links">
      {anchors.map((a, i) => (
        <div className="ins-line" key={a.id}>
          Linked to the zone of{" "}
          <button
            type="button"
            className="link"
            title="Select the zone's system"
            onClick={() => void select(a.id)}
          >
            {names[i]}
          </button>
          <button
            type="button"
            className="link"
            aria-label={`Unlink from ${names[i]}'s zone`}
            title={`Unlink from ${names[i]}'s zone`}
            onClick={() => void unlinkFromFeZone(a.id, system.id)}
          >
            ×
          </button>
        </div>
      ))}
      <div className="muted ins-hint">{FE_LINKS_INTRO}</div>
    </Section>
  );
}
