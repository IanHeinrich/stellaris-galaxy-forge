import { expect, it, vi } from "vitest";
import * as mock from "./__mocks__/ipc";

it("the IPC mock stands in for every export of the real module, and nothing else", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("./ipc");
  expect(Object.keys(mock).sort()).toEqual(Object.keys(actual).sort());
});
