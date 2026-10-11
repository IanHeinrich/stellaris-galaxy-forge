import { useEffect } from "react";
import { create } from "zustand";
import * as ipc from "../api/ipc";
import type { InitializerDefinition } from "../generated/InitializerDefinition";
import { useGameDataStore } from "./gameDataStore";

/** One definition's read: asked for, answered, or refused with the message to show. */
export type DefinitionRead =
  { pending: true } | { definition: InitializerDefinition } | { error: string };

export interface InitializerDefinitionsState {
  /** The game data version the reads below were answered by. */
  version: number;
  reads: Map<string, DefinitionRead>;
  /** Reads `name`'s definition once for game data `version`; a later version drops every read. */
  request(name: string, version: number): void;
}

export const useInitializerDefinitions = create<InitializerDefinitionsState>((set, get) => ({
  version: 0,
  reads: new Map(),

  request(name, version) {
    const state = get();
    const reads = state.version === version ? state.reads : new Map<string, DefinitionRead>();
    if (reads.has(name)) return;
    set({ version, reads: new Map(reads).set(name, { pending: true }) });
    void ipc.getInitializerDefinition(name).then(
      (definition) => settle(name, version, { definition }),
      (e: unknown) => settle(name, version, { error: ipc.errorMessage(e) }),
    );
  },
}));

function settle(name: string, version: number, read: DefinitionRead): void {
  const state = useInitializerDefinitions.getState();
  if (state.version !== version) return;
  useInitializerDefinitions.setState({ reads: new Map(state.reads).set(name, read) });
}

/**
 * Initializer `name`'s definition as the loaded game data has it, read once per game data
 * version; null for no name, and while no game data is loaded.
 */
export function useInitializerDefinition(
  name: string,
): { value: InitializerDefinition | undefined; error: string | undefined } | null {
  const ready = useGameDataStore((s) => s.status === "ready");
  const version = useGameDataStore((s) => s.version);
  const read = useInitializerDefinitions((s) =>
    s.version === version ? s.reads.get(name) : undefined,
  );
  const request = useInitializerDefinitions((s) => s.request);
  const wanted = ready && name !== "";

  useEffect(() => {
    if (wanted) request(name, version);
  }, [wanted, name, version, request]);

  if (!wanted) return null;
  if (read === undefined || "pending" in read) return { value: undefined, error: undefined };
  return "error" in read
    ? { value: undefined, error: read.error }
    : { value: read.definition, error: undefined };
}
