import type { PlanetPage } from "../../../generated/PlanetPage";
import type { PlanetEditAdapter } from "../../../lib/details/picker";
import {
  deleteLabel,
  deleteOp,
  REMOVE_COLONY,
  removeColonyOp,
} from "../../../lib/details/planetRemoval";
import { useOpCheck } from "../../useOpCheck";

/** One destructive action of a planet's page, disabled with its reason while the core refuses it. */
function Action({
  refusal,
  label,
  run,
}: {
  refusal: string | null | undefined;
  label: string;
  run: () => unknown;
}) {
  return (
    <div className="pl-remove">
      <button
        type="button"
        className="pl-remove-button"
        disabled={refusal !== null}
        title={refusal ?? undefined}
        onClick={() => void run()}
      >
        {label}
      </button>
      {refusal && <span className="muted">{refusal}</span>}
    </div>
  );
}

/** Removes the colony on the body `page` shows, named `name`, through `edits`; the body stays. */
export function RemoveColonyAction({
  page,
  name,
  edits,
}: {
  page: PlanetPage;
  name: string;
  edits: PlanetEditAdapter;
}) {
  const refusal = useOpCheck(removeColonyOp(page.id), page.system);
  return <Action refusal={refusal} label={REMOVE_COLONY} run={() => edits.removeColony(name)} />;
}

/** Deletes the body `page` shows, named `name`, with its moons and any colony on it, through `edits`. */
export function DeletePlanetAction({
  page,
  name,
  moon,
  edits,
}: {
  page: PlanetPage;
  name: string;
  moon: boolean;
  edits: PlanetEditAdapter;
}) {
  const refusal = useOpCheck(deleteOp(page.id), page.system);
  return (
    <Action refusal={refusal} label={deleteLabel(moon)} run={() => edits.remove(name, moon)} />
  );
}
