import { Territories, type Reply, type Request } from "./territories";
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
    epoch: number,
  ): void;
  apply(changed: TerritorySystem[], removed: number[], epoch: number): void;
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
    epoch: number,
  ): void {
    this.send({ kind: "reset", epoch, systems: [...systems], params, bordered: [...bordered] });
  }

  apply(changed: TerritorySystem[], removed: number[], epoch: number): void {
    this.send({ kind: "apply", epoch, changed, removed });
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
 * queued before it moot and drops it; applies queued after one wait behind it. Should the
 * worker fail before it has ever answered, the rest of the session computes inline.
 */
export class WorkerTerritoryClient implements TerritoryClient {
  private worker: Worker | null;
  private fallback: InlineTerritoryClient | null = null;
  private reply: (reply: Reply) => void = () => {};
  private inFlight: Request | null = null;
  private answered = false;
  private queue: Request[] = [];

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
      // A request that threw gets no reply; the ones behind it must not wait for one.
      this.inFlight = null;
      this.postNext();
    };
  }

  reset(
    systems: Iterable<TerritorySystem>,
    params: TerritoryParams,
    bordered: Iterable<number>,
    epoch: number,
  ): void {
    const projected = Array.from(systems, project);
    this.post({ kind: "reset", epoch, systems: projected, params, bordered: [...bordered] });
  }

  apply(changed: TerritorySystem[], removed: number[], epoch: number): void {
    this.post({ kind: "apply", epoch, changed: changed.map(project), removed });
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
    else this.queue.push(request);
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
