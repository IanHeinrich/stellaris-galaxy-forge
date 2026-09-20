import { documentCapabilities, supports } from "../../../lib/capabilities";
import { useEditorStore } from "../../../store/editorStore";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { useSystemNames } from "../../../store/browserRows";
import { linkedPairs, linkedSystems, useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { browseInitializers, NEEDS_GAME_DATA } from "../../initializers/entry";
import { BulkActions } from "./BulkActions";
import { Chip, Section, Swatch } from "../parts";

/** Several systems selected: what they have in common, and where the actions live. */
export function SelectionView() {
  const selection = useEditorStore((s) => s.selection);
  const select = useEditorStore((s) => s.select);
  const toggleSelect = useEditorStore((s) => s.toggleSelect);
  const systems = useGalaxyStore((s) => s.systems);
  const names = useSystemNames(selection);
  const gameData = useGameDataStore((s) => s.status === "ready");
  const canAssign = supports(useFileSessionStore(documentCapabilities), "create_systems");

  const owners = new Set(
    selection.map((id) => systems.get(id)?.owner ?? null).filter((o) => o !== null),
  );
  const lanes = linkedPairs(systems, selection).length;
  const isolated = selection.length - linkedSystems(systems, selection).length;
  return (
    <>
      <div className="ins-head">
        <span className="name">{selection.length} systems selected</span>
        <button className="link ins-close" onClick={() => void select(null)} title="Clear (Esc)">
          Clear ×
        </button>
      </div>
      <div className="ins-chips">
        {selection.map((id, i) => {
          const system = systems.get(id);
          return (
            <button
              type="button"
              className="chip pick"
              key={id}
              title={`Remove #${id} from the selection`}
              onClick={() => void toggleSelect(id)}
            >
              <Swatch owner={system?.owner ?? null} />
              {names[i]}
              <span aria-hidden="true">×</span>
            </button>
          );
        })}
      </div>
      <div className="ins-line muted">
        <span>
          {lanes} lanes between them · {owners.size} owners · {isolated} isolated
        </span>
      </div>
      <Section id="selection.actions" title="Actions">
        <div className="ins-bulk">
          <BulkActions />
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
      {selection.some((id) => !systems.has(id)) && (
        <div className="ins-line">
          <Chip warn>some selected systems are no longer in the galaxy</Chip>
        </div>
      )}
    </>
  );
}
