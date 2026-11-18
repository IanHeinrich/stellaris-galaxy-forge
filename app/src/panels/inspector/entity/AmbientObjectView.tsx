import { ABOUT_MAIN_STAR, ambientObjectName, inGameLines } from "../../../lib/ambientObjectAdd";
import { documentCapabilities } from "../../../lib/capabilities";
import {
  ambientObjectPoint,
  mainStarPoint,
  placedAmbientObject,
} from "../../../lib/details/ambientObjects";
import { ambientObjectFieldIntent, type PositionField } from "../../../lib/details/orbitIntent";
import { editableId } from "../../../lib/details/placedRows";
import { openSystem } from "../../../store/commands";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { useGalaxyStore } from "../../../store/galaxyStore";
import type { Entry } from "../../../store/inspectorStore";
import { useSystemGeometry } from "../../../store/systemGeometry";
import { Icon } from "../../parts";
import { useAmbientObjectViews } from "../../useAmbientObjectViews";
import { Empty, LinkRow, Properties, PropertyRow } from "../parts";
import { useGeometryEdit } from "../useGeometryEdit";
import { RemovalAction } from "./PlanetRemoval";
import { PositionBlock } from "./PositionBlock";

/**
 * The Position block of ambient object `id` of `system`, measured from the system's main star as
 * the game places it; nothing where it stands at no point or may not be moved. Each commit is the
 * move a drag in the system view sends.
 */
function AmbientObjectPosition({ system, id }: { system: number; id: number }) {
  const { frame, editing } = useSystemGeometry(system);
  const { send, note } = useGeometryEdit(system);
  const star = mainStarPoint(frame.layout, frame.details);
  const object = placedAmbientObject(frame.details, id);
  const at = object === undefined ? null : ambientObjectPoint(object, star);
  if (at === null || !editing.ambientObjects.has(id)) return null;
  const commit = (field: PositionField, typed: number) =>
    send(({ frame: now }) => {
      const main = mainStarPoint(now.layout, now.details);
      const current = placedAmbientObject(now.details, id);
      const from = current === undefined ? null : ambientObjectPoint(current, main);
      return from === null ? null : ambientObjectFieldIntent(system, id, from, main, field, typed);
    });
  return (
    <PositionBlock centre={star} at={at} about={ABOUT_MAIN_STAR} onCommit={commit}>
      {note()}
    </PositionBlock>
  );
}

/**
 * An ambient object a scenario system's own block places: its picture and name, its position,
 * what the game does with it, and its deletion where the editor edits it as it stands.
 */
export function AmbientObjectView({ entry }: { entry: Entry }) {
  const ref = entry.ref;
  const system = ref.kind === "ambient_object" ? ref.system : null;
  const id = ref.kind === "ambient_object" ? ref.id : null;
  const { frame } = useSystemGeometry(system);
  const { views, problem } = useAmbientObjectViews();
  const systemName = useGalaxyStore((s) => s.systemName);
  const removable = useFileSessionStore((s) => documentCapabilities(s).ambient_objects);
  const object = id === null ? undefined : placedAmbientObject(frame.details, id);
  const view = object === undefined ? undefined : views?.get(object.kind);
  const name = object === undefined ? entry.label : ambientObjectName(object.kind, views);
  const head = (
    <div className="ins-head">
      <span className="name">{name}</span>
    </div>
  );
  if (system === null || id === null || object === undefined) {
    return (
      <>
        {head}
        <Empty>This ambient object is not in the system.</Empty>
      </>
    );
  }
  return (
    <>
      {head}
      <div className="ins-sub muted">Ambient object in {systemName(system)}</div>
      {view?.portrait != null && <Icon className="ins-ambient-picture" keys={[view.portrait]} />}
      {problem !== null && <div className="muted">{problem}</div>}
      <AmbientObjectPosition system={system} id={id} />
      <div className="edit-block-title ins-about">About</div>
      <Properties>
        {view !== undefined && (
          <PropertyRow label="In game">{inGameLines(view).join(", ")}</PropertyRow>
        )}
        <LinkRow label="System" title="Open the system's page" onOpen={() => openSystem(system)}>
          {systemName(system)}
        </LinkRow>
      </Properties>
      {removable && editableId(object.origin) !== null && (
        <RemovalAction target={{ kind: "ambientObject", system, id, name }} />
      )}
    </>
  );
}
