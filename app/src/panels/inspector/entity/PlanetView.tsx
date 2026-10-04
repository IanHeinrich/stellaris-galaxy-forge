import { useFileSessionStore } from "../../../store/fileSessionStore";
import { useInspectorStore, type Entry } from "../../../store/inspectorStore";
import { BODY_SOURCES } from "./bodySources";
import { BodyPage } from "./BodyPage";
import { EntityView } from "./EntityView";

/**
 * A body: its page, read through the source of the open document's kind. Where that source has
 * an entity behind the body, its other tabs are the generic entity view, which reads it by its id.
 */
export function PlanetView({ entry }: { entry: Entry }) {
  const tab = useInspectorStore((s) => s.tab);
  const kind = useFileSessionStore((s) => s.kind);
  const ref = entry.ref;
  if (ref.kind !== "body" || kind === null) return <EntityView entry={entry} />;
  if (tab !== "overview" && BODY_SOURCES[kind].entityTabs) return <EntityView entry={entry} />;
  const key = `${kind}:${ref.system}:${ref.id}`;
  return <BodyPage key={key} entry={entry} kind={kind} system={ref.system} id={ref.id} />;
}
