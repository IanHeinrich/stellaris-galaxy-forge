import { describe, expect, it } from "vitest";
import type { RecentDoc } from "../store/recentsStore";
import {
  TERRAN,
  VOID,
  campaignListing,
  campaignSave,
  modScenario,
  saveMeta,
} from "../test/builders";
import {
  detailsSave,
  footerOpens,
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

const B_SCENARIO = modScenario({ path: "C:/mods/b.txt", name: "b_galaxy", mod_name: "Other Mod" });

function lists(over: Partial<OpenLists> = {}): OpenLists {
  return {
    filter: "",
    tab: "all",
    campaigns: [TERRAN, VOID],
    campaignsError: null,
    scenarios: [modScenario(), B_SCENARIO],
    scenariosError: null,
    scenarioNotices: [],
    files: { [TERRAN.dir]: [campaignSave()] },
    fileErrors: {},
    expanded: TERRAN.dir,
    loadingDirs: [],
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

describe("latest save card", () => {
  const NEWER = campaignListing({
    dir: "C:/saves/void",
    name: "void_2",
    empire: "Void Compact",
    newest: 300,
    file_names: ["autosave_2231.01.01.sav", "2230.01.01.sav"],
    meta: saveMeta({ date: "2231.01.01", version: "Cygnus v4.5.0" }),
  });
  const LATEST = "C:/saves/void/autosave_2231.01.01.sav";

  it("tops the All tab with the newest save of every campaign, selected and opened as a save", () => {
    const state = lists({ campaigns: [TERRAN, NEWER] });
    const all = openSections(state, RECENTS);
    expect(all[0]).toMatchObject({ id: "latest", count: 0 });
    const row = selectedRow(navigableRows(all), null);
    expect(row).toMatchObject({
      kind: "latest",
      path: LATEST,
      empire: "Void Compact",
      subtitle: "2231.01.01 · v4.5.0 · autosave_2231.01.01.sav",
      modified: 300,
    });
    expect(footerOpens(row, state).open).toEqual({ path: LATEST, mode: "save" });
    const counts = Object.fromEntries(openTabs(state, RECENTS).map((t) => [t.id, t.count]));
    expect(counts).toEqual({ all: 8, recent: 2, saves: 4, scenarios: 2 });
  });

  it("keeps Recent's whole count for its Show all link while its rows drop the card's save", () => {
    const seven: RecentDoc[] = Array.from({ length: 7 }, (_, i) => ({
      ...RECENT,
      path: i === 0 ? RECENT.path : `C:/saves/terran/${i}.sav`,
      openedAt: 10 - i,
    }));
    const recent = openSections(lists(), seven).find((s) => s.id === "recent")!;
    expect(recent.count).toBe(7);
    expect(recent.more).toBe(1);
    expect(recent.rows.map((r) => r.key)).not.toContain(`recent:${RECENT.path}`);
    expect(openSections(lists({ tab: "recent" }), seven)[0].rows).toHaveLength(7);
  });

  it("joins a backslash folder, and drops a recent path that differs in case and slashes", () => {
    const win = campaignListing({
      dir: "C:\\Saves\\void_2",
      newest: 300,
      file_names: ["Latest.sav"],
    });
    const recents: RecentDoc[] = [{ ...RECENT, path: "c:/saves/VOID_2/latest.sav" }];
    const state = lists({ campaigns: [TERRAN, win] });
    const all = openSections(state, recents);
    const row = all[0].rows[0];
    expect(row).toMatchObject({ kind: "latest", path: "C:\\Saves\\void_2\\Latest.sav" });
    expect(all.map((s) => s.id)).not.toContain("recent");

    expect(detailsSave(row, state)).toBeNull();
    const read = campaignSave({ path: "C:/Saves/void_2/Latest.sav", file_name: "Latest.sav" });
    expect(detailsSave(row, { ...state, files: { [win.dir]: [read] } })).toBe(read);
  });

  it("leaves the save it shows out of Recent on the All tab only", () => {
    expect(rowKeys(sections(), "latest")).toEqual([`latest:${RECENT.path}`]);
    expect(rowKeys(sections(), "recent")).toEqual(["recent:C:/mods/a.txt"]);
    expect(rowKeys(sections({ tab: "recent" }), "recent")).toEqual([
      `recent:${RECENT.path}`,
      "recent:C:/mods/a.txt",
    ]);
  });

  it("is gone behind a filter, on the other tabs, and while there are no saves", () => {
    const none = (over: Partial<OpenLists>) =>
      openSections(lists(over), RECENTS).every((s) => s.id !== "latest");
    expect(none({ filter: "terran" })).toBe(true);
    expect(none({ tab: "saves" })).toBe(true);
    expect(none({ tab: "recent" })).toBe(true);
    expect(none({ tab: "scenarios" })).toBe(true);
    expect(none({ campaigns: [] })).toBe(true);
    expect(none({ campaigns: null })).toBe(true);
  });
});

describe("filter", () => {
  it("keeps only what every section matches, across name, campaign, file and mod", () => {
    const terran = sections({ filter: "terran" });
    expect(rowKeys(terran, "recent")).toEqual([`recent:${RECENT.path}`]);
    expect(rowKeys(terran, "saves")).toEqual([
      `campaign:${TERRAN.dir}`,
      `save:${campaignSave().path}`,
    ]);
    expect(rowKeys(terran, "scenarios")).toEqual([]);

    const other = sections({ filter: "other mod" });
    expect(rowKeys(other, "scenarios")).toEqual(["scenario:C:/mods/b.txt"]);
    expect(rowKeys(other, "saves")).toEqual([]);
  });

  it("opens a collapsed campaign that holds a matching save", () => {
    const collapsed = sections({ expanded: null, filter: "2206.11.16.sav" });
    expect(rowKeys(collapsed, "saves")).toEqual([
      `campaign:${TERRAN.dir}`,
      `save:${campaignSave().path}`,
    ]);
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
    expect(none.map((s) => s.id)).toEqual(["latest", "saves", "scenarios"]);
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

describe("the recent list on the All tab", () => {
  const TEN: RecentDoc[] = Array.from({ length: 10 }, (_, i) => ({
    ...RECENT,
    path: `C:/saves/terran/${i}.sav`,
    openedAt: 100 - i,
  }));

  it("lists the newest 5 and says how many it left out", () => {
    const recent = openSections(lists(), TEN).find((s) => s.id === "recent")!;
    expect(recent.rows.map((r) => r.key)).toEqual(TEN.slice(0, 5).map((d) => `recent:${d.path}`));
    expect(recent.more).toBe(5);
    expect(recent.count).toBe(10);
  });

  it("lists all of them on the Recent tab, and leaves nothing out below the cap", () => {
    const recent = openSections(lists({ tab: "recent" }), TEN)[0];
    expect(recent.rows).toHaveLength(10);
    expect(recent.more).toBeUndefined();
    expect(sections().find((s) => s.id === "recent")?.more).toBeUndefined();
  });

  it("counts every document in the tabs, and walks only the rows shown", () => {
    const counts = Object.fromEntries(openTabs(lists(), TEN).map((t) => [t.id, t.count]));
    expect(counts).toMatchObject({ all: 16, recent: 10 });
    const walked = navigableRows(openSections(lists(), TEN)).filter((r) => r.kind === "recent");
    expect(walked).toHaveLength(5);
  });
});

describe("rows", () => {
  it("titles a save with the name it was given and puts its game date under it", () => {
    const named = campaignSave({ path: "C:/saves/terran/my run.sav", file_name: "my run.sav" });
    const all = sections({ files: { [TERRAN.dir]: [named] } });
    expect(rowOf<"save">(all, `save:${named.path}`)).toMatchObject({
      title: "my run",
      sub: "2206.11.16",
      autosave: false,
    });
  });

  it("shows the date once for a save the game named, and the name alone when the header is unread", () => {
    const unread = campaignSave({
      path: "C:/saves/terran/broken.sav",
      file_name: "broken.sav",
      meta: null,
    });
    const all = sections({ files: { [TERRAN.dir]: [campaignSave(), unread] } });
    expect(rowOf<"save">(all, `save:${campaignSave().path}`)).toMatchObject({
      title: "2206.11.16",
      sub: null,
    });
    expect(rowOf<"save">(all, `save:${unread.path}`)).toMatchObject({
      title: "broken",
      sub: null,
    });
  });

  it("tags an autosave and titles it with its date", () => {
    const autosave = campaignSave({
      path: "C:/saves/terran/autosave_2207.01.01.sav",
      file_name: "autosave_2207.01.01.sav",
      meta: saveMeta({ date: "2207.01.01" }),
    });
    const all = sections({ files: { [TERRAN.dir]: [autosave] } });
    expect(rowOf<"save">(all, `save:${autosave.path}`)).toMatchObject({
      title: "2207.01.01",
      sub: null,
      autosave: true,
    });
  });

  it("says one save, one system, and the newest save's version and date under a campaign", () => {
    const one = campaignListing({
      file_names: ["2210.02.03.sav"],
      meta: saveMeta({ date: "2210.02.03", version: "Cygnus v4.5.0" }),
    });
    const small = modScenario({ path: "C:/mods/tiny.txt", systems: 1 });
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
  const SAVE_KEY = `save:${campaignSave().path}`;
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

describe("the footer's targets", () => {
  const targets = (over: Partial<OpenLists>, key: string) =>
    footerOpens(rowOf(sections(over), key), lists(over));
  const saved = campaignSave().path;
  const listed = modScenario().path;

  it("opens a save as a save or as a scenario, and anything else as it is", () => {
    expect(targets({}, `save:${saved}`)).toEqual({
      open: { path: saved, mode: "save" },
      asScenario: { path: saved, mode: "scenario" },
      forPaint: null,
    });
    expect(targets({}, `scenario:${listed}`)).toEqual({
      open: { path: listed, mode: "save" },
      asScenario: null,
      forPaint: listed,
    });
    expect(targets({ tab: "recent" }, `recent:${RECENT.path}`)).toEqual({
      open: { path: RECENT.path, mode: "save" },
      asScenario: { path: RECENT.path, mode: "scenario" },
      forPaint: null,
    });
    expect(targets({}, `campaign:${TERRAN.dir}`).open).toEqual({ path: saved, mode: "save" });
    expect(footerOpens(undefined, lists())).toEqual({
      open: null,
      asScenario: null,
      forPaint: null,
    });
  });

  it("opens nothing for a scenario that failed to read or a campaign whose saves are unread", () => {
    const broken = { scenarios: [modScenario({ error: "bad brace" })] };
    expect(targets(broken, `scenario:${listed}`).open).toBeNull();
    expect(targets({ files: {} }, `campaign:${TERRAN.dir}`).open).toBeNull();
  });

  it("offers Paint a Galaxy only for a scenario not already for the mod", () => {
    const painted = { scenarios: [modScenario({ painted: true })] };
    expect(targets(painted, `scenario:${listed}`).forPaint).toBeNull();
  });
});
