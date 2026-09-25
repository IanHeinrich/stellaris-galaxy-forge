import { useMemo, type ReactNode } from "react";
import type { InitializerView } from "../../generated/InitializerView";
import { initializerTotals } from "../../lib/initializer/initializerBrowser";
import {
  describeInitializer,
  isEmpireSpawn,
  relativeSource,
} from "../../lib/initializer/initializerGroups";
import { displayName } from "../../lib/names";
import { resourceSprite } from "../../lib/resources";
import { counted } from "../../lib/text";
import { useDetailsStore } from "../../store/detailsStore";
import { useGameDataStore } from "../../store/gameDataStore";
import { useInitializerBrowserStore } from "../../store/initializerBrowserStore";
import { useNamed } from "../useNamed";
import { InitializerSpawn } from "../inspector/system/sections/scenario/Initializer";
import { Pills } from "../inspector/system/sections/bodies";
import { entryLabel, nameKeysOf } from "./rows";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="ib-fact">
      <span className="k">{label}</span>
      <span>{children}</span>
    </div>
  );
}

/** The weight an empire spawn is written with, which is the only number the browser sets. */
function SpawnWeight() {
  const spawnWeight = useInitializerBrowserStore((s) => s.spawnWeight);
  const setSpawnWeight = useInitializerBrowserStore((s) => s.setSpawnWeight);
  return (
    <div className="ib-weight">
      <span>
        Empire spawn — writes <span className="mono">spawn_weight = &#123; base = N &#125;</span>
      </span>
      <input
        type="number"
        min={0}
        step={1}
        aria-label="Spawn weight"
        value={spawnWeight ?? 1}
        onChange={(e) => {
          const value = Number(e.currentTarget.value);
          setSpawnWeight(Number.isFinite(value) ? value : null);
        }}
      />
    </div>
  );
}

/** What the highlighted initializer is and spawns, down to the resources its bodies carry. */
export function Detail({ entry, uses }: { entry: InitializerView | null; uses: number }) {
  const names = useGameDataStore((s) => s.names);
  const summary = useGameDataStore((s) => s.summary);
  const deposits = useGameDataStore((s) => s.deposits);
  const icons = useDetailsStore((s) => s.resourceIcons);

  useNamed(entry === null ? [] : nameKeysOf(entry));

  const totals = useMemo(
    () =>
      entry === null
        ? []
        : initializerTotals(entry, deposits).map(([resource, amount]) => ({
            resource,
            amount,
            sprite: resourceSprite(resource, icons),
          })),
    [entry, deposits, icons],
  );

  if (entry === null) {
    return (
      <div className="ib-detail">
        <div className="ib-detail-head">
          <div className="ib-detail-name">Random</div>
          <div className="muted mono">no initializer</div>
        </div>
        <div className="muted">The game picks what the system holds when the galaxy is built.</div>
      </div>
    );
  }

  const about = describeInitializer(entry);
  const label = entryLabel(entry, names);
  const roots = [summary?.install ?? "", ...(summary?.mods ?? []).map((m) => m.dir ?? "")];
  return (
    <div className="ib-detail">
      <div className="ib-detail-head">
        <div className="ib-detail-name">{label ?? entry.name}</div>
        <div className="muted mono">{entry.name}</div>
      </div>
      <InitializerSpawn name={entry.name} />
      {totals.length > 0 && (
        <div className="ib-totals">
          <span className="k">Resources</span>
          <span className="rs">
            <Pills rows={totals} />
          </span>
        </div>
      )}
      <div className="ib-facts">
        {about.countries.length > 0 && (
          <Row label="Spawns">
            {about.countries.map((country, i) => (
              <span key={`${country.name_key}-${i}`} className="ib-country">
                {displayName(country.name_key)}{" "}
                <span className="muted">{country.country_type}</span>
              </span>
            ))}
          </Row>
        )}
        {about.usage !== null && <Row label="Usage">{about.usage}</Row>}
        {about.maxInstances !== null && <Row label="Max instances">{about.maxInstances}</Row>}
        {about.flags.length > 0 && (
          <Row label="Flags">
            <span className="mono">{about.flags.join(" ")}</span>
          </Row>
        )}
        {entry.spawns.length > 0 && (
          <Row label="Neighbours">
            <span className="mono">{entry.spawns.join(" ")}</span>
          </Row>
        )}
        <Row label="Source">
          <span className="mono">{relativeSource(about.source, roots)}</span>
        </Row>
        <Row label="In use">
          {uses === 0
            ? "No system in this document uses it"
            : `${counted(uses, "system")} in this document use it`}
        </Row>
      </div>
      {isEmpireSpawn(entry) && <SpawnWeight />}
    </div>
  );
}
