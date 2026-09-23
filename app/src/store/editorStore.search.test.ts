import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");
vi.mock("@tauri-apps/plugin-dialog", () => import("../api/__mocks__/dialog"));

import * as ipc from "../api/ipc";
import type { SearchResult } from "../generated/SearchResult";
import { editor, openFixtureSave } from "./editorFixture";
import { useFileSessionStore } from "./fileSessionStore";

const search = vi.mocked(ipc.search);

const result = (systems: number[]): SearchResult => ({ hits: [], systems });

beforeEach(openFixtureSave);

describe("search rings", () => {
  it("a query's result rings every system it locates", async () => {
    search.mockResolvedValueOnce(result([0, 2]));

    expect(await editor().runSearch("salvager", 20)).toEqual(result([0, 2]));

    expect(search).toHaveBeenCalledWith("salvager", 20);
    expect(editor().searchRings).toEqual([0, 2]);
  });

  it("clearing the field or Esc drops the rings", async () => {
    search.mockResolvedValueOnce(result([0, 2]));
    await editor().runSearch("gaia", 20);

    editor().clearSearch();

    expect(editor().searchRings).toEqual([]);
  });

  it("a result that arrives after a clear rings nothing", async () => {
    let answer: (r: SearchResult) => void = () => undefined;
    search.mockReturnValueOnce(new Promise<SearchResult>((resolve) => (answer = resolve)));
    const pending = editor().runSearch("gaia", 20);

    editor().clearSearch();
    answer(result([0]));

    expect(await pending).toBeNull();
    expect(editor().searchRings).toEqual([]);
  });

  it("only the latest of two queries rings its systems", async () => {
    let first: (r: SearchResult) => void = () => undefined;
    search.mockReturnValueOnce(new Promise<SearchResult>((resolve) => (first = resolve)));
    search.mockResolvedValueOnce(result([2]));
    const older = editor().runSearch("g", 20);
    await editor().runSearch("gaia", 20);
    first(result([0, 1, 2]));

    expect(await older).toBeNull();
    expect(editor().searchRings).toEqual([2]);
  });

  it("a failed search drops the rings and rejects", async () => {
    search.mockResolvedValueOnce(result([0]));
    await editor().runSearch("gaia", 20);
    search.mockRejectedValueOnce({ kind: "no_session", message: "no save open" });

    await expect(editor().runSearch("gaia world", 20)).rejects.toMatchObject({
      kind: "no_session",
    });
    expect(editor().searchRings).toEqual([]);
  });

  it("closing the document drops the rings", async () => {
    search.mockResolvedValueOnce(result([0]));
    await editor().runSearch("gaia", 20);

    await useFileSessionStore.getState().close();

    expect(editor().searchRings).toEqual([]);
  });
});
