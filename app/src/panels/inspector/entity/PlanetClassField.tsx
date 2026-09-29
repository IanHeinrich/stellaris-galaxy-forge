import { bodyClassName } from "../../../lib/details/labels";
import {
  CLASS_LOOK_NOTE,
  CLASS_TITLE,
  classFieldReason,
  classRows,
  setPlanetClassOp,
} from "../../../lib/details/planetClass";
import { useGameDataStore } from "../../../store/gameDataStore";
import { EditNote, EditRow, PickerField } from "../../EditField";
import type { IconPickerItem } from "../../IconPicker";
import { useApplyOp } from "../../useApplyOp";
import { useNamed } from "../../useNamed";
import { PlanetIcon } from "../system/sections/bodies";

/** Planet `id`'s class, picked from those the install lets it take; `colonised` and `moon` narrow them. */
export function PlanetClassField({
  id,
  planetClass,
  colonised,
  moon,
}: {
  id: number;
  planetClass: string;
  colonised: boolean;
  moon: boolean;
}) {
  const applyOp = useApplyOp();
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const names = useGameDataStore((s) => s.names);
  const label = useNamed([planetClass, ...planetClasses.keys()], (key) =>
    bodyClassName(key, names),
  );
  const icon = (key: string) => (
    <PlanetIcon planetClass={key} sprite={planetClasses.get(key)?.icon_sprite} />
  );
  const items: IconPickerItem[] = classRows(planetClass, colonised, moon, planetClasses, label).map(
    (row) => ({ ...row, icon: icon(row.key) }),
  );
  const reason = classFieldReason(planetClass, colonised, planetClasses) ?? undefined;
  return (
    <>
      <EditRow label="Class">
        <span className="pl-class-field">
          <PickerField
            label="Class"
            title={CLASS_TITLE}
            disabledReason={reason}
            current={{ key: planetClass, label: label(planetClass), icon: icon(planetClass) }}
            items={items}
            onPick={(key) => {
              const op = setPlanetClassOp(id, planetClass, key, planetClasses);
              if (op !== null) applyOp(op);
            }}
          />
        </span>
      </EditRow>
      {reason === undefined && <EditNote>{CLASS_LOOK_NOTE}</EditNote>}
    </>
  );
}
