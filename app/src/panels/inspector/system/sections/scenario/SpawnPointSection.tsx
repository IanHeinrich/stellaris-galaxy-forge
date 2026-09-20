import { useState } from "react";
import type { SpawnReservationPreset } from "../../../../../generated/SpawnReservationPreset";
import type { SystemNode } from "../../../../../generated/SystemNode";
import {
  isAiReserved,
  isHumanReserved,
  isSpawnPoint,
  isSpawnWeight,
} from "../../../../../lib/spawn";
import { useFileSessionStore } from "../../../../../store/fileSessionStore";
import { useApplyOp } from "../../../../useApplyOp";
import { Chip, Field, Section } from "../../../parts";
import { useEditableSystem } from "../../editable";
import { ScriptedSeat } from "./ScriptedSeat";
import {
  DEFAULT_SPAWN_WEIGHT,
  modifierAmount,
  NEEDS_INITIALIZER,
  NEEDS_SPAWN_POINT,
  reservationLabel,
  spawnPointOp,
  spawnReservationOp,
} from "./spawnPoint";

/**
 * Whether the generator may start an empire here, and how heavily this system weighs against the
 * others. The weight is written beside the initializer, so a system without one cannot carry it.
 */
export function SpawnPointSection({ system }: { system: SystemNode }) {
  const editable = useEditableSystem();
  if (!editable) return null;
  return (
    <Section id="system.spawn" title="Spawn point">
      <SpawnPoint system={system} />
    </Section>
  );
}

function SpawnPoint({ system }: { system: SystemNode }) {
  const applyOp = useApplyOp();
  const paint = useFileSessionStore((s) => s.paintProfile);
  const [refused, setRefused] = useState(false);
  const weight = system.spawn_weight;
  const scripted = system.spawn_script !== null;
  const none = system.initializer === "" && !paint;
  const toggle = (on: boolean) =>
    applyOp(spawnPointOp(system, on ? DEFAULT_SPAWN_WEIGHT : null, paint || scripted));
  const commit = (next: number) => {
    setRefused(!isSpawnWeight(next));
    if (isSpawnWeight(next)) applyOp(spawnPointOp(system, next, false));
  };
  return (
    <>
      <div className="ins-spawn-point">
        <label>
          <input
            type="checkbox"
            checked={scripted || weight !== null}
            disabled={none}
            onChange={() => toggle(!scripted && weight === null)}
          />
          Spawn point
        </label>
        {!scripted && weight !== null && (
          <>
            <span className="k">weight</span>
            <Field
              kind="number"
              className="coord"
              label="Spawn weight"
              value={weight}
              onCommit={commit}
              onDone={() => setRefused(false)}
            />
          </>
        )}
      </div>
      {refused && <div className="muted ins-hint">A spawn weight must be more than zero.</div>}
      {none && <div className="muted ins-hint">{NEEDS_INITIALIZER}</div>}
      {scripted ? <ScriptedSeat system={system} /> : <Reservation system={system} />}
      <Modifiers system={system} />
    </>
  );
}

/**
 * Holding the system for one kind of empire: the presets
 * `modifier = { factor = 0 is_ai = yes }` and its mirror, which bar the other kind. They are
 * exclusive, so checking one takes the other back.
 */
function Reservation({ system }: { system: SystemNode }) {
  const applyOp = useApplyOp();
  const editable = useEditableSystem();
  const drawn = isSpawnPoint(system);
  const human = isHumanReserved(system);
  const ai = isAiReserved(system);
  const set = (preset: SpawnReservationPreset, on: boolean) =>
    applyOp(spawnReservationOp(system.id, on ? preset : null));
  return (
    <>
      <div className="ins-spawn-point">
        <label>
          <input
            type="checkbox"
            checked={human}
            disabled={!drawn || !editable}
            onChange={() => set("human", !human)}
          />
          Reserve for a human player
        </label>
      </div>
      <div className="ins-spawn-point">
        <label>
          <input
            type="checkbox"
            checked={ai}
            disabled={!drawn || !editable}
            onChange={() => set("ai", !ai)}
          />
          Reserve for the AI
        </label>
      </div>
      {!drawn && <div className="muted ins-hint">{NEEDS_SPAWN_POINT}</div>}
    </>
  );
}

/**
 * The rest of the `spawn_weight` block as the file states it: triggers this editor reads and
 * never rewrites, so every one is shown, whether or not it names someone it seats.
 */
function Modifiers({ system }: { system: SystemNode }) {
  const modifiers = system.spawn_modifiers;
  if (modifiers.length === 0 && system.spawn_design === null) return null;
  return (
    <>
      {modifiers.length > 0 && (
        <div className="muted ins-spawn-head">Modifiers · {modifiers.length}</div>
      )}
      {modifiers.map((m, i) => (
        <div className="ins-spawn-modifier" key={i}>
          <span className="num">{modifierAmount(m)}</span>
          <span className="mono">{m.trigger}</span>
          {m.reservation !== null && <Chip>{reservationLabel(m.reservation)}</Chip>}
        </div>
      ))}
      {system.spawn_design !== null && (
        <div className="ins-line">
          <span className="k muted">design</span>
          <span className="mono">{system.spawn_design}</span>
        </div>
      )}
    </>
  );
}
