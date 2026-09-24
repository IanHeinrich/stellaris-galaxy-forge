import type { SystemDetail } from "../../../generated/SystemDetail";
import type { SystemNode } from "../../../generated/SystemNode";
import { nodeName } from "../../../lib/names";
import { kindLabel } from "../../../lib/special";
import { useDetailsStore } from "../../../store/detailsStore";
import { useEditorStore } from "../../../store/editorStore";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { useCountryName } from "../../../store/browserRows";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useInspectorStore } from "../../../store/inspectorStore";
import { useOwnership } from "../../../store/ownership";
import { TextField } from "../../EditField";
import { useApplyOp, useApplySymmetricOp } from "../../useApplyOp";
import { Chip, DrillLink, Section, SourceChip, Swatch } from "../parts";
import { ADDED_CHIP_TITLE, AddedSystemBlock } from "./AddedSystemBlock";
import { useEditableSystem } from "./editable";
import { kindHover } from "./sections/kindHover";
import { StarMismatchNote } from "./StarClassLine";
import { useStarClassLabel } from "./useStarNames";
import { renameSystemOp } from "./systemName";

/** Why the owner line's day-one chip means what it means, shown on hover. */
const DAY_ONE_OWNER_TITLE =
  "Claimed on day one, by an event on_game_start fires, not at galaxy generation.";

/** Why the owner line's assumed marker means what it means, shown on hover. */
const ASSUMED_OWNER_TITLE = "A claim whose conditions this editor cannot judge is marked assumed.";

function PositionSection({ system }: { system: SystemNode }) {
  const applyOp = useApplySymmetricOp();
  const move = (x: number, y: number) => applyOp({ type: "MoveSystem", id: system.id, x, y });
  return (
    <div className="ins-position">
      <span className="k">x</span>
      <TextField
        kind="number"
        className="coord"
        label="x"
        value={system.x}
        decimals={2}
        onCommit={(x) => move(x, system.y)}
      />
      <span className="k">y</span>
      <TextField
        kind="number"
        className="coord"
        label="y"
        value={system.y}
        decimals={2}
        onCommit={(y) => move(system.x, y)}
      />
    </div>
  );
}

/** What the head's name says on hover where the document lets it change. */
const RENAME_TITLE = "Rename this system";

/** What a scenario system with no name shows at the head, and why. */
const RANDOM_NAME = "Random name";
const RANDOM_NAME_TITLE =
  "This system has no name, so Stellaris gives it a random one when the game starts.";

/** The head's name text: a scenario system with no name says the game will pick one. */
function NameText({ system }: { system: SystemNode }) {
  if (system.name.key !== "") return <>{nodeName(system.name)}</>;
  return <span className="ins-random-name">{RANDOM_NAME}</span>;
}

/**
 * The name at the head: a field that writes it as the file states it, a literal, or the key a
 * plain system has none of. A document that cannot name a system shows text.
 */
function HeadName({ system }: { system: SystemNode }) {
  const applyOp = useApplyOp();
  const editable = useEditableSystem();
  const unnamed = system.name.key === "";
  if (!editable) {
    return (
      <span className="name" title={unnamed ? RANDOM_NAME_TITLE : undefined}>
        <NameText system={system} />
      </span>
    );
  }
  return (
    <TextField
      kind="text"
      className="ins-name-field"
      label="System name"
      title={unnamed ? `${RANDOM_NAME_TITLE} Type to name it.` : RENAME_TITLE}
      placeholder={RANDOM_NAME}
      value={system.name.key}
      display={unnamed ? undefined : nodeName(system.name)}
      onCommit={(name) => applyOp(renameSystemOp(system.id, name))}
    />
  );
}

/** The owner at the head: a link to the empire's page where the document has empires. */
function OwnerName({ id, label }: { id: number; label: string | null }) {
  const open = useInspectorStore((s) => s.open);
  const known = useGalaxyStore((s) => s.countries.has(id));
  if (!known || label === null) return <span>{label}</span>;
  return (
    <DrillLink
      requires="empires"
      title={`Open ${label}'s page`}
      onOpen={() => open({ ref: { kind: "country", id }, label })}
    >
      {label}
    </DrillLink>
  );
}

