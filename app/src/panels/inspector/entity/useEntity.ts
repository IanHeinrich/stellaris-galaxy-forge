import { useEffect } from "react";
import type { EntityAddr } from "../../../generated/EntityAddr";
import type { EntityKind } from "../../../generated/EntityKind";
import type { EntitySchema } from "../../../generated/EntitySchema";
import type { EntitySource } from "../../../generated/EntitySource";
import type { EntityView } from "../../../generated/EntityView";
import type { FieldSchema } from "../../../generated/FieldSchema";
import type { PlanetPage } from "../../../generated/PlanetPage";
import { addrKey, planetPageKey, useEntityStore, viewKey } from "../../../store/entityStore";
import { refFor, useInspectorStore } from "../../../store/inspectorStore";

/** The system the stack is rooted in: what a station drill needs and the map keeps selected. */
export function useRootSystem(): number | null {
  return useInspectorStore((s) => {
    const root = s.stack[0]?.ref;
    return root !== undefined && root.kind === "system" ? root.id : null;
  });
}

/** Drilling onto an entity, keeping the map where it is. */
export interface EntityOpener {
  /** Whether a drill onto `addr` has anywhere to go from where the stack stands. */
  opens(addr: EntityAddr): boolean;
  open(addr: EntityAddr, label: string): void;
}

export function useOpenEntity(): EntityOpener {
  const open = useInspectorStore((s) => s.open);
  const system = useRootSystem();
  return {
    opens: (addr) => refFor(addr, system) !== null,
    open: (addr, label) => {
      const ref = refFor(addr, system);
      if (ref !== null) open({ ref, label });
    },
  };
}

/** A read the inspector is waiting on, has been answered, or has been refused. */
export interface Read<T> {
  value: T | undefined;
  error: string | undefined;
}

/** One level of an entity, asked for the first time it is shown. */
export function useEntityView(addr: EntityAddr, path: readonly string[]): Read<EntityView> {
  const key = viewKey(addr, path);
  const request = useEntityStore((s) => s.request);
  const value = useEntityStore((s) => s.views.get(key));
  const error = useEntityStore((s) => s.errors.get(key));
  useEffect(() => request(addr, path), [request, addr, path]);
  return { value, error };
}

export function useEntitySource(addr: EntityAddr): Read<EntitySource> {
  const key = addrKey(addr);
  const request = useEntityStore((s) => s.requestSource);
  const value = useEntityStore((s) => s.sources.get(key));
  const error = useEntityStore((s) => s.errors.get(`source/${key}`));
  useEffect(() => request(addr), [request, addr]);
  return { value, error };
}

/**
 * A save body's page, asked for the first time it is shown and again once an edit, undo or redo
 * to its system has dropped it.
 */
export function usePlanetPage(id: number): Read<PlanetPage> {
  const request = useEntityStore((s) => s.requestPlanetPage);
  const value = useEntityStore((s) => s.pages.get(id));
  const error = useEntityStore((s) => s.errors.get(planetPageKey(id)));
  const version = useEntityStore((s) => s.version);
  useEffect(() => request(id), [request, id, version]);
  return { value, error };
}

/** A kind's schema, which crosses IPC once and then answers every entity of that kind. */
export function useEntitySchema(kind: EntityKind): Map<string, FieldSchema> {
  const request = useEntityStore((s) => s.requestSchema);
  const schema = useEntityStore((s) => s.schemas.get(kind));
  useEffect(() => request(kind), [request, kind]);
  return fieldsOf(schema);
}

function fieldsOf(schema: EntitySchema | undefined): Map<string, FieldSchema> {
  return new Map((schema?.fields ?? []).map((field) => [field.key, field]));
}
