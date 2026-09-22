import { useEffect, useState, type ReactNode } from "react";
import type { CampaignListing } from "../../generated/CampaignListing";
import type { EmpireCount } from "../../generated/EmpireCount";
import type { GalaxySettings } from "../../generated/GalaxySettings";
import type { SaveFile } from "../../generated/SaveFile";
import type { SaveMeta } from "../../generated/SaveMeta";
import type { ScenarioListing } from "../../generated/ScenarioListing";
import type { Setting } from "../../generated/Setting";
import { saveFlagKey } from "../../lib/flagKey";
import { displayNameIn, stripped, type Names } from "../../lib/names";
import { plural, recentTarget, type Row } from "../../lib/openRows";
import { fileName } from "../../lib/paths";
import { useGameDataStore } from "../../store/gameDataStore";
import { detailsKey, useOpenScreenStore } from "../../store/openScreenStore";
import type { RecentDoc } from "../../store/recentsStore";
import { useTextureUrl } from "../useTextureUrl";
import { formatSize, formatWhen } from "./launchData";

export const CLOUD_TITLE =
  "In Steam's cloud folder: Steam can overwrite an edited file with its cloud copy. " +
  "Close Steam or disable Steam Cloud for Stellaris before playing it.";

export const IRONMAN_TITLE = "Ironman save: the game only loads it in ironman mode.";

/** The first year of every game; the galaxy block states mid and end game as years after it. */
const START_YEAR = 2200;

const DLC_SHOWN = 5;

/** The empire's own colour, when game data knows the key the header names. */
function EmpireDot({ meta }: { meta: SaveMeta | null }) {
  const mapColors = useGameDataStore((s) => s.mapColors);
  const color = meta?.color ? mapColors.get(meta.color)?.flag : undefined;
  if (!color) return null;
  return <span className="dot" style={{ background: color }} />;
}

/** The empire's flag once game data has drawn it, its colour until then. */
export function EmpireMark({ meta, size }: { meta: SaveMeta | null; size: "row" | "large" }) {
  const key = saveFlagKey(meta);
  const url = useTextureUrl(key === null ? [] : [key]);
  if (url === undefined) return <EmpireDot meta={meta} />;
  return <img className={`empire-flag ${size}`} src={url} alt="" />;
}

/** The game's text for `key`, else the key made readable. */
function labelIn(names: Names, key: string): string {
  const text = names.get(key);
  if (text) return text;
  const plain = stripped(key);
  return plain.charAt(0).toUpperCase() + plain.slice(1);
}

function useLabel(): (key: string) => string {
  const names = useGameDataStore((s) => s.names);
  return (key) => labelIn(names, key);
}

/** Asks game data for the keys this pane shows, so they read as the game names them. */
function useNameKeys(keys: Array<string | null | undefined>): void {
  const ready = useGameDataStore((s) => s.status === "ready");
  const wanted = keys.filter((k): k is string => Boolean(k)).join("\n");
  useEffect(() => {
    if (ready && wanted) void useGameDataStore.getState().fetchNames(wanted.split("\n"));
  }, [ready, wanted]);
}

function num(n: number): string {
  return String(Number(n.toFixed(2)));
}

function times(n: number | null): string | null {
  return n === null ? null : `${num(n)}×`;
}

function count(n: number | null): string | null {
  return n === null ? null : num(n);
}

function range(setting: Setting | null): string | null {
  if (!setting) return null;
  const { min, max } = setting;
  if (min !== null && max !== null) return min === max ? num(min) : `${num(min)}–${num(max)}`;
  return setting.default === null ? null : num(setting.default);
}

function folderOf(path: string): string {
  return path.slice(0, Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")));
}

/** The number in a version string, `"Cygnus v4.5.0"` -> `"4.5.0"`. */
function versionNumber(version: string): string | null {
  return /\d+(?:\.\d+)+/.exec(version)?.[0] ?? null;
}

type Fact = [label: string, value: ReactNode | null | undefined];

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
  const label = useLabel();
  const names = useGameDataStore((s) => s.names);
  useNameKeys([meta?.portrait]);
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
            ["Planets", meta.planets === null ? null : plural(meta.planets, "planet")],
            ["Fleets", meta.fleets === null ? null : plural(meta.fleets, "fleet")],
          ]}
        />
      )}
      {!meta && <div className="od-soft">The save's header could not be read.</div>}
    </header>
  );
}

