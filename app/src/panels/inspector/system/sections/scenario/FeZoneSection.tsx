import type { FeDirection } from "../../../../../generated/FeDirection";
import type { FeKind } from "../../../../../generated/FeKind";
import type { FeZone } from "../../../../../generated/FeZone";
import type { SystemNode } from "../../../../../generated/SystemNode";
import { linkedTo, takesCustomLinks, USE_NEAREST_SHORT_LABEL } from "../../../../../lib/feLinks";
import {
  addFeZoneRefusal,
  FE_DIRECTIONS,
  FE_KINDS,
  FE_ZONE_DISTANCES,
} from "../../../../../lib/feZone";
import { useSystemName, useSystemNames } from "../../../../../store/browserRows";
import { useEditorStore } from "../../../../../store/editorStore";
import { useCanEdit, usePaintLayer } from "../../../../../store/fileSessionStore";
import { useGalaxyStore } from "../../../../../store/galaxyStore";
import { useIssuesStore } from "../../../../../store/issuesStore";
import { Section } from "../../../parts";

/** What a zone is, in four short lines: the ring is empty space the mod fills at game start. */
export const FE_ZONE_INTRO = [
  "A fallen empire zone is empty space.",
  "At game start the Paint a Galaxy mod creates a fallen empire's home system at the centre " +
    "of the ring, its other systems around it, and hyperlanes to systems nearby.",
  "Nothing already on the map is used or moved, so keep the ring clear of your systems.",
  "Every zone belongs to one of your systems, which the ring is measured from: add it from " +
    "the system you want it near.",
] as const;

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

/** What the Connections block says of a zone the mod links by its own rule. */
export const NEAREST_NOTE = "The mod links the fallen empire to its nearest systems.";

export const LINK_HINT = "Select this system, then right-click a system to link it.";

/** What the Connections block says of a zone that takes custom connections from no system. */
export const NONE_LINKED = "None. The mod will lay no hyperlanes to the fallen empire.";

/** Where the ring sits, measured from the anchor by name, and what grid it is confined to. */
function placementHint(anchor: string): string {
  return (
    `Where the ring sits, measured from ${anchor}. The mod can only place a fallen empire at ` +
    "these eight directions and distances."
  );
}

/**
 * The Paint a Galaxy fallen empire zone a scenario system anchors: the empty ring the mod fills
 * at game start. Every change writes the whole zone back as the user's own.
 */
export function FeZoneSection({ system }: { system: SystemNode }) {
  const editable = useCanEdit("create_systems");
  const paint = usePaintLayer();
  if (!editable || !paint) return null;
  return (
    <Section id="system.feZone" title="Fallen empire zone">
      <ul className="muted ins-hint ins-fe-zone-intro">
        {FE_ZONE_INTRO.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
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
  const problems = useIssuesStore((s) => s.issues).filter((issue) =>
    issue.code === "fe_zone_overlap"
      ? issue.systems.includes(system.id)
      : (issue.code.startsWith("fe_zone_") ||
          issue.code === "fe_link_isolated" ||
          issue.code === "fe_link_shared") &&
        issue.systems[0] === system.id,
  );
  const write = (patch: Partial<FeZone>) =>
    void setFeZone(system.id, { ...zone, ...patch, preferred: true });
  return (
    <>
      {problems.map((issue) => (
        <div className="ins-warn" key={issue.code + issue.systems.join()}>
          {issue.message}
        </div>
      ))}
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
      <Connections system={system} />
      <div className="ins-actions">
        <button type="button" onClick={() => void setFeZone(system.id, null)}>
          Remove zone
        </button>
      </div>
    </>
  );
}

/**
 * Which systems the mod lays the fallen empire's hyperlanes from: its own nearest ones, or the
 * systems linked to the zone, each with a way to it and a way out of the list.
 */
function Connections({ system }: { system: SystemNode }) {
  const systems = useGalaxyStore((s) => s.systems);
  const select = useEditorStore((s) => s.select);
  const unlinkFromFeZone = useEditorStore((s) => s.unlinkFromFeZone);
  const resetFeLinks = useEditorStore((s) => s.resetFeLinks);
  const custom = takesCustomLinks(system);
  const linked = custom ? linkedTo(system, systems) : [];
  const names = useSystemNames(linked.map((l) => l.id));
  if (!custom) {
    return (
      <>
        <div className="ins-sub">Connections</div>
        <div className="ins-line">{NEAREST_NOTE}</div>
        <div className="muted ins-hint">{LINK_HINT}</div>
      </>
    );
  }
  return (
    <>
      <div className="ins-sub">Connections</div>
      {linked.length === 0 && <div className="ins-line">{NONE_LINKED}</div>}
      {linked.map((l, i) => (
        <div className="ins-line" key={l.id}>
          <button
            type="button"
            className="link"
            title="Select the linked system"
            onClick={() => void select(l.id)}
          >
            {names[i]}
          </button>
          <button
            type="button"
            className="link"
            aria-label={`Unlink ${names[i]}`}
            title={`Unlink ${names[i]}`}
            onClick={() => void unlinkFromFeZone(system.id, l.id)}
          >
            ×
          </button>
        </div>
      ))}
      <div className="ins-actions">
        <button type="button" onClick={() => void resetFeLinks(system.id)}>
          {USE_NEAREST_SHORT_LABEL}
        </button>
      </div>
    </>
  );
}
