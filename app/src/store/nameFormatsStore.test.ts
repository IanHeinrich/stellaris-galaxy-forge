import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");
vi.mock("../api/events");

import { flush } from "../test/flush";
import { mockedIpc } from "../test/ipc";
import { until } from "../test/wait";
import { useGameDataStore } from "./gameDataStore";
import { useNameFormatsStore } from "./nameFormatsStore";
import { resetStores } from "./storeFixture";

const KEY = "STAR_NAME_1_OF_2";

/** Each test reads from game data of its own, so nothing one asked for stays asked in the next. */
let loads = 0;

beforeEach(() => {
  resetStores();
  useGameDataStore.setState({ status: "ready", version: ++loads });
});

describe("name formats", () => {
  it("asks again for a format whose read failed", async () => {
    mockedIpc.getRawNames.mockRejectedValueOnce({ kind: "io", message: "busy" });
    mockedIpc.getRawNames.mockResolvedValue({ [KEY]: "$NAME$ A" });

    useNameFormatsStore.getState().request([KEY]);
    await until(() => expect(mockedIpc.getRawNames).toHaveBeenCalledTimes(1));
    await flush();
    useNameFormatsStore.getState().request([KEY]);

    await until(() => expect(useNameFormatsStore.getState().formats.get(KEY)).toBe("$NAME$ A"));
    expect(mockedIpc.getRawNames).toHaveBeenCalledTimes(2);
  });

  it("asks once for a key asked twice before its read lands", async () => {
    mockedIpc.getRawNames.mockResolvedValue({ [KEY]: "$NAME$ A" });

    useNameFormatsStore.getState().request([KEY]);
    useNameFormatsStore.getState().request([KEY]);
    await until(() => expect(useNameFormatsStore.getState().formats.get(KEY)).toBe("$NAME$ A"));
    useNameFormatsStore.getState().request([KEY]);
    await flush();

    expect(mockedIpc.getRawNames.mock.calls).toEqual([[[KEY]]]);
  });
});
