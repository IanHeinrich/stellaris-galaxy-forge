/** The Open screen's view model: its sections and rows, as pure functions of what it has read. */
import type { CampaignListing } from "../generated/CampaignListing";
import type { PaintModView } from "../generated/PaintModView";
import type { SaveFile } from "../generated/SaveFile";
import type { ScenarioListing } from "../generated/ScenarioListing";
import type { ScenarioSource } from "../generated/ScenarioSource";
import type { OpenMode } from "../store/fileSessionStore";
import type { RecentDoc } from "../store/recentsStore";
import { displayName } from "./names";
import { scenarioForPaint } from "./paint";
import { fileName } from "./paths";

export type SectionId = "recent" | "saves" | "scenarios";

/** What the rail filters the list to: one section, or every one of them. */
export type OpenTab = "all" | SectionId;

export const OPEN_TABS: OpenTab[] = ["all", "recent", "saves", "scenarios"];

const TAB_LABEL: Record<OpenTab, string> = {
  all: "All",
  recent: "Recent",
  saves: "Saves",
  scenarios: "Scenarios",
};

export interface RecentRow {
  kind: "recent";
  key: string;
  doc: RecentDoc;
  /** The file was gone the last time it was asked for. */
  missing: boolean;
}

export interface CampaignRow {
  kind: "campaign";
  key: string;
  campaign: CampaignListing;
  /** The empire of the newest save, localised, else the folder's name. */
  empire: string;
  /** "v4.4.6 · 2206.11.16", from the newest save's header. */
  subtitle: string;
  /** "3 saves". */
  count: string;
  expanded: boolean;
  loading: boolean;
  error: string | null;
}

export interface SaveRow {
  kind: "save";
  key: string;
  file: SaveFile;
  /** Localised empire name; null when the header could not be read. */
  empire: string | null;
  /** The in-game date, else the file name when the header could not be read. */
  title: string;
  autosave: boolean;
}

export interface ScenarioRow {
  kind: "scenario";
  key: string;
  listing: ScenarioListing;
  /** The heading this row sits under: where the file came from. */
  group: string;
  /** "100 systems · A Mod". */
  subtitle: string;
  /** The file could not be read as a scenario, so it cannot be opened. */
  disabled: boolean;
}

export type Row = RecentRow | CampaignRow | SaveRow | ScenarioRow;

export interface Section {
  id: SectionId;
  label: string;
  rows: Row[];
  /** What the rail counts for it: documents, so a campaign counts its saves. */
  count: number;
  /** What the section says instead of rows: an error, or that it is still reading. */
  note: string | null;
  /** A line each for what went wrong beside the rows, which are listed all the same. */
  notices: string[];
}

export interface Tab {
  id: OpenTab;
  label: string;
  count: number;
}

export interface OpenLists {
  filter: string;
  tab: OpenTab;
  /** Null until the campaign folders have been read. */
  campaigns: CampaignListing[] | null;
  campaignsError: string | null;
  scenarios: ScenarioListing[] | null;
  scenariosError: string | null;
  /** What the mod descriptors behind the scenario list could not tell us. */
  scenarioNotices: string[];
  /** The saves of each campaign folder that has been expanded, by folder. */
  files: Record<string, SaveFile[]>;
  fileErrors: Record<string, string>;
  /** The one expanded campaign folder. */
  expanded: string | null;
  /** The campaign folder whose saves are being read. */
  loadingDir: string | null;
  /** Recently opened paths that were not there when they were last asked for. */
  missing: string[];
}

/** "1 save", "3 saves". */
export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** The trailing word of a game version string, `"Pegasus v4.4.6"` -> `"v4.4.6"`. */
function versionShort(version: string): string {
  const parts = version.trim().split(/\s+/);
  return parts[parts.length - 1] ?? "";
}

function haystack(fields: Array<string | null | undefined>): string {
  return fields.filter(Boolean).join(" ").toLowerCase();
}

/** Every word of the filter has to be somewhere in the row's text. */
function matches(words: string[], text: string): boolean {
  return words.every((word) => text.includes(word));
}

function saveText(file: SaveFile, empire: string | null): string {
  return haystack([file.file_name, file.campaign, empire, file.meta?.date, file.meta?.version]);
}

function empireOf(meta: { name: string } | null): string | null {
  return meta ? displayName(meta.name) : null;
}

function saveRow(file: SaveFile): SaveRow {
  return {
    kind: "save",
    key: `save:${file.path}`,
    file,
    empire: empireOf(file.meta),
    title: file.meta?.date || file.file_name,
    autosave: file.file_name.toLowerCase().startsWith("autosave"),
  };
}

