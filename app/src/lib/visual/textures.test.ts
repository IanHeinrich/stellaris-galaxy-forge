import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Texture } from "pixi.js";
import type { TextureView } from "../../generated/TextureView";

vi.mock("../../api/textures", () => ({
  getTextures: vi.fn(),
}));

import * as api from "../../api/textures";
import {
  clearTextures,
  getTexture,
  onTextures,
  requestTextures,
  setTextureDecoder,
} from "./textures";

const getTextures = vi.mocked(api.getTextures);

/** Stands in for a decoded texture; the decoder is stubbed so PixiJS never loads. */
function fakeTexture(key: string): Texture {
  return { label: key, destroy: vi.fn() } as unknown as Texture;
}

function viewOf(key: string): TextureView {
  return key.startsWith("bad:")
    ? { key, width: 0, height: 0, png_base64: null, error: "no such sprite" }
    : { key, width: 16, height: 16, png_base64: "AAAA", error: null };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  clearTextures();
  setTextureDecoder(async (view) => fakeTexture(view.key));
  getTextures.mockImplementation(async (keys) => keys.map(viewOf));
});

afterEach(() => {
  setTextureDecoder(null);
  vi.useRealTimers();
});

describe("requestTextures", () => {
  it("sends every request made in the same tick as one call and caches what lands", async () => {
    const landed = vi.fn<(keys: string[]) => void>();
    const off = onTextures(landed);
    requestTextures(["star_class:g", "star_class:k"]);
    requestTextures(["star_class:k", "flag:1"]);
    expect(getTextures).not.toHaveBeenCalled();
    expect(getTexture("star_class:g")).toBeUndefined();

    await vi.advanceTimersByTimeAsync(0);
    expect(getTextures).toHaveBeenCalledTimes(1);
    expect(getTextures).toHaveBeenCalledWith(["star_class:g", "star_class:k", "flag:1"]);
    expect(landed).toHaveBeenCalledTimes(1);
    expect(landed).toHaveBeenCalledWith(["star_class:g", "star_class:k", "flag:1"]);
    expect((getTexture("star_class:g") as unknown as { label: string }).label).toBe("star_class:g");

    off();
    requestTextures(["star_class:g", "flag:2"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(getTextures).toHaveBeenLastCalledWith(["flag:2"]);
    expect(landed).toHaveBeenCalledTimes(1);
  });

  it("chunks a large request into calls of at most 100 keys", async () => {
    requestTextures(Array.from({ length: 250 }, (_, i) => `flag:${i}`));
    await vi.advanceTimersByTimeAsync(0);
    expect(getTextures).toHaveBeenCalledTimes(3);
    expect(getTextures.mock.calls.map(([keys]) => keys.length)).toEqual([100, 100, 50]);
  });

  it("caches a key that failed as null and never asks for it again", async () => {
    const landed = vi.fn<(keys: string[]) => void>();
    onTextures(landed);
    requestTextures(["bad:one", "star_class:g"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(getTexture("bad:one")).toBeNull();
    expect(landed).toHaveBeenCalledWith(["bad:one", "star_class:g"]);

    requestTextures(["bad:one"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(getTextures).toHaveBeenCalledTimes(1);
  });

  it("a rejected call settles its keys as null", async () => {
    getTextures.mockRejectedValueOnce({ kind: "no_session", message: "no game data" });
    requestTextures(["star_class:g"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(getTexture("star_class:g")).toBeNull();
  });
});

describe("clearTextures", () => {
  it("forgets every key, tells listeners before destroying the textures, and drops answers still in flight", async () => {
    requestTextures(["star_class:g"]);
    await vi.advanceTimersByTimeAsync(0);
    const texture = getTexture("star_class:g") as unknown as { destroy: ReturnType<typeof vi.fn> };

    let finish!: (views: TextureView[]) => void;
    getTextures.mockReturnValueOnce(new Promise((r) => (finish = r)));
    requestTextures(["flag:1"]);
    await vi.advanceTimersByTimeAsync(0);

    const heard: Array<{ keys: string[]; destroyed: number }> = [];
    const off = onTextures((keys) =>
      heard.push({ keys, destroyed: texture.destroy.mock.calls.length }),
    );
    clearTextures();
    off();
    expect(getTexture("star_class:g")).toBeUndefined();
    expect(heard).toEqual([{ keys: ["star_class:g"], destroyed: 0 }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(texture.destroy).toHaveBeenCalledTimes(1);

    finish([viewOf("flag:1")]);
    await vi.advanceTimersByTimeAsync(0);
    expect(getTexture("flag:1")).toBeUndefined();

    requestTextures(["star_class:g"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(getTextures).toHaveBeenCalledTimes(3);
  });
});
