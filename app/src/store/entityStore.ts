import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { EditResult } from "../generated/EditResult";
import type { EntityAddr } from "../generated/EntityAddr";
import type { EntityKind } from "../generated/EntityKind";
import type { EntitySchema } from "../generated/EntitySchema";
import type { EntitySource } from "../generated/EntitySource";
import type { EntityView } from "../generated/EntityView";
import type { PlanetPage } from "../generated/PlanetPage";

/** One entity, whichever level of it is being read. */
export function addrKey(addr: EntityAddr): string {
  return `${addr.kind}:${addr.id}`;
}

/** One level of one entity: what the view cache is keyed by. */
export function viewKey(addr: EntityAddr, path: readonly string[] = []): string {
  return path.length === 0 ? addrKey(addr) : `${addrKey(addr)}/${path.join("/")}`;
}

/** An entity's whole text, which is one read of its own. */
function sourceKey(addr: EntityAddr): string {
  return `source/${addrKey(addr)}`;
}

/** A save body's page, which is one read of its own. */
export function planetPageKey(id: number): string {
  return `page/${addrKey({ kind: "planet", id })}`;
}

const PAGE_PREFIX = "page/";
const READ_PREFIX = /^(source|page)\//;

/** The entity a key belongs to: the read it names, without its kind of read or its path. */
function ownerOf(key: string): string {
  const body = key.replace(READ_PREFIX, "");
  const cut = body.indexOf("/");
  return cut === -1 ? body : body.slice(0, cut);
}

export interface EntityState {
  /** Views by `viewKey`: one entry per level, so a drill keeps the level above it. */
  views: Map<string, EntityView>;
  /** Sources by `addrKey`; an entity has one whole text, not one per level. */
  sources: Map<string, EntitySource>;
  schemas: Map<EntityKind, EntitySchema>;
  /** Save bodies' pages by planet id. */
  pages: Map<number, PlanetPage>;
  /** Reads asked for and not yet answered, by the key of what was asked for. */
  pending: Set<string>;
  /** What a refused read said, by the same key; a refused read is not asked for again. */
  errors: Map<string, string>;
  /** Bumped whenever anything lands, is dropped or is cleared. */
  version: number;
  /** Reads one level of an entity, unless the cache or a read in flight already answers for it. */
  request(addr: EntityAddr, path?: readonly string[]): void;
  requestSource(addr: EntityAddr): void;
  requestSchema(kind: EntityKind): void;
  requestPlanetPage(id: number): void;
  /**
   * What an applied edit, undo or redo leaves behind: every entity it rewrote is stale, and so
   * is every page of a body in a system it touched or removed.
   */
  noteEdit(result: EditResult): void;
  /** Drops every level and the source of each entity, so the next request reads it again. */
  invalidate(addrs: readonly EntityAddr[]): void;
  clear(): void;
}

/** Bumped by `clear`; an answer from an older session is dropped. */
let generation = 0;

/** Reads an edit overtook: their answer reads the bytes as they were, so it is thrown away. */
const dropped = new Set<string>();

export const useEntityStore = create<EntityState>((set, get) => ({
  views: new Map(),
  sources: new Map(),
  schemas: new Map(),
  pages: new Map(),
  pending: new Set(),
  errors: new Map(),
  version: 0,

  request(addr, path = []) {
    const key = viewKey(addr, path);
    if (!begin(key, get().views.has(key))) return;
    void land(key, generation, ipc.getEntity(addr, [...path]), (view) => ({
      views: new Map(useEntityStore.getState().views).set(key, view),
    }));
  },

  requestSource(addr) {
    const key = addrKey(addr);
    if (!begin(sourceKey(addr), get().sources.has(key))) return;
    void land(sourceKey(addr), generation, ipc.getEntitySource(addr), (source) => ({
      sources: new Map(useEntityStore.getState().sources).set(key, source),
    }));
  },

  requestSchema(kind) {
    if (!begin(`schema/${kind}`, get().schemas.has(kind))) return;
    void land(`schema/${kind}`, generation, ipc.getEntitySchema(kind), (schema) => ({
      schemas: new Map(useEntityStore.getState().schemas).set(kind, schema),
    }));
  },

  requestPlanetPage(id) {
    const key = planetPageKey(id);
    if (!begin(key, get().pages.has(id))) return;
    void land(key, generation, ipc.getPlanetPage(id), (page) => ({
      pages: new Map(useEntityStore.getState().pages).set(id, page),
    }));
  },

  noteEdit(result) {
    const systems = new Set([
      ...result.touched_entities.filter((addr) => addr.kind === "system").map((addr) => addr.id),
      ...result.details_stale,
      ...(result.delta.removed ?? []),
    ]);
    const pages = [...get().pages.values()]
      .filter((page) => page.system !== null && systems.has(page.system))
      .map((page): EntityAddr => ({ kind: "planet", id: page.id }));
    get().invalidate([...result.touched_entities, ...pages]);
    if (systems.size > 0) dropPendingPages();
  },

  invalidate(addrs) {
    if (addrs.length === 0) return;
    const owners = new Set(addrs.map(addrKey));
    const stale = (key: string) => owners.has(ownerOf(key));
    const views = new Map([...get().views].filter(([key]) => !stale(key)));
    const sources = new Map([...get().sources].filter(([key]) => !stale(key)));
    const pages = new Map([...get().pages].filter(([id]) => !stale(planetPageKey(id))));
    const errors = new Map([...get().errors].filter(([key]) => !stale(key)));
    // A read already out would land on the pre-edit bytes: it is dropped, not cached.
    const pending = new Set(get().pending);
    for (const key of pending) {
      if (!stale(key)) continue;
      pending.delete(key);
      dropped.add(key);
    }
    set({ views, sources, pages, errors, pending, version: get().version + 1 });
  },

  clear() {
    generation++;
    dropped.clear();
    set({
      views: new Map(),
      sources: new Map(),
      schemas: new Map(),
      pages: new Map(),
      pending: new Set(),
      errors: new Map(),
      version: get().version + 1,
    });
  },
}));

/** A page read already out does not say which system it is in, so any edit to a system drops it. */
function dropPendingPages(): void {
  const { pending, version } = useEntityStore.getState();
  const kept = new Set([...pending].filter((key) => !key.startsWith(PAGE_PREFIX)));
  if (kept.size === pending.size) return;
  for (const key of pending) if (!kept.has(key)) dropped.add(key);
  useEntityStore.setState({ pending: kept, version: version + 1 });
}

/** Starts one read, or says the cache, a read in flight or a refusal already answers for it. */
function begin(key: string, cached: boolean): boolean {
  const { pending, errors, version } = useEntityStore.getState();
  if (cached || pending.has(key) || errors.has(key)) return false;
  dropped.delete(key);
  useEntityStore.setState({ pending: new Set(pending).add(key), version: version + 1 });
  return true;
}

async function land<T>(
  key: string,
  gen: number,
  read: Promise<T>,
  apply: (value: T) => Partial<EntityState>,
): Promise<void> {
  let patch: Partial<EntityState>;
  try {
    const value = await read;
    if (gen !== generation || dropped.delete(key)) return;
    patch = apply(value);
  } catch (e) {
    if (gen !== generation || dropped.delete(key)) return;
    patch = { errors: new Map(useEntityStore.getState().errors).set(key, ipc.errorMessage(e)) };
  }
  const { pending, version } = useEntityStore.getState();
  const next = new Set(pending);
  next.delete(key);
  useEntityStore.setState({ ...patch, pending: next, version: version + 1 });
}
