import type { SystemNode } from "../../../generated/SystemNode";
import { ADDED_THIS_SESSION, NEEDS_GAME_DATA } from "../../../lib/addSystem";
import { nodeName } from "../../../lib/names";
import { useEditorStore } from "../../../store/editorStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { specialFor } from "../../../store/generatorStore";
import { EditBlock, EditNote, EditRow, PickerField, TextField } from "../../EditField";
import type { IconPickerItem } from "../../IconPicker";
import { useGeneratorData } from "../../useGeneratorData";
import { StarRowIcon, StarTriggerIcon } from "../StarIcon";

const DELETABLE_UNTIL_REOPENED = "You can delete it until the file is reopened.";
export const ADDED_CHIP_TITLE = `Added since you opened this file. ${DELETABLE_UNTIL_REOPENED}`;
const REPLACES_BODIES =
  "Changing the class or rerolling replaces the bodies. The name, position and lanes stay.";
const ROLL_BODIES = "Roll new bodies around the same star class";

function rebuildsSpecial(label: string): string {
  return `Reroll builds ${label} again. Changing the class rolls a regular system around that star. The name, position and lanes stay.`;
}

/**
 * What only a save system added this session can have changed: its name, its star class and
 * bodies rolled again, and its removal. Each is one edit, applied as the field commits. A system
 * of a Special menu layout rerolls as that layout, and a new class makes it a regular system.
 */
export function AddedSystemBlock({ system }: { system: SystemNode }) {
  const rerollSystem = useEditorStore((s) => s.rerollSystem);
  const renameAddedSystem = useEditorStore((s) => s.renameAddedSystem);
  const removeSystems = useEditorStore((s) => s.removeSystems);
  const views = useGameDataStore((s) => s.starClasses);
  const names = useGameDataStore((s) => s.names);
  const { gameData, picks, stars } = useGeneratorData();
  const special = specialFor(picks, system.initializer)?.label;

  const icon = (key: string, Icon: typeof StarRowIcon) => {
    const view = views.get(key);
    return view && <Icon view={view} />;
  };
  const items: IconPickerItem[] = stars.map((c) => ({
    key: c.key,
    label: c.label,
    icon: icon(c.key, StarRowIcon),
  }));
  const current: IconPickerItem = {
    key: system.star_class,
    label:
      stars.find((c) => c.key === system.star_class)?.label ??
      names.get(system.star_class) ??
      system.star_class,
    icon: icon(system.star_class, StarTriggerIcon),
  };
  const reason = gameData ? undefined : NEEDS_GAME_DATA;
  return (
    <EditBlock title={ADDED_THIS_SESSION} className="added">
      <EditRow label="Name">
        <TextField
          kind="text"
          label="System name"
          title="Rename this system; its star and planets take the new name"
          value={system.name.key}
          display={nodeName(system.name)}
          onCommit={(name) => void renameAddedSystem(system.id, name)}
        />
      </EditRow>
      <EditRow label="Star class">
        <PickerField
          label="Star class"
          title="Pick a star class to roll new bodies around it"
          disabledReason={reason}
          current={current}
          items={items}
          onPick={(key) => void rerollSystem(system.id, key)}
        />
      </EditRow>
      <EditRow label="Bodies">
        <button
          type="button"
          className="ins-reroll"
          disabled={!gameData}
          title={reason ?? (special ? `Build ${special} again with new bodies` : ROLL_BODIES)}
          onClick={() => void rerollSystem(system.id)}
        >
          <span aria-hidden="true">↻</span> Reroll
        </button>
      </EditRow>
      <EditNote>{special ? rebuildsSpecial(special) : REPLACES_BODIES}</EditNote>
      <div className="ins-added-actions">
        <button
          type="button"
          className="ins-danger"
          onClick={() => void removeSystems([system.id])}
        >
          Delete system
        </button>
        <span className="muted">{DELETABLE_UNTIL_REOPENED}</span>
      </div>
    </EditBlock>
  );
}
