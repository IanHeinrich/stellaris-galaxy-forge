import { useState } from "react";
import type { SystemDetail } from "../../../generated/SystemDetail";
import type { SystemNode } from "../../../generated/SystemNode";
import { nodeName } from "../../../lib/names";
import { kindLabel } from "../../../lib/special";
import { useDetailsStore } from "../../../store/detailsStore";
import { useEditorStore } from "../../../store/editorStore";
import { useFileSessionStore } from "../../../store/fileSessionStore";
import { useCountryName } from "../../../store/browserRows";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useApplyOp } from "../../useApplyOp";
import { Chip, Field, Section, SourceChip, Swatch } from "../parts";
import { useEditableSystem } from "./editable";
import { kindHover } from "./sections/kindHover";
import { renameSystemOp } from "./systemName";

/** Why the owner line's day-one chip means what it means, shown on hover. */
const DAY_ONE_OWNER_TITLE =
  "Claimed on day one, by an event on_game_start fires, not at galaxy generation.";

/** Why the owner line's assumed marker means what it means, shown on hover. */
const ASSUMED_OWNER_TITLE = "A claim whose conditions this editor cannot judge is marked assumed.";

function PositionSection({ system }: { system: SystemNode }) {
  const applyOp = useApplyOp();
  const move = (x: number, y: number) => applyOp({ type: "MoveSystem", id: system.id, x, y });
  return (
    <div className="ins-position">
      <span className="k">x</span>
      <Field
        kind="number"
        className="coord"
        label="x"
        value={system.x}
        decimals={2}
        onCommit={(x) => move(x, system.y)}
      />
      <span className="k">y</span>
      <Field
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

/**
 * The name at the head: a click turns it into the field that writes it, as the file states it,
 * a literal, or the key a plain system has none of. A document that cannot name a system shows text.
 */
function HeadName({ system }: { system: SystemNode }) {
  const applyOp = useApplyOp();
  const editable = useEditableSystem();
  const [editing, setEditing] = useState(false);
  if (!editable) return <span className="name">{nodeName(system.name)}</span>;
  if (editing) {
    return (
      <Field
        kind="text"
        className="ins-name-field"
        label="System name"
        value={system.name.key}
        autoFocus
        onDone={() => setEditing(false)}
        onCommit={(name) => applyOp(renameSystemOp(system.id, name))}
      />
    );
  }
  return (
    <button type="button" className="name" title={RENAME_TITLE} onClick={() => setEditing(true)}>
      {nodeName(system.name)}
      <span className="ins-pencil">✎</span>
    </button>
  );
}

export function Header({ detail }: { detail: SystemDetail }) {
  const { system } = detail;
  const select = useEditorStore((s) => s.select);
  const owner = useCountryName(system.owner);
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
      <div className="ins-sub muted">
        {starClass === "" ? "" : `${starClass} · `}
        {planets} planets · nebula: {detail.nebula ? nodeName(detail.nebula.name) : "none"}
      </div>
      {system.owner !== null && (
        <div className="ins-line">
          <Swatch owner={system.owner} />
          <span>{owner}</span>
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
      {!scenario && kinds.length > 0 && (
        <div className="ins-chips">
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
      <Section id="system.position" title="Position">
        <PositionSection system={detail.system} />
      </Section>
    </>
  );
}
