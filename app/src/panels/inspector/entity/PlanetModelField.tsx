import { useEffect } from "react";
import { bodyClassName } from "../../../lib/details/labels";
import {
  DEFAULT_MODEL,
  modelLabel,
  modelRows,
  MODEL_TITLE,
  MODELS_NEED_GAME_DATA,
  setPlanetModelOp,
} from "../../../lib/details/planetModel";
import { useGameDataStore } from "../../../store/gameDataStore";
import { EditRow, PickerField } from "../../EditField";
import { useApplyOp } from "../../useApplyOp";

/** Planet `id`'s model, `current` being the one it has, picked from the install's models. */
export function PlanetModelField({
  id,
  planetClass,
  current,
}: {
  id: number;
  planetClass: string;
  current: string | null;
}) {
  const applyOp = useApplyOp();
  const ready = useGameDataStore((s) => s.status === "ready");
  const models = useGameDataStore((s) => s.planetModels);
  const names = useGameDataStore((s) => s.names);
  useEffect(() => void useGameDataStore.getState().loadPlanetModels(), [ready]);
  const list = models ?? [];
  const rows = modelRows(list, planetClass, bodyClassName(planetClass, names), current);
  const reason = list.length === 0 && current === null ? MODELS_NEED_GAME_DATA : undefined;
  return (
    <EditRow label="Model">
      <PickerField
        label="Model"
        title={MODEL_TITLE}
        disabledReason={reason}
        current={{ key: current ?? DEFAULT_MODEL, label: modelLabel(list, current) }}
        items={rows}
        onPick={(key) => {
          const op = setPlanetModelOp(id, current, key);
          if (op !== null) applyOp(op);
        }}
      />
    </EditRow>
  );
}
