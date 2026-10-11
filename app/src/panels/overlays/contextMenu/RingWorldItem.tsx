import { DELETE_RING_WORLD, deleteRingWorldOp } from "../../../lib/details/ringWorldRemoval";
import { deleteRingWorld } from "../../../store/ringWorldRemoval";
import { useOpCheck } from "../../useOpCheck";
import { MenuItem } from "./MenuItem";

/** Deletes the ring world of `system` whole, or says why it cannot: offered once the core has answered. */
export function RingWorldItem({ system }: { system: number }) {
  const refusal = useOpCheck(deleteRingWorldOp(system), system);
  return (
    <MenuItem
      disabled={refusal !== null}
      className={refusal ? "hinted" : undefined}
      title={refusal ?? undefined}
      run={() => deleteRingWorld(system)}
    >
      {DELETE_RING_WORLD}
      {refusal && <span className="muted">{refusal}</span>}
    </MenuItem>
  );
}
