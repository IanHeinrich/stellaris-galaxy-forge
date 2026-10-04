import { Territories, type BandWidths, type Reply, type Request } from "./territories";
import type { TerritoryParams, TerritorySystem } from "./territory";

/**
 * Where the territories are computed. A request carries the epoch the caller is on; a reply
 * carries it back so a caller that has moved on can tell a stale answer from a current one.
 */
export interface TerritoryClient {
  reset(
    systems: Iterable<TerritorySystem>,
    params: TerritoryParams,
    bordered: Iterable<number>,
    widths: BandWidths,
    epoch: number,
  ): void;
  apply(changed: TerritorySystem[], removed: number[], epoch: number): void;
  /** Re-traces every band for new widths; the bands shown stay until the answer comes. */
  band(widths: BandWidths, epoch: number): void;
  onReply(cb: (reply: Reply) => void): void;
  destroy(): void;
}

/** Computes on the calling thread and answers before returning. */
export class InlineTerritoryClient implements TerritoryClient {
  private readonly territories = new Territories();
  private reply: (reply: Reply) => void = () => {};

  reset(
    systems: Iterable<TerritorySystem>,
    params: TerritoryParams,
    bordered: Iterable<number>,
    widths: BandWidths,
    epoch: number,
  ): void {
    const request = { systems: [...systems], params, bordered: [...bordered], widths };
    this.send({ kind: "reset", epoch, ...request });
  }

  apply(changed: TerritorySystem[], removed: number[], epoch: number): void {
    this.send({ kind: "apply", epoch, changed, removed });
  }

  band(widths: BandWidths, epoch: number): void {
    this.send({ kind: "band", epoch, widths });
  }

  send(request: Request): void {
    this.reply(this.territories.handle(request));
  }

  onReply(cb: (reply: Reply) => void): void {
    this.reply = cb;
  }

  destroy(): void {}
}

/**
 * Computes in a module worker, one request in flight at a time. A reset makes everything
 * queued before it moot and drops it; applies queued after one wait behind it. A band request
 * replaces any band request still queued, so a zoom re-traces only for its latest step. Should the
 * worker fail before it has ever answered, the rest of the session computes inline. Should an
 * apply or band request fail after that, the worker starts over from the galaxy as the caller last
 * described it, since the failed request may have left its field half updated. A reset that fails
 * is not tried again: the requests queued behind it go on to the worker.
 */
export class WorkerTerritoryClient implements TerritoryClient {
  private worker: Worker | null;
  private fallback: InlineTerritoryClient | null = null;
  private reply: (reply: Reply) => void = () => {};
  private inFlight: Request | null = null;
  private answered = false;
  private queue: Request[] = [];
  /** The last reset, with every apply and band request since folded in. */
  private galaxy: Omit<Extract<Request, { kind: "reset" }>, "systems"> | null = null;
  private systems = new Map<number, TerritorySystem>();

  constructor() {
    this.worker = new Worker(new URL("./territories.worker.ts", import.meta.url), {
      type: "module",
    });
    this.worker.onmessage = (e: MessageEvent<Reply>) => {
      this.answered = true;
      this.inFlight = null;
      this.reply(e.data);
      this.postNext();
    };
    this.worker.onerror = () => {
      if (!this.answered) {
        this.fallBack();
        return;
      }
      const failed = this.inFlight;
      this.inFlight = null;
      if (failed?.kind !== "reset" && this.galaxy) {
        this.queue = [{ ...this.galaxy, systems: [...this.systems.values()] }];
      }
      this.postNext();
    };
  }

  reset(
    systems: Iterable<TerritorySystem>,
    params: TerritoryParams,
    bordered: Iterable<number>,
    widths: BandWidths,
    epoch: number,
  ): void {
    const projected = Array.from(systems, project);
    this.galaxy = { kind: "reset", epoch, params, bordered: [...bordered], widths };
    this.systems = new Map(projected.map((s) => [s.id, s]));
    this.post({ ...this.galaxy, systems: projected });
  }

  apply(changed: TerritorySystem[], removed: number[], epoch: number): void {
    const projected = changed.map(project);
    for (const id of removed) this.systems.delete(id);
    for (const s of projected) this.systems.set(s.id, s);
    if (this.galaxy) this.galaxy = { ...this.galaxy, epoch };
    this.post({ kind: "apply", epoch, changed: projected, removed });
  }

  band(widths: BandWidths, epoch: number): void {
    if (this.galaxy) this.galaxy = { ...this.galaxy, epoch, widths };
    this.post({ kind: "band", epoch, widths });
  }

  onReply(cb: (reply: Reply) => void): void {
    this.reply = cb;
    this.fallback?.onReply(cb);
  }

  destroy(): void {
    this.queue = [];
    this.inFlight = null;
    this.worker?.terminate();
    this.worker = null;
    this.fallback = null;
  }

  private post(request: Request): void {
    if (this.fallback) {
      this.fallback.send(request);
      return;
    }
    if (request.kind === "reset") this.queue = [request];
    else if (request.kind === "band") {
      this.queue = this.queue.filter((queued) => queued.kind !== "band");
      this.queue.push(request);
    } else this.queue.push(request);
    this.postNext();
  }

  private postNext(): void {
    if (this.inFlight || !this.worker) return;
    const next = this.queue.shift();
    if (!next) return;
    this.inFlight = next;
    this.worker.postMessage(next);
  }

  private fallBack(): void {
    const pending = this.inFlight ? [this.inFlight, ...this.queue] : this.queue;
    this.queue = [];
    this.inFlight = null;
    this.worker?.terminate();
    this.worker = null;
    this.fallback = new InlineTerritoryClient();
    this.fallback.onReply(this.reply);
    for (const request of pending) this.fallback.send(request);
  }
}

/** The fields the maths reads, so a full `SystemNode` is not cloned across the thread boundary. */
function project(s: TerritorySystem): TerritorySystem {
  return { id: s.id, x: s.x, y: s.y, owner: s.owner, lanes: s.lanes.map((l) => ({ to: l.to })) };
}
