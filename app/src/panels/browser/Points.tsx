import { useMemo } from "react";
import type { SpecialKind } from "../../generated/SpecialKind";
import { pointGroups } from "../../lib/browserRows";
import { kindLabel, kindTitle } from "../../lib/special";
import { kindVisible } from "../../lib/visual/layerGroups";
import { toCss } from "../../lib/visual/ownerColors";
import { KIND_STYLE } from "../../lib/visual/specialStyle";
import { type PointGroup, type PointRow } from "../../store/browserRows";
import { useEditorStore } from "../../store/editorStore";
import { useMapChromeStore } from "../../store/mapChromeStore";
import { systemNameOf, useGalaxyStore } from "../../store/galaxyStore";
import { useFileSessionStore } from "../../store/fileSessionStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { useCollapse, type Collapse } from "./collapse";
import { Action, Eye, Group, Row } from "./rows";

function PointLine({ row, kind }: { row: PointRow; kind: SpecialKind }) {
  const setSelection = useEditorStore((s) => s.setSelection);
  const jumpTo = useEditorStore((s) => s.jumpTo);
  return (
    <Row
      name={row.label}
      title={`Go to ${row.label} — ${kindTitle(kind)}`}
      subline={row.subline}
      onName={() => void jumpTo(row.id)}
      actions={
        <Action
          glyph="⊙"
          label={`Select ${row.label}`}
          onClick={() => void setSelection([row.id], "replace")}
        />
      }
    />
  );
}

function KindEye({ group }: { group: PointGroup }) {
  const shown = useMapChromeStore((s) => kindVisible(s, group.kind));
  const toggleKind = useMapChromeStore((s) => s.toggleKind);
  const label = kindLabel(group.kind);
  return (
    <>
      <Eye
        on={shown}
        label={shown ? `Hide ${label} on the map` : `Show ${label} on the map`}
        onToggle={() => toggleKind(group.kind)}
      />
      <span
        className="browser-swatch"
        style={{ background: toCss(KIND_STYLE[group.kind].color) }}
      />
    </>
  );
}

function PointSection({
  group,
  collapse,
  sub = false,
}: {
  group: PointGroup;
  collapse: Collapse;
  sub?: boolean;
}) {
  const key = sub ? `${group.kind}/${group.key}` : group.key;
  return (
    <Group
      label={group.label}
      title={kindTitle(group.kind)}
      count={group.count}
      open={!collapse.collapsed(key, sub || group.kind === "unique")}
      sub={sub}
      lead={sub ? undefined : <KindEye group={group} />}
      onToggle={() => collapse.toggle(key)}
    >
      {group.groups.map((inner) => (
        <PointSection key={inner.key} group={inner} collapse={collapse} sub />
      ))}
      {group.rows.map((row) => (
        <PointLine key={row.id} row={row} kind={group.kind} />
      ))}
    </Group>
  );
}

/** Why a scenario's points of interest are not statements of the file the user is editing. */
export const POINTS_NOTE =
  "Points of interest are read from the initializer scripts and the loaded game data, not from " +
  "the scenario's own text.";

/** Systems worth finding, grouped by kind, each group's eye driving its map layer. */
export function Points() {
  const scenario = useFileSessionStore((s) => s.kind === "scenario");
  const systems = useGalaxyStore((s) => s.systems);
  const special = useGameDataStore((s) => s.special);
  const withGameData = useGameDataStore((s) => s.specialWithGameData);
  const names = useGameDataStore((s) => s.names);
  const collapse = useCollapse("points");
  const pending = useGameDataStore((s) => s.specialPending);
  const groups = useMemo(
    () => pointGroups(special, withGameData, names, (id) => systemNameOf(systems, names, id)),
    [special, withGameData, names, systems],
  );

  if (groups.length === 0) {
    return (
      <div className="muted">
        {pending ? "Finding points of interest…" : "No points of interest in this save."}
      </div>
    );
  }
  return (
    <div className="browser">
      {scenario && <div className="browser-note src">{POINTS_NOTE}</div>}
      {groups.map((group) => (
        <PointSection key={group.key} group={group} collapse={collapse} />
      ))}
    </div>
  );
}
