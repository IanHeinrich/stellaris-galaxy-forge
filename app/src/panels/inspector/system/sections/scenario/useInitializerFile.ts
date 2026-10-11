import { useEffect, useMemo } from "react";
import { useCanEdit } from "../../../../../store/fileSessionStore";
import { useGameDataStore } from "../../../../../store/gameDataStore";

/**
 * The file the install defines initializer `name` in, where the open document reads scripts and
 * the loaded game data has it; `null` otherwise.
 */
export function useInitializerFile(name: string): string | null {
  const scripted = useCanEdit("scripts");
  const ready = useGameDataStore((s) => s.status === "ready");
  const initializers = useGameDataStore((s) => s.initializers);

  // Reading the install again once game data is ready is what fills the list in.
  useEffect(() => {
    if (scripted) void useGameDataStore.getState().loadInitializers();
  }, [scripted, ready]);

  return useMemo(
    () =>
      scripted && name !== "" ? (initializers?.find((e) => e.name === name)?.source ?? null) : null,
    [scripted, initializers, name],
  );
}
