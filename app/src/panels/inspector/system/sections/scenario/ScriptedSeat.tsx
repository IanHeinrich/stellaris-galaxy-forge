import type { SystemNode } from "../../../../../generated/SystemNode";
import {
  PAINT_SPAWN_KINDS,
  paintKindDescription,
  paintKindKey,
  scriptForKind,
  seatSummary,
} from "../../../../../lib/paint";
import { useGalaxyStore } from "../../../../../store/galaxyStore";
import { useApplyOp } from "../../../../useApplyOp";
import { useEditableSystem } from "../../editable";
import { openLocalClusterWorkshop, openReservedSpawnsWorkshop } from "../../../../chrome/paintMod";

const RESERVED_PREFIX = "reserved:";

const [PLAIN_KINDS, RESERVED_KINDS] = [
  PAINT_SPAWN_KINDS.filter((k) => !k.key.startsWith(RESERVED_PREFIX)),
  PAINT_SPAWN_KINDS.filter((k) => k.key.startsWith(RESERVED_PREFIX)),
];

/** `k`'s label, marked "in use" when a system other than the one being edited already holds it. */
function optionLabel(k: { key: string; label: string }, others: ReturnType<typeof seatSummary>) {
  const inUse =
    k.key === "sol"
      ? others.sol
      : k.key === "player"
        ? others.player
        : k.key.startsWith(RESERVED_PREFIX) &&
          others.reserved.includes(k.key.slice(RESERVED_PREFIX.length).toUpperCase());
  return inUse ? `${k.label} · in use` : k.label;
}

/**
 * The seat a Paint a Galaxy spawn system offers, as its script names it. The mod seats players
 * by these kinds, so the kind is what a change writes; the weight the script resolves to is
 * the mod's to compute.
 */
export function ScriptedSeat({ system }: { system: SystemNode }) {
  const applyOp = useApplyOp();
  const editable = useEditableSystem();
  const systems = useGalaxyStore((s) => s.systems);
  const script = system.spawn_script;
  if (script === null) return null;
  const kind = script.paint_a_galaxy.kind;
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
            {PLAIN_KINDS.map((k) => (
              <option key={k.key} value={k.key}>
                {optionLabel(k, others)}
              </option>
            ))}
            <optgroup label="Reserved for one empire">
              {RESERVED_KINDS.map((k) => (
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
            {" Give this seat the Sol initializer and Alpha Centauri and the other neighbours "}
            {"appear beside it. Without it, the "}
            <button type="button" className="link" onClick={openLocalClusterWorkshop}>
              Local Cluster mod
            </button>
            {" is the usual workaround."}
          </>
        )}
      </div>
    </>
  );
}
