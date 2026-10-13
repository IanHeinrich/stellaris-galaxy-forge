import { MEGASTRUCTURES_NEED_GAME_DATA } from "../../../lib/megastructureCopy";
import type { MegastructureSpot } from "../../../lib/megastructurePicks";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useMegastructureAddStore } from "../../../store/megastructureAdd";
import { MenuItem } from "./MenuItem";

/**
 * Opens the Add megastructure dialog for `spot`, or says why it cannot: `refusal`, or game data
 * that is not loaded.
 */
export function AddMegastructureItem({
  system,
  spot,
  label,
  refusal = null,
}: {
  system: number;
  spot: MegastructureSpot;
  label: string;
  refusal?: string | null;
}) {
  const gameData = useGameDataStore((s) => s.status === "ready");
  const open = useMegastructureAddStore((s) => s.open);
  const why = refusal ?? (gameData ? null : MEGASTRUCTURES_NEED_GAME_DATA);
  return (
    <MenuItem
      disabled={why !== null}
      className={why ? "hinted" : undefined}
      title={why ?? undefined}
      run={() => open(system, spot)}
    >
      {label}
      {why && <span className="muted">{why}</span>}
    </MenuItem>
  );
}
