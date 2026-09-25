import type { ReactNode } from "react";
import type { SystemDetail } from "../../../../generated/SystemDetail";
import type { ScenarioBypass } from "../../../../generated/ScenarioBypass";
import { bypassIcons, scenarioBypassIcon } from "../../../../lib/details/labels";
import { bypassSource, bypassSourceTitle, bypassesOf } from "../../../../lib/scenarioBypasses";
import { displayName } from "../../../../lib/names";
import { useEditorStore } from "../../../../store/editorStore";
import { useCanEdit, useFileSessionStore } from "../../../../store/fileSessionStore";
import { useMapChromeStore } from "../../../../store/mapChromeStore";
import { useGalaxyVersion, useSystemName } from "../../../../store/browserRows";
import { useGalaxyStore } from "../../../../store/galaxyStore";
import { useGameDataStore } from "../../../../store/gameDataStore";
import { useInspectorStore } from "../../../../store/inspectorStore";
import { useApplySymmetricOp } from "../../../useApplyOp";
import { Chip, Icon, SourceChip } from "../../../parts";
import { DrillLink, DrillRow, Empty, MoreButton, Section } from "../../parts";

/** Where a scenario's prevented pairs are made, since the inspector makes none. */
export const PREVENT_HINT =
  "Right-click a lane to prevent it, or select other systems and right-click this one.";

/** A row naming another system: a lane the reader can jump to, or a pair the file forbids. */
function LaneRow({
  className,
  name,
  title,
  onOpen,
  onPointerEnter,
  onPointerLeave,
  children,
}: {
  className: string;
  name: ReactNode;
  title?: string;
  onOpen?: () => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
  children: ReactNode;
}) {
  const body = (
    <>
      <span className="ins-lane-name">{name}</span>
      {children}
    </>
  );
  if (onOpen === undefined) {
    return (
      <div className={className} onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave}>
        {body}
      </div>
    );
  }
  return (
    <DrillRow
      className={className}
      title={title}
      onOpen={onOpen}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      {body}
    </DrillRow>
  );
}

/**
 * Cuts one lane from the row that names it. The map can only cut a lane it draws, and it draws
 * no lane from a system to itself. Nothing is offered for a lane whose far system is not there:
 * its inverse would have to add a lane to a system that does not exist, so the core refuses it.
 */
function CutLane({ a, b, missing }: { a: number; b: number; missing: boolean }) {
  const applyOp = useApplySymmetricOp();
  if (missing) return <span />;
  return (
    <button
      type="button"
      className="ins-lane-cut"
      aria-label={`Cut the lane to #${b}`}
      title={`Cut the lane to #${b}`}
      onClick={(e) => {
        e.stopPropagation();
        void applyOp({ type: "RemoveLane", a, b });
      }}
    >
      ✂
    </button>
  );
}

/** A pair the scenario forbids a generated lane between, and the way to allow it again. */
function PreventedRow({ system, other }: { system: number; other: number }) {
  const applyOp = useApplySymmetricOp();
  const name = useSystemName(other);
  return (
    <LaneRow className="ins-prevented" name={name}>
      <span className="muted mono">#{other}</span>
      <button
        type="button"
        className="link"
        title={`Allow a lane between #${system} and #${other}`}
        onClick={() => applyOp({ type: "UnpreventLane", a: system, b: other })}
      >
        Allow
      </button>
    </LaneRow>
  );
}

/**
 * The pairs `prevent_hyperlane` forbids, under the lanes themselves, and where the map makes
 * more of them.
 */
function Prevented({ system, prevented }: { system: number; prevented: readonly number[] }) {
  return (
    <>
      {prevented.length > 0 && (
        <div className="muted ins-spawn-head">Prevented · {prevented.length}</div>
      )}
      {prevented.map((other) => (
        <PreventedRow key={other} system={system} other={other} />
      ))}
      <div className="muted ins-hint">{PREVENT_HINT}</div>
    </>
  );
}

