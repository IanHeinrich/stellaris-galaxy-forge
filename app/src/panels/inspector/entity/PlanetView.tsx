import { useEffect, useMemo } from "react";
import type { PlanetSummary } from "../../../generated/PlanetSummary";
import type { SystemNode } from "../../../generated/SystemNode";
import {
  findPlanet,
  isStarBody,
  setPlanetSizeOp,
  setStarTypeOp,
  singleStarClasses,
  starTypeChoices,
  starTypeRows,
} from "../../../lib/details/starBody";
import { currentStarBodies } from "../../../lib/details/starClass";
import { templateName } from "../../../lib/names";
import { useDetailsStore } from "../../../store/detailsStore";
import { useEditorStore } from "../../../store/editorStore";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { refKey, useInspectorStore, type Entry } from "../../../store/inspectorStore";
import { EditBlock, EditKey, EditRow, PickerField, TextField } from "../../EditField";
import type { IconPickerItem } from "../../IconPicker";
import { useApplyOp } from "../../useApplyOp";
import { LinkRow, Properties, PropertyRow } from "../parts";
import { StarRowIcon, StarTriggerIcon } from "../StarIcon";
import { READING_STARS } from "../system/StarClassLine";
import { EntityView } from "./EntityView";
import "./entity.css";

export const NEEDS_GAME_DATA = "Load game data to change the star type";
const NO_CHOICE = "The game data has no other star type";
const NO_SIZE = "The save gives this body no size";

/** A class's localised name, or its key until the name arrives. */
function useClassLabel(): (key: string) => string {
  const names = useGameDataStore((s) => s.names);
  return (key) => names.get(key) ?? key;
}

/** The star class each planet class makes on its own, for the icons. */
function useSingleStarClasses() {
  const starClasses = useGameDataStore((s) => s.starClasses);
  return useMemo(() => singleStarClasses(starClasses), [starClasses]);
}

/**
 * A star body's type, as a field offering every planet class the game flags `star`. Like the
 * system's star class it waits, disabled, while the system's details are unread or stale.
 */
function StarTypeField({ planet, system }: { planet: PlanetSummary; system: SystemNode }) {
  const applyOp = useApplyOp();
  const label = useClassLabel();
  const singles = useSingleStarClasses();
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const starClasses = useGameDataStore((s) => s.starClasses);
  const stale = useDetailsStore((s) => s.stale.has(system.id));
  const read = useDetailsStore((s) => s.details.get(system.id));
  const fresh = currentStarBodies(read, stale, planetClasses, starClasses);
  const choices = starTypeChoices(planet.class, planetClasses);
  const keys = [planet.class, ...choices].join("|");
  useEffect(() => {
    void useGameDataStore.getState().fetchNames(keys.split("|"));
  }, [keys]);

  const icon = (key: string, Icon: typeof StarRowIcon) => {
    const view = singles.get(key);
    return view && <Icon view={view} />;
  };
  const items: IconPickerItem[] = starTypeRows(choices, label).map((row) => ({
    ...row,
    icon: icon(row.key, StarRowIcon),
  }));
  const current: IconPickerItem = {
    key: planet.class,
    label: label(planet.class),
    icon: icon(planet.class, StarTriggerIcon),
  };
  const reason =
    planetClasses.size === 0
      ? NEEDS_GAME_DATA
      : fresh === null
        ? READING_STARS
        : choices.length === 0
          ? NO_CHOICE
          : undefined;
  return (
    <PickerField
      label="Star type"
      title="Change this star's type. The system's star class follows when a class has these stars."
      disabledReason={reason}
      current={current}
      items={items}
      onPick={(key) => {
        if (fresh) applyOp(setStarTypeOp(system, fresh, planet.id, key, starClasses));
      }}
    />
  );
}

/** A body's size as a whole number of at least 1; anything else puts the field back. */
function SizeField({ planet }: { planet: PlanetSummary }) {
  const applyOp = useApplyOp();
  const size = planet.size;
  if (size === null) {
    return (
      <TextField
        kind="text"
        label="Size"
        value="none"
        disabledReason={NO_SIZE}
        onCommit={() => undefined}
      />
    );
  }
  return (
    <TextField
      kind="number"
      label="Size"
      title="Change the body's size"
      value={size}
      onCommit={(next) => {
        const op = setPlanetSizeOp(planet.id, size, next);
        if (op !== null) applyOp(op);
      }}
    />
  );
}

function About({ planet, system }: { planet: PlanetSummary; system: SystemNode }) {
  const label = useClassLabel();
  const stack = useInspectorStore((s) => s.stack);
  const popTo = useInspectorStore((s) => s.popTo);
  const select = useEditorStore((s) => s.select);
  const systemName = useGalaxyStore((s) => s.systemName);
  const toSystem = () => {
    const key = refKey({ kind: "system", id: system.id });
    const at = stack.findIndex((entry) => refKey(entry.ref) === key);
    if (at >= 0) popTo(at);
    else void select(system.id);
  };
  return (
    <>
      <div className="edit-block-title ins-about">About</div>
      <Properties>
        <PropertyRow label="Class">{label(planet.class)}</PropertyRow>
        <LinkRow label="System" title="Open the system's page" onOpen={toSystem}>
          {systemName(system.id)}
        </LinkRow>
      </Properties>
    </>
  );
}

/** A save star body's own page: its type and size to edit first, then what it is. */
export function StarBodyOverview({
  planet,
  system,
}: {
  planet: PlanetSummary;
  system: SystemNode;
}) {
  const label = useClassLabel();
  const own = useSingleStarClasses().get(planet.class);
  const named = templateName(planet);
  return (
    <>
      <div className="ins-head ins-star-head">
        {own && <StarRowIcon view={own} />}
        <span className="name">{named === "" ? label(planet.class) : named}</span>
        <span className="muted mono">#{planet.id}</span>
      </div>
      <EditBlock title="Star">
        <EditRow label="Star type">
          <StarTypeField planet={planet} system={system} />
        </EditRow>
        <EditRow label="Size">
          <SizeField planet={planet} />
        </EditRow>
      </EditBlock>
      <About planet={planet} system={system} />
      <EditKey />
    </>
  );
}

/**
 * A planet: a save star body's Overview is its own page, and every other tab, any other planet,
 * a scenario's, or one no read system lists, is the generic entity view.
 */
export function PlanetView({ entry }: { entry: Entry }) {
  const tab = useInspectorStore((s) => s.tab);
  const scenario = useFileSessionStore((s) => s.kind === "scenario");
  const details = useDetailsStore((s) => s.details);
  const planetClasses = useGameDataStore((s) => s.planetClasses);
  const starClasses = useGameDataStore((s) => s.starClasses);
  const id = entry.ref.kind === "planet" ? entry.ref.id : null;
  const found = useMemo(() => (id === null ? null : findPlanet(details, id)), [details, id]);
  const system = useGalaxyStore((s) => (found === null ? undefined : s.systems.get(found.system)));
  if (
    tab !== "overview" ||
    scenario ||
    found === null ||
    system === undefined ||
    !isStarBody(found.planet.class, planetClasses, starClasses)
  ) {
    return <EntityView entry={entry} />;
  }
  return <StarBodyOverview planet={found.planet} system={system} />;
}
