import { useCanEdit } from "../../../store/fileSessionStore";
import { useInspectorStore, type Entry } from "../../../store/inspectorStore";
import { EntityView } from "./EntityView";
import { PlanetPageView } from "./PlanetPage";

/**
 * A planet: a save body's Overview is its own page, and every other tab, or a scenario's planet,
 * is the generic entity view.
 */
export function PlanetView({ entry }: { entry: Entry }) {
  const tab = useInspectorStore((s) => s.tab);
  const bodies = useCanEdit("bodies");
  if (tab !== "overview" || !bodies || entry.ref.kind !== "planet") {
    return <EntityView entry={entry} />;
  }
  return <PlanetPageView entry={entry} id={entry.ref.id} />;
}
