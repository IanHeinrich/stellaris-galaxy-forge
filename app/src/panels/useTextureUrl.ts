import { useEffect, useSyncExternalStore } from "react";
import { firstTextureUrl, getTexture, onTextures, requestTextures } from "../lib/visual/textures";

/**
 * The first of `keys` whose texture has landed, as a data URL for an `<img>`, waiting on a key
 * still loading before it tries the next; the keys not yet known are requested from the cache the
 * map uses, and the caller redraws when they settle.
 */
export function useTextureUrl(keys: readonly string[]): string | undefined {
  // Every render, so a cleared cache is asked again as the map layers ask from their render path.
  useEffect(() => {
    const missing = keys.filter((key) => key !== "" && getTexture(key) === undefined);
    if (missing.length > 0) requestTextures(missing);
  });

  return useSyncExternalStore(onTextures, () => firstTextureUrl(keys));
}
