import { afterEach, describe, expect, it, vi } from "vitest";
import type { Reply, Request } from "./territories";
import type { TerritorySystem } from "./territory";
import { PARAMS } from "./territory.fixture";
import { WorkerTerritoryClient } from "./territoryClient";

/** Stands in for the module worker: keeps what is posted, and answers or fails when told. */
class FakeWorker {
  static last: FakeWorker;
  onmessage: ((e: MessageEvent<Reply>) => void) | null = null;
  onerror: (() => void) | null = null;
  readonly posted: Request[] = [];

  constructor() {
    FakeWorker.last = this;
  }

  postMessage(request: Request): void {
    this.posted.push(request);
  }

  answer(reply: Reply): void {
    this.onmessage?.({ data: reply } as MessageEvent<Reply>);
  }

  fail(): void {
    this.onerror?.();
  }

  terminate(): void {}
}

const system = (id: number, x: number, owner: number | null): TerritorySystem => ({
  id,
  x,
  y: 0,
  owner,
  lanes: [],
});

const WIDTHS = { band: 4, seam: 1 };

describe("WorkerTerritoryClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("starts the worker over from the galaxy as last described when an apply fails", () => {
    vi.stubGlobal("Worker", FakeWorker);
    const client = new WorkerTerritoryClient();
    const worker = FakeWorker.last;
    client.reset([system(1, 0, 10), system(2, 50, 10)], PARAMS, [10], WIDTHS, 3);
    worker.answer({ kind: "reset", epoch: 3, shapes: [] });
    client.apply([system(1, 20, 10)], [], 3);
    worker.answer({ kind: "apply", epoch: 3, shapes: [], removed: [] });
    client.apply([system(3, 90, 10)], [2], 3);
    client.apply([system(4, 120, null)], [], 3);
    worker.fail();

    expect(worker.posted.map((r) => r.kind)).toEqual(["reset", "apply", "apply", "reset"]);
    expect(worker.posted[3]).toEqual({
      kind: "reset",
      epoch: 3,
      systems: [system(1, 20, 10), system(3, 90, 10), system(4, 120, null)],
      params: PARAMS,
      bordered: [10],
      widths: WIDTHS,
    });
  });

  it("starts over at the band widths last asked for", () => {
    vi.stubGlobal("Worker", FakeWorker);
    const client = new WorkerTerritoryClient();
    const worker = FakeWorker.last;
    client.reset([system(1, 0, 10)], PARAMS, [10], WIDTHS, 1);
    worker.answer({ kind: "reset", epoch: 1, shapes: [] });
    client.band({ band: 6, seam: 1.5 }, 1);
    worker.answer({ kind: "band", epoch: 1, bands: [] });
    client.apply([system(2, 40, 10)], [], 1);
    worker.fail();

    const restart = worker.posted[worker.posted.length - 1];
    expect(restart?.kind === "reset" && restart.widths).toEqual({ band: 6, seam: 1.5 });
  });

  it("does not try a failed reset again, and goes on with what was queued behind it", () => {
    vi.stubGlobal("Worker", FakeWorker);
    const client = new WorkerTerritoryClient();
    const worker = FakeWorker.last;
    client.reset([system(1, 0, 10)], PARAMS, [10], WIDTHS, 1);
    worker.answer({ kind: "reset", epoch: 1, shapes: [] });
    client.reset([system(1, 10, 10)], PARAMS, [10], WIDTHS, 2);
    client.apply([system(2, 40, 10)], [], 2);
    worker.fail();

    expect(worker.posted.map((r) => r.kind)).toEqual(["reset", "reset", "apply"]);
  });
});
