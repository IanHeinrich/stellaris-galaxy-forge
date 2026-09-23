import type { CampaignListing } from "../generated/CampaignListing";
import type { SaveFile } from "../generated/SaveFile";
import type { ScenarioListing } from "../generated/ScenarioListing";
import type { CampaignRow, SaveRow, ScenarioRow } from "../lib/openRows";
import { saveMeta, scenarioSummary } from "./builders";

/** The campaign folder every Open screen test lists. */
export const DIR = "C:/saves/terran";

export function saveFile(over: Partial<SaveFile> = {}): SaveFile {
  return {
    path: `${DIR}/2206.11.16.sav`,
    campaign: "terran_1",
    file_name: "2206.11.16.sav",
    meta: saveMeta({ name: "Terran Federation", planets: 1, fleets: 7 }),
    modified: 200,
    size: 4096,
    cloud: false,
    ...over,
  };
}

export function saveRow(over: Partial<SaveRow> = {}): SaveRow {
  return {
    kind: "save",
    key: "save:1",
    file: saveFile(),
    empire: "Terran Federation",
    title: "2206.11.16",
    autosave: false,
    ...over,
  };
}

export function scenarioListing(over: Partial<ScenarioListing> = {}): ScenarioListing {
  return {
    path: "C:/mods/a/map/setup_scenarios/a.txt",
    name: "a_galaxy",
    systems: 100,
    source: "install",
    mod_name: null,
    enabled: true,
    shadowed_by: null,
    modified: 10,
    size: 1024,
    error: null,
    summary: scenarioSummary(),
    painted: false,
    ...over,
  };
}

export function scenarioRow(over: Partial<ScenarioRow> = {}): ScenarioRow {
  return {
    kind: "scenario",
    key: "scenario:1",
    listing: scenarioListing(),
    group: "Install",
    subtitle: "100 systems · Stellaris",
    disabled: false,
    ...over,
  };
}

export const CAMPAIGN: CampaignListing = {
  dir: DIR,
  name: "terran_1",
  empire: "Terran Federation",
  files: 3,
  newest: 200,
  meta: saveMeta({ name: "Terran Federation", date: "2206.11.16" }),
  cloud: false,
};

export function campaignRow(): CampaignRow {
  return {
    kind: "campaign",
    key: `campaign:${DIR}`,
    campaign: CAMPAIGN,
    empire: "Terran Federation",
    subtitle: "v4.4.6 · 2206.11.16",
    count: "3 saves",
    expanded: true,
    loading: false,
    error: null,
  };
}

/** The text a reader sees: no markup, no attributes, one space between words. */
export function shown(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** The label of every button, in order. */
export function buttons(html: string): string[] {
  return [...html.matchAll(/<button[^>]*>(.*?)<\/button>/g)].map((m) => shown(m[1]));
}
