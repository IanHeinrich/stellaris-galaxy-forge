import type { GalaxyDelta } from "../generated/GalaxyDelta";
import { addTo, deleteFrom } from "./multiMap";

/** What a table files: something drawn or picked between two systems, under a key of its kind. */
export interface Tabled {
  readonly key: string;
  readonly ends: readonly [number, number];
}

/**
 * The entries between systems that the lanes layer and the pick index file, each once by key,
 * with the systems each touches and the ends a system named before the galaxy held them. A
 * delta drops what its systems are ends of, and says which systems to derive again.
 */
export class LaneTable<E extends Tabled> {
  private readonly entries = new Map<string, E>();
  private readonly byId = new Map<number, Set<E>>();
  /** Systems an entry names that the document does not hold, and the systems naming them. */
  private readonly dangling = new Map<number, Set<number>>();

  clear(): void {
    this.entries.clear();
    this.byId.clear();
    this.dangling.clear();
  }

  has(key: string): boolean {
    return this.entries.has(key);
  }

  add(entry: E): void {
    this.entries.set(entry.key, entry);
    for (const end of entry.ends) addTo(this.byId, end, entry);
  }

  /** The entries system `id` is an end of. */
  of(id: number): ReadonlySet<E> {
    return this.byId.get(id) ?? NONE;
  }

  /** Notes that `from` names `missing`, which the galaxy does not hold yet. */
  waitFor(missing: number, from: number): void {
    addTo(this.dangling, missing, from);
  }

  /**
   * Drops every entry a system of `delta` is an end of, handing each to `dropped`, and returns
   * the systems to derive again: the ends of what went, the delta's own systems, and any that
   * named one of them before it was there.
   */
  release(delta: GalaxyDelta, dropped: (entry: E) => void): Set<number> {
    const again = new Set<number>();
    for (const id of [...(delta.removed ?? []), ...delta.systems.map((s) => s.id)]) {
      for (const entry of [...this.of(id)]) {
        this.remove(entry);
        dropped(entry);
        for (const end of entry.ends) again.add(end);
      }
      for (const from of this.dangling.get(id) ?? []) again.add(from);
      this.dangling.delete(id);
    }
    for (const s of delta.systems) again.add(s.id);
    return again;
  }

  private remove(entry: E): void {
    this.entries.delete(entry.key);
    for (const end of entry.ends) deleteFrom(this.byId, end, entry);
  }
}

const NONE: ReadonlySet<never> = new Set();
