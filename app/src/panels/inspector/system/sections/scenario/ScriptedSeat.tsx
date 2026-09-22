import type { SystemNode } from "../../../../../generated/SystemNode";
import {
  PLAIN_SPAWN_KINDS,
  RESERVED_SPAWN_KINDS,
  canBeWeighted,
  isReservedKey,
  paintKindDescription,
  paintKindKey,
  reservedLetter,
  scriptForKind,
  seatSummary,
  weightedDescription,
  weightedScript,
} from "../../../../../lib/paint";
import { useGalaxyStore } from "../../../../../store/galaxyStore";
import { useApplyOp } from "../../../../useApplyOp";
import { useEditableSystem } from "../../editable";
import { openLocalClusterWorkshop, openReservedSpawnsWorkshop } from "../../../../chrome/paintMod";

/** `k`'s label, marked "in use" when a system other than the one being edited already holds it. */
function optionLabel(k: { key: string; label: string }, others: ReturnType<typeof seatSummary>) {
  const inUse =
    k.key === "sol"
      ? others.sol
      : isReservedKey(k.key) && others.reserved.includes(reservedLetter(k.key));
  return inUse ? `${k.label} · in use` : k.label;
}

/**
 * The seat a Paint a Galaxy spawn system offers, as its script names it, and whether it carries
 * the weight for its holder. The mod seats players by these kinds, so the kind is what a change
 * writes; the weight the script resolves to is the mod's to compute.
 */
export function ScriptedSeat({ system }: { system: SystemNode }) {
  const applyOp = useApplyOp();
  const editable = useEditableSystem();
  const systems = useGalaxyStore((s) => s.systems);
  const script = system.spawn_script;
  if (script === null) return null;
  const { kind, player } = script.paint_a_galaxy;
  const reserved = typeof kind !== "string";
  const sol = kind === "sol";
  const others = seatSummary([...systems.values()].filter((other) => other.id !== system.id));
  return (
    <>
      <div className="ins-spawn-point">
        <label>
          Seat
          <select
            aria-label="Spawn kind"
            value={paintKindKey(script)}
            disabled={!editable}
            onChange={(e) =>
              applyOp({
                type: "SetSpawnScript",
                id: system.id,
                script: scriptForKind(e.currentTarget.value, system),
              })
            }
          >
            {PLAIN_SPAWN_KINDS.map((k) => (
              <option key={k.key} value={k.key}>
                {optionLabel(k, others)}
              </option>
            ))}
            <optgroup label="Reserved for one empire">
              {RESERVED_SPAWN_KINDS.map((k) => (
                <option key={k.key} value={k.key}>
                  {optionLabel(k, others)}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
      </div>
      <div className="muted ins-hint">
        {paintKindDescription(script)}
        {reserved && (
          <>
            {" The trait comes from the "}
            <button type="button" className="link" onClick={openReservedSpawnsWorkshop}>
              Reserved Spawns submod ↗
            </button>
            .
          </>
        )}
        {sol && (
          <>
            {" For Alpha Centauri and the other neighbours beside it, the "}
            <button type="button" className="link" onClick={openLocalClusterWorkshop}>
              Local Cluster mod
            </button>
            {" is the usual workaround."}
          </>
        )}
      </div>
      {canBeWeighted(kind) && (
        <>
          <div className="ins-spawn-point">
            <label>
              <input
                type="checkbox"
                checked={player}
                disabled={!editable}
                onChange={() =>
                  applyOp({
                    type: "SetSpawnScript",
                    id: system.id,
                    script: weightedScript(system, !player),
                  })
                }
              />
              {others.player ? "Weighted for its empire · in use" : "Weighted for its empire"}
            </label>
          </div>
          {player && <div className="muted ins-hint">{weightedDescription(kind)}</div>}
        </>
      )}
    </>
  );
}