function GalaxyFacts({ settings }: { settings: GalaxySettings }) {
  const label = useLabel();
  useNameKeys([settings.template, settings.shape]);
  const key = (k: string | null) => (k === null ? null : label(k));
  return (
    <Facts
      facts={[
        ["Size", key(settings.template)],
        ["Shape", key(settings.shape)],
        ["AI empires", count(settings.num_empires)],
        ["Advanced", count(settings.num_advanced_empires)],
        ["Fallen", count(settings.num_fallen_empires)],
        ["Marauders", count(settings.num_marauder_empires)],
        ["Nomads", count(settings.num_nomad_empires)],
        ["Gateways", times(settings.num_gateways)],
        ["Wormholes", times(settings.num_wormhole_pairs)],
        ["Hyperlanes", times(settings.num_hyperlanes)],
        ["Habitable", times(settings.habitability)],
        ["Primitives", times(settings.primitive)],
      ]}
    />
  );
}

function RulesFacts({ settings }: { settings: GalaxySettings }) {
  const label = useLabel();
  useNameKeys([settings.difficulty, settings.scaling]);
  const key = (k: string | null) => (k === null ? null : label(k));
  const year = (n: number | null) => (n === null ? null : String(START_YEAR + n));
  const crisis = [key(settings.crisis_type), times(settings.crises)].filter(Boolean).join(" · ");
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

function SaveBody({ file }: { file: SaveFile }) {
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
            ["File", file.file_name],
            ["Folder", folderOf(file.path)],
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

function CampaignBody({ campaign, empire }: { campaign: CampaignListing; empire: string }) {
  const files = useOpenScreenStore((s) => s.files[campaign.dir]);
  const newest = files?.[0];
  return (
    <>
      <MetaHead meta={campaign.meta} fallback={empire} />
      {campaign.cloud && <Warning>{CLOUD_TITLE}</Warning>}
      <Block title="Campaign">
        <Facts
          facts={[
            ["Saves", plural(campaign.files, "save")],
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

function ScenarioBody({ listing, group }: { listing: ScenarioListing; group: string }) {
  const label = useLabel();
  const summary = listing.summary;
  useNameKeys(summary.supports_shape);
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
      </header>
      {listing.error && <Warning>{listing.error}</Warning>}
      {listing.shadowed_by && (
        <Warning>The game reads {listing.shadowed_by}'s file of this name instead.</Warning>
      )}
      <Block title="Scenario">
        <Facts
          facts={[
            ["Systems", plural(listing.systems, "system")],
            ["Radius", count(summary.radius)],
            ["Core radius", count(summary.core_radius)],
            ["Shapes", summary.supports_shape.map(label).join(", ")],
          ]}
        />
      </Block>
      <EmpireTable listing={listing} />
      <Block title="Galaxy">
        <Facts
          facts={[
            ["Habitable", times(summary.colonizable_planet_odds)],
            ["Primitives", times(summary.primitive_odds)],
            ["Gateways", range(summary.num_gateways)],
            ["Wormholes", range(summary.num_wormhole_pairs)],
            ["Nebulas", range(summary.num_nebulas)],
            ["Hyperlanes", range(summary.num_hyperlanes)],
            ["Crisis", times(summary.crisis_strength)],
          ]}
        />
      </Block>
      <Block title="File">
        <Facts
          facts={[
            ["Modified", formatWhen(listing.modified)],
            ["Size", formatSize(listing.size)],
            ["File", fileName(listing.path)],
            ["Folder", folderOf(listing.path)],
          ]}
        />
      </Block>
    </>
  );
}

function RecentBody({ doc, missing }: { doc: RecentDoc; missing: boolean }) {
  const target = recentTarget(doc, useOpenScreenStore());
  if (target?.kind === "save") return <SaveBody file={target.file} />;
  if (target?.kind === "scenario") return <ScenarioBody {...target} />;
  return (
    <>
      <header className="od-head">
        <div className="od-name">
          <span>{doc.title}</span>
        </div>
        {doc.subtitle && <div className="od-soft">{doc.subtitle}</div>}
      </header>
      {missing && <Warning>The file was not found the last time it was opened.</Warning>}
      <Block title="File">
        <Facts
          facts={[
            ["Kind", doc.kind === "save" ? "Save" : "Scenario"],
            ["Opened", formatWhen(doc.openedAt / 1000)],
            ["File", fileName(doc.path)],
            ["Folder", folderOf(doc.path)],
          ]}
        />
      </Block>
    </>
  );
}

function Body({ row }: { row: Row }) {
  switch (row.kind) {
    case "save":
      return <SaveBody file={row.file} />;
    case "campaign":
      return <CampaignBody campaign={row.campaign} empire={row.empire} />;
    case "scenario":
      return <ScenarioBody listing={row.listing} group={row.group} />;
    case "recent":
      return <RecentBody doc={row.doc} missing={row.missing} />;
  }
}

/** What the selected row is, at more length than its row has room for. */
export function OpenDetails({ row }: { row: Row | undefined }) {
  return (
    <aside className="open-details" aria-label="Details">
      {row ? <Body row={row} /> : <p className="od-soft">Nothing selected.</p>}
    </aside>
  );
}
