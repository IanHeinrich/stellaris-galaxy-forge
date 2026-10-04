import type { ReactNode } from "react";
import { useWormholePair } from "../../../../store/bypassSelectors";
import { useSystemName } from "../../../../store/browserRows";
import { useEditorStore } from "../../../../store/editorStore";
import { useCanEdit } from "../../../../store/fileSessionStore";
import { Section } from "../../parts";

const NATURAL_PAIR_INTRO =
  'To take the pair out, select both ends, then choose "Unlink wormhole pair" from the ' +
  "right-click menu or the selection's actions.";

const PAINT_PAIR_INTRO =
  "The Paint a Galaxy mod opens a wormhole between the two ends of a pair on day one. Select " +
  'this system and another, then choose "Link as wormhole pair" from the right-click menu or ' +
  "the selection's actions.";

/** What the section says of a pair whose other end the file does not name. */
function partnerMissing(pair: number): string {
  return `Wormhole pair ${pair}, partner missing`;
}

/** The section around what it says of the pair, with how the document pairs wormholes. */
function PairSection({ children }: { children: ReactNode }) {
  const natural = useCanEdit("wormhole_pairs");
  return (
    <Section id="system.wormholePair" title="Wormhole pair">
      <div className="ins-line">{children}</div>
      <div className="muted ins-hint">{natural ? NATURAL_PAIR_INTRO : PAINT_PAIR_INTRO}</div>
    </Section>
  );
}

/**
 * The wormhole pair a system is one end of, with the way to its other end. Shown only while the
 * system is in one; linking and unlinking are done from a two-system selection.
 */
export function WormholePairSection({ system }: { system: number }) {
  const found = useWormholePair(system);
  const select = useEditorStore((s) => s.select);
  const partnerName = useSystemName(found?.partner ?? system);
  if (found === null) return null;
  const { pair, partner } = found;
  if (partner === null) {
    return pair === null ? null : <PairSection>{partnerMissing(pair)}</PairSection>;
  }
  return (
    <PairSection>
      {pair === null ? "Wormhole pair with " : `Wormhole pair ${pair} with `}
      <button
        type="button"
        className="link"
        title="Select the other end"
        onClick={() => void select(partner)}
      >
        {partnerName}
      </button>
    </PairSection>
  );
}
