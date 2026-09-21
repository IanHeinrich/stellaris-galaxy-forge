import type { FeDirection } from "../../../../../generated/FeDirection";
import type { FeKind } from "../../../../../generated/FeKind";
import type { FeZone } from "../../../../../generated/FeZone";
import type { SystemNode } from "../../../../../generated/SystemNode";
import {
  addFeZoneRefusal,
  FE_DIRECTIONS,
  FE_KINDS,
  FE_ZONE_DISTANCES,
} from "../../../../../lib/feZone";
import { useSystemName } from "../../../../../store/browserRows";
import { useEditorStore } from "../../../../../store/editorStore";
import { usePaintLayer } from "../../../../../store/fileSessionStore";
import { useGalaxyStore } from "../../../../../store/galaxyStore";
import { Section } from "../../../parts";
import { useEditableSystem } from "../../editable";

export const FE_ZONE_INTRO =
  "A fallen empire zone is empty space. When the game starts, the Paint a Galaxy mod creates a " +
  "fallen empire's home system at the centre of the ring and its other systems around it, then " +
  "links them by hyperlane to systems nearby. Nothing already on the map is used or moved, so " +
  "the ring must stay clear of your systems.";

export const ADD_ZONE_HINT =
  "Marks empty space nearby where the mod will create a fallen empire's systems at game start.";

export const KIND_HINT =
  "Random lets the game pick the fallen empire. A named type puts that empire here first, if " +
  "the game spawns one.";

export const FALLBACK_LABEL = "Fill with random systems if no fallen empire spawns here";

export const FALLBACK_HINT =
  "If no fallen empire is placed here, the mod creates a few ordinary systems in the ring instead.";

export const AUTOMATIC_NOTE =
  "Automatic. The mod may use this ring if it needs more zones than you placed. Any change " +
  "makes it yours.";

/** Where the ring sits, measured from the anchor by name. */
function placementHint(anchor: string): string {
  return `Where the ring sits, measured from ${anchor}.`;
}

/**
 * The Paint a Galaxy fallen empire zone a scenario system anchors: the empty ring the mod fills
 * at game start. Every change writes the whole zone back as the user's own.
 */
export function FeZoneSection({ system }: { system: SystemNode }) {
  const editable = useEditableSystem();
  const paint = usePaintLayer();
  if (!editable || !paint) return null;
  return (
    <Section id="system.feZone" title="Fallen empire zone">
      <div className="muted ins-hint">{FE_ZONE_INTRO}</div>
      {system.fe_zone === null ? (
        <NoZone system={system} />
      ) : (
        <Zone system={system} zone={system.fe_zone} />
      )}
    </Section>
  );
}

function NoZone({ system }: { system: SystemNode }) {
  const systems = useGalaxyStore((s) => s.systems);
  const addFeZone = useEditorStore((s) => s.addFeZone);
  const refusal = addFeZoneRefusal(system, systems);
  return (
    <>
      <div className="ins-line">None</div>
      <div className="ins-actions">
        <button
          type="button"
          disabled={refusal !== null}
          title={refusal ?? undefined}
          onClick={() => void addFeZone(system.id)}
        >
          Add zone
        </button>
      </div>
      <div className="muted ins-hint">{ADD_ZONE_HINT}</div>
    </>
  );
}

function Zone({ system, zone }: { system: SystemNode; zone: FeZone }) {
  const setFeZone = useEditorStore((s) => s.setFeZone);
  const anchor = useSystemName(system.id);
  const write = (patch: Partial<FeZone>) =>
    void setFeZone(system.id, { ...zone, ...patch, preferred: true });
  return (
    <>
      <div className="ins-fe-zone">
        <label>
          Type
          <select
            aria-label="Fallen empire type"
            value={zone.kind}
            onChange={(e) => write({ kind: e.currentTarget.value as FeKind })}
          >
            {FE_KINDS.map((k) => (
              <option key={k.key} value={k.key}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="muted ins-hint">{KIND_HINT}</div>
      <div className="ins-fe-zone">
        <label>
          Direction
          <select
            aria-label="Zone direction"
            value={zone.direction}
            onChange={(e) => write({ direction: e.currentTarget.value as FeDirection })}
          >
            {FE_DIRECTIONS.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Distance
          <select
            aria-label="Zone distance"
            value={zone.distance}
            onChange={(e) => write({ distance: Number(e.currentTarget.value) })}
          >
            {FE_ZONE_DISTANCES.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="muted ins-hint">{placementHint(anchor)}</div>
      <div className="ins-fe-zone">
        <label>
          <input
            type="checkbox"
            checked={zone.fallback}
            onChange={() => write({ fallback: !zone.fallback })}
          />
          {FALLBACK_LABEL}
        </label>
      </div>
      <div className="muted ins-hint">{FALLBACK_HINT}</div>
      {!zone.preferred && <div className="muted ins-hint">{AUTOMATIC_NOTE}</div>}
      <div className="ins-actions">
        <button type="button" onClick={() => void setFeZone(system.id, null)}>
          Remove zone
        </button>
      </div>
    </>
  );
}
