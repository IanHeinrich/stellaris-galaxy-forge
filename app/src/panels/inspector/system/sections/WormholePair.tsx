import { wormholePartnerOf } from "../../../../lib/wormholes";
import { useSystemName } from "../../../../store/browserRows";
import { useEditorStore } from "../../../../store/editorStore";
import { useCanEdit } from "../../../../store/fileSessionStore";
import { useGalaxyStore } from "../../../../store/galaxyStore";
import { Section } from "../../parts";

export const SAVE_WORMHOLE_PAIR_INTRO =
  'To take the pair out, select both ends, then choose "Unlink wormhole pair" from the ' +
  "right-click menu or the selection's actions.";

/**
 * The natural wormhole pair a save system is one end of, with the way to its other end. Shown
 * only while the system is in one; linking and unlinking are done from a two-system selection.
 */
export function SaveWormholePairSection({ system }: { system: number }) {
  const editable = useCanEdit("wormhole_pairs");
  const bypasses = useGalaxyStore((s) => s.bypasses);
  const select = useEditorStore((s) => s.select);
  const partner = wormholePartnerOf(bypasses, system);
  const partnerName = useSystemName(partner ?? system);
  if (!editable || partner === null) return null;
  return (
    <Section id="system.saveWormholePair" title="Wormhole pair">
      <div className="ins-line">
        Wormhole pair with{" "}
        <button
          type="button"
          className="link"
          title="Select the other end"
          onClick={() => void select(partner)}
        >
          {partnerName}
        </button>
      </div>
      <div className="muted ins-hint">{SAVE_WORMHOLE_PAIR_INTRO}</div>
    </Section>
  );
}
