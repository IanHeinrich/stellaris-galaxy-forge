import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { EditResult } from "../generated/EditResult";
import type { EntityAddr } from "../generated/EntityAddr";
import type { EntityKind } from "../generated/EntityKind";
import type { EntitySchema } from "../generated/EntitySchema";
import type { EntitySource } from "../generated/EntitySource";
import type { EntityView } from "../generated/EntityView";
import type { PlanetPage } from "../generated/PlanetPage";
import type { SystemDetails } from "../generated/SystemDetails";
import { keyedReads, type KeyedReads } from "./reads";

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

/** A save body read alone, where its system's details don't list it. */
function unlistedKey(id: number): string {
  return `unlisted/${addrKey({ kind: "planet", id })}`;
}

const READ_PREFIX = /^(source|page|unlisted)\//;

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
  /**
   * Save bodies' pages by planet id. A page an edit made stale stays until its fresh read lands,
   * so the inspector keeps showing it rather than a loading line.
   */
  pages: Map<number, PlanetPage>;
  /** The pages an edit made stale, read again on their next request. */
  stalePages: Set<number>;
  /** Save bodies and their moons read alone by planet id, `null` where the save holds none. */
  unlisted: Map<number, SystemDetails | null>;
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
  /** Reads save body `id` alone, in the system it names, else `system`. */
  requestUnlisted(id: number, system: number): void;
  /**
   * What an applied edit, undo or redo leaves behind: every entity it rewrote is stale, and so
   * is the page of every planet listing a rewritten moon. A touched or removed system also
   * stales the wormhole reads and drops the page reads in flight.
   */
  noteEdit(result: EditResult): void;
  /** Drops every level and the source of each entity, so the next request reads it again. */
  invalidate(addrs: readonly EntityAddr[]): void;
  clear(): void;
}

/** One kind of read, held in `pending` and `errors` under `key`. */
function entityReads<A, T>(
  fetch: (ask: A) => Promise<T>,
  key: (ask: A) => string,
  apply: (ask: A, value: T) => Partial<EntityState>,
): KeyedReads<A, string> {
  return keyedReads(([ask]: A[]) => fetch(ask), {
    key,
    batch: 1,
    answered: ([ask], value) => land(apply(ask, value)),
    failed: ([ask], message) =>
      land({ errors: new Map(useEntityStore.getState().errors).set(key(ask), message) }),
  });
}

interface ViewAsk {
  addr: EntityAddr;
  path: readonly string[];
}

const viewReads = entityReads(
  ({ addr, path }: ViewAsk) => ipc.getEntity(addr, [...path]),
  ({ addr, path }) => viewKey(addr, path),
  ({ addr, path }, view) => ({
    views: new Map(useEntityStore.getState().views).set(viewKey(addr, path), view),
  }),
);

const sourceReads = entityReads(
  (addr: EntityAddr) => ipc.getEntitySource(addr),
  sourceKey,
  (addr, source) => ({
    sources: new Map(useEntityStore.getState().sources).set(addrKey(addr), source),
  }),
);

const schemaReads = entityReads(
  (kind: EntityKind) => ipc.getEntitySchema(kind),
  (kind) => `schema/${kind}`,
  (kind, schema) => ({ schemas: new Map(useEntityStore.getState().schemas).set(kind, schema) }),
);

const pageReads = entityReads(
  (id: number) => ipc.getPlanetPage(id),
  planetPageKey,
  (id, page) => {
    const stalePages = new Set(useEntityStore.getState().stalePages);
    stalePages.delete(id);
    return { pages: new Map(useEntityStore.getState().pages).set(id, page), stalePages };
  },
);

const unlistedReads = entityReads(
  ({ id, system }: { id: number; system: number }) => ipc.getUnlistedBody(id, system),
  ({ id }) => unlistedKey(id),
  ({ id }, alone) => ({ unlisted: new Map(useEntityStore.getState().unlisted).set(id, alone) }),
);

const ALL_READS: Omit<KeyedReads<never, string>, "read">[] = [
  viewReads,
  sourceReads,
  schemaReads,
  pageReads,
  unlistedReads,
];

function pendingNow(): Set<string> {
  return new Set(ALL_READS.flatMap((reads) => [...reads.pending()]));
}

