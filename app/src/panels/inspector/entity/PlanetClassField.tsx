import { bodyClassName } from "../../../lib/details/labels";
import type { PlanetEditAdapter } from "../../../lib/details/picker";
import {
  CLASS_LOOK_NOTE,
  CLASS_TITLE,
  CLASSES_LOOK_NOTE,
  CLASSES_NEED_GAME_DATA,
  CLASSES_TITLE,
  classFieldReason,
  classRows,
  fewerClassesWarning,
  NO_SHARED_CLASS,
  sharedClassRows,
  type ClassBody,
} from "../../../lib/details/planetClass";
import { useGameDataStore } from "../../../store/gameDataStore";
import { EditNote, EditRow, PickerField } from "../../EditField";
import type { IconPickerItem } from "../../IconPicker";
import { useNamed } from "../../useNamed";
import { PlanetIcon } from "../system/sections/bodies";

/** A planet the Class field changes: its id and name, and what narrows the classes it may take. */
export interface ClassFieldBody extends ClassBody {
  id: number;
  name: string;
}

/**
 * The class of `bodies`, picked from those the install lets each of them take and sent to
 * `edits`; a colony and a moon narrow them. For one planet the field shows its class; for several
 * the class they share, or how many they have, and a warning names the planets that narrow the list.
 */
export function PlanetClassField({
  bodies,
  edits,
}: {
  bodies: readonly ClassFieldBody[];
  edits: PlanetEditAdapter;
}) {
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const names = useGameDataStore((s) => s.names);
  const classes = [...new Set(bodies.map((b) => b.class))];
  const label = useNamed([...classes, ...planetClasses.keys()], (key) => bodyClassName(key, names));
  const icon = (key: string, seed?: number) => (
    <PlanetIcon
      planetClass={key}
      sprite={planetClasses.get(key)?.icon_sprite}
      seed={seed}
      discFirst
    />
  );
  const [first] = bodies;
  const several = bodies.length > 1;
  const rows = several
    ? sharedClassRows(bodies, planetClasses, label)
    : classRows(first.class, first.colonised, first.moon, planetClasses, label);
  const items: IconPickerItem[] = rows.map((row) => ({ ...row, icon: icon(row.key) }));
  const reason = several
    ? planetClasses.size === 0
      ? CLASSES_NEED_GAME_DATA
      : items.length === 0
        ? NO_SHARED_CLASS
        : undefined
    : (classFieldReason(first.class, first.colonised, planetClasses) ?? undefined);
  const current: IconPickerItem =
    classes.length === 1
      ? { key: first.class, label: label(first.class), icon: icon(first.class, first.id) }
      : { key: "", label: `Mixed (${classes.length} classes)` };
  const warning = several ? fewerClassesWarning(bodies, planetClasses) : null;
  return (
    <>
      <EditRow label="Class">
        <span className="pl-class-field">
          <PickerField
            label="Class"
            title={several ? CLASSES_TITLE : CLASS_TITLE}
            disabledReason={reason}
            current={current}
            items={items}
            onPick={(key) => void edits.setClass(key, first.class, planetClasses)}
          />
        </span>
      </EditRow>
      {warning !== null && <EditNote warn>⚠ {warning}</EditNote>}
      {reason === undefined && <EditNote>{several ? CLASSES_LOOK_NOTE : CLASS_LOOK_NOTE}</EditNote>}
    </>
  );
}
