import { MEGASTRUCTURES_NEED_GAME_DATA } from "../../../lib/megastructureCopy";
import type { MegastructureSpot } from "../../../lib/megastructurePicks";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useMegastructureAddStore } from "../../../store/megastructureAdd";
import { RefusableMenuItem } from "./MenuItem";

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
  return (
    <RefusableMenuItem
      refusal={refusal ?? (gameData ? null : MEGASTRUCTURES_NEED_GAME_DATA)}
      run={() => open(system, spot)}
    >
      {label}
    </RefusableMenuItem>
  );
}