function recentSection(state: OpenLists, recents: RecentDoc[], words: string[]): Section {
  const rows: Row[] = [...recents]
    .sort((a, b) => b.openedAt - a.openedAt)
    .filter((doc) => matches(words, haystack([doc.title, doc.subtitle, fileName(doc.path)])))
    .map((doc) => ({
      kind: "recent" as const,
      key: `recent:${doc.path}`,
      doc,
      missing: state.missing.includes(doc.path),
    }));
  return {
    id: "recent",
    label: "Recent",
    rows,
    count: rows.length,
    note: recents.length === 0 ? "Nothing opened yet." : null,
    notices: [],
  };
}

function savesSection(state: OpenLists, words: string[]): Section {
  const rows: Row[] = [];
  let count = 0;
  for (const campaign of state.campaigns ?? []) {
    const empire = campaign.empire ? displayName(campaign.empire) : campaign.name;
    const self = matches(words, haystack([campaign.name, empire, campaign.dir]));
    const files = state.files[campaign.dir];
    const shown = (files ?? []).filter(
      (file) => self || matches(words, saveText(file, empireOf(file.meta))),
    );
    if (!self && shown.length === 0 && words.length > 0) continue;
    count += self ? campaign.files : shown.length;
    const expanded = self || words.length === 0 ? state.expanded === campaign.dir : true;
    const meta = campaign.meta;
    rows.push({
      kind: "campaign",
      key: `campaign:${campaign.dir}`,
      campaign,
      empire,
      subtitle: meta ? [versionShort(meta.version), meta.date].filter(Boolean).join(" · ") : "",
      count: plural(campaign.files, "save"),
      expanded,
      loading: state.loadingDir === campaign.dir,
      error: state.fileErrors[campaign.dir] ?? null,
    });
    if (!expanded) continue;
    for (const file of shown) rows.push(saveRow(file));
  }
  return {
    id: "saves",
    label: "Saves",
    rows,
    count,
    notices: [],
    note: state.campaignsError
      ? `Could not list saves: ${state.campaignsError}`
      : state.campaigns === null
        ? "Finding saves…"
        : state.campaigns.length === 0
          ? "No saves found."
          : null,
  };
}

const SOURCE_ORDER: ScenarioSource[] = ["user_mod", "mod", "install"];

const SOURCE_LABEL: Record<ScenarioSource, string> = {
  user_mod: "My mods",
  mod: "Workshop mods",
  install: "Install",
};

/** Workshop scenarios the playset leaves out come after the ones it carries. */
function inGroup(source: ScenarioSource, a: ScenarioListing, b: ScenarioListing): number {
  if (source === "mod" && a.enabled !== b.enabled) return a.enabled ? -1 : 1;
  return a.name.localeCompare(b.name);
}

function scenariosSection(state: OpenLists, words: string[]): Section {
  const shown = (state.scenarios ?? []).filter((s) =>
    matches(words, haystack([s.name, s.mod_name, fileName(s.path)])),
  );
  const rows: Row[] = [];
  for (const source of SOURCE_ORDER) {
    const group = shown.filter((s) => s.source === source).sort((a, b) => inGroup(source, a, b));
    for (const listing of group) {
      rows.push({
        kind: "scenario",
        key: `scenario:${listing.path}`,
        listing,
        group: SOURCE_LABEL[source],
        subtitle: `${plural(listing.systems, "system")} · ${listing.mod_name ?? "Stellaris"}`,
        disabled: listing.error !== null,
      });
    }
  }
  return {
    id: "scenarios",
    label: "Scenarios",
    rows,
    count: rows.length,
    notices: state.scenarioNotices,
    note: state.scenariosError
      ? `Could not list scenarios: ${state.scenariosError}`
      : state.scenarios === null
        ? "Finding scenarios…"
        : null,
  };
}

function everySection(state: OpenLists, recents: RecentDoc[]): Section[] {
  const words = state.filter.toLowerCase().split(/\s+/).filter(Boolean);
  return [
    recentSection(state, recents, words),
    savesSection(state, words),
    scenariosSection(state, words),
  ];
}

/** What the chosen tab lists, in order, with the filter applied; All leaves out an empty Recent. */
export function openSections(state: OpenLists, recents: RecentDoc[]): Section[] {
  const all = everySection(state, recents);
  if (state.tab !== "all") return all.filter((s) => s.id === state.tab);
  return all.filter((s) => s.id !== "recent" || s.rows.length > 0);
}

/** The rail's tabs, each counting what the filter leaves whichever tab is chosen. */
export function openTabs(state: OpenLists, recents: RecentDoc[]): Tab[] {
  const all = everySection(state, recents);
  const count = (id: OpenTab) =>
    all.filter((s) => id === "all" || s.id === id).reduce((sum, s) => sum + s.count, 0);
  return OPEN_TABS.map((id) => ({ id, label: TAB_LABEL[id], count: count(id) }));
}

