/**
 * Preparing the open scenario for a new game.
 * Command and argument names match `app/src-tauri/src/commands/prepare.rs`.
 */
import { invoke } from "@tauri-apps/api/core";
import type { PreparedEdit } from "../generated/PreparedEdit";
import type { PreparePreview } from "../generated/PreparePreview";
import type { RowChoice } from "../generated/RowChoice";

/**
 * What `choices` would do to the open scenario: each row's systems and how many systems the one
 * edit would change. Rejects with `SgfError` (kind `op`) without game data or on a save.
 */
export function preparePreview(choices: RowChoice[]): Promise<PreparePreview> {
  return invoke<PreparePreview>("prepare_preview", { choices });
}

/**
 * Write `choices` over the open scenario as one edit, one undo step, with how many systems it
 * changed; null when they change nothing. Rejects as `preparePreview` does.
 */
export function prepareApply(choices: RowChoice[]): Promise<PreparedEdit | null> {
  return invoke<PreparedEdit | null>("prepare_apply", { choices });
}
