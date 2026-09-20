/**
 * The game's art, rendered to PNG by the Rust side. Command names and argument names here match
 * `app/src-tauri/src/commands.rs`.
 */
import { invoke } from "@tauri-apps/api/core";
import type { TextureView } from "../generated/TextureView";

/** One texture per key, in order, as PNG; a key that cannot be rendered carries its `error` inline. */
export function getTextures(keys: string[]): Promise<TextureView[]> {
  return invoke<TextureView[]>("get_textures", { keys });
}
