import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api/ipc");

import { mockedIpc } from "../test/ipc";
import type { Op } from "../generated/Op";
import { opCheckKey, useOpCheckStore } from "./opCheckStore";
import { until } from "../test/wait";

const OP: Op = { type: "DeleteBody", body: 99 };
const KEY = opCheckKey(OP, 140);
const store = () => useOpCheckStore.getState();

beforeEach(() => {
  vi.resetAllMocks();
  store().reset();
});

describe("the core's answers about an op", () => {
  it("asks once per generation of the op's system", async () => {
    mockedIpc.checkOp.mockResolvedValue(null);
    store().ask(OP, 140, 0);
    store().ask(OP, 140, 0);
    await until(() => expect(store().answers.get(KEY)).toEqual({ generation: 0, refusal: null }));
    expect(mockedIpc.checkOp).toHaveBeenCalledOnce();

    store().staled([140, 141]);
    expect(store().generations.get(140)).toBe(1);
    store().ask(OP, 140, 1);
    expect(mockedIpc.checkOp).toHaveBeenCalledTimes(2);
  });

  it("counts every edit, for an op about no system", () => {
    store().staled([]);
    store().staled([140]);
    expect(store().edits).toBe(2);
    expect(store().generations.has(141)).toBe(false);
  });

  it("holds an answer about no system apart from one about its system", async () => {
    mockedIpc.checkOp.mockResolvedValue(null);
    store().staled([28]);
    store().staled([16]);
    store().ask(OP, null, store().edits);
    await until(() =>
      expect(store().answers.get(opCheckKey(OP, null))).toEqual({ generation: 2, refusal: null }),
    );
    store().ask(OP, 16, store().generations.get(16)!);
    await until(() =>
      expect(store().answers.get(opCheckKey(OP, 16))).toEqual({ generation: 1, refusal: null }),
    );
  });

  it("keeps the newer answer when an older one lands after it", async () => {
    let answerOld: (refusal: string | null) => void = () => undefined;
    mockedIpc.checkOp
      .mockImplementationOnce(() => new Promise((resolve) => (answerOld = resolve)))
      .mockResolvedValueOnce("planet 99 does not exist");
    store().ask(OP, 140, 0);
    store().ask(OP, 140, 1);
    await until(() => expect(store().answers.get(KEY)?.generation).toBe(1));

    answerOld(null);
    await Promise.resolve();
    expect(store().answers.get(KEY)).toEqual({
      generation: 1,
      refusal: "planet 99 does not exist",
    });
  });

  it("drops an answer that lands after the document changed", async () => {
    let answer: (refusal: string | null) => void = () => undefined;
    mockedIpc.checkOp.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    store().ask(OP, 140, 0);
    store().reset();
    answer("planet 99 does not exist");
    await Promise.resolve();
    expect(store().answers.size).toBe(0);
  });
});
