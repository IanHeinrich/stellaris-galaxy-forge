import type { SystemNode } from "../../../../../generated/SystemNode";
import {
  PAINT_SPAWN_KINDS,
  paintKindKey,
  scriptForKind,
  spawnScriptLabel,
} from "../../../../../lib/paint";
import { useApplyOp } from "../../../../useApplyOp";
import { useEditableSystem } from "../../editable";

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
  return (
    <>
      <div className="ins-spawn-point">
        <label>
          Paint a Galaxy spawn: {spawnScriptLabel(script)}
          <select
            aria-label="Spawn kind"
            value={paintKindKey(script.paint_a_galaxy.kind)}
            disabled={!editable}
            onChange={(e) =>
              applyOp({
                type: "SetSpawnScript",
                id: system.id,
                script: scriptForKind(e.currentTarget.value, system),
              })
            }
          >
            {PAINT_SPAWN_KINDS.map((kind) => (
              <option key={kind.key} value={kind.key}>
                {kind.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="muted ins-hint">
        Paint a Galaxy seats players by these kinds; the mod computes the spawn weight from the
        kind.
      </div>
    </>
  );
}
