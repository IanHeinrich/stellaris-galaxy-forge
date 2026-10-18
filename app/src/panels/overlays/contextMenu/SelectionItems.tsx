import { useState } from "react";
import {
  ARRANGE_ITEM,
  CUT_BETWEEN,
  ISOLATE_THEM,
  LINK_EVERY_PAIR_ITEM,
  LINK_NEARBY_ITEM,
  RESET_LENGTHS,
} from "../../../lib/selectionCopy";
import { useEditorStore } from "../../../store/editorStore";
import { useCanEdit } from "../../../store/fileSessionStore";
import {
  ArrangeButton,
  CountedButton,
  MarauderClanButton,
  SwapSystemsButton,
  WormholePairButton,
} from "../../BulkActions";
import {
  previewedLanes,
  useBulkLanes,
  useLanePreview,
  useNearbyLanes,
  useSelectionDeletion,
} from "../../useSelectionActions";
import { LaneDensitySlider, LaneIslandsCheckbox } from "../../LaneDensitySlider";

/** The system menu's items for a selection it is part of: its lanes, its pair or clan, its shape and its removal. */
export function SelectionItems({ dismiss }: { dismiss: () => void }) {
  const selection = useEditorStore((s) => s.selection);
  const connectSelected = useEditorStore((s) => s.connectSelected);
  const cutLanesBetweenSelected = useEditorStore((s) => s.cutLanesBetweenSelected);
  const isolateSelected = useEditorStore((s) => s.isolateSelected);
  const resetSelectedLaneLengths = useEditorStore((s) => s.resetSelectedLaneLengths);
  const canCreate = useCanEdit("create_systems");
  const lanes = useBulkLanes();
  const deletion = useSelectionDeletion();
  const host = { dismiss, itemRole: "menuitem" } as const;
  return (
    <>
      <CountedButton
        {...host}
        label={LINK_EVERY_PAIR_ITEM}
        count={lanes.unlinked}
        refusal={lanes.everyPairRefusal}
        run={connectSelected}
      />
      <NearbyRow dismiss={dismiss} />
      <CountedButton
        {...host}
        label={CUT_BETWEEN}
        count={lanes.linked}
        run={cutLanesBetweenSelected}
      />
      <CountedButton {...host} label={ISOLATE_THEM} count={lanes.laned} run={isolateSelected} />
      {lanes.stale !== null && (
        <CountedButton
          {...host}
          label={RESET_LENGTHS}
          count={lanes.stale}
          run={resetSelectedLaneLengths}
        />
      )}
      {selection.length === 2 && <WormholePairButton {...host} a={selection[0]} b={selection[1]} />}
      {selection.length === 2 && <SwapSystemsButton {...host} a={selection[0]} b={selection[1]} />}
      {canCreate && selection.length === 3 && <MarauderClanButton {...host} ids={selection} />}
      <ArrangeButton {...host} ids={selection} label={ARRANGE_ITEM} />
      {deletion !== null && (
        <button
          type="button"
          role="menuitem"
          onClick={() => {
            dismiss();
            deletion.run();
          }}
        >
          {deletion.kind === "systems" ? `Delete systems (${selection.length})` : deletion.label}
        </button>
      )}
    </>
  );
}

/** Link nearby, under the Lane density it links at, previewing its lanes while hovered or focused. */
function NearbyRow({ dismiss }: { dismiss: () => void }) {
  const connectSelectedMesh = useEditorStore((s) => s.connectSelectedMesh);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const previewing = hovered || focused;
  const pairs = useNearbyLanes(true, previewing);
  useLanePreview(previewedLanes(previewing, pairs));
  return (
    <div
      className="mesh-row"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
    >
      <label className="mesh-slider">
        <span className="muted">sparse</span>
        <LaneDensitySlider
          label="Lane density"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        <span className="muted">dense</span>
      </label>
      <LaneIslandsCheckbox className="mesh-slider" />
      <button
        type="button"
        role="menuitem"
        disabled={pairs?.length === 0}
        onClick={() => {
          dismiss();
          void connectSelectedMesh();
        }}
      >
        {LINK_NEARBY_ITEM}
        {pairs === null ? "" : ` (${pairs.length})`}
      </button>
    </div>
  );
}
