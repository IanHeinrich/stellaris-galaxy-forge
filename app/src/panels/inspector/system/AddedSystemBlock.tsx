import { useEffect } from "react";
import type { SystemNode } from "../../../generated/SystemNode";
import { ADDED_THIS_SESSION, NEEDS_GAME_DATA } from "../../../lib/addSystem";
import { nodeName } from "../../../lib/names";
import { useEditorStore } from "../../../store/editorStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useGeneratorStore } from "../../../store/generatorStore";
import { EditBlock, EditNote, EditRow, PickerField, TextField } from "../../EditField";
import type { IconPickerItem } from "../../IconPicker";
import { StarRowIcon, StarTriggerIcon } from "../StarIcon";

export const ADDED_CHIP_TITLE =
  "Added since you opened this file. You can delete it until the file is reopened.";
const REPLACES_BODIES =
  "Changing the class or rerolling replaces the bodies. The name, position and lanes stay.";

/**
 * What only a save system added this session can have changed: its name, its star class and
 * bodies rolled again, and its removal. Each is one edit, applied as the field commits.
 */
export function AddedSystemBlock({ system }: { system: SystemNode }) {
  const rerollSystem = useEditorStore((s) => s.rerollSystem);
  const renameAddedSystem = useEditorStore((s) => s.renameAddedSystem);
  const removeSystem = useEditorStore((s) => s.removeSystem);
  const gameData = useGameDataStore((s) => s.status === "ready");
  const views = useGameDataStore((s) => s.starClasses);
  const names = useGameDataStore((s) => s.names);
  const starClasses = useGeneratorStore((s) => s.starClasses);
  const request = useGeneratorStore((s) => s.request);
  useEffect(() => {
    if (gameData) request();
  }, [gameData, request]);

  const icon = (key: string, Icon: typeof StarRowIcon) => {
    const view = views.get(key);
    return view && <Icon view={view} />;
  };
  const items: IconPickerItem[] = (starClasses ?? []).map((c) => ({
    key: c.key,
    label: c.label,
    icon: icon(c.key, StarRowIcon),
  }));
  const current: IconPickerItem = {
    key: system.star_class,
    label:
      starClasses?.find((c) => c.key === system.star_class)?.label ??
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
          title={reason ?? "Roll new bodies around the same star class"}
          onClick={() => void rerollSystem(system.id)}
        >
          <span aria-hidden="true">↻</span> Reroll
        </button>
      </EditRow>
      <EditNote>{REPLACES_BODIES}</EditNote>
      <div className="ins-added-actions">
        <button type="button" className="ins-danger" onClick={() => void removeSystem(system.id)}>
          Delete system
        </button>
        <span className="muted">Possible until the file is reopened.</span>
      </div>
    </EditBlock>
  );
}