/** The rows the keyboard walks, in one list across the sections. */
export function navigableRows(sections: Section[]): Row[] {
  return sections.flatMap((section) => section.rows);
}

/** The selected row: the one `key` names while it is still listed, else the first. */
export function selectedRow(rows: Row[], key: string | null): Row | undefined {
  return rows.find((row) => row.key === key) ?? rows[0];
}

/** The key an arrow press moves the selection to, `step` rows on and kept inside the list. */
export function steppedKey(rows: Row[], key: string | null, step: number): string | null {
  const current = selectedRow(rows, key);
  if (!current) return null;
  const at = rows.indexOf(current) + step;
  return rows[Math.min(Math.max(at, 0), rows.length - 1)].key;
}

/** What one press of the pointer on a row does. */
export interface Press {
  /** The row it selects. */
  select: string | null;
  /** The campaign folder it opens or closes. */
  toggle: string | null;
  /** The row it opens. */
  activate: Row | null;
}

/**
 * A press on `row`, the `detail`th of its click gesture. The first press selects the row and
 * toggles a campaign; the second opens the row the first one selected, which a campaign never
 * is, so a double-click on a campaign toggles it once and never opens a row the toggle moved
 * under the pointer.
 */
export function pressRow(rows: Row[], row: Row, detail: number, firstKey: string | null): Press {
  if (detail <= 1) {
    const toggle = row.kind === "campaign" ? row.campaign.dir : null;
    return { select: row.key, toggle, activate: null };
  }
  const first = detail === 2 ? rows.find((r) => r.key === firstKey) : undefined;
  return {
    select: null,
    toggle: null,
    activate: first && first.kind !== "campaign" ? first : null,
  };
}

/** What a recent document is on this machine now: a listed save or scenario, else unknown. */
export type RecentTarget =
  | { kind: "save"; file: SaveFile }
  | { kind: "scenario"; listing: ScenarioListing; group: string }
  | null;

export function recentTarget(doc: RecentDoc, state: OpenLists): RecentTarget {
  if (doc.kind === "save") {
    for (const files of Object.values(state.files)) {
      const file = files.find((f) => f.path === doc.path);
      if (file) return { kind: "save", file };
    }
    return null;
  }
  const listing = state.scenarios?.find((s) => s.path === doc.path);
  return listing ? { kind: "scenario", listing, group: SOURCE_LABEL[listing.source] } : null;
}

/** The save whose galaxy settings the details pane shows for `row`, when its path is known. */
export function detailsSave(row: Row | undefined, state: OpenLists): SaveFile | null {
  switch (row?.kind) {
    case "save":
      return row.file;
    case "campaign":
      return state.files[row.campaign.dir]?.[0] ?? null;
    case "recent": {
      const target = recentTarget(row.doc, state);
      return target?.kind === "save" ? target.file : null;
    }
    default:
      return null;
  }
}

export interface FooterOpen {
  path: string;
  mode: OpenMode;
}

export interface FooterTargets {
  open: FooterOpen | null;
  asScenario: FooterOpen | null;
  /** A scenario file that isn't already for Paint a Galaxy, to open for the mod. */
  forPaint: string | null;
}

/**
 * What the footer's buttons open for the selected row. Open takes a file as it is, a
 * campaign's newest save once its saves are read; "Open as scenario" is there for a save, and
 * "Open for Paint a Galaxy" for a scenario that isn't for the mod already.
 */
export function footerOpens(
  row: Row | undefined,
  lists: OpenLists,
  paintMod: PaintModView | null = null,
): FooterTargets {
  const targets = baseFooterOpens(row, lists);
  const path = targets.open?.path ?? null;
  const listings = row?.kind === "scenario" ? [row.listing] : lists.scenarios;
  const scenario =
    row?.kind === "scenario" || (row?.kind === "recent" && row.doc.kind === "scenario");
  const forPaint =
    scenario && path !== null && scenarioForPaint(path, listings, paintMod) !== true ? path : null;
  return { ...targets, forPaint };
}

function baseFooterOpens(
  row: Row | undefined,
  lists: OpenLists,
): { open: FooterOpen | null; asScenario: FooterOpen | null } {
  const as = (path: string | null | undefined, mode: OpenMode) => (path ? { path, mode } : null);
  switch (row?.kind) {
    case "save":
      return { open: as(row.file.path, "save"), asScenario: as(row.file.path, "scenario") };
    case "recent": {
      const save = row.doc.kind === "save";
      return {
        open: as(row.doc.path, "save"),
        asScenario: save ? as(row.doc.path, "scenario") : null,
      };
    }
    case "campaign":
      return { open: as(detailsSave(row, lists)?.path, "save"), asScenario: null };
    case "scenario":
      return { open: row.disabled ? null : as(row.listing.path, "save"), asScenario: null };
    default:
      return { open: null, asScenario: null };
  }
}
