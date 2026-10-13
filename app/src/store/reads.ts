import { errorMessage } from "../api/ipc";

/** A token for dropping late replies: a reply lands only while the token it took is the latest. */
export interface Latest {
  /** Takes a new token, which every token taken before it no longer is. */
  next(): number;
  /** The latest token, taken without replacing it: for several replies awaited at once. */
  current(): number;
  /** Whether `token` is still the latest. */
  is(token: number): boolean;
}

/** A fresh token, as one store's or one read's own. */
export function latest(): Latest {
  let at = 0;
  return {
    next: () => ++at,
    current: () => at,
    is: (token) => token === at,
  };
}

type Key = string | number;

const UNSCOPED = Symbol("unscoped");

export interface KeyedReadOptions<A, T, K extends Key> {
  /**
   * What the answers stand for, such as the loaded game data's version. A reply asked for in an
   * older scope lands nowhere, and a new scope asks every key again. Unset, only `clear` starts a
   * new one.
   */
  scope?: () => unknown;
  /** The key `ask` is held under; the ask itself when it is a key. */
  key?: (ask: A) => K;
  /** At most this many asks go in one read. */
  batch?: number;
  /** Gathers the asks made within this many milliseconds of the last into one read; unset, each reads at once. */
  wait?: number;
  /** Lands the answer to `asks`, those of the read still wanted, which are no longer pending. */
  answered(asks: A[], answer: T): void;
  /** Lands a failed read of `asks`, which are no longer pending, so asking again reads them again. */
  failed(asks: A[], message: string): void;
}

/** Reads once per key: an ask already on its way is not sent again, and a reply nobody wants is dropped. */
export interface KeyedReads<A, K extends Key> {
  /** Reads those of `asks` not on their way already; resolves once the reads it started have landed. */
  read(asks: Iterable<A>): Promise<void>;
  /** Whether the read of `key` is on its way. */
  asked(key: K): boolean;
  /** The keys whose read is on its way. */
  pending(): Set<K>;
  /** Drops the reads of `keys` on their way: their replies land nowhere, and the keys can be asked again. */
  drop(keys: Iterable<K>): void;
  /** Drops every read on its way, as a new scope does. */
  clear(): void;
}

export function keyedReads<A extends Key, T>(
  fetch: (asks: A[]) => Promise<T>,
  options: KeyedReadOptions<A, T, A>,
): KeyedReads<A, A>;
export function keyedReads<A, T, K extends Key>(
  fetch: (asks: A[]) => Promise<T>,
  options: KeyedReadOptions<A, T, K> & { key: (ask: A) => K },
): KeyedReads<A, K>;
/**
 * One cache's reads by key, sent through `fetch`. Each key asked for is marked until its reply
 * lands, so asking again meanwhile sends nothing. The cache holds the answers: `answered` and
 * `failed` land them.
 */
export function keyedReads<A, T, K extends Key>(
  fetch: (asks: A[]) => Promise<T>,
  options: KeyedReadOptions<A, T, K>,
): KeyedReads<A, K> {
  const keyOf = options.key ?? ((ask: A) => ask as unknown as K);
  const epoch = latest();
  let scoped: unknown = UNSCOPED;
  /** Each key on its way, with the mark of the ask that sent it. */
  let marks = new Map<K, number>();
  let marked = 0;
  /** Asks waiting for the gathering read, each with its mark. */
  let waiting: [A, number][] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let gathered: { done: Promise<void>; land: () => void } | null = null;

  function clear(): void {
    epoch.next();
    marks = new Map();
    waiting = [];
    if (timer !== null) clearTimeout(timer);
    timer = null;
    gathered?.land();
    gathered = null;
  }

  function inScope(): void {
    const now = options.scope?.();
    if (now === scoped) return;
    scoped = now;
    clear();
  }

  async function send(asks: [A, number][]): Promise<void> {
    const mine = epoch.current();
    let reply: { answer: T } | { message: string };
    try {
      reply = { answer: await fetch(asks.map(([ask]) => ask)) };
    } catch (e) {
      reply = { message: errorMessage(e) };
    }
    inScope();
    if (!epoch.is(mine)) return;
    const wanted = asks.filter(([ask, mark]) => marks.get(keyOf(ask)) === mark).map(([a]) => a);
    if (wanted.length === 0) return;
    for (const ask of wanted) marks.delete(keyOf(ask));
    if ("answer" in reply) options.answered(wanted, reply.answer);
    else options.failed(wanted, reply.message);
  }

  async function flush(): Promise<void> {
    timer = null;
    inScope();
    const asks = waiting;
    waiting = [];
    const size = options.batch ?? asks.length;
    const sends: Promise<void>[] = [];
    for (let i = 0; i < asks.length; i += size) sends.push(send(asks.slice(i, i + size)));
    await Promise.all(sends);
  }

  function gather(wait: number): Promise<void> {
    if (timer !== null) clearTimeout(timer);
    gathered ??= (() => {
      let land = () => undefined as void;
      const done = new Promise<void>((resolve) => (land = resolve));
      return { done, land };
    })();
    const waiter = gathered;
    timer = setTimeout(() => {
      gathered = null;
      void flush().then(waiter.land);
    }, wait);
    return waiter.done;
  }

  return {
    read(asks) {
      inScope();
      for (const ask of asks) {
        const key = keyOf(ask);
        if (marks.has(key)) continue;
        marks.set(key, ++marked);
        waiting.push([ask, marked]);
      }
      if (waiting.length === 0) return gathered?.done ?? Promise.resolve();
      return options.wait === undefined ? flush() : gather(options.wait);
    },
    asked(key) {
      inScope();
      return marks.has(key);
    },
    pending() {
      inScope();
      return new Set(marks.keys());
    },
    drop(keys) {
      for (const key of keys) marks.delete(key);
    },
    clear,
  };
}
