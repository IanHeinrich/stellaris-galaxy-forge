import { describe, expect, it } from "vitest";
import type { CampaignListing } from "../generated/CampaignListing";
import type { SaveFile } from "../generated/SaveFile";
import type { ScenarioListing } from "../generated/ScenarioListing";
import type { RecentDoc } from "../store/recentsStore";
import { navigableRows, openSections, type OpenLists, type Section } from "./openRows";

function campaign(over: Partial<CampaignListing> = {}): CampaignListing {
  return {
    dir: "C:/saves/terran",
    name: "terran_1",
    empire: "Terran Federation",
    files: 2,
    newest: 200,
    meta: null,
    cloud: false,
    ...over,
  };
}

function save(over: Partial<SaveFile> = {}): SaveFile {
  return {
    path: "C:/saves/terran/2206.11.16.sav",
    campaign: "terran_1",
    file_name: "2206.11.16.sav",
    meta: {
      name: "Terran Federation",
      date: "2206.11.16",
      version: "Pegasus v4.4.6",
      ironman: false,
      planets: 4,
      fleets: 7,
      color: "blue",
    },
    modified: 200,
    size: 4096,
    cloud: false,
    ...over,
  };
}

function scenario(over: Partial<ScenarioListing> = {}): ScenarioListing {
  return {
    path: "C:/mods/a/map/setup_scenarios/a.txt",
    name: "a_galaxy",
    systems: 100,
    source: "mod",
    mod_name: "A Mod",
    enabled: true,
    shadowed_by: null,
    modified: 10,
    size: 1024,
    error: null,
    ...over,
  };
}

const RECENT: RecentDoc = {
  kind: "save",
  path: "C:/saves/terran/2206.11.16.sav",
  title: "Terran Federation",
  subtitle: "Terran Federation · 2206.11.16 · v4.4.6",
  openedAt: 5,
};

const RECENTS: RecentDoc[] = [
  RECENT,
  {
    ...RECENT,
    kind: "scenario",
    path: "C:/mods/a.txt",
    title: "a_galaxy",
    subtitle: "100 systems",
    openedAt: 4,
  },
];

const TERRAN = campaign();
const VOID = campaign({
  dir: "C:/saves/void",
  name: "void_2",
  empire: "Void Compact",
  newest: 100,
});

const B_SCENARIO = scenario({ path: "C:/mods/b.txt", name: "b_galaxy", mod_name: "Other Mod" });

function lists(over: Partial<OpenLists> = {}): OpenLists {
  return {
    filter: "",
    campaigns: [TERRAN, VOID],
    campaignsError: null,
    scenarios: [scenario(), B_SCENARIO],
    scenariosError: null,
    scenarioNotices: [],
    files: { [TERRAN.dir]: [save()] },
    fileErrors: {},
    expanded: TERRAN.dir,
    loadingDir: null,
    missing: [],
    ...over,
  };
}

function sections(over: Partial<OpenLists> = {}): Section[] {
  return openSections(lists(over), RECENTS);
}

function rowKeys(all: Section[], id: string): string[] {
  return all.find((s) => s.id === id)!.rows.map((r) => r.key);
}

describe("filter", () => {
  it("keeps only what every section matches, across name, campaign, file and mod", () => {
    const terran = sections({ filter: "terran" });
    expect(rowKeys(terran, "recent")).toEqual([`recent:${RECENT.path}`]);
    expect(rowKeys(terran, "saves")).toEqual([`campaign:${TERRAN.dir}`, `save:${save().path}`]);
    expect(rowKeys(terran, "scenarios")).toEqual([]);

    const other = sections({ filter: "other mod" });
    expect(rowKeys(other, "scenarios")).toEqual(["scenario:C:/mods/b.txt"]);
    expect(rowKeys(other, "saves")).toEqual([]);
  });

  it("opens a collapsed campaign that holds a matching save", () => {
    const collapsed = sections({ expanded: null, filter: "2206.11.16.sav" });
    expect(rowKeys(collapsed, "saves")).toEqual([`campaign:${TERRAN.dir}`, `save:${save().path}`]);
  });

  it("walks every row of every section in one list, and lists no action rows", () => {
    expect(navigableRows(sections({ filter: "terran" })).map((r) => r.kind)).toEqual([
      "recent",
      "campaign",
      "save",
    ]);
  });
});
