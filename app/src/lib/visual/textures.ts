/**
 * Textures rendered by the Rust side, keyed like `TextureView.key`. A module-level cache rather
 * than a store: layers read it in their render path and redraw on `onTextures`.
 */
import type { Texture } from "pixi.js";
import { getTextures } from "../../api/textures";
import type { TextureView } from "../../generated/TextureView";

export type TextureDecoder = (view: TextureView) => Promise<Texture>;

const BATCH = 100;

const cache = new Map<string, Texture | null>();
/** PNG data URLs of landed textures, for DOM elements such as tooltips. */
const urls = new Map<string, string>();
const inflight = new Set<string>();
const listeners = new Set<(keys: string[]) => void>();
let queue: string[] = [];
let flush: ReturnType<typeof setTimeout> | null = null;
let generation = 0;
let decode: TextureDecoder = decodePng;

/** `undefined` when never requested or still loading, `null` when the key could not be rendered. */
export function getTexture(key: string): Texture | null | undefined {
  return cache.get(key);
}

/** The landed texture as a PNG data URL, for an `<img>`; undefined until it lands. */
export function getTextureUrl(key: string): string | undefined {
  return urls.get(key);
}

/** Fetches the keys not yet known; every request made in the same macrotask goes out as one call. */
export function requestTextures(keys: Iterable<string>): void {
  for (const key of keys) {
    if (cache.has(key) || inflight.has(key)) continue;
    inflight.add(key);
    queue.push(key);
  }
  if (queue.length > 0 && flush === null) flush = setTimeout(flushQueue, 0);
}

/** Called with the keys that settled (as a texture or as `null`) after each batch. */
export function onTextures(listener: (keys: string[]) => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/**
 * Forgets every texture. Listeners hear first, with every key that was cached, so they drop
 * their sprites' references; the GPU memory is released a macrotask later, once nothing
 * still draws it.
 */
export function clearTextures(): void {
  generation++;
  if (flush !== null) clearTimeout(flush);
  flush = null;
  queue = [];
  inflight.clear();
  const dropped = [...cache.entries()];
  cache.clear();
  urls.clear();
  const keys = dropped.map(([key]) => key);
  for (const listener of listeners) listener(keys);
  setTimeout(() => {
    for (const [, texture] of dropped) texture?.destroy(true);
  }, 0);
}

/** Replaces the PNG decoder; tests use it to keep PixiJS and `createImageBitmap` out of the loop. */
export function setTextureDecoder(decoder: TextureDecoder | null): void {
  decode = decoder ?? decodePng;
}

function flushQueue(): void {
  flush = null;
  const keys = queue;
  queue = [];
  for (let i = 0; i < keys.length; i += BATCH)
    void fetchBatch(keys.slice(i, i + BATCH), generation);
}

async function fetchBatch(keys: string[], gen: number): Promise<void> {
  const views = await getTextures(keys).catch((e: unknown) =>
    keys.map((key) => ({ key, width: 0, height: 0, png_base64: null, error: String(e) })),
  );
  const textures = await Promise.all(views.map(toTexture));
  if (gen !== generation) {
    for (const texture of textures) texture?.destroy(true);
    return;
  }
  const settled: string[] = [];
  views.forEach((view, i) => {
    cache.set(view.key, textures[i]);
    if (textures[i] && view.png_base64)
      urls.set(view.key, `data:image/png;base64,${view.png_base64}`);
    settled.push(view.key);
  });
  for (const key of keys) inflight.delete(key);
  for (const listener of listeners) listener(settled);
}

async function toTexture(view: TextureView): Promise<Texture | null> {
  if (view.png_base64 === null || view.error !== null) return failed(view.key, view.error);
  return decode(view).catch((e: unknown) => failed(view.key, e));
}

const warned = new Set<string>();

function failed(key: string, error: unknown): null {
  if (!warned.has(key)) {
    warned.add(key);
    console.warn("texture", key, error);
  }
  return null;
}

async function decodePng(view: TextureView): Promise<Texture> {
  const { ImageSource, Texture } = await import("pixi.js");
  const bytes = Uint8Array.from(atob(view.png_base64 ?? ""), (c) => c.charCodeAt(0));
  const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
  const source = new ImageSource({
    resource: bitmap,
    scaleMode: "linear",
    autoGenerateMipmaps: isPowerOfTwo(bitmap.width) && isPowerOfTwo(bitmap.height),
  });
  return new Texture({ source });
}

function isPowerOfTwo(n: number): boolean {
  return n > 0 && (n & (n - 1)) === 0;
}
