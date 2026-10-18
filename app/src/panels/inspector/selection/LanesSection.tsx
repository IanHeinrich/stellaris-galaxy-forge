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
import {
  addLanes,
  linkChoice,
  previewedLanes,
  useBulkLanes,
  useEveryPairLanes,
  useLanePreview,
  useNearbyLanes,
} from "../../useSelectionActions";
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
 * it out. The lanes it would add show on the map while the block is pointed at or focused.
 */
function AddLanesBlock() {
  const laneIslands = useMapChromeStore((s) => s.laneIslands);
  const setLaneIslands = useMapChromeStore((s) => s.setLaneIslands);
  const { everyPairRefusal } = useBulkLanes();
  const [picked, setPicked] = useState<LinkChoice>("every");
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const link = linkChoice(picked, everyPairRefusal);
  const previewing = hovered || focused;
  const every = useEveryPairLanes(link === "every");
  const nearby = useNearbyLanes(link === "nearby", previewing);
  const pairs = link === "every" ? every : nearby;
  const exhausted = pairs?.length === 0;
  useLanePreview(previewedLanes(previewing, pairs));
  return (
    <div
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
    >
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
                <LaneDensitySlider label="Lane density" />
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
          disabled={exhausted}
          onClick={() => {
            // The button disables itself once the lanes are in, and a disabled button may never blur.
            setFocused(false);
            void addLanes(link);
          }}
        >
          {addLanesLabel(pairs === null ? null : pairs.length)}
        </button>
      </EditBlock>
    </div>
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
