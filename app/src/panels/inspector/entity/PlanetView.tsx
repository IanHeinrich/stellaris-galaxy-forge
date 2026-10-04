import { documentCapabilities } from "../../../lib/capabilities";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { useInspectorStore, type Entry } from "../../../store/inspectorStore";
import { EntityView } from "./EntityView";
import { PlanetPageView } from "./PlanetPage";
import { ScenarioBodyView } from "./ScenarioBodyView";

/**
 * A body: one the document rolls is drawn from its system's details. A save planet's Overview is
 * its own page, and its other tabs are the generic entity view, which reads the planet by its id.
 */
export function PlanetView({ entry }: { entry: Entry }) {
  const tab = useInspectorStore((s) => s.tab);
  const capabilities = useFileSessionStore(documentCapabilities);
  if (entry.ref.kind !== "body") return <EntityView entry={entry} />;
  if (capabilities.rolled_layout) return <ScenarioBodyView entry={entry} />;
  if (tab !== "overview" || !capabilities.bodies) return <EntityView entry={entry} />;
  return <PlanetPageView entry={entry} id={entry.ref.id} />;
}
