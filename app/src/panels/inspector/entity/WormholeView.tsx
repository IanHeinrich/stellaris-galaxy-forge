import { useEffect } from "react";
import type { Bounds } from "../../../generated/Bounds";
import type { WormholeSummary } from "../../../generated/WormholeSummary";
import { bypassIconKey } from "../../../lib/details/icons";
import { bypassName, wormholePlateName } from "../../../lib/details/labels";
import {
  GEOMETRY_REASONS,
  wormholeFieldIntent,
  wormholePlace,
} from "../../../lib/details/orbitIntent";
import { rounded } from "../../../lib/details/orbits";
import { openSystem } from "../../../store/commands";
import { useDetailsStore } from "../../../store/detailsStore";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useInspectorStore, type Entry } from "../../../store/inspectorStore";
import { useSystemGeometry } from "../../../store/systemGeometry";
import { EditBlock, EditKey } from "../../EditField";
import { Icon } from "../../parts";
import { Empty, LinkRow, Properties, PropertyRow } from "../parts";
import { RadiusAngleFields } from "../RadiusAngleFields";
import { useGeometryEdit } from "../useGeometryEdit";
import { EntityView } from "./EntityView";
import "./entity.css";

function Head({ hole, name }: { hole: WormholeSummary; name: string }) {
  const kinds = useGameDataStore((s) => s.bypasses);
  const key = bypassIconKey(hole.kind, kinds);
  return (
    <div className="ins-head">
      <Icon className="gi" keys={key === null ? [] : [key]} glyph="◎" />
      <span className="name">{name}</span>
      <span className="muted mono">#{hole.id}</span>
    </div>
  );
}

/** Where a natural wormhole stands about the star, as fields; each commit is one move. */
function PositionBlock({ system, hole }: { system: number; hole: WormholeSummary }) {
  const { send, note } = useGeometryEdit(system);
  const { radius, angle } = wormholePlace(hole);
  const commit = (field: "radius" | "angle", { min: typed }: Bounds) =>
    send(({ frame }) => {
      const now = frame.details?.wormholes.find((w) => w.id === hole.id);
      return now ? wormholeFieldIntent(system, now, field, typed) : null;
    });
  return (
    <EditBlock title="Position">
      <RadiusAngleFields
        radius={radius}
        angle={angle}
        radiusLabel="Distance"
        radiusTitle="How far it stands from the star"
        angleTitle="Where it stands about the star, in degrees"
        onCommit={commit}
      />
      {note()}
    </EditBlock>
  );
}

/** A save's wormhole or shroud tunnel: its place to edit where it can move, then what it is. */
function WormholeOverview({ system, id, label }: { system: number; id: number; label: string }) {
  const request = useDetailsStore((s) => s.request);
  const version = useDetailsStore((s) => s.version);
  const systemName = useGalaxyStore((s) => s.systemName);
  const { frame, editing } = useSystemGeometry(system);
  useEffect(() => request([system]), [system, request, version]);
  const hole = frame.details?.wormholes.find((w) => w.id === id);
  if (!hole) {
    return (
      <>
        <div className="ins-head">
          <span className="name">{label}</span>
          <span className="muted mono">#{id}</span>
        </div>
        <Empty>
          {frame.details ? "This wormhole is not in the system." : "Reading the system…"}
        </Empty>
      </>
    );
  }
  const movable = editing.wormholes.has(id);
  const { radius, angle } = wormholePlace(hole);
  const partner = hole.partner;
  return (
    <>
      <Head hole={hole} name={wormholePlateName(systemName(system), hole.kind)} />
      {movable && <PositionBlock system={system} hole={hole} />}
      <div className="edit-block-title ins-about">About</div>
      <Properties>
        <PropertyRow label="Type">{bypassName(hole.kind)}</PropertyRow>
        <LinkRow label="System" title="Open the system's page" onOpen={() => openSystem(system)}>
          {systemName(system)}
        </LinkRow>
        {partner !== null && (
          <LinkRow
            label="Leads to"
            title="Open the system at the other end"
            onOpen={() => openSystem(partner)}
          >
            {systemName(partner)}
          </LinkRow>
        )}
        {!movable && <PropertyRow label="Distance">{rounded(radius)}</PropertyRow>}
        {!movable && <PropertyRow label="Angle">{`${Math.round(angle) % 360}°`}</PropertyRow>}
        <PropertyRow label="Bypass">#{hole.bypass}</PropertyRow>
      </Properties>
      {!movable && hole.kind !== "wormhole" && (
        <div className="muted ins-hint">{GEOMETRY_REASONS.lockedWormhole}</div>
      )}
      {movable && <EditKey />}
    </>
  );
}

/** A wormhole: its own Overview page, and the generic entity view on every other tab. */
export function WormholeView({ entry }: { entry: Entry }) {
  const tab = useInspectorStore((s) => s.tab);
  if (tab !== "overview" || entry.ref.kind !== "wormhole") return <EntityView entry={entry} />;
  return <WormholeOverview system={entry.ref.system} id={entry.ref.id} label={entry.label} />;
}
