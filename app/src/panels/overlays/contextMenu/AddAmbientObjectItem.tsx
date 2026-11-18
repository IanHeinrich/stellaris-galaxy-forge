import {
  ADD_AMBIENT_OBJECT_HERE_LABEL,
  AMBIENT_OBJECTS_NEED_GAME_DATA,
} from "../../../lib/ambientObjectAdd";
import { useAmbientObjectAddStore } from "../../../store/ambientObjectAdd";
import { useGameDataStore } from "../../../store/gameDataStore";
import { RefusableMenuItem } from "./MenuItem";

/** Opens the Add ambient object browser at point (`x`, `y`) of system `system`, or says game data isn't loaded. */
export function AddAmbientObjectItem({ system, x, y }: { system: number; x: number; y: number }) {
  const gameData = useGameDataStore((s) => s.status === "ready");
  const open = useAmbientObjectAddStore((s) => s.open);
  return (
    <RefusableMenuItem
      refusal={gameData ? null : AMBIENT_OBJECTS_NEED_GAME_DATA}
      run={() => open(system, x, y)}
    >
      {ADD_AMBIENT_OBJECT_HERE_LABEL}
    </RefusableMenuItem>
  );
}
