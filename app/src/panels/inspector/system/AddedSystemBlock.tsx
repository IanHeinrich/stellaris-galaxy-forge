import { useEffect, useMemo } from "react";
import type { Arrangement } from "../../../generated/Arrangement";
import type { SystemNode } from "../../../generated/SystemNode";
import { ADDED_THIS_SESSION, NEEDS_GAME_DATA } from "../../../lib/addSystem";
import { isStarBody, singleStarClasses } from "../../../lib/details/starBody";
import { arrangementOf, fitSlots } from "../../../lib/multiStar";
import { nodeName } from "../../../lib/names";
import { useEditorStore } from "../../../store/editorStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { specialFor, starsKey, useGeneratorStore } from "../../../store/generatorStore";
import { spareStar } from "../../../store/starBuilderStore";
import { EditBlock, EditNote, EditRow, PickerField, TextField } from "../../EditField";
import type { IconPickerItem } from "../../IconPicker";
import { useGeneratorData, useStarData } from "../../useGeneratorData";
import { StarRowIcon, StarTriggerIcon } from "../../StarIcon";
import { MapIconPicker, StarSlot } from "../../StarPickers";

const DELETABLE_UNTIL_REOPENED = "You can delete it until the file is reopened.";
export const ADDED_CHIP_TITLE = `Added since you opened this file. ${DELETABLE_UNTIL_REOPENED}`;
const REPLACES_BODIES =
  "Changing the class or rerolling replaces the bodies. The name, position and lanes stay.";
const REBUILDS_STARS =
  "Changing the arrangement, a star or the map icon builds the system again. The name, position and lanes stay.";
const ROLL_BODIES = "Roll new bodies around the same star class";
/** The key of the Arrangement picker's single star: never a layout. */
const ONE_STAR = "__one_star__";
const ONE_STAR_LABEL = "One star";
const UNUSED_SLOT = "This arrangement has no third star";
const READING_CLASS = "Reading which star class these stars are filed under…";

function rebuildsSpecial(label: string): string {
  return `Reroll builds ${label} again. Changing the class rolls a regular system around that star. The name, position and lanes stay.`;
}

/** What an added system is built of: its stars in list order, its arrangement and whether it has planets. */
interface AddedStars {
  stars: string[];
  /** The arrangement its layout is, or null for a single star or a layout the builder lacks. */
  arrangement: Arrangement | null;
  planets: boolean;
}

/**
 * What `system`'s stars are, read from the bodies it lists, which of them are stars the install
 * says, and its arrangement from its layout, its initializer, among the builder's arrangements.
 */
function useAddedStars(
  system: SystemNode,
  arrangements: readonly Arrangement[] | null,
): AddedStars {
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const starClasses = useGameDataStore((s) => s.starClasses);
  return useMemo(() => {
    const bodies = system.bodies ?? [];
    const star = (cls: string) => isStarBody(cls, planetClasses, starClasses);
    return {
      stars: bodies.filter((b) => star(b.class)).map((b) => b.class),
      arrangement: arrangementOf(arrangements ?? [], system.initializer),
      planets: system.bodies === undefined || bodies.some((b) => !star(b.class)),
    };
  }, [system.bodies, system.initializer, arrangements, planetClasses, starClasses]);
}

/**
 * What only a save system added this session can have changed: its name, its arrangement, stars
 * and map icon or its star class, its bodies rolled again, and its removal. Each is one edit,
 * applied as the field commits. A system of a Special menu layout rerolls as that layout, and a
 * new class makes it a regular system; a binary or trinary is built again from its stars.
 */
