import { useEffect } from "react";
import { bodyClassName } from "../../../lib/details/labels";
import type { PlanetEditAdapter } from "../../../lib/details/picker";
import {
  DEFAULT_MODEL,
  modelLabel,
  modelRows,
  MODEL_TITLE,
  MODELS_NEED_GAME_DATA,
} from "../../../lib/details/planetModel";
import { useGameDataStore } from "../../../store/gameDataStore";
import { EditRow, PickerField } from "../../EditField";

/**
 * A planet's model, `current` being the one it has, picked from the install's models and sent to
 * `edits`.
 */
export function PlanetModelField({
  edits,
  planetClass,
  current,
}: {
  edits: PlanetEditAdapter;
  planetClass: string;
  current: string | null;
}) {
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
        onPick={(key) => void edits.setModel(key, current)}
      />
    </EditRow>
  );
}
