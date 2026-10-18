import { useState } from "react";
import {
  addLanesLabel,
  CUT_BETWEEN,
  ISOLATE_THEM,
  LIKE_THE_GAME,
  LINK_CHOICES,
  RESET_LENGTHS,
  type LinkChoice,
} from "../../../lib/selectionCopy";
import { TOOL_OPTIONS } from "../../../lib/toolCopy";
import { useWormholePairAction } from "../../../store/bypassSelectors";
import { useEditorStore } from "../../../store/editorStore";
import { useMapChromeStore } from "../../../store/mapChromeStore";
import { CountedButton, WormholePairButton } from "../../BulkActions";
import { useBulkLanes, useEveryPairLanes, useNearbyLanes } from "../../useSelectionActions";
import { EditBlock, EditRow, ToggleField } from "../../EditField";
import { LaneDensitySlider } from "../../LaneDensitySlider";
import { Section } from "../parts";

/** Several systems selected: the lanes to add among them, the ones to take away, and their lengths. */
export function LanesSection() {
  const selection = useEditorStore((s) => s.selection);
  const cutLanesBetweenSelected = useEditorStore((s) => s.cutLanesBetweenSelected);
  const isolateSelected = useEditorStore((s) => s.isolateSelected);
  const resetSelectedLaneLengths = useEditorStore((s) => s.resetSelectedLaneLengths);
  const lanes = useBulkLanes();
  return (
    <Section id="selection.lanes" title="Hyperlanes">
      <AddLanesBlock />
      <EditBlock title="Remove lanes">
        <CountedButton
          className="edit-wide"
          label={CUT_BETWEEN}
          count={lanes.linked}
          run={cutLanesBetweenSelected}
        />
        <CountedButton
          className="edit-wide"
          label={ISOLATE_THEM}
          count={lanes.laned}
          run={isolateSelected}
        />
      </EditBlock>
      {lanes.stale !== null && (
        <EditBlock title="Lengths">
          <CountedButton
            className="edit-wide"
            label={RESET_LENGTHS}
            count={lanes.stale}
            run={resetSelectedLaneLengths}
          />
        </EditBlock>
      )}
      {selection.length === 2 && <WormholeBlock a={selection[0]} b={selection[1]} />}
    </Section>
  );
}

/**
 * One Add button for both ways of linking the selection. Every pair is the first choice up to its
 * limit; the choice the player makes holds while the page is open, unless the limit then rules
 * it out.
 */
function AddLanesBlock() {
  const connectSelected = useEditorStore((s) => s.connectSelected);
  const connectSelectedMesh = useEditorStore((s) => s.connectSelectedMesh);
  const laneIslands = useMapChromeStore((s) => s.laneIslands);
  const setLaneIslands = useMapChromeStore((s) => s.setLaneIslands);
  const { everyPairRefusal } = useBulkLanes();
  const [picked, setPicked] = useState<LinkChoice>("every");
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [sliding, setSliding] = useState(false);
  const link: LinkChoice = everyPairRefusal === null ? picked : "nearby";
  const previewing = hovered || focused || sliding;
  const every = useEveryPairLanes(link === "every", previewing);
  const nearby = useNearbyLanes(link === "nearby", previewing);
  const pairs = link === "every" ? every : nearby;
  return (
    <EditBlock title="Add lanes">
      <EditRow label="Link">
        <span className="segmented" role="group" aria-label="Link">
          {LINK_CHOICES.map(({ choice, label }) => {
            const refusal = choice === "every" ? everyPairRefusal : null;
            return (
              <button
                key={choice}
                type="button"
                aria-pressed={link === choice}
                disabled={refusal !== null}
                title={refusal ?? undefined}
                onClick={() => setPicked(choice)}
              >
                {label}
              </button>
            );
          })}
        </span>
      </EditRow>
      {link === "nearby" && (
        <>
          <EditRow label="Density">
            <span className="lane-density">
              <span className="muted">sparse</span>
              <LaneDensitySlider
                label="Lane density"
                onFocus={() => setSliding(true)}
                onBlur={() => setSliding(false)}
              />
              <span className="muted">dense</span>
            </span>
          </EditRow>
          <ToggleField
            label={LIKE_THE_GAME}
            title={TOOL_OPTIONS.laneIslands.hint}
            checked={laneIslands}
            onChange={setLaneIslands}
          />
        </>
      )}
      <button
        type="button"
        className="edit-wide"
        disabled={pairs?.length === 0}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onClick={() => void (link === "every" ? connectSelected() : connectSelectedMesh())}
      >
        {addLanesLabel(pairs === null ? null : pairs.length)}
      </button>
    </EditBlock>
  );
}

/** Two selected systems the document can pair by wormhole, or parts again. */
function WormholeBlock({ a, b }: { a: number; b: number }) {
  if (useWormholePairAction(a, b) === null) return null;
  return (
    <EditBlock title="Wormholes">
      <WormholePairButton className="edit-wide" a={a} b={b} />
    </EditBlock>
  );
}