export function Header({ detail }: { detail: SystemDetail }) {
  const { system } = detail;
  const select = useEditorStore((s) => s.select);
  const { owners, table } = useOwnership();
  // A clan's system is the clan's, whatever the scripts say; any other owner is the file's.
  const ownerId = owners.get(system.id) ?? system.owner;
  const countryLabel = useCountryName(ownerId);
  const owner = (ownerId === null ? undefined : table.get(ownerId)?.label) ?? countryLabel;
  const names = useGameDataStore((s) => s.names);
  const special = useGameDataStore((s) => s.special.get(system.id));
  const scenarioOwner = useGameDataStore(
    (s) => s.scenarioOwners?.owners.find((o) => o.system === system.id) ?? null,
  );
  const claimedBy = scenarioOwner?.claimed_by ?? null;
  // A scenario says what stands here on the initializer's own line; a save has only this head.
  const scenario = useFileSessionStore((s) => s.kind === "scenario");
  const details = useDetailsStore((s) => s.details.get(system.id));
  const capital = details?.planets.some((p) => p.capital && p.owner === system.owner) ?? false;
  const planets = details?.planets.length ?? system.planet_count;
  const starClass = names.get(system.star_class) ?? system.star_class;
  const multiple = useStarClassLabel(system, starClass);
  const starLabel = scenario ? starClass : multiple;
  const kinds = special?.kinds ?? [];
  return (
    <>
      <div className="ins-head">
        <HeadName key={system.id} system={system} />
        <span className="muted mono">#{system.id}</span>
        <button className="link ins-close" onClick={() => void select(null)} title="Clear (Esc)">
          ×
        </button>
      </div>
      {system.name.key === "" && (
        <div className="ins-sub muted">
          No name. Stellaris picks a random one when the game starts.
        </div>
      )}
      <div className="ins-sub muted">
        {starLabel !== "" && `${starLabel} · `}
        {planets} planets · nebula: {detail.nebula ? nodeName(detail.nebula.name) : "none"}
      </div>
      {!scenario && starLabel !== "" && (
        <StarMismatchNote system={system} planets={details?.planets} label={starLabel} />
      )}
      {ownerId !== null && (
        <div className="ins-line">
          <Swatch owner={ownerId} />
          <OwnerName id={ownerId} label={owner} />
          {capital && <Chip>capital</Chip>}
          {scenarioOwner?.tier === "day_one" && (
            <Chip title={DAY_ONE_OWNER_TITLE}>
              day 1{scenarioOwner.claimed_by !== null && ` · ${scenarioOwner.claimed_by}`}
            </Chip>
          )}
          {scenarioOwner?.assumed && (
            <Chip warn title={ASSUMED_OWNER_TITLE}>
              assumed
            </Chip>
          )}
          <SourceChip
            source={claimedBy === null ? "initializers" : "scripts"}
            title={
              claimedBy === null
                ? "The owner is the one the initializer's chain claims this system for at generation."
                : "The owner is the one an event claims this system for on day one."
            }
          />
        </div>
      )}
      {!scenario && (kinds.length > 0 || system.added) && (
        <div className="ins-chips">
          {system.added && (
            <Chip added title={ADDED_CHIP_TITLE}>
              + added this session
            </Chip>
          )}
          {kinds.map((k) => (
            <Chip key={k} kind title={kindHover(system, k)}>
              {kindLabel(k)}
            </Chip>
          ))}
        </div>
      )}
    </>
  );
}

/** What every overview opens with: what the system is, and where it sits. */
export function OverviewHead({ detail }: { detail: SystemDetail }) {
  return (
    <>
      <Header detail={detail} />
      {detail.system.added && <AddedSystemBlock key={detail.system.id} system={detail.system} />}
      <Section id="system.position" title="Position">
        <PositionSection system={detail.system} />
      </Section>
    </>
  );
}
