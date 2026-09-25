/** Two ids, the smaller first. */
export type Pair = [number, number];

/** `a` and `b` as a pair, the smaller first. */
export function pairOf(a: number, b: number): Pair {
  return a < b ? [a, b] : [b, a];
}

/** Orders pairs by their first id, then their second. */
export function comparePairs(p: readonly [number, number], q: readonly [number, number]): number {
  return p[0] - q[0] || p[1] - q[1];
}

/** A value per unordered pair of ids, however round the pair is given; iterates in insertion order. */
export class PairMap<V> {
  private readonly map = new Map<string, V>();

  get size(): number {
    return this.map.size;
  }

  has(a: number, b: number): boolean {
    return this.map.has(pairKey(a, b));
  }

  get(a: number, b: number): V | undefined {
    return this.map.get(pairKey(a, b));
  }

  set(a: number, b: number, value: V): void {
    this.map.set(pairKey(a, b), value);
  }

  delete(a: number, b: number): void {
    this.map.delete(pairKey(a, b));
  }

  clear(): void {
    this.map.clear();
  }

  values(): IterableIterator<V> {
    return this.map.values();
  }
}

/** Unordered pairs of ids, each once. */
export class PairSet extends PairMap<Pair> {
  add(a: number, b: number): void {
    this.set(a, b, pairOf(a, b));
  }

  /** Every pair, ascending. */
  sorted(): Pair[] {
    return [...this.values()].sort(comparePairs);
  }
}

/** One string per unordered pair of ids, however round the pair is given. */
export function pairKey(a: number, b: number): string {
  return a < b ? `${a},${b}` : `${b},${a}`;
}
