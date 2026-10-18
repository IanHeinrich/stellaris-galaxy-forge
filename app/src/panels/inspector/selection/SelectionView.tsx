import { useState } from "react";
import { useEditorStore } from "../../../store/editorStore";
import { useCanEdit } from "../../../store/fileSessionStore";
import { useSystemNames } from "../../../store/browserRows";
import { linkedSystems, selectionLanes, useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { deleteSystemsLabel } from "../../../lib/selectionCopy";
import { counted } from "../../../lib/text";
import { browseInitializers, INITIALIZERS_NEED_GAME_DATA } from "../../initializerEntry";
import { MarauderClanButton } from "../../BulkActions";
import { useSelectionDeletion } from "../../useSelectionActions";
import { DialogField, EditBlock, EditRow } from "../../EditField";
import { BulkStarClass } from "./BulkStarClass";
import { LanesSection } from "./LanesSection";
import { PositionSection } from "./PositionSection";
import { Chip, FILTER_MIN, FilterField } from "../../parts";
import { Section, Swatch } from "../parts";
import { shortcutLabel } from "../../../lib/keys";

/** How many chips a long selection shows before asking for a filter. */
const CHIPS_SHOWN = 60;

/**
 * Several systems selected: what they have in common, then their lanes, their positions, what is
 * set for all of them, the list of them and their removal.
 */
export function SelectionView() {
  const selection = useEditorStore((s) => s.selection);
  const select = useEditorStore((s) => s.select);
  const systems = useGalaxyStore((s) => s.systems);

  const owners = new Set(
    selection.map((id) => systems.get(id)?.owner ?? null).filter((o) => o !== null),
  );
  const lanes = selectionLanes(systems, selection).linked.length;
  const isolated = selection.length - linkedSystems(systems, selection).length;
  const between = `${counted(lanes, "lane")} between them · ${counted(owners.size, "owner")}`;
  return (
    <>
      <div className="ins-head">
        <span className="name">{selection.length} systems selected</span>
        <button
          className="link ins-close"
          onClick={() => void select(null)}
          title={`Clear (${shortcutLabel("clearSelection")})`}
        >
          Clear ×
        </button>
      </div>
      <div className="ins-line muted">
        <span>
          {between} · {isolated} isolated
        </span>
      </div>
      {selection.some((id) => !systems.has(id)) && (
        <div className="ins-line">
          <Chip warn>some selected systems are no longer in the galaxy</Chip>
        </div>
      )}
      <LanesSection />
      <PositionSection />
      <SetForAllSection />
      <SelectedChips />
      <DeleteSelection />
    </>
  );
}

/** One value given to every selected system: the star class in a save, the initializer in a scenario. */
function SetForAllSection() {
  const selection = useEditorStore((s) => s.selection);
  const gameData = useGameDataStore((s) => s.status === "ready");
  const canAssign = useCanEdit("create_systems");
  const bodies = useCanEdit("bodies");
  if (!bodies && !canAssign) return null;
  return (
    <Section id="selection.setAll" title={`Set for all ${selection.length}`}>
      {bodies && (
        <EditBlock title="Stars">
          <BulkStarClass ids={selection} />
        </EditBlock>
      )}
      {canAssign && (
        <EditBlock title="Scripts">
          <EditRow label="Initializer">
            <DialogField
              label="Initializer"
              text="Choose…"
              title="Give every selected system one initializer"
              disabledReason={gameData ? undefined : INITIALIZERS_NEED_GAME_DATA}
              onOpen={() => browseInitializers(selection)}
            />
          </EditRow>
          {selection.length === 3 && <MarauderClanButton className="edit-wide" ids={selection} />}
        </EditBlock>
      )}
    </Section>
  );
}

/** The selection's delete button, apart from the rest under a rule, where the document deletes them. */
function DeleteSelection() {
  const selection = useEditorStore((s) => s.selection);
  const deletion = useSelectionDeletion();
  if (deletion === null) return null;
  return (
    <div className="ins-delete">
      <button type="button" onClick={deletion.run}>
        {deletion.kind === "systems" ? deleteSystemsLabel(selection.length) : deletion.label}
      </button>
    </div>
  );
}

/** The selected systems as chips that each drop their system; a long selection is filtered, not listed whole. */
function SelectedChips() {
  const selection = useEditorStore((s) => s.selection);
  const toggleSelect = useEditorStore((s) => s.toggleSelect);
  const setSelection = useEditorStore((s) => s.setSelection);
  const systems = useGalaxyStore((s) => s.systems);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const named = needle === "" ? selection.slice(0, CHIPS_SHOWN) : selection;
  const names = useSystemNames(named);

  const labels = named.map((id, i) => names[i] || `#${id}`);
  const matches = named.flatMap((id, i) =>
    needle === "" || labels[i].toLowerCase().includes(needle) || `#${id}`.includes(needle)
      ? [i]
      : [],
  );
  const shown = matches.slice(0, CHIPS_SHOWN);
  const hidden = (needle === "" ? selection.length : matches.length) - shown.length;

  return (
    <Section id="selection.systems" title={`Systems · ${selection.length}`}>
      {selection.length > FILTER_MIN && (
        <FilterField
          label="Filter the selection by name or #id"
          value={query}
          onChange={setQuery}
        />
      )}
      <div className="ins-chips">
        {shown.map((i) => {
          const id = selection[i];
          return (
            <button
              type="button"
              className="chip pick"
              key={id}
              title={`Remove ${labels[i]} from the selection`}
              onClick={() => void toggleSelect(id)}
            >
              <Swatch owner={systems.get(id)?.owner ?? null} />
              {labels[i]}
              <span aria-hidden="true">×</span>
            </button>
          );
        })}
      </div>
      {hidden > 0 && (
        <div className="muted ins-hint">
          {hidden} more{needle === "" ? ", type to filter" : ""}
        </div>
      )}
      {needle !== "" && matches.length > 0 && matches.length < selection.length && (
        <button
          type="button"
          onClick={() => {
            const matched = new Set(matches.map((i) => selection[i]));
            void setSelection(
              selection.filter((id) => !matched.has(id)),
              "replace",
            );
            setQuery("");
          }}
        >
          Deselect {matches.length} matching
        </button>
      )}
    </Section>
  );
}