/** The hyperlanes leaving a system; hovering a row ghosts that lane on the map. */
export function HyperlaneSection({
  detail,
  limit,
  startClosed,
}: {
  detail: SystemDetail;
  limit?: number;
  startClosed?: boolean;
}) {
  const { system, neighbours } = detail;
  const jumpTo = useEditorStore((s) => s.jumpTo);
  const setLanePreview = useMapChromeStore((s) => s.setLanePreview);
  const setTab = useInspectorStore((s) => s.setTab);
  const canPrevent = useCanEdit("create_systems");
  const systems = useGalaxyStore((s) => s.systems);
  const waylines = useGalaxyStore((s) => s.waylines);
  useGalaxyVersion();
  const node = systems.get(system.id);
  const lanes = node?.lanes ?? [];
  const wayline = (other: number) =>
    waylines.some((w) => w.a === Math.min(system.id, other) && w.b === Math.max(system.id, other));
  const shown = limit === undefined ? neighbours : neighbours.slice(0, limit);
  return (
    <Section
      id="system.hyperlanes"
      title="Hyperlanes"
      count={neighbours.length}
      startClosed={startClosed}
    >
      {neighbours.length === 0 ? (
        <Empty>Isolated: no hyperlanes.</Empty>
      ) : (
        <>
          {shown.map((n, i) => {
            const mismatch = lanes.find((l) => l.to === n.id)?.stale ?? false;
            return (
              <LaneRow
                key={`${n.id}-${i}`}
                className="ins-lane"
                title={`Jump to #${n.id}`}
                onOpen={() => void jumpTo(n.id)}
                onPointerEnter={() => setLanePreview([[system.id, n.id]])}
                onPointerLeave={() => setLanePreview(null)}
                name={
                  <>
                    {displayName(n.name_key)} {n.bridge && <Chip>bridge</Chip>}{" "}
                    {wayline(n.id) && <Chip title="A leg of a wayline network">wayline</Chip>}
                  </>
                }
              >
                <span className="num">{n.length}</span>
                <span className="num">{n.distance === null ? "—" : n.distance.toFixed(1)}</span>
                <span className="num">
                  {mismatch && (
                    <Chip warn title="Length differs from floor(distance)">
                      !
                    </Chip>
                  )}
                </span>
                <CutLane a={system.id} b={n.id} missing={n.distance === null} />
              </LaneRow>
            );
          })}
          {shown.length < neighbours.length && (
            <MoreButton
              count={neighbours.length - shown.length}
              where="on the Lanes tab"
              onClick={() => setTab("lanes")}
            />
          )}
        </>
      )}
      {canPrevent && <Prevented system={system.id} prevented={node?.prevented ?? []} />}
    </Section>
  );
}

/** Why an endpoint is marked assumed, shown on hover. */
const ASSUMED_BYPASS_TITLE =
  "An endpoint whose conditions this editor cannot judge is marked assumed.";

/** The system at the far end, named and jumped to. */
function PartnerLink({ id }: { id: number }) {
  const jumpTo = useEditorStore((s) => s.jumpTo);
  const name = useSystemName(id);
  return (
    <DrillLink title={`Jump to #${id}`} onOpen={() => void jumpTo(id)}>
      {name}
    </DrillLink>
  );
}

/** One endpoint the game data places here: what it is, where it leads, and which reader found it. */
function ScenarioBypassRow({ bypass }: { bypass: ScenarioBypass }) {
  const kinds = useGameDataStore((s) => s.bypasses);
  const icon = scenarioBypassIcon(bypass.kind, kinds);
  return (
    <div className="ins-line">
      <Icon className="gi" keys={icon.keys} glyph={icon.glyph} />
      <span>{icon.label}</span>
      {bypass.partner !== null && <PartnerLink id={bypass.partner} />}
      <SourceChip source={bypassSource(bypass)} title={bypassSourceTitle(bypass)} />
      {bypass.assumed && (
        <Chip warn title={ASSUMED_BYPASS_TITLE}>
          assumed
        </Chip>
      )}
    </div>
  );
}

/**
 * The bypasses of the open system: the ones the save writes, or the ones a scenario's
 * initializers and day-one scripts place, which a scenario shows only where there are any.
 */
export function BypassSection({ system }: { system: number }) {
  const scenario = useFileSessionStore((s) => s.kind === "scenario");
  const galaxy = useGalaxyStore((s) => s.galaxy);
  const placed = useGameDataStore((s) => s.scenarioBypasses);
  const kinds = useGameDataStore((s) => s.bypasses);
  const icons = bypassIcons(galaxy?.bypasses ?? [], system, kinds);
  const bypasses = bypassesOf(placed, system);
  if (scenario) {
    if (bypasses.length === 0) return null;
    return (
      <Section id="system.bypasses" title="Bypasses" count={bypasses.length}>
        {bypasses.map((bypass, i) => (
          <ScenarioBypassRow key={`${bypass.system}-${i}`} bypass={bypass} />
        ))}
      </Section>
    );
  }
  return (
    <Section id="system.bypasses" title="Bypasses" count={icons.length}>
      {icons.length === 0 ? (
        <Empty>No bypasses touch this system.</Empty>
      ) : (
        icons.map((icon, i) => (
          <div className="ins-line" key={`${icon.label}-${i}`}>
            <Icon className="gi" keys={icon.keys} glyph={icon.glyph} />
            <span>{icon.label}</span>
          </div>
        ))
      )}
    </Section>
  );
}
