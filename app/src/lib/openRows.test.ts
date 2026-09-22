import { describe, expect, it } from "vitest";
import type { CampaignListing } from "../generated/CampaignListing";
import type { SaveFile } from "../generated/SaveFile";
import type { ScenarioListing } from "../generated/ScenarioListing";
import type { RecentDoc } from "../store/recentsStore";
import { saveMeta, scenarioSummary } from "../test/builders";
import {
  navigableRows,
  openSections,
  openTabs,
  pressRow,
  selectedRow,
  steppedKey,
  type OpenLists,
  type Row,
  type Section,
} from "./openRows";

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
    meta: saveMeta({ name: "Terran Federation", planets: 4, fleets: 7, color: "blue" }),
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
    summary: scenarioSummary(),
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
    tab: "all",
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
  return all.find((s) => s.id === id)?.rows.map((r) => r.key) ?? [];
}

function rowOf<K extends Row["kind"]>(all: Section[], key: string): Row & { kind: K } {
  return navigableRows(all).find((r) => r.key === key) as Row & { kind: K };
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

describe("tabs", () => {
  it("lists only the chosen section, and walks only what it lists", () => {
    const saves = sections({ tab: "saves" });
    expect(saves.map((s) => s.id)).toEqual(["saves"]);
    expect(navigableRows(saves).map((r) => r.kind)).toEqual(["campaign", "save", "campaign"]);
  });

  it("leaves an empty Recent out of All, and shows its note under Recent", () => {
    const none = openSections(lists(), []);
    expect(none.map((s) => s.id)).toEqual(["saves", "scenarios"]);
    const recent = openSections(lists({ tab: "recent" }), []);
    expect(recent.map((s) => s.note)).toEqual(["Nothing opened yet."]);
    expect(sections({ filter: "void" }).map((s) => s.id)).toEqual(["saves", "scenarios"]);
  });

  it("counts what the filter leaves in every tab, whichever is chosen", () => {
    const counts = (over: Partial<OpenLists>) =>
      Object.fromEntries(openTabs(lists(over), RECENTS).map((t) => [t.id, t.count]));
    expect(counts({ tab: "scenarios" })).toEqual({ all: 8, recent: 2, saves: 4, scenarios: 2 });
    expect(counts({ tab: "recent", filter: "terran" })).toEqual({
      all: 3,
      recent: 1,
      saves: 2,
      scenarios: 0,
    });
  });
});

describe("rows", () => {
  it("titles a save with its game date, tags an autosave, and falls back to the file name", () => {
    const autosave = save({ path: "C:/saves/terran/autosave_2207.01.01.sav" });
    const unread = save({
      path: "C:/saves/terran/broken.sav",
      file_name: "broken.sav",
      meta: null,
    });
    const all = sections({
      files: {
        [TERRAN.dir]: [save(), { ...autosave, file_name: "autosave_2207.01.01.sav" }, unread],
      },
    });
    expect(rowOf<"save">(all, `save:${save().path}`)).toMatchObject({
      title: "2206.11.16",
      autosave: false,
    });
    expect(rowOf<"save">(all, `save:${autosave.path}`)).toMatchObject({ autosave: true });
    expect(rowOf<"save">(all, `save:${unread.path}`)).toMatchObject({ title: "broken.sav" });
  });

  it("says one save, one system, and the newest save's version and date under a campaign", () => {
    const one = campaign({
      files: 1,
      meta: saveMeta({ date: "2210.02.03", version: "Cygnus v4.5.0" }),
    });
    const small = scenario({ path: "C:/mods/tiny.txt", systems: 1 });
    const all = sections({ campaigns: [one, VOID], scenarios: [small, B_SCENARIO] });
    expect(rowOf<"campaign">(all, `campaign:${one.dir}`)).toMatchObject({
      count: "1 save",
      subtitle: "v4.5.0 · 2210.02.03",
    });
    expect(rowOf<"campaign">(all, `campaign:${VOID.dir}`)).toMatchObject({ count: "2 saves" });
    expect(rowOf<"scenario">(all, `scenario:${small.path}`)).toMatchObject({
      subtitle: "1 system · A Mod",
    });
    expect(rowOf<"scenario">(all, "scenario:C:/mods/b.txt")).toMatchObject({
      subtitle: "100 systems · Other Mod",
    });
  });
});

describe("selection", () => {
  const SAVE_KEY = `save:${save().path}`;
  const walk = (over: Partial<OpenLists>) => navigableRows(openSections(lists(over), RECENTS));

  it("stays on the row it names when a campaign above it collapses", () => {
    const before = walk({ tab: "saves" });
    const voidKey = `campaign:${VOID.dir}`;
    expect(before.map((r) => r.key)).toEqual([`campaign:${TERRAN.dir}`, SAVE_KEY, voidKey]);

    const after = walk({ tab: "saves", expanded: VOID.dir });
    expect(selectedRow(after, voidKey)?.key).toBe(voidKey);
    expect(after.indexOf(selectedRow(after, voidKey)!)).toBe(1);
  });

  it("falls back to the first row once the row it names is no longer listed", () => {
    const after = walk({ tab: "saves", expanded: null });
    expect(selectedRow(after, SAVE_KEY)?.key).toBe(`campaign:${TERRAN.dir}`);
    expect(selectedRow(after, null)?.key).toBe(`campaign:${TERRAN.dir}`);
    expect(selectedRow([], SAVE_KEY)).toBeUndefined();
  });

  it("steps by key and stops at either end", () => {
    const rows = walk({ tab: "saves" });
    expect(steppedKey(rows, `campaign:${TERRAN.dir}`, 1)).toBe(SAVE_KEY);
    expect(steppedKey(rows, `campaign:${TERRAN.dir}`, -1)).toBe(`campaign:${TERRAN.dir}`);
    expect(steppedKey(rows, `campaign:${VOID.dir}`, 1)).toBe(`campaign:${VOID.dir}`);
    expect(steppedKey([], null, 1)).toBeNull();
  });
});

describe("a press on a row", () => {
  it("toggles a campaign once for a double-click, and opens nothing", () => {
    const rows = navigableRows(sections({ tab: "saves" }));
    const voidRow = rows.find((r) => r.key === `campaign:${VOID.dir}`)!;

    const first = pressRow(rows, voidRow, 1, null);
    expect(first).toEqual({ select: voidRow.key, toggle: VOID.dir, activate: null });
    expect(pressRow(rows, voidRow, 2, first.select)).toEqual({
      select: null,
      toggle: null,
      activate: null,
    });
  });

  it("opens only the row the first press selected, not one the toggle moved under the pointer", () => {
    const before = navigableRows(sections({ tab: "saves", expanded: null }));
    const terranRow = before.find((r) => r.key === `campaign:${TERRAN.dir}`)!;
    const first = pressRow(before, terranRow, 1, null);

    const after = navigableRows(sections({ tab: "saves" }));
    const moved = after[1];
    expect(moved.kind).toBe("save");
    expect(pressRow(after, moved, 2, first.select).activate).toBeNull();
  });

  it("opens a save on its second press, and ignores a third", () => {
    const rows = navigableRows(sections({ tab: "saves" }));
    const saveRow = rows.find((r) => r.kind === "save")!;
    const first = pressRow(rows, saveRow, 1, null);
    expect(first).toEqual({ select: saveRow.key, toggle: null, activate: null });
    expect(pressRow(rows, saveRow, 2, first.select).activate).toBe(saveRow);
    expect(pressRow(rows, saveRow, 3, first.select).activate).toBeNull();
  });
});
