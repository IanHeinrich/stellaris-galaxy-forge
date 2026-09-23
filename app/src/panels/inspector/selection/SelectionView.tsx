import { useState } from "react";
import { documentCapabilities, supports } from "../../../lib/capabilities";
import { useEditorStore } from "../../../store/editorStore";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { useSystemNames } from "../../../store/browserRows";
import { linkedSystems, selectionLanes, useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { counted } from "../../../lib/text";
import { browseInitializers, NEEDS_GAME_DATA } from "../../initializers/entry";
import { BulkActions, BulkStarClass } from "./BulkActions";
import { Chip, FILTER_MIN, FilterField, Section, Swatch } from "../parts";

/** How many chips a long selection shows before asking for a filter. */
const CHIPS_SHOWN = 60;

/** Several systems selected: what they have in common, and where the actions live. */
export function SelectionView() {
  const selection = useEditorStore((s) => s.selection);
  const select = useEditorStore((s) => s.select);
  const systems = useGalaxyStore((s) => s.systems);
  const gameData = useGameDataStore((s) => s.status === "ready");
  const capabilities = useFileSessionStore(documentCapabilities);
  const canAssign = supports(capabilities, "create_systems");
  const save = useFileSessionStore((s) => s.kind === "save") && supports(capabilities, "details");

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
        <button className="link ins-close" onClick={() => void select(null)} title="Clear (Esc)">
          Clear ×
        </button>
      </div>
      <div className="ins-line muted">
        <span>
          {between} · {isolated} isolated
        </span>
      </div>
      <Section id="selection.actions" title="Actions">
        <div className="ins-bulk">
          <BulkActions />
          {save && <BulkStarClass ids={selection} />}
          {canAssign && (
            <button
              type="button"
              disabled={!gameData}
              title={gameData ? undefined : NEEDS_GAME_DATA}
              onClick={() => browseInitializers(selection)}
            >
              Set initializer… ({selection.length} systems)
            </button>
          )}
        </div>
        <div className="muted ins-hint">Also in the right-click menu on the map.</div>
      </Section>
      <SelectedChips />
      {selection.some((id) => !systems.has(id)) && (
        <div className="ins-line">
          <Chip warn>some selected systems are no longer in the galaxy</Chip>
        </div>
      )}
    </>
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
