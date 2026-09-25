import { useState } from "react";
import type { SystemNode } from "../../../../../generated/SystemNode";
import { enabledScript } from "../../../../../lib/paint";
import { isSpawnWeight } from "../../../../../lib/spawn";
import { useEditorStore } from "../../../../../store/editorStore";
import { useCanEdit, usePaintLayer } from "../../../../../store/fileSessionStore";
import { useApplySymmetricOp } from "../../../../useApplyOp";
import { TextField } from "../../../../EditField";
import { Chip, Section } from "../../../parts";
import { ScriptedSeat } from "./ScriptedSeat";
import {
  DEFAULT_SPAWN_WEIGHT,
  flagLabel,
  modifierAmount,
  NEEDS_INITIALIZER,
  spawnPointOp,
} from "./spawnPoint";

/**
 * Whether the generator may start an empire here, and how heavily this system weighs against the
 * others. The weight is written beside the initializer, so a system without one cannot carry it.
 */
export function SpawnPointSection({ system }: { system: SystemNode }) {
  const editable = useCanEdit("create_systems");
  if (!editable) return null;
  return (
    <Section id="system.spawn" title="Spawn point">
      <SpawnPoint system={system} />
    </Section>
  );
}

function SpawnPoint({ system }: { system: SystemNode }) {
  const applyOp = useApplySymmetricOp();
  const setSeat = useEditorStore((s) => s.setSeat);
  const paint = usePaintLayer();
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
            <TextField
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
      {paint && !scripted && weight !== null && (
        <>
          <div className="ins-actions">
            <button
              type="button"
              onClick={() => void setSeat(system.id, (s) => s.spawn_script ?? enabledScript(s))}
            >
              Use a Paint a Galaxy seat
            </button>
          </div>
          <div className="muted ins-hint">The mod fills seats by kind and ignores this weight.</div>
        </>
      )}
      {scripted && <ScriptedSeat system={system} />}
      <Modifiers system={system} />
    </>
  );
}

/**
 * The rest of the `spawn_weight` block as the file states it: triggers this editor reads and
 * never rewrites, so every one is shown, whether or not it names an empire.
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
          {m.country_flag !== null && <Chip>{flagLabel(m.country_flag)}</Chip>}
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
