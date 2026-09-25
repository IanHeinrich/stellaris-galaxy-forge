import type { SystemNode } from "../../../../../generated/SystemNode";
import { wormholePartner } from "../../../../../lib/paint";
import { useSystemName } from "../../../../../store/browserRows";
import { useEditorStore } from "../../../../../store/editorStore";
import { useCanEdit, usePaintLayer } from "../../../../../store/fileSessionStore";
import { useGalaxyStore } from "../../../../../store/galaxyStore";
import { Section } from "../../../parts";

export const WORMHOLE_PAIR_INTRO =
  "The Paint a Galaxy mod opens a wormhole between the two ends of a pair on day one. Select " +
  'this system and another, then choose "Link as wormhole pair" from the right-click menu or ' +
  "the selection's actions.";

/** What the section says of a pair whose other end the file does not name. */
export function partnerMissing(pair: number): string {
  return `Wormhole pair ${pair}, partner missing`;
}

/**
 * The Paint a Galaxy wormhole pair a scenario system is one end of, with the way to its other
 * end. Shown only while the system is in one; linking is done from a two-system selection.
 */
export function WormholePairSection({ system }: { system: SystemNode }) {
  const editable = useCanEdit("create_systems");
  const paint = usePaintLayer();
  const systems = useGalaxyStore((s) => s.systems);
  const select = useEditorStore((s) => s.select);
  const partner = wormholePartner(systems, system);
  const partnerName = useSystemName(partner?.id ?? system.id);
  if (!editable || !paint || system.wormhole_pair === null) return null;
  const pair = system.wormhole_pair;
  return (
    <Section id="system.wormholePair" title="Wormhole pair">
      <div className="ins-line">
        {partner === null ? (
          partnerMissing(pair)
        ) : (
          <>
            Wormhole pair {pair} with{" "}
            <button
              type="button"
              className="link"
              title="Select the other end"
              onClick={() => void select(partner.id)}
            >
              {partnerName}
            </button>
          </>
        )}
      </div>
      <div className="muted ins-hint">{WORMHOLE_PAIR_INTRO}</div>
    </Section>
  );
}
