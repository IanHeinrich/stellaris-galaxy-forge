import { useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import type { CampaignListing } from "../../generated/CampaignListing";
import type { EmpireCount } from "../../generated/EmpireCount";
import type { GalaxySettings } from "../../generated/GalaxySettings";
import type { SaveFile } from "../../generated/SaveFile";
import type { SaveMeta } from "../../generated/SaveMeta";
import type { ScenarioListing } from "../../generated/ScenarioListing";
import { displayNameIn, readableKey } from "../../lib/names";
import { countText, rangeText, recentTarget, timesText, type Row } from "../../lib/openRows";
import { PAINT_MOD_OFF_BREAKS, SCENARIO_FOR_PAINT, SCENARIO_PLAIN } from "../../lib/paintCopy";
import { fileName, folderOf } from "../../lib/paths";
import { CLOUD_TITLE } from "../../lib/sessionCopy";
import { counted, formatSize, formatWhen } from "../../lib/text";
import { versionNumber } from "../../lib/version";
import { useGameDataStore } from "../../store/gameDataStore";
import { detailsKey, useOpenScreenStore } from "../../store/openScreenStore";
import { usePaintModStore } from "../../store/paintModStore";
import type { RecentDoc } from "../../store/recentsStore";
import { useNamed } from "../useNamed";
import { EmpireMark, IRONMAN_TITLE } from "./OpenRows";
import { useForPaint } from "./useForPaint";

/** The first year of every game; the galaxy block states mid and end game as years after it. */
const START_YEAR = 2200;

const DLC_SHOWN = 5;

/** The same fact in the pane, and a warning while the mod the scenario is for is off. */
function PaintFact({
  path,
  listings,
}: {
  path: string;
  listings: readonly ScenarioListing[] | null;
}) {
  const forPaint = useForPaint(path, listings);
  const modOff = usePaintModStore((s) => s.known && !s.paintMod?.enabled);
  if (forPaint === null) return null;
  return (
    <>
      <div className="od-soft">{(forPaint ? SCENARIO_FOR_PAINT : SCENARIO_PLAIN).line}</div>
      {forPaint && modOff && <Warning>{PAINT_MOD_OFF_BREAKS}</Warning>}
    </>
  );
}

type Fact = [label: string, value: ReactNode | null | undefined];

/** The last two rows of every File block: the file's name and the folder it sits in. */
function whereFacts(path: string): Fact[] {
  return [
    ["File", fileName(path)],
    ["Folder", folderOf(path)],
  ];
}

function Facts({ facts }: { facts: Fact[] }) {
  const shown = facts.filter(([, value]) => value !== null && value !== undefined && value !== "");
  if (shown.length === 0) return null;
  return (
    <dl className="od-facts">
      {shown.map(([label, value]) => (
        <div key={label} className="od-fact">
          <dt>{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="od-block">
      <h3>{title}</h3>
      {children}
    </section>
  );
}

function Warning({ children }: { children: ReactNode }) {
  return <p className="od-warn">{children}</p>;
}

function VersionBadge({ version }: { version: string }) {
  const installed = useGameDataStore((s) => (s.status === "ready" ? s.summary?.version : null));
  const theirs = versionNumber(version);
  const ours = installed ? versionNumber(installed) : null;
  if (!theirs || !ours) return null;
  const same = theirs === ours;
  return (
    <span
      className={same ? "od-badge" : "od-badge differs"}
      title={`The game data is ${installed}`}
    >
      {same ? "matches install" : "differs from install"}
    </span>
  );
}

function MetaHead({ meta, fallback }: { meta: SaveMeta | null; fallback: string }) {
  const label = useNamed(meta?.portrait ? [meta.portrait] : [], readableKey);
  const names = useGameDataStore((s) => s.names);
  return (
    <header className="od-head">
      <div className="od-name">
        <span className="od-mark">
          <EmpireMark meta={meta} size="large" />
        </span>
        <span>{meta ? displayNameIn(names, meta.name) : fallback}</span>
      </div>
      {meta?.portrait && <div className="od-soft">{label(meta.portrait)}</div>}
      {meta?.date && <div className="od-date">{meta.date}</div>}
      {meta?.version && (
        <div className="od-version">
          <span>
            {meta.version}
            {meta.version_revision !== null && ` · rev ${meta.version_revision}`}
          </span>
          <VersionBadge version={meta.version} />
        </div>
      )}
      {meta && (
        <Facts
          facts={[
            ["Planets", meta.planets === null ? null : counted(meta.planets, "planet")],
            ["Fleets", meta.fleets === null ? null : counted(meta.fleets, "fleet")],
          ]}
        />
      )}
      {!meta && <div className="od-soft">The save's header could not be read.</div>}
    </header>
  );
}

function GalaxyFacts({ settings }: { settings: GalaxySettings }) {
  const label = useNamed([settings.template ?? "", settings.shape ?? ""], readableKey);
  const key = (k: string | null) => (k === null ? null : label(k));
  return (
    <Facts
      facts={[
        ["Size", key(settings.template)],
        ["Shape", key(settings.shape)],
        ["AI empires", countText(settings.num_empires)],
        ["Advanced", countText(settings.num_advanced_empires)],
        ["Fallen", countText(settings.num_fallen_empires)],
        ["Marauders", countText(settings.num_marauder_empires)],
        ["Nomads", countText(settings.num_nomad_empires)],
        ["Gateways", timesText(settings.num_gateways)],
        ["Wormholes", timesText(settings.num_wormhole_pairs)],
        ["Hyperlanes", timesText(settings.num_hyperlanes)],
        ["Habitable", timesText(settings.habitability)],
        ["Primitives", timesText(settings.primitive)],
      ]}
    />
  );
}

function RulesFacts({ settings }: { settings: GalaxySettings }) {
  const label = useNamed([settings.difficulty ?? "", settings.scaling ?? ""], readableKey);
  const key = (k: string | null) => (k === null ? null : label(k));
  const year = (n: number | null) => (n === null ? null : String(START_YEAR + n));
  const crisis = [key(settings.crisis_type), timesText(settings.crises)]
    .filter(Boolean)
    .join(" · ");
  return (
    <Facts
      facts={[
        ["Difficulty", key(settings.difficulty)],
        ["Scaling", key(settings.scaling)],
        ["Crisis", crisis],
        ["Mid game", year(settings.mid_game_start)],
        ["End game", year(settings.end_game_start)],
        ["Ironman", settings.ironman === null ? null : settings.ironman ? "Yes" : "No"],
      ]}
    />
  );
}

/** The galaxy and rules blocks, read from the save when it is shown. */
function SettingsBlocks({ file }: { file: SaveFile }) {
  const details = useOpenScreenStore((s) => s.details[detailsKey(file.path, file.modified)]);
  if (details?.status === "ready") {
    return (
      <>
        <Block title="Galaxy">
          <GalaxyFacts settings={details.settings} />
        </Block>
        <Block title="Rules">
          <RulesFacts settings={details.settings} />
        </Block>
      </>
    );
  }
  const line =
    details?.status === "error"
      ? `Could not read the galaxy settings: ${details.message}`
      : "Reading the galaxy settings…";
  return (
    <Block title="Galaxy">
      <p className={details?.status === "error" ? "od-warn" : "od-soft"}>{line}</p>
    </Block>
  );
}

function RequiredDlc({ dlcs }: { dlcs: string[] }) {
  const [all, setAll] = useState(false);
  if (dlcs.length === 0) return null;
  const shown = all ? dlcs : dlcs.slice(0, DLC_SHOWN);
  const hidden = dlcs.length - DLC_SHOWN;
  return (
    <Block title={`Required DLC · ${dlcs.length}`}>
      <div className="od-tags">
        {shown.map((dlc) => (
          <span key={dlc} className="od-tag">
            {dlc}
          </span>
        ))}
        {hidden > 0 && (
          <button
            type="button"
            className="od-tag od-more"
            title={all ? `Show the first ${DLC_SHOWN}` : "Show every DLC the save requires"}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setAll(!all)}
          >
            {all ? "fewer" : `+${hidden}`}
          </button>
        )}
      </div>
    </Block>
  );
}

function SaveDetails({ file }: { file: SaveFile }) {
  const meta = file.meta;
  return (
    <>
      <MetaHead meta={meta} fallback={file.file_name} />
      {file.cloud && <Warning>{CLOUD_TITLE}</Warning>}
      {meta?.ironman && <Warning>{IRONMAN_TITLE}</Warning>}
      {meta && <SettingsBlocks file={file} />}
      <RequiredDlc key={file.path} dlcs={meta?.required_dlcs ?? []} />
      <Block title="File">
        <Facts
          facts={[
            ["Saved", formatWhen(file.modified)],
            ["Size", formatSize(file.size)],
            ...whereFacts(file.path),
          ]}
        />
      </Block>
    </>
  );
}

/** The earliest and latest in-game dates among the saves read so far. */
function dateRange(files: SaveFile[]): string | null {
  const dates = files.flatMap((f) => (f.meta?.date ? [f.meta.date] : [])).sort();
  if (dates.length === 0) return null;
  const first = dates[0];
  const last = dates[dates.length - 1];
  return first === last ? first : `${first} – ${last}`;
}

function CampaignDetails({ campaign, empire }: { campaign: CampaignListing; empire: string }) {
  const files = useOpenScreenStore((s) => s.files[campaign.dir]);
  const newest = files?.[0];
  return (
    <>
      <MetaHead meta={campaign.meta} fallback={empire} />
      {campaign.cloud && <Warning>{CLOUD_TITLE}</Warning>}
      <Block title="Campaign">
        <Facts
          facts={[
            ["Saves", counted(campaign.files, "save")],
            ["Dates", files ? dateRange(files) : null],
            ["Last saved", formatWhen(campaign.newest)],
          ]}
        />
      </Block>
      {newest?.meta && <SettingsBlocks file={newest} />}
      <RequiredDlc key={campaign.dir} dlcs={campaign.meta?.required_dlcs ?? []} />
      <Block title="Folder">
        <Facts
          facts={[
            ["Name", campaign.name],
            ["Path", campaign.dir],
          ]}
        />
      </Block>
    </>
  );
}

type EmpireKind =
  "empires" | "advanced_empires" | "fallen_empires" | "marauder_empires" | "nomad_empires";

const EMPIRE_KINDS: Array<[string, EmpireKind]> = [
  ["Empires", "empires"],
  ["Advanced", "advanced_empires"],
  ["Fallen", "fallen_empires"],
  ["Marauders", "marauder_empires"],
  ["Nomads", "nomad_empires"],
];

function EmpireTable({ listing }: { listing: ScenarioListing }) {
  const rows = EMPIRE_KINDS.map(([label, key]): [string, EmpireCount] => [
    label,
    listing.summary[key],
  ]).filter(([, c]) => c.default !== null || c.max !== null);
  if (rows.length === 0) return null;
  return (
    <Block title="Empires">
      <table className="od-table">
        <thead>
          <tr>
            <th />
            <th>Default</th>
            <th>Up to</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, c]) => (
            <tr key={label}>
              <th>{label}</th>
              <td>{c.default ?? "–"}</td>
              <td>{c.max ?? "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Block>
  );
}

function ScenarioDetails({ listing, group }: { listing: ScenarioListing; group: string }) {
  const summary = listing.summary;
  const label = useNamed(summary.supports_shape, readableKey);
  const playset =
    listing.source !== "mod" ? null : listing.enabled ? "In the playset" : "Not in the playset";
  return (
    <>
      <header className="od-head">
        <div className="od-name">
          <span>{listing.name}</span>
        </div>
        <div className="od-soft">
          {listing.mod_name ?? "Stellaris"} · {group}
        </div>
        {playset && <div className="od-soft">{playset}</div>}
        <PaintFact path={listing.path} listings={[listing]} />
      </header>
      {listing.error && <Warning>{listing.error}</Warning>}
      {listing.shadowed_by && (
        <Warning>The game reads {listing.shadowed_by}'s file of this name instead.</Warning>
      )}
      <Block title="Scenario">
        <Facts
          facts={[
            ["Systems", counted(listing.systems, "system")],
            ["Radius", countText(summary.radius)],
            ["Core radius", countText(summary.core_radius)],
            ["Shapes", summary.supports_shape.map(label).join(", ")],
          ]}
        />
      </Block>
      <EmpireTable listing={listing} />
      <Block title="Galaxy">
        <Facts
          facts={[
            ["Habitable", timesText(summary.colonizable_planet_odds)],
            ["Primitives", timesText(summary.primitive_odds)],
            ["Gateways", rangeText(summary.num_gateways)],
            ["Wormholes", rangeText(summary.num_wormhole_pairs)],
            ["Nebulas", rangeText(summary.num_nebulas)],
            ["Hyperlanes", rangeText(summary.num_hyperlanes)],
            ["Crisis", timesText(summary.crisis_strength)],
          ]}
        />
      </Block>
      <Block title="File">
        <Facts
          facts={[
            ["Modified", formatWhen(listing.modified)],
            ["Size", formatSize(listing.size)],
            ...whereFacts(listing.path),
          ]}
        />
      </Block>
    </>
  );
}

function RecentDetails({ doc, missing }: { doc: RecentDoc; missing: boolean }) {
  const lists = useOpenScreenStore(useShallow((s) => ({ files: s.files, scenarios: s.scenarios })));
  const target = recentTarget(doc, lists);
  if (target?.kind === "save") return <SaveDetails file={target.file} />;
  if (target?.kind === "scenario") return <ScenarioDetails {...target} />;
  return (
    <>
      <header className="od-head">
        <div className="od-name">
          <span>{doc.title}</span>
        </div>
        {doc.subtitle && <div className="od-soft">{doc.subtitle}</div>}
        {doc.kind === "scenario" && <PaintFact path={doc.path} listings={null} />}
      </header>
      {missing && <Warning>The file was not found the last time it was opened.</Warning>}
      <Block title="File">
        <Facts
          facts={[
            ["Kind", doc.kind === "save" ? "Save" : "Scenario"],
            ["Opened", formatWhen(doc.openedAt / 1000)],
            ...whereFacts(doc.path),
          ]}
        />
      </Block>
    </>
  );
}

function RowDetails({ row }: { row: Row }) {
  switch (row.kind) {
    case "save":
      return <SaveDetails file={row.file} />;
    case "campaign":
      return <CampaignDetails campaign={row.campaign} empire={row.empire} />;
    case "scenario":
      return <ScenarioDetails listing={row.listing} group={row.group} />;
    case "recent":
      return <RecentDetails doc={row.doc} missing={row.missing} />;
  }
}

/** What the selected row is, at more length than its row has room for. */
export function OpenDetails({ row }: { row: Row | undefined }) {
  return (
    <aside className="open-details" aria-label="Details">
      {row ? <RowDetails row={row} /> : <p className="od-soft">Nothing selected.</p>}
    </aside>
  );
}