export function AddedSystemBlock({ system }: { system: SystemNode }) {
  const rerollSystem = useEditorStore((s) => s.rerollSystem);
  const rebuildSystem = useEditorStore((s) => s.rebuildSystem);
  const renameAddedSystem = useEditorStore((s) => s.renameAddedSystem);
  const removeSystems = useEditorStore((s) => s.removeSystems);
  const views = useGameDataStore((s) => s.starClasses);
  const names = useGameDataStore((s) => s.names);
  const { gameData, picks, stars: classes } = useGeneratorData();
  const special = specialFor(picks, system.initializer)?.label;
  const { arrangements, starTypes } = useStarData();
  const { stars, arrangement, planets } = useAddedStars(system, arrangements);
  const filed = useGeneratorStore((s) => s.filed);
  const built = arrangement !== null && stars.length === arrangement.stars ? arrangement : null;
  const known = built ? filed.get(starsKey(stars)) : undefined;
  const automatic = known?.kind === "filed" ? known.starClass : undefined;
  const override =
    automatic !== undefined && system.star_class !== automatic ? system.star_class : null;
  useEffect(() => {
    if (built) useGeneratorStore.getState().fileStars(stars);
  }, [built, stars]);
  const reason = gameData ? undefined : NEEDS_GAME_DATA;
  // A change keeps a chosen map icon, which tells only once the automatic class is known.
  const builtReason =
    reason ??
    (!built || automatic !== undefined
      ? undefined
      : known?.kind === "refused"
        ? known.reason
        : READING_CLASS);
  const spare = built ? spareStar(stars, built.stars, starTypes) : null;
  const offersArrangement = built !== null || stars.length === 1;
  const singles = useMemo(() => singleStarClasses(views), [views]);

  const rebuild = (layout: Arrangement, chosen: readonly string[], starClass: string | null) =>
    void rebuildSystem(system.id, {
      kind: "built",
      layout: layout.layout,
      stars: fitSlots(chosen, layout.stars, starTypes),
      star_class: starClass,
      planets,
    });
  const pickArrangement = (key: string) => {
    if (key === ONE_STAR) {
      if (built) void rerollSystem(system.id, singles.get(stars[0])?.key ?? null);
      return;
    }
    const layout = arrangementOf(arrangements ?? [], key);
    if (layout !== null && layout.layout !== built?.layout) {
      rebuild(layout, stars, built ? override : null);
    }
  };
  const arrangementItems: IconPickerItem[] = [
    { key: ONE_STAR, label: ONE_STAR_LABEL },
    ...(arrangements ?? []).map((a) => ({ key: a.layout, label: a.name })),
  ];

  const icon = (key: string, Icon: typeof StarRowIcon) => {
    const view = views.get(key);
    return view && <Icon view={view} />;
  };
  const items: IconPickerItem[] = classes.map((c) => ({
    key: c.key,
    label: c.label,
    icon: icon(c.key, StarRowIcon),
  }));
  const current: IconPickerItem = {
    key: system.star_class,
    label:
      classes.find((c) => c.key === system.star_class)?.label ??
      names.get(system.star_class) ??
      system.star_class,
    icon: icon(system.star_class, StarTriggerIcon),
  };
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
      {offersArrangement && arrangements !== null && arrangements.length > 0 && (
        <EditRow label="Arrangement">
          <PickerField
            label="Arrangement"
            title="Pick how the system's stars are arranged"
            disabledReason={builtReason}
            current={
              built
                ? { key: built.layout, label: built.name }
                : { key: ONE_STAR, label: ONE_STAR_LABEL }
            }
            items={arrangementItems}
            onPick={pickArrangement}
          />
        </EditRow>
      )}
      {built ? (
        <>
          <EditRow label="Stars">
            <span className="ins-star-slots">
              {stars.map((star, i) => (
                <StarSlot
                  key={i}
                  label={`Star ${i + 1}`}
                  star={star}
                  starTypes={starTypes}
                  triggerClassName="edit-field"
                  disabledReason={builtReason}
                  onPick={(key) => {
                    if (key !== star) {
                      rebuild(
                        built,
                        stars.map((s, j) => (j === i ? key : s)),
                        override,
                      );
                    }
                  }}
                />
              ))}
              {spare !== null && (
                <StarSlot
                  label={`Star ${stars.length + 1}`}
                  star={spare}
                  starTypes={starTypes}
                  triggerClassName="edit-field"
                  disabledReason={UNUSED_SLOT}
                  onPick={() => undefined}
                />
              )}
            </span>
          </EditRow>
          <EditRow label="Map icon">
            <MapIconPicker
              label="Map icon"
              title={builtReason ?? "Pick the star class the galaxy map shows for this system"}
              disabled={builtReason !== undefined}
              automatic={automatic}
              chosen={override}
              triggerClassName="edit-field"
              onPick={(key) => {
                if (key !== override) rebuild(built, stars, key);
              }}
            />
          </EditRow>
        </>
      ) : (
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
      )}
      <EditRow label="Bodies">
        <button
          type="button"
          className="ins-reroll"
          disabled={(built ? builtReason : reason) !== undefined}
          title={
            (built ? builtReason : reason) ??
            (special ? `Build ${special} again with new bodies` : ROLL_BODIES)
          }
          onClick={() => void rerollSystem(system.id)}
        >
          <span aria-hidden="true">↻</span> Reroll
        </button>
      </EditRow>
      {known?.kind === "refused" && <EditNote warn>{known.reason}</EditNote>}
      <EditNote>
        {special ? rebuildsSpecial(special) : built ? REBUILDS_STARS : REPLACES_BODIES}
      </EditNote>
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
