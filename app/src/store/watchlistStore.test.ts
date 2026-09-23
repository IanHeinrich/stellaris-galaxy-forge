import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import * as ipc from "../api/ipc";
import type { SearchResult } from "../generated/SearchResult";
import { WATCH_COLOURS } from "../lib/watchlist";
import { OPEN_RESULT } from "./fixture";
import { PREF_KEYS } from "./prefKeys";
import { resetSession, session, stored } from "./sessionFixture";
import { storedWatchlist, useWatchlistStore } from "./watchlistStore";

const search = vi.mocked(ipc.search);
const watch = () => useWatchlistStore.getState();

const result = (systems: number[]): SearchResult => ({ hits: [], systems });

/** What each query finds in the sample save, as the core would answer it. */
const FOUND: Record<string, number[]> = { salvager: [2], "alpha refuge": [0, 1] };

beforeEach(() => {
  resetSession();
  useWatchlistStore.setState({ ...useWatchlistStore.getInitialState(), entries: [] });
  search.mockImplementation(async (query) => result(FOUND[query] ?? []));
});

describe("pinning", () => {
  it("keeps a search trimmed, in a colour of its own, and shown", () => {
    expect(watch().pin("  salvager ")).toBe(true);
    expect(watch().pin("alpha refuge")).toBe(true);

    expect(watch().entries).toEqual([
      { query: "salvager", colour: WATCH_COLOURS[0], shown: true },
      { query: "alpha refuge", colour: WATCH_COLOURS[1], shown: true },
    ]);
  });

  it("ignores an empty search and one already pinned in any case", () => {
    watch().pin("salvager");

    expect(watch().pin("   ")).toBe(false);
    expect(watch().pin("SALVAGER")).toBe(false);
    expect(watch().entries.map((e) => e.query)).toEqual(["salvager"]);
  });

  it("hands a removed entry's colour to the next one pinned", () => {
    watch().pin("salvager");
    watch().pin("gaia");
    watch().remove("salvager");

    watch().pin("alpha refuge");

    expect(watch().entries).toEqual([
      { query: "gaia", colour: WATCH_COLOURS[1], shown: true },
      { query: "alpha refuge", colour: WATCH_COLOURS[0], shown: true },
    ]);
  });

  it("toggles whether an entry's rings are shown", () => {
    watch().pin("salvager");

    watch().toggleShown("salvager");
    expect(watch().entries[0].shown).toBe(false);
    watch().toggleShown("salvager");
    expect(watch().entries[0].shown).toBe(true);
  });

  it("keeps the list in the preferences, and reads back only a well-formed one", () => {
    watch().pin("salvager");
    watch().toggleShown("salvager");

    expect(JSON.parse(stored.get(PREF_KEYS.watchlist)!)).toEqual([
      { query: "salvager", colour: WATCH_COLOURS[0], shown: false },
    ]);
    expect(storedWatchlist()).toEqual(watch().entries);

    stored.set(PREF_KEYS.watchlist, JSON.stringify([{ query: "gaia", colour: "red" }]));
    expect(storedWatchlist()).toEqual([]);
  });
});

describe("results", () => {
  it("runs nothing while no document is open", () => {
    watch().pin("salvager");

    expect(search).not.toHaveBeenCalled();
    expect(watch().results.size).toBe(0);
  });

  it("runs every entry when a document opens, and drops the answers when it closes", async () => {
    watch().pin("salvager");
    watch().pin("alpha refuge");

    await session().openSave(OPEN_RESULT.path);
    await vi.waitFor(() => expect(watch().results.size).toBe(2));

    expect(search).toHaveBeenCalledWith("salvager", expect.any(Number));
    expect(search).toHaveBeenCalledWith("alpha refuge", expect.any(Number));
    expect(watch().results.get("salvager")).toEqual([2]);
    expect(watch().results.get("alpha refuge")).toEqual([0, 1]);

    await session().close();

    expect(watch().results.size).toBe(0);
  });

  it("runs a search pinned while a document is open", async () => {
    await session().openSave(OPEN_RESULT.path);

    watch().pin("salvager");

    await vi.waitFor(() => expect(watch().results.get("salvager")).toEqual([2]));
  });

  it("keeps only the answers of the latest refresh", async () => {
    watch().pin("salvager");
    let first: (r: SearchResult) => void = () => undefined;
    search.mockReturnValueOnce(new Promise<SearchResult>((resolve) => (first = resolve)));
    const older = watch().refresh();
    await watch().refresh();

    first(result([0, 1, 2]));
    await older;

    expect(watch().results.get("salvager")).toEqual([2]);
  });
});
