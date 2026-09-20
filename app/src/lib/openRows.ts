/** The Open screen's view model: its sections and rows, as pure functions of what it has read. */
import type { CampaignListing } from "../generated/CampaignListing";
import type { SaveFile } from "../generated/SaveFile";
import type { ScenarioListing } from "../generated/ScenarioListing";
import type { ScenarioSource } from "../generated/ScenarioSource";
import type { RecentDoc } from "../store/recentsStore";
import { displayName } from "./names";
import { fileName } from "./paths";

export type SectionId = "recent" | "saves" | "scenarios";

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
}

export interface ScenarioRow {
  kind: "scenario";
  key: string;
  listing: ScenarioListing;
  /** The heading this row sits under: where the file came from. */
  group: string;
  /** The file could not be read as a scenario, so it cannot be opened. */
  disabled: boolean;
}

export interface ActionRow {
  kind: "browse" | "new-scenario";
  key: string;
}

export type Row = RecentRow | CampaignRow | SaveRow | ScenarioRow | ActionRow;

export interface Section {
  id: SectionId;
  label: string;
  rows: Row[];
  /** What the section says instead of rows: an error, or that it is still reading. */
  note: string | null;
  /** A line each for what went wrong beside the rows, which are listed all the same. */
  notices: string[];
}

export interface OpenLists {
  filter: string;
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
    note: recents.length === 0 ? "Nothing opened yet." : null,
    notices: [],
  };
}

function savesSection(state: OpenLists, words: string[]): Section {
  const rows: Row[] = [];
  for (const campaign of state.campaigns ?? []) {
    const empire = campaign.empire ? displayName(campaign.empire) : campaign.name;
    const self = matches(words, haystack([campaign.name, empire, campaign.dir]));
    const files = state.files[campaign.dir];
    const shown = (files ?? []).filter(
      (file) => self || matches(words, saveText(file, empireOf(file.meta))),
    );
    if (!self && shown.length === 0 && words.length > 0) continue;
    const expanded = self || words.length === 0 ? state.expanded === campaign.dir : true;
    rows.push({
      kind: "campaign",
      key: `campaign:${campaign.dir}`,
      campaign,
      empire,
      expanded,
      loading: state.loadingDir === campaign.dir,
      error: state.fileErrors[campaign.dir] ?? null,
    });
    if (!expanded) continue;
    for (const file of shown) {
      rows.push({ kind: "save", key: `save:${file.path}`, file, empire: empireOf(file.meta) });
    }
  }
  rows.push({ kind: "browse", key: "browse" });
  return {
    id: "saves",
    label: "Saves",
    rows,
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
        disabled: listing.error !== null,
      });
    }
  }
  rows.push({ kind: "new-scenario", key: "new-scenario" });
  return {
    id: "scenarios",
    label: "Scenarios",
    rows,
    notices: state.scenarioNotices,
    note: state.scenariosError
      ? `Could not list scenarios: ${state.scenariosError}`
      : state.scenarios === null
        ? "Finding scenarios…"
        : null,
  };
}

/** Everything the Open screen lists, in the order it lists it, with the filter applied. */
export function openSections(state: OpenLists, recents: RecentDoc[]): Section[] {
  const words = state.filter.toLowerCase().split(/\s+/).filter(Boolean);
  return [
    recentSection(state, recents, words),
    savesSection(state, words),
    scenariosSection(state, words),
  ];
}

/** What a section says it holds: its documents, not the actions at its foot. */
export function sectionCount(section: Section): number {
  return section.rows.filter((row) => row.kind !== "browse" && row.kind !== "new-scenario").length;
}

/** The rows the keyboard walks, in one list across the sections. */
export function navigableRows(sections: Section[]): Row[] {
  return sections.flatMap((section) => section.rows);
}
