import type { SpecialLayout } from "../../../generated/SpecialLayout";
import type { SpecialPick } from "../../../generated/SpecialPick";
import { specialMarks } from "../../../lib/addSystem";
import { LockGlyph } from "../../Glyph";
import { useEditorStore } from "../../../store/editorStore";
import { PickItem } from "./PickCard";
import { Submenu } from "./Submenu";

const SPECIAL_LABEL = "Special";
const UNIQUE_HEADING = "Unique systems";
const OTHER_HEADING = "Other special systems";
const IN_GALAXY = "Already in this galaxy";

/** A Special row's label with its marks: already in the galaxy, and its DLC had or missing. */
function SpecialLabel({ layout, cap }: { layout: SpecialLayout; cap: number | null }) {
  const marks = specialMarks(layout, cap);
  const dlc = layout.dlc?.name ?? "";
  return (
    <>
      <span>{layout.label}</span>
      <span className="pick-marks">
        {marks.inGalaxy && (
          <span className="warn" role="img" aria-label={IN_GALAXY} title={IN_GALAXY}>
            ⚠
          </span>
        )}
        {marks.dlc === "tag" && (
          <span className="pick-dlc" title={dlc}>
            DLC
          </span>
        )}
        {marks.dlc === "lock" && (
          <LockGlyph
            className="pick-lock"
            width={9}
            height={11}
            title={`Needs ${dlc}, which this save doesn't have`}
          />
        )}
      </span>
    </>
  );
}

/** The Special menu's two groups, the game's unique systems and the rest, each in label order, every row placing its layout at the spot. */
export function SpecialRows({ x, y, picks }: { x: number; y: number; picks: SpecialPick[] }) {
  const addSpecialSystemAt = useEditorStore((s) => s.addSpecialSystemAt);
  const byLabel = (a: SpecialPick, b: SpecialPick) => a.layout.label.localeCompare(b.layout.label);
  const groups = [
    { heading: UNIQUE_HEADING, rows: picks.filter((p) => p.layout.unique).sort(byLabel) },
    { heading: OTHER_HEADING, rows: picks.filter((p) => !p.layout.unique).sort(byLabel) },
  ].filter((group) => group.rows.length > 0);
  return groups.map((group, i) => (
    <div key={group.heading} className="pick-group" role="group" aria-label={group.heading}>
      <div className={i === 0 ? "pick-group-heading" : "pick-group-heading separated"}>
        {group.heading}
      </div>
      {group.rows.map(({ layout, summary }) => (
        <PickItem
          key={layout.key}
          className="menu-item pick-row"
          title={layout.label}
          summary={summary}
          run={() => addSpecialSystemAt(x, y, layout.key)}
        >
          <SpecialLabel layout={layout} cap={summary.max_instances} />
        </PickItem>
      ))}
    </div>
  ));
}

/** The star submenu's last entry, after a divider: the game's special layouts. */
export function SpecialItems({ x, y, picks }: { x: number; y: number; picks: SpecialPick[] }) {
  return (
    <Submenu label={SPECIAL_LABEL} className="context-menu-separated">
      <SpecialRows x={x} y={y} picks={picks} />
    </Submenu>
  );
}
