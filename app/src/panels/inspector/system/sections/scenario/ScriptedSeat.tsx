import type { SystemNode } from "../../../../../generated/SystemNode";
import {
  PAINT_SPAWN_KINDS,
  paintKindDescription,
  paintKindKey,
  scriptForKind,
} from "../../../../../lib/paint";
import { useApplyOp } from "../../../../useApplyOp";
import { useEditableSystem } from "../../editable";
import { openReservedSpawnsWorkshop } from "../../../../chrome/paintMod";

const RESERVED_PREFIX = "reserved:";

const [PLAIN_KINDS, RESERVED_KINDS] = [
  PAINT_SPAWN_KINDS.filter((k) => !k.key.startsWith(RESERVED_PREFIX)),
  PAINT_SPAWN_KINDS.filter((k) => k.key.startsWith(RESERVED_PREFIX)),
];

/**
 * The seat a Paint a Galaxy spawn system offers, as its script names it. The mod seats players
 * by these kinds, so the kind is what a change writes; the weight the script resolves to is
 * the mod's to compute.
 */
export function ScriptedSeat({ system }: { system: SystemNode }) {
  const applyOp = useApplyOp();
  const editable = useEditableSystem();
  const script = system.spawn_script;
  if (script === null) return null;
  const kind = script.paint_a_galaxy.kind;
  const reserved = typeof kind !== "string";
  return (
    <>
      <div className="ins-spawn-point">
        <label>
          Seat
          <select
            aria-label="Spawn kind"
            value={paintKindKey(kind)}
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
                {k.label}
              </option>
            ))}
            <optgroup label="Reserved for one empire">
              {RESERVED_KINDS.map((k) => (
                <option key={k.key} value={k.key}>
                  {k.label}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
      </div>
      <div className="muted ins-hint">
        {paintKindDescription(kind)}
        {reserved && (
          <>
            {" The trait comes from the "}
            <button type="button" className="link" onClick={openReservedSpawnsWorkshop}>
              Reserved Spawns submod ↗
            </button>
            .
          </>
        )}
      </div>
    </>
  );
}
