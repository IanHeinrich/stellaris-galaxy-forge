import { useEffect, useState } from "react";
import type { WormholeSummary } from "../../../generated/WormholeSummary";
import { bypassIconKey } from "../../../lib/details/icons";
import { bypassName, wormholePlateName } from "../../../lib/details/labels";
import {
  GEOMETRY_REASONS,
  wormholeFieldIntent,
  wormholePlace,
} from "../../../lib/details/orbitEdits";
import { openSystem } from "../../../store/commands";
import { useDetailsStore } from "../../../store/detailsStore";
import { useGalaxyStore } from "../../../store/galaxyStore";
import { useGameDataStore } from "../../../store/gameDataStore";
import { useInspectorStore, type Entry } from "../../../store/inspectorStore";
import { applyGeometryFrom, useSystemGeometry } from "../../../store/systemGeometry";
import { EditBlock, EditKey, EditNote, EditRow, TextField } from "../../EditField";
import { Icon } from "../../parts";
import { Empty, LinkRow, Properties, PropertyRow } from "../parts";
import { EntityView } from "./EntityView";
import "./entity.css";

function rounded(value: number): number {
  return Math.round(value * 100) / 100;
}

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
  const [refusal, setRefusal] = useState<string | null>(null);
  const { radius, angle } = wormholePlace(hole);
  const commit = (field: "radius" | "angle", typed: number) => {
    setRefusal(null);
    void applyGeometryFrom(
      system,
      ({ frame }) => {
        const now = frame.details?.wormholes.find((w) => w.id === hole.id);
        return now ? wormholeFieldIntent(system, now, field, typed) : null;
      },
      setRefusal,
    );
  };
  return (
    <EditBlock title="Position">
      <EditRow label="Distance">
        <TextField
          kind="number"
          label="Distance"
          title="How far it stands from the star"
          value={rounded(radius)}
          onCommit={(typed) => commit("radius", typed)}
        />
      </EditRow>
      <EditRow label="Angle">
        <TextField
          kind="number"
          label="Angle"
          title="Where it stands about the star, in degrees"
          value={rounded(angle)}
          display={String(Math.round(angle) % 360)}
          onCommit={(typed) => commit("angle", typed)}
        />
      </EditRow>
      {refusal !== null && (
        <EditNote>
          <span className="warn">{refusal}</span>
        </EditNote>
      )}
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
