import { vi } from "vitest";
import type { ModelPlacement } from "../generated/ModelPlacement";
import type { TextureView } from "../generated/TextureView";

/** How the fake answers. A test sets it, and `resetTextureFetch` puts it back. */
export const textureFetch = {
  /**
   * `none` answers with no views, `views` with one per key, `held` with one per key once
   * `release` is called, and `never` does not answer.
   */
  mode: "none" as "none" | "views" | "held" | "never",
  /** The keys that answer with an error where `mode` answers with views. */
  fails: (() => false) as (key: string) => boolean,
  /** Where a `model:` key's sprite goes, as the baker answers it; none for any other key. */
  model: (() => undefined) as (key: string) => ModelPlacement | undefined,
  release: null as (() => void) | null,
};

export function resetTextureFetch(): void {
  textureFetch.mode = "none";
  textureFetch.fails = () => false;
  textureFetch.model = () => undefined;
  textureFetch.release = null;
}

/**
 * What the fake answers for `key`: a one-pixel picture with the placement `model` gives it, or an
 * error where `fails` says so.
 */
export function textureView(key: string): TextureView {
  if (textureFetch.fails(key)) {
    return { key, width: 0, height: 0, png_base64: null, error: "no map" };
  }
  const model = textureFetch.model(key);
  return { key, width: 1, height: 1, png_base64: "", error: null, ...(model && { model }) };
}

/**
 * Stands in for `api/gamedata`, whose `getTextures` the texture cache calls: a test passes this
 * module to `vi.mock("<path>/api/gamedata", () => import("<path>/test/textures"))`.
 */
export const getTextures = vi.fn((keys: string[]): Promise<TextureView[]> => {
  switch (textureFetch.mode) {
    case "none":
      return Promise.resolve([]);
    case "views":
      return Promise.resolve(keys.map(textureView));
    case "held":
      return new Promise((resolve) => {
        textureFetch.release = () => resolve(keys.map(textureView));
      });
    case "never":
      return new Promise(() => {});
  }
});