export const useEntityStore = create<EntityState>((set, get) => ({
  views: new Map(),
  sources: new Map(),
  schemas: new Map(),
  pages: new Map(),
  stalePages: new Set(),
  unlisted: new Map(),
  pending: new Set(),
  errors: new Map(),
  version: 0,

  request(addr, path = []) {
    const key = viewKey(addr, path);
    begin(viewReads, { addr, path }, key, get().views.has(key));
  },

  requestSource(addr) {
    begin(sourceReads, addr, sourceKey(addr), get().sources.has(addrKey(addr)));
  },

  requestSchema(kind) {
    begin(schemaReads, kind, `schema/${kind}`, get().schemas.has(kind));
  },

  requestPlanetPage(id) {
    const cached = get().pages.has(id) && !get().stalePages.has(id);
    begin(pageReads, id, planetPageKey(id), cached);
  },

  requestUnlisted(id, system) {
    begin(unlistedReads, { id, system }, unlistedKey(id), get().unlisted.has(id));
  },

  noteEdit(result) {
    const systems = new Set([
      ...result.touched_entities.filter((addr) => addr.kind === "system").map((addr) => addr.id),
      ...result.details_stale,
      ...(result.delta.removed ?? []),
    ]);
    const wormholes = systems.size > 0 ? wormholeReads(get()) : [];
    const planets = new Set(
      result.touched_entities.filter((addr) => addr.kind === "planet").map((addr) => addr.id),
    );
    const hosts = [...get().pages.values()]
      .filter((page) => page.moons.some((moon) => planets.has(moon.id)))
      .map((page): EntityAddr => ({ kind: "planet", id: page.id }));
    get().invalidate([...result.touched_entities, ...hosts, ...wormholes]);
    if (systems.size > 0) dropPendingPages();
  },

  invalidate(addrs) {
    if (addrs.length === 0) return;
    const owners = new Set(addrs.map(addrKey));
    const stale = (key: string) => owners.has(ownerOf(key));
    const views = new Map([...get().views].filter(([key]) => !stale(key)));
    const sources = new Map([...get().sources].filter(([key]) => !stale(key)));
    const stalePages = new Set(get().stalePages);
    for (const id of get().pages.keys()) if (stale(planetPageKey(id))) stalePages.add(id);
    const unlisted = new Map([...get().unlisted].filter(([id]) => !stale(unlistedKey(id))));
    const errors = new Map([...get().errors].filter(([key]) => !stale(key)));
    // A read already out would land on the pre-edit bytes: it is dropped, not cached.
    for (const reads of ALL_READS) reads.drop([...reads.pending()].filter(stale));
    set({
      views,
      sources,
      stalePages,
      unlisted,
      errors,
      pending: pendingNow(),
      version: get().version + 1,
    });
  },

  clear() {
    for (const reads of ALL_READS) reads.clear();
    set({
      views: new Map(),
      sources: new Map(),
      schemas: new Map(),
      pages: new Map(),
      stalePages: new Set(),
      unlisted: new Map(),
      pending: new Set(),
      errors: new Map(),
      version: get().version + 1,
    });
  },
}));

/** Every wormhole read cached or out: none is filed under its system, so any edit to a system drops them. */
function wormholeReads(state: EntityState): EntityAddr[] {
  const owners = [
    ...state.views.keys(),
    ...state.sources.keys(),
    ...state.errors.keys(),
    ...state.pending,
  ].map(ownerOf);
  const ids = new Set(
    owners.filter((key) => key.startsWith("wormhole:")).map((key) => Number(key.slice(9))),
  );
  return [...ids].map((id): EntityAddr => ({ kind: "wormhole", id }));
}

/** A page read already out does not say which system it is in, so any edit to a system drops it. */
function dropPendingPages(): void {
  const pages = pageReads.pending();
  if (pages.size === 0) return;
  pageReads.drop(pages);
  const { version } = useEntityStore.getState();
  useEntityStore.setState({ pending: pendingNow(), version: version + 1 });
}

/** Starts one read, unless the cache, a read in flight or a refusal already answers for it. */
function begin<A>(reads: KeyedReads<A, string>, ask: A, key: string, cached: boolean): void {
  const { errors, version } = useEntityStore.getState();
  if (cached || errors.has(key) || reads.asked(key)) return;
  void reads.read([ask]);
  useEntityStore.setState({ pending: pendingNow(), version: version + 1 });
}

function land(patch: Partial<EntityState>): void {
  const { version } = useEntityStore.getState();
  useEntityStore.setState({ ...patch, pending: pendingNow(), version: version + 1 });
}
