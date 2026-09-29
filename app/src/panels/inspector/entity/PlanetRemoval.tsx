import type { PlanetPage } from "../../../generated/PlanetPage";
import {
  deleteLabel,
  deleteOp,
  REMOVE_COLONY,
  removeColonyOp,
} from "../../../lib/details/planetRemoval";
import { deletePlanet, removeColony } from "../../../store/planetRemoval";
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

/** Removes the colony on the body `page` shows, named `name`; the body stays. */
export function RemoveColonyAction({ page, name }: { page: PlanetPage; name: string }) {
  const refusal = useOpCheck(removeColonyOp(page.id), page.system);
  return <Action refusal={refusal} label={REMOVE_COLONY} run={() => removeColony(page.id, name)} />;
}

/** Deletes the body `page` shows, named `name`, with its moons and any colony on it. */
export function DeletePlanetAction({
  page,
  name,
  moon,
}: {
  page: PlanetPage;
  name: string;
  moon: boolean;
}) {
  const refusal = useOpCheck(deleteOp(page.id), page.system);
  return (
    <Action
      refusal={refusal}
      label={deleteLabel(moon)}
      run={() => deletePlanet(page.id, name, moon)}
    />
  );
}
