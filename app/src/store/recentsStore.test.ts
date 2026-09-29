import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stubPrefs } from "../test/prefs";
import { saveMeta } from "../test/builders";
import { recentSubtitle, useRecentsStore, type RecentDoc } from "./recentsStore";

const stored = new Map<string, string>();

beforeEach(() => {
  stubPrefs(stored);
  useRecentsStore.setState({ recents: [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const recents = () => useRecentsStore.getState();

const SAVE: Omit<RecentDoc, "openedAt"> = {
  kind: "save",
  path: "C:/saves/a.sav",
  title: "Test Empire",
  subtitle: "Test Empire · 2206.11.16 · v4.4.6",
};

describe("recentSubtitle", () => {
  it("builds a save's subtitle from its meta, skipping missing parts", () => {
    expect(recentSubtitle("save", saveMeta())).toBe("Test Empire · 2206.11.16 · v4.4.6");
    expect(recentSubtitle("save", saveMeta({ date: "", version: "" }))).toBe("Test Empire");
    expect(recentSubtitle("save", null)).toBe("");
  });

  it("gives a scenario its system count, or nothing without one", () => {
    expect(recentSubtitle("scenario", null, 12)).toBe("12 systems");
    expect(recentSubtitle("scenario", null)).toBe("");
  });
});

describe("noteOpened", () => {
  it("dedupes by path, moving the reopened entry to the front", () => {
    recents().noteOpened(SAVE);
    recents().noteOpened({ ...SAVE, path: "C:/saves/b.sav", title: "Other Empire" });
    expect(recents().recents.map((r) => r.path)).toEqual(["C:/saves/b.sav", "C:/saves/a.sav"]);

    recents().noteOpened(SAVE);
    expect(recents().recents.map((r) => r.path)).toEqual(["C:/saves/a.sav", "C:/saves/b.sav"]);
    expect(recents().recents).toHaveLength(2);
  });

  it("caps the list at 10", () => {
    for (let i = 0; i < 15; i++) {
      recents().noteOpened({ ...SAVE, path: `C:/saves/${i}.sav` });
    }
    expect(recents().recents).toHaveLength(10);
    expect(recents().recents[0].path).toBe("C:/saves/14.sav");
  });

  it("persists through writePref", () => {
    recents().noteOpened(SAVE);
    const persisted = JSON.parse(stored.get("sgf.recents") ?? "[]") as RecentDoc[];
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject(SAVE);
  });
});

describe("forget", () => {
  it("removes an entry and persists the change", () => {
    recents().noteOpened(SAVE);
    recents().noteOpened({ ...SAVE, path: "C:/saves/b.sav" });
    recents().forget(SAVE.path);
    expect(recents().recents.map((r) => r.path)).toEqual(["C:/saves/b.sav"]);
    const persisted = JSON.parse(stored.get("sgf.recents") ?? "[]") as RecentDoc[];
    expect(persisted.map((r) => r.path)).toEqual(["C:/saves/b.sav"]);
  });
});

describe("forgetAll", () => {
  it("removes several entries at once and persists the change", () => {
    for (const name of ["a", "b", "c"]) {
      recents().noteOpened({ ...SAVE, path: `C:/saves/${name}.sav` });
    }
    recents().forgetAll(["C:/saves/a.sav", "C:/saves/c.sav", "C:/saves/never.sav"]);
    expect(recents().recents.map((r) => r.path)).toEqual(["C:/saves/b.sav"]);
    const persisted = JSON.parse(stored.get("sgf.recents") ?? "[]") as RecentDoc[];
    expect(persisted.map((r) => r.path)).toEqual(["C:/saves/b.sav"]);
  });
});

describe("clear", () => {
  it("empties the list and persists it", () => {
    recents().noteOpened(SAVE);
    recents().noteOpened({ ...SAVE, path: "C:/saves/b.sav" });
    recents().clear();
    expect(recents().recents).toEqual([]);
    expect(JSON.parse(stored.get("sgf.recents") ?? "[]")).toEqual([]);
  });
});

describe("load", () => {
  it("keeps the newest 10 of a longer stored list", async () => {
    const twenty = Array.from({ length: 20 }, (_, i) => ({
      kind: "save",
      path: `C:/saves/${i}.sav`,
      title: "A",
      openedAt: 100 - i,
      subtitle: "",
    }));
    stored.set("sgf.recents", JSON.stringify(twenty));
    vi.resetModules();
    const fresh = await import("./recentsStore");
    const loaded = fresh.useRecentsStore.getState().recents;
    expect(loaded).toHaveLength(10);
    expect(loaded[0].path).toBe("C:/saves/0.sav");
    expect(loaded[9].path).toBe("C:/saves/9.sav");
  });

  it("drops malformed persisted entries and keeps the well-formed ones", async () => {
    stored.set(
      "sgf.recents",
      JSON.stringify([
        { kind: "save", path: "C:/saves/a.sav", title: "A", openedAt: 1, subtitle: "" },
        { kind: "bogus", path: "C:/saves/b.sav", title: "B", openedAt: 2, subtitle: "" },
        { kind: "scenario", path: "C:/saves/c.sav", title: "C" },
        "not an object",
        null,
      ]),
    );
    vi.resetModules();
    const fresh = await import("./recentsStore");
    expect(fresh.useRecentsStore.getState().recents).toEqual([
      { kind: "save", path: "C:/saves/a.sav", title: "A", openedAt: 1, subtitle: "" },
    ]);
  });
});
